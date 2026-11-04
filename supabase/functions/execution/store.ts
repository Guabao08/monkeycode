import { firstAtLeast } from "../../../src/learning/first-at-least.ts";
import { privateCases } from "../../../server/learning/first-at-least.ts";
import type { ExecutionResult, JobView, Submission } from "../../../src/learning/execution.ts";

export const SERVICE_MESSAGE = "Execution unavailable. This job will not be retried; reserved quota is not refunded.";
export const WRONG_ANSWER_MESSAGE = "The returned output did not match the required answer format or value.";
export const unavailableResult = (): ExecutionResult => ({ status: "service-error", message: SERVICE_MESSAGE, implementationComplexityVerified: false });
const categories = new Set(privateCases.map(item => item.category));
const statuses: Record<string, true> = { passed: true, "wrong-answer": true, "compile-error": true, "runtime-error": true, "resource-limit": true, "service-error": true };
export const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Reconstruct only public values; arbitrary strings, source and diagnostics are never durable. */
export function durableResult(value: unknown): ExecutionResult {
  if (!record(value) || typeof value.status !== "string" || !Object.hasOwn(statuses, value.status) || value.status === "service-error") return unavailableResult();
  const status = value.status as ExecutionResult["status"];
  const result: ExecutionResult = { status, implementationComplexityVerified: false };
  const feedback = value.feedback;
  if (feedback !== undefined || status === "passed" || status === "wrong-answer") {
    if (feedback === undefined && status === "wrong-answer") return { ...result, message: WRONG_ANSWER_MESSAGE };
    if (!record(feedback) || feedback.status !== (status === "passed" ? "passed" : "wrong-answer")) return unavailableResult();
    if (Object.hasOwn(feedback, "failureCategories")) {
      if (!Array.isArray(feedback.failureCategories) || feedback.failureCategories.length > 8 || !feedback.failureCategories.every(category => typeof category === "string" && categories.has(category))) return unavailableResult();
      const failureCategories = [...new Set(feedback.failureCategories as string[])];
      if ((status === "passed") !== (failureCategories.length === 0)) return unavailableResult();
      result.feedback = { status: feedback.status as "passed" | "wrong-answer", failureCategories };
    } else if ((status === "passed" || status === "wrong-answer") && Array.isArray(feedback.cases) && feedback.cases.length === firstAtLeast.examples.length) {
      const sourceCases = feedback.cases;
      const cases = firstAtLeast.examples.map((example, index) => {
        const item: unknown = sourceCases[index];
        const actual = record(item) ? item.actual : null;
        const safeActual = (typeof actual === "number" && Number.isFinite(actual)) || typeof actual === "boolean" ? actual : null;
        return { index, expected: example.expected, actual: safeActual, passed: typeof actual === "number" && Number.isInteger(actual) && actual === example.expected };
      });
      if ((status === "passed") !== cases.every(item => item.passed)) return unavailableResult();
      result.feedback = { status, cases };
    } else return unavailableResult();
  }
  return result;
}

/** Exact structural comparison, without trusting property order or extra database fields. */
export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  if (record(left) && record(right)) return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
  return false;
}

export function validateJob(value: unknown): JobView {
  if (!record(value) || !["id", "status", "createdAt"].every(key => Object.hasOwn(value, key))
      || Object.keys(value).some(key => !["id", "status", "createdAt", "result"].includes(key)) || typeof value.id !== "string" || !JOB_ID.test(value.id)
      || typeof value.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))
      || !["queued", "running", "completed"].includes(value.status as string)) throw new StoreError(502);
  const job: JobView = { id: value.id, status: value.status as JobView["status"], createdAt: value.createdAt };
  if (job.status === "completed") {
    if (!record(value.result) || !sameValue(value.result, durableResult(value.result))) throw new StoreError(502);
    job.result = durableResult(value.result);
  } else if (Object.hasOwn(value, "result")) throw new StoreError(502);
  return job;
}

export class StoreError extends Error {
  constructor(readonly status: 400 | 429 | 502) { super(status === 429 ? "Execution capacity or quota is exhausted" : status === 400 ? "Invalid admission" : "Execution storage response is uncertain"); }
}
export interface ExecutionStore {
  admit(inviteId: string, action: Submission["action"]): Promise<JobView>;
  get(inviteId: string, id: string): Promise<JobView | null>;
  finish(id: string, result: ExecutionResult): Promise<JobView | null>;
}
export interface StoreConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  inviteDailyLimit: number;
  globalDailyLimit: number;
  monthlyRunLimit: number;
}

export async function boundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body) throw new Error("Invalid JSON response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const pieces: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error("JSON response exceeds limit");
      pieces.push(decoder.decode(value, { stream: true }));
    }
    pieces.push(decoder.decode());
    return JSON.parse(pieces.join(""));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Deadline includes headers and the bounded body, even for a transport that ignores abort. */
export async function deadline<T>(work: (signal: AbortSignal) => Promise<T>, milliseconds: number): Promise<T> {
  const controller = new AbortController();
  const { promise: expired, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => { controller.abort(); reject(new Error("Deadline exceeded")); }, milliseconds);
  try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), expired]); }
  finally { clearTimeout(timer); controller.abort(); }
}

export function createRpcStore(config: StoreConfig, fetchImpl: typeof fetch = fetch): ExecutionStore {
  const origin = new URL(config.supabaseUrl);
  if (!["https:", "http:"].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || !config.serviceRoleKey.trim()) throw new Error("Invalid execution storage configuration");
  const base = origin.origin;
  async function rpc(name: "mc_admit_job" | "mc_get_job" | "mc_finish_job", body: Record<string, unknown>): Promise<unknown> {
    try {
      return await deadline(async signal => {
        const response = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
          method: "POST", redirect: "error", signal,
          headers: { "Content-Type": "application/json", apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          // Only SQLSTATE is interpreted. Error detail/message/hint are never exposed.
          let code: unknown;
          try { const error = await boundedJson(response, 16 * 1024); if (record(error)) code = error.code; } catch { /* Uncertain, fail closed. */ }
          if (name === "mc_admit_job" && code === "MC429") throw new StoreError(429);
          if (name === "mc_admit_job" && code === "MC400") throw new StoreError(400);
          throw new StoreError(502);
        }
        return boundedJson(response, 64 * 1024);
      }, 8_000);
    } catch (error) { throw error instanceof StoreError ? error : new StoreError(502); }
  }
  return {
    async admit(inviteId, action) {
      const job = validateJob(await rpc("mc_admit_job", { p_invite_id: inviteId, p_action: action, p_invite_daily_limit: config.inviteDailyLimit, p_global_daily_limit: config.globalDailyLimit, p_monthly_run_limit: config.monthlyRunLimit }));
      if (job.status === "completed") throw new StoreError(502);
      return job;
    },
    async get(inviteId, id) {
      const value = await rpc("mc_get_job", { p_invite_id: inviteId, p_job_id: id });
      if (value === null) return null;
      const job = validateJob(value);
      if (job.id !== id) throw new StoreError(502);
      return job;
    },
    async finish(id, result) {
      const value = await rpc("mc_finish_job", { p_job_id: id, p_result: durableResult(result) });
      if (value === null) return null;
      const job = validateJob(value);
      if (job.id !== id || job.status !== "completed") throw new StoreError(502);
      return job;
    },
  };
}
