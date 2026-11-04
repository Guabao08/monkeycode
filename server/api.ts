import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { firstAtLeast } from "../src/learning/first-at-least";
import { privateCases } from "./learning/first-at-least";
import type { ApiConfig } from "./config";
import type { Executor } from "./execution/types";
import type { ExecutionResult, Submission } from "../src/learning/execution";
import { AdmissionError, JobStore, unavailableResult } from "./job-store";
import { createStaticHandler } from "./static";

export type ApiServer = Server & { shutdown(): Promise<void> };
const MAX_BODY = 40 * 1024;
const MAX_CODE = 32 * 1024;
const categories = new Set(privateCases.map(item => item.category));
const statuses: Record<string, true> = { passed: true, "wrong-answer": true, "compile-error": true, "runtime-error": true, "resource-limit": true, "service-error": true };

function authenticate(request: IncomingMessage, config: ApiConfig): string | undefined {
  if (request.rawHeaders.filter((_, i) => i % 2 === 0 && request.rawHeaders[i]?.toLowerCase() === "authorization").length !== 1) return undefined;
  const value = request.headers.authorization;
  if (!value || !/^Bearer [\x21-\x7e]{32,4096}$/.test(value)) return undefined;
  const digest = createHash("sha256").update(value.slice(7)).digest();
  let invite: string | undefined;
  for (const entry of config.invites) if (timingSafeEqual(digest, entry.digest)) invite = entry.id;
  return invite;
}

async function parseSubmission(request: IncomingMessage): Promise<Submission> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) throw new AdmissionError(415, "Content-Type must be application/json");
  if (request.headers["content-encoding"] !== undefined) throw new AdmissionError(415, "Content encoding is not supported");
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) throw new AdmissionError(413, "Request body exceeds 40 KiB");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new AdmissionError(413, "Request body exceeds 40 KiB");
    chunks.push(buffer);
  }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new AdmissionError(400, "Invalid JSON body"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdmissionError(400, "Invalid submission");
  const item = value as Record<string, unknown>;
  const fields = ["exerciseId", "exerciseVersion", "language", "action", "code"];
  if (Object.keys(item).length !== fields.length || !fields.every(key => Object.hasOwn(item, key)) ||
      item.exerciseId !== "first-at-least" || item.exerciseVersion !== 1 ||
      (item.language !== "python" && item.language !== "java") || (item.action !== "run" && item.action !== "submit") ||
      typeof item.code !== "string" || item.code.includes("\0")) throw new AdmissionError(400, "Invalid submission fields");
  if (Buffer.byteLength(item.code, "utf8") > MAX_CODE) throw new AdmissionError(413, "Learner code exceeds 32 KiB");
  return item as unknown as Submission;
}

/** Reconstruct the response rather than passing through provider objects or private metadata. */
function sanitizeResult(value: ExecutionResult, config: ApiConfig): ExecutionResult {
  if (!value || !Object.hasOwn(statuses, value.status) || value.status === "service-error") return { ...unavailableResult };
  const result: ExecutionResult = { status: value.status, implementationComplexityVerified: false };
  if (value.status === "passed" || value.status === "wrong-answer" || value.feedback !== undefined) {
    const feedback = value.feedback;
    if (!feedback && value.status === "wrong-answer") return {
      status: "wrong-answer", message: "The returned output did not match the required answer format or value.", implementationComplexityVerified: false,
    };
    if (!feedback || feedback.status !== (value.status === "passed" ? "passed" : "wrong-answer")) return { ...unavailableResult };
    if ("failureCategories" in feedback) {
      if (!Array.isArray(feedback.failureCategories) || !feedback.failureCategories.every(category => categories.has(category))) return { ...unavailableResult };
      if ((value.status === "passed") !== (feedback.failureCategories.length === 0)) return { ...unavailableResult };
      result.feedback = { status: feedback.status, failureCategories: [...new Set(feedback.failureCategories)] };
    } else if ((value.status === "passed" || value.status === "wrong-answer") && "cases" in feedback && Array.isArray(feedback.cases) && feedback.cases.length === firstAtLeast.examples.length) {
      result.feedback = { status: feedback.status, cases: firstAtLeast.examples.map((example, index) => {
        const actual = feedback.cases[index]?.actual;
        const safeActual = typeof actual === "number" && Number.isFinite(actual) || typeof actual === "boolean" ? actual : null;
        return { index, expected: example.expected, actual: safeActual, passed: typeof actual === "number" && Number.isInteger(actual) && actual === example.expected };
      }) };
      if ((value.status === "passed") !== result.feedback.cases.every(item => item.passed)) return { ...unavailableResult };
    } else return { ...unavailableResult };
  } else if (typeof value.message === "string") {
    const diagnostic = Buffer.from(value.message.replaceAll(config.apiKey, "[redacted]").slice(0, 8192), "utf8");
    result.message = new TextDecoder().decode(diagnostic.subarray(0, 8192), { stream: true });
  }
  return result;
}

export function createApi(config: ApiConfig, executor: Executor): ApiServer {
  const serveWeb = config.webRoot ? createStaticHandler(config.webRoot) : undefined;
  const store = new JobStore(config);
  let stopping = false;
  const volatileResults = new Map<string, { result: ExecutionResult; expires: number }>();
  const cleanup = setInterval(() => {
    try {
      store.prune();
      for (const [id, item] of volatileResults) if (item.expires < Date.now()) volatileResults.delete(id);
    } catch { stopping = true; }
  }, 60_000);
  cleanup.unref();

  function respond(response: ServerResponse, status: number, body: unknown): void {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  }
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const target = request.url ?? "";
    if (serveWeb && target !== "/healthz" && target !== "/api" && !target.startsWith("/api/")) {
      await serveWeb(request, response);
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Vary", "Origin");
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== config.allowedOrigin) throw new AdmissionError(403, "Origin not allowed");
    if (origin !== undefined) response.setHeader("Access-Control-Allow-Origin", config.allowedOrigin);
    const path = request.url;
    if (request.method === "GET" && path === "/healthz") { respond(response, 200, { status: "ok" }); return; }
    if (request.method === "OPTIONS") {
      if (!origin || !["/api/jobs", "/api/exercises/first-at-least"].includes(path ?? "") && !/^\/api\/jobs\/[a-f0-9-]{36}$/.test(path ?? "")) throw new AdmissionError(404, "Not found");
      if (!["GET", "POST"].includes(request.headers["access-control-request-method"] ?? "") ||
          (request.headers["access-control-request-headers"] ?? "").split(",").map(header => header.trim().toLowerCase()).filter(Boolean).some(header => !["authorization", "content-type"].includes(header))) throw new AdmissionError(403, "Preflight not allowed");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      response.writeHead(204).end(); return;
    }
    const invite = authenticate(request, config);
    if (!invite) { response.setHeader("WWW-Authenticate", "Bearer"); throw new AdmissionError(401, "Unauthorized"); }
    if (request.method === "GET" && path === "/api/exercises/first-at-least") { respond(response, 200, firstAtLeast); return; }
    if (request.method === "GET" && /^\/api\/jobs\/[a-f0-9-]{36}$/.test(path ?? "")) {
      const id = path!.slice("/api/jobs/".length);
      const job = store.get(id, invite);
      if (!job) throw new AdmissionError(404, "Not found");
      if (job.status === "completed") job.result = volatileResults.get(id)?.result ?? job.result;
      respond(response, 200, job); return;
    }
    if (request.method === "POST" && path === "/api/jobs") {
      if (stopping || !config.executionEnabled) throw new AdmissionError(503, "Execution is disabled");
      const submission = await parseSubmission(request);
      if (stopping || !config.executionEnabled) throw new AdmissionError(503, "Execution is disabled");
      const job = store.admit(invite, submission.action);
      // Admission and all reservations have committed before any provider invocation.
      void (async () => {
        let result: ExecutionResult;
        try {
          store.running(job.id);
          result = sanitizeResult(await executor.execute(submission), config);
        } catch { result = { ...unavailableResult }; }
        if (stopping) return;
        try {
          store.finish(job.id, result);
          volatileResults.set(job.id, { result, expires: Date.now() + 24 * 60 * 60 * 1000 });
        } catch {
          // Do not dispatch further work if a durable completion cannot be recorded.
          stopping = true;
        }
      })();
      respond(response, 202, job); return;
    }
    throw new AdmissionError(404, "Not found");
  }
  const server = createServer({ maxHeaderSize: 16 * 1024, headersTimeout: 10_000, requestTimeout: 15_000, keepAliveTimeout: 5_000 }, (request, response) => {
    void handle(request, response).catch((error: unknown) => {
      request.resume();
      if (!response.headersSent && !response.destroyed) respond(response, error instanceof AdmissionError ? error.status : 500, {
        error: error instanceof AdmissionError ? error.message : "Internal server error",
      });
    });
  }) as ApiServer;
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 100;
  let shutdown: Promise<void> | undefined;
  server.shutdown = () => {
    if (shutdown) return shutdown;
    stopping = true;
    clearInterval(cleanup);
    store.close();
    volatileResults.clear();
    const completion = Promise.withResolvers<void>();
    shutdown = completion.promise;
    if (!server.listening) completion.resolve();
    else {
      server.close(error => error ? completion.reject(error) : completion.resolve());
      server.closeIdleConnections();
    }
    return shutdown;
  };
  return server;
}
