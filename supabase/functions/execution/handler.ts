import { timingSafeEqual } from "node:crypto";
import { firstAtLeast } from "../../../src/learning/first-at-least.ts";
import type { ExecutionResult, JobView, Submission } from "../../../src/learning/execution.ts";
import type { Executor } from "../../../server/execution/types.ts";
import { OnlineCompilerExecutor } from "../../../server/execution/onlinecompiler.ts";
import { createRpcStore, deadline, durableResult, JOB_ID, record, sameValue, StoreError, unavailableResult, validateJob } from "./store.ts";
import type { ExecutionStore, StoreConfig } from "./store.ts";

export interface HandlerConfig {
  allowedOrigin: string;
  executionEnabled: boolean;
  invites: readonly { id: string; digest: Uint8Array }[];
  diagnosticSecrets?: readonly string[];
}
export interface RuntimeConfig extends HandlerConfig, StoreConfig { apiKey: string }
export interface HandlerDependencies {
  store: ExecutionStore;
  executor: Executor;
  waitUntil: (work: Promise<void>) => void;
  /** QA can shorten the bound; production cannot raise it above 100 seconds. */
  executionTimeoutMs?: number;
}
export type ExecutionHandler = (request: Request) => Promise<Response>;
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Environment values are never interpolated into configuration errors. */
export function loadRuntimeConfig(get: (name: string) => string | undefined): RuntimeConfig {
  try {
    const enabled = get("MONKEYCODE_EXECUTION_ENABLED") ?? "false";
    if (enabled !== "true" && enabled !== "false") throw new Error();
    const apiKey = get("ONLINECOMPILER_API_KEY")?.trim() ?? "";
    if (enabled === "true" && (!apiKey || get("ONLINECOMPILER_RETENTION_ACCEPTED") !== "true")) throw new Error();
    const value: unknown = JSON.parse(get("MONKEYCODE_INVITES_JSON") ?? "");
    if (!record(value) || Object.keys(value).length < 1 || Object.keys(value).length > 10) throw new Error();
    const seen = new Set<string>();
    const invites = Object.entries(value).map(([id, digest]) => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof digest !== "string" || !/^[a-fA-F0-9]{64}$/.test(digest) || seen.has(digest.toLowerCase())) throw new Error();
      seen.add(digest.toLowerCase());
      return { id, digest: Uint8Array.from(digest.match(/../g)!, byte => Number.parseInt(byte, 16)) };
    });
    const allowedOrigin = get("MONKEYCODE_ALLOWED_ORIGIN") ?? "http://127.0.0.1:5173";
    const origin = new URL(allowedOrigin);
    if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== allowedOrigin) throw new Error();
    const supabaseUrl = get("SUPABASE_URL") ?? "";
    const storageOrigin = new URL(supabaseUrl);
    const serviceRoleKey = get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!["https:", "http:"].includes(storageOrigin.protocol) || storageOrigin.username || storageOrigin.password || storageOrigin.search || storageOrigin.hash || storageOrigin.pathname !== "/" || !serviceRoleKey.trim()) throw new Error();
    function limit(name: string, fallback: number): number {
      const text = get(name);
      if (text === undefined) return fallback;
      const number = Number(text);
      if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(number) || number > 2_147_483_647) throw new Error();
      return number;
    }
    return { allowedOrigin, executionEnabled: enabled === "true", invites, apiKey, supabaseUrl, serviceRoleKey,
      diagnosticSecrets: [apiKey, serviceRoleKey].filter(Boolean),
      inviteDailyLimit: limit("MONKEYCODE_INVITE_DAILY_LIMIT", 30), globalDailyLimit: limit("MONKEYCODE_GLOBAL_DAILY_LIMIT", 300), monthlyRunLimit: limit("MONKEYCODE_MONTHLY_RUN_LIMIT", 90000) };
  } catch { throw new Error("Invalid execution service configuration"); }
}

async function authenticate(request: Request, config: HandlerConfig): Promise<{ id: string; token: string } | null> {
  // Web Headers coalesces duplicate authorization fields with comma+space. Neither
  // that form nor comma-bearing/multi-scheme credentials pass this grammar.
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer [\x21-\x2b\x2d-\x7e]{32,4096}$/.test(header)) return null;
  const token = header.slice(7);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  let id: string | undefined;
  for (const invite of config.invites) {
    if (invite.digest.byteLength !== 32) continue;
    if (timingSafeEqual(digest, invite.digest)) id = invite.id;
  }
  return id === undefined ? null : { id, token };
}

async function parseSubmission(request: Request): Promise<Submission> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new HttpError(415, "Content-Type must be application/json");
  if (request.headers.has("content-encoding")) throw new HttpError(415, "Content encoding is not supported");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 40 * 1024)) throw new HttpError(413, "Request body exceeds 40 KiB");
  // Use a dedicated reader so oversize requests have the correct 413 response.
  if (!request.body) throw new HttpError(400, "Invalid JSON body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let size = 0;
  let value: unknown;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 40 * 1024) throw new HttpError(413, "Request body exceeds 40 KiB");
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    value = JSON.parse(parts.join(""));
  } catch (error) { throw error instanceof HttpError ? error : new HttpError(400, "Invalid JSON body"); }
  finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const fields = ["exerciseId", "exerciseVersion", "language", "action", "code"];
  if (!record(value) || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))
      || value.exerciseId !== "first-at-least" || value.exerciseVersion !== 1 || !["python", "java"].includes(value.language as string)
      || !["run", "submit"].includes(value.action as string) || typeof value.code !== "string" || value.code.includes("\0")) throw new HttpError(400, "Invalid submission fields");
  if (new TextEncoder().encode(value.code).byteLength > 32 * 1024) throw new HttpError(413, "Learner code exceeds 32 KiB");
  return value as unknown as Submission;
}

function publicDiagnostic(value: unknown, durable: ExecutionResult, secrets: readonly string[]): string | undefined {
  if (!record(value) || value.feedback !== undefined || durable.feedback !== undefined || !["compile-error", "runtime-error", "resource-limit"].includes(durable.status) || typeof value.message !== "string") return undefined;
  let message = value.message;
  for (const secret of secrets) if (secret) message = message.split(secret).join("[redacted]");
  message = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return new TextDecoder().decode(new TextEncoder().encode(message).subarray(0, 8192), { stream: true });
}

export function createExecutionHandler(config: HandlerConfig, dependencies: HandlerDependencies): ExecutionHandler {
  const { store, executor, waitUntil } = dependencies;
  const executionTimeout = dependencies.executionTimeoutMs ?? 100_000;
  if (!Number.isFinite(executionTimeout) || executionTimeout <= 0 || executionTimeout > 100_000) throw new Error("Invalid worker deadline");
  return async request => {
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" });
    const json = (status: number, value: unknown): Response => {
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(value), { status, headers });
    };
    try {
      const origin = request.headers.get("origin");
      if (origin !== null && origin !== config.allowedOrigin) throw new HttpError(403, "Origin not allowed");
      if (origin !== null) headers.set("Access-Control-Allow-Origin", config.allowedOrigin);
      const url = new URL(request.url);
      // Supabase's gateway removes /functions/v1 before invoking the worker.
      const path = url.pathname.replace(/^\/(?:functions\/v1\/)?execution(?=\/|$)/, "");
      const jobPath = /^\/api\/jobs\/([0-9a-f-]+)$/.exec(path);
      const jobId = jobPath && JOB_ID.test(jobPath[1]!) ? jobPath[1]! : undefined;
      if (url.search) throw new HttpError(404, "Not found");
      if (request.method === "GET" && path === "/healthz") return json(200, { status: "ok" });
      if (request.method === "OPTIONS") {
        if (!origin || !["/api/jobs", "/api/exercises/first-at-least"].includes(path) && !jobId) throw new HttpError(404, "Not found");
        if (!["GET", "POST"].includes(request.headers.get("access-control-request-method") ?? "") || (request.headers.get("access-control-request-headers") ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean).some(value => !["authorization", "content-type"].includes(value))) throw new HttpError(403, "Preflight not allowed");
        headers.set("Access-Control-Allow-Methods", "GET, POST");
        headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        return new Response(null, { status: 204, headers });
      }
      const invite = await authenticate(request, config);
      if (!invite) { headers.set("WWW-Authenticate", "Bearer"); throw new HttpError(401, "Unauthorized"); }
      if (request.method === "GET" && path === "/api/exercises/first-at-least") return json(200, firstAtLeast);
      if (request.method === "GET" && jobId) {
        const value = await deadline(() => store.get(invite.id, jobId), 8_000).catch(() => { throw new StoreError(502); });
        if (value === null) throw new HttpError(404, "Not found");
        const job = validateJob(value);
        if (job.id !== jobId) throw new StoreError(502);
        return json(200, job);
      }
      if (request.method !== "POST" || path !== "/api/jobs") throw new HttpError(404, "Not found");
      if (!config.executionEnabled) throw new HttpError(503, "Execution is disabled");
      const submission = await parseSubmission(request);
      let job: JobView;
      try {
        job = validateJob(await deadline(() => store.admit(invite.id, submission.action), 8_000));
        if (job.status === "completed") throw new StoreError(502);
      } catch (error) { throw error instanceof StoreError ? error : new StoreError(502); }
      const encoder = new TextEncoder();
      let closed = false;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const emit = (value: unknown): void => {
        if (!closed) try { controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); } catch { closed = true; }
      };
      const stream = new ReadableStream<Uint8Array>({
        start(value) { controller = value; emit({ type: "admitted", job }); },
        cancel() { closed = true; },
      });
      // Admission is already committed and queued in the stream before any work.
      // Ignore request.signal: disconnecting must never cancel the durable job.
      const work = Promise.resolve().then(async () => {
        let raw: unknown;
        try { raw = await deadline(signal => executor.execute(submission, signal), executionTimeout); }
        catch { raw = unavailableResult(); }
        const result = durableResult(raw);
        const message = publicDiagnostic(raw, result, [...(config.diagnosticSecrets ?? []), invite.token]);
        const value = await deadline(() => store.finish(job.id, result), 8_000);
        if (value === null) throw new StoreError(502);
        const completed = validateJob(value);
        if (completed.id !== job.id || completed.status !== "completed") throw new StoreError(502);
        // The database may have recovered an expired lease. Its result wins.
        if (message !== undefined && sameValue(completed.result, result)) completed.result = { ...completed.result!, message };
        emit({ type: "completed", job: completed });
        if (!closed) { closed = true; controller.close(); }
      }).catch(() => {
        if (!closed) { closed = true; try { controller.error(new Error("Durable completion unavailable; recover this job by ID")); } catch { /* Already disconnected. */ } }
      });
      waitUntil(work);
      headers.set("Content-Type", "application/x-ndjson; charset=utf-8");
      headers.set("X-Accel-Buffering", "no");
      return new Response(stream, { status: 202, headers });
    } catch (error) {
      const status = error instanceof HttpError || error instanceof StoreError ? error.status : 500;
      return json(status, { error: error instanceof HttpError || error instanceof StoreError ? error.message : "Internal server error" });
    }
  };
}

/** Lazy production setup; QA imports createExecutionHandler instead, with no provider transport. */
export async function createRuntimeHandler(get: (name: string) => string | undefined, waitUntil: (work: Promise<void>) => void): Promise<ExecutionHandler> {
  const config = loadRuntimeConfig(get);
  return createExecutionHandler(config, { store: createRpcStore(config), executor: new OnlineCompilerExecutor(config.apiKey), waitUntil });
}
