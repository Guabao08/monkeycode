import { createExecutionHandler, loadRuntimeConfig } from "./handler.ts";
import type { HandlerConfig, HandlerDependencies } from "./handler.ts";
import { createRpcStore, durableResult, sameValue, StoreError, unavailableResult } from "./store.ts";
import type { ExecutionStore } from "./store.ts";
import type { ExecutionResult, JobView } from "../../../src/learning/execution.ts";
import { firstAtLeast } from "../../../src/learning/first-at-least.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown): void {
  assert(sameValue(actual, expected), "Values differ");
}
const TOKEN = "qa-invite-token-with-at-least-thirty-two-characters";
const ORIGIN = "https://practice.example";
const ID = "00000000-0000-4000-8000-000000000001";
const CREATED = "2026-11-03T00:00:00.000Z";
const running = (): JobView => ({ id: ID, status: "running", createdAt: CREATED });
const completed = (result: ExecutionResult): JobView => ({ ...running(), status: "completed", result });
const passed = (): ExecutionResult => ({ status: "passed", implementationComplexityVerified: false,
  feedback: { status: "passed", cases: firstAtLeast.examples.map((example, index) => ({ index, expected: example.expected, actual: example.expected, passed: true })) } });
const submission = { exerciseId: "first-at-least", exerciseVersion: 1, language: "python", action: "run", code: "def first_at_least(values, target): return 0" };

async function fixture(options: {
  config?: Partial<HandlerConfig>;
  store?: Partial<ExecutionStore>;
  executor?: HandlerDependencies["executor"];
  executionTimeoutMs?: number;
} = {}) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN)));
  const calls = { admitted: 0, executed: 0, finished: 0, got: [] as string[], results: [] as ExecutionResult[] };
  let saved: JobView | null = null;
  const store: ExecutionStore = {
    async admit() { calls.admitted++; return running(); },
    async get(invite) { calls.got.push(invite); return saved; },
    async finish(_id, result) { calls.finished++; calls.results.push(result); saved = completed(result); return saved; },
    ...options.store,
  };
  const work: Promise<void>[] = [];
  const handler = createExecutionHandler({ allowedOrigin: ORIGIN, executionEnabled: true, invites: [{ id: "owner", digest }], ...options.config }, {
    store,
    executor: options.executor ?? { async execute() { calls.executed++; return passed(); } },
    waitUntil(promise) { work.push(promise); }, executionTimeoutMs: options.executionTimeoutMs,
  });
  return { handler, calls, work, store };
}
function request(path = "/api/jobs", init: RequestInit = {}): Request {
  const headers = new Headers({ Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN, "Content-Type": "application/json" });
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return new Request(`http://edge.local/execution${path}`, { method: "POST", body: JSON.stringify(submission), ...init, headers });
}
async function consume(response: Response): Promise<Record<string, unknown>[]> {
  return (await response.text()).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}
function event(value: Uint8Array | undefined): { type: string; job: JobView } {
  assert(value);
  return JSON.parse(new TextDecoder().decode(value));
}

Deno.test("admission is a real first stream chunk; completion waits for the durable commit", async () => {
  const execution = Promise.withResolvers<ExecutionResult>();
  const finishing = Promise.withResolvers<void>();
  const commit = Promise.withResolvers<JobView>();
  const f = await fixture({ executor: { execute: () => execution.promise }, store: {
    async finish(_id, result) { equal(result, passed()); finishing.resolve(); return await commit.promise; },
  } });
  const response = await f.handler(request());
  equal(response.status, 202);
  assert(response.headers.get("content-type")?.startsWith("application/x-ndjson"));
  equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  const reader = response.body!.getReader();
  const admitted = event((await reader.read()).value);
  equal(admitted, { type: "admitted", job: running() });
  let secondArrived = false;
  const second = reader.read().then(value => { secondArrived = true; return value; });
  execution.resolve(passed());
  await finishing.promise;
  await Promise.resolve();
  assert(!secondArrived, "Completion was emitted before the durable finish");
  commit.resolve(completed(passed()));
  equal(event((await second).value), { type: "completed", job: completed(passed()) });
  assert((await reader.read()).done);
  await Promise.all(f.work);
});

Deno.test("wrong, malformed and duplicate credentials reject exercise access before storage", async () => {
  const f = await fixture();
  for (const authorization of ["Bearer wrong-token-that-is-long-enough-but-not-valid", `bearer ${TOKEN}`, `Bearer ${TOKEN}, Bearer ${TOKEN}`, `Bearer  ${TOKEN}`, "Basic secret", `Bearer ${TOKEN}\tother`]) {
    const response = await f.handler(request("/api/exercises/first-at-least", { method: "GET", body: undefined, headers: { authorization } }));
    equal(response.status, 401);
    equal(response.headers.get("www-authenticate"), "Bearer");
  }
  const headers = new Headers();
  headers.append("Authorization", `Bearer ${TOKEN}`);
  headers.append("Authorization", `Bearer ${TOKEN}`);
  const duplicate = await f.handler(new Request("http://edge.local/api/exercises/first-at-least", { headers }));
  equal(duplicate.status, 401);
  const allowed = await f.handler(request("/api/exercises/first-at-least", { method: "GET", body: undefined }));
  equal(allowed.status, 200);
  equal(await allowed.json(), firstAtLeast);
  equal(f.calls.admitted, 0);
  equal(f.calls.executed, 0);
});

Deno.test("origin must match exactly and preflight permits only the documented headers", async () => {
  const f = await fixture();
  for (const origin of ["https://practice.example.attacker.test", "https://practice.example/", "null", `${ORIGIN}, https://attacker.test`]) {
    const response = await f.handler(request("/api/jobs", { headers: { origin } }));
    equal(response.status, 403);
    equal(response.headers.get("access-control-allow-origin"), null);
  }
  const good = await f.handler(request("/api/jobs", { method: "OPTIONS", body: undefined, headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Authorization, Content-Type" } }));
  equal(good.status, 204);
  equal(good.headers.get("access-control-allow-origin"), ORIGIN);
  const bad = await f.handler(request("/api/jobs", { method: "OPTIONS", body: undefined, headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-provider-key" } }));
  equal(bad.status, 403);
  equal(f.calls.admitted, 0);
});

Deno.test("disabled execution rejects before reading or admitting a submission", async () => {
  const f = await fixture({ config: { executionEnabled: false } });
  const response = await f.handler(request("/api/jobs", { body: "not JSON" }));
  equal(response.status, 503);
  equal(f.calls.admitted, 0);
  equal(f.calls.executed, 0);
  equal(f.work.length, 0);
});

Deno.test("strict fields, UTF-8, NUL, body size and code byte limits reject before admission", async () => {
  const f = await fixture();
  const invalid: [RequestInit, number][] = [
    [{ body: "[1]" }, 400], [{ body: "{}" }, 400], [{ body: JSON.stringify({ ...submission, extra: true }) }, 400],
    [{ body: JSON.stringify({ ...submission, exerciseVersion: 2 }) }, 400], [{ body: JSON.stringify({ ...submission, action: "retry" }) }, 400],
    [{ body: JSON.stringify({ ...submission, language: "javascript" }) }, 400], [{ body: JSON.stringify({ ...submission, code: "a\0b" }) }, 400],
    [{ body: new Uint8Array([0xff]) }, 400], [{ body: "x".repeat(40 * 1024 + 1) }, 413],
    [{ body: JSON.stringify({ ...submission, code: "é".repeat(16 * 1024 + 1) }) }, 413],
    [{ headers: { "content-type": "text/plain" } }, 415], [{ headers: { "content-encoding": "gzip" } }, 415],
    [{ headers: { "content-length": "40961" } }, 413],
  ];
  for (const [init, status] of invalid) equal((await f.handler(request("/api/jobs", init))).status, status);
  equal(f.calls.admitted, 0);
  equal(f.calls.executed, 0);
});

Deno.test("definite quota rejection differs from uncertain admission and never starts execution", async () => {
  for (const [error, status] of [[new StoreError(429), 429], [new StoreError(400), 400], [new Error("source and service key must not escape"), 502]] as const) {
    const f = await fixture({ store: { async admit() { throw error; } } });
    const response = await f.handler(request());
    equal(response.status, status);
    assert(!(await response.text()).includes("source and service key"));
    equal(f.calls.executed, 0);
    equal(f.work.length, 0);
  }
});

Deno.test("canceling the response stream does not cancel execution or durable finish", async () => {
  const execution = Promise.withResolvers<ExecutionResult>();
  let signal: AbortSignal | undefined;
  const f = await fixture({ executor: { execute(_submission, workerSignal) { signal = workerSignal; return execution.promise; } } });
  const response = await f.handler(request());
  const reader = response.body!.getReader();
  equal(event((await reader.read()).value).type, "admitted");
  await reader.cancel("client disconnected");
  assert(signal && !signal.aborted);
  execution.resolve(passed());
  await Promise.all(f.work);
  equal(f.calls.finished, 1);
  equal(f.calls.results, [passed()]);
});

Deno.test("request cancellation also leaves the admitted worker alive", async () => {
  const execution = Promise.withResolvers<ExecutionResult>();
  const controller = new AbortController();
  const f = await fixture({ executor: { execute: () => execution.promise } });
  const response = await f.handler(request("/api/jobs", { signal: controller.signal }));
  const reader = response.body!.getReader();
  equal(event((await reader.read()).value).type, "admitted");
  controller.abort();
  execution.resolve(passed());
  equal(event((await reader.read()).value).job.result, passed());
  assert((await reader.read()).done);
  await Promise.all(f.work);
  equal(f.calls.finished, 1);
});

Deno.test("durable failure errors the stream without a false completed event or replay", async () => {
  const execution = Promise.withResolvers<ExecutionResult>();
  let finishes = 0;
  const f = await fixture({ executor: { execute: () => execution.promise }, store: { async finish() { finishes++; throw new Error("private source/credential"); } } });
  const response = await f.handler(request());
  const reader = response.body!.getReader();
  equal(event((await reader.read()).value).type, "admitted");
  const second = reader.read();
  execution.resolve(passed());
  let failed = false;
  try { await second; } catch (error) { failed = true; assert(error instanceof Error && !error.message.includes("private source")); }
  assert(failed);
  await Promise.all(f.work);
  equal(finishes, 1);
  equal(f.work.length, 1);
});

Deno.test("private feedback exposes and persists categories only, never diagnostics or fixtures", async () => {
  const raw = { status: "wrong-answer", implementationComplexityVerified: false,
    message: "private diagnostic and source", feedback: { status: "wrong-answer", failureCategories: ["duplicate handling", "duplicate handling"], input: "private fixture", actual: "private output" }, extra: "secret" } as unknown as ExecutionResult;
  const f = await fixture({ executor: { async execute() { return raw; } } });
  const events = await consume(await f.handler(request("/api/jobs", { body: JSON.stringify({ ...submission, action: "submit" }) })));
  const expected = { status: "wrong-answer", implementationComplexityVerified: false, feedback: { status: "wrong-answer", failureCategories: ["duplicate handling"] } };
  equal(events[1], { type: "completed", job: completed(expected as ExecutionResult) });
  equal(f.calls.results, [expected]);
  assert(!JSON.stringify(events).includes("private"));
  await Promise.all(f.work);
});

Deno.test("public diagnostic is RAM-only, bounded and credential-redacted; GET is durable only", async () => {
  const apiKey = "qa-provider-secret";
  const raw: ExecutionResult = { status: "compile-error", implementationComplexityVerified: false, message: `error ${apiKey} ${TOKEN}\0\n${"é".repeat(6000)}` };
  const f = await fixture({ config: { diagnosticSecrets: [apiKey] }, executor: { async execute() { return raw; } } });
  const events = await consume(await f.handler(request()));
  const job = events[1]!.job as JobView;
  const message = job.result?.message;
  assert(typeof message === "string");
  assert(message.startsWith("error [redacted] [redacted]\n"));
  assert(new TextEncoder().encode(message).byteLength <= 8192);
  assert(!message.includes(apiKey) && !message.includes(TOKEN) && !message.includes("\0"));
  equal(f.calls.results, [{ status: "compile-error", implementationComplexityVerified: false }]);
  const response = await f.handler(request(`/api/jobs/${ID}`, { method: "GET", body: undefined }));
  equal(response.status, 200);
  equal(await response.json(), completed({ status: "compile-error", implementationComplexityVerified: false }));
  equal(f.calls.got, ["owner"]);
  await Promise.all(f.work);
});

Deno.test("database lease recovery is authoritative over a late pass or public diagnostic", async () => {
  for (const raw of [passed(), { status: "compile-error", implementationComplexityVerified: false, message: "late public diagnostic" } as ExecutionResult]) {
    const f = await fixture({ executor: { async execute() { return raw; } }, store: { async finish() { return completed(unavailableResult()); } } });
    const events = await consume(await f.handler(request()));
    equal(events[1], { type: "completed", job: completed(unavailableResult()) });
    assert(!JSON.stringify(events).includes("late public diagnostic"));
    await Promise.all(f.work);
  }
});

Deno.test("GET uses the authenticated owner and does not reveal another owner's job", async () => {
  const otherToken = "a-second-invite-token-with-thirty-two-characters";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(otherToken)));
  const owners: string[] = [];
  const f = await fixture({ config: { invites: [{ id: "other", digest }] }, store: { async get(owner, id) { owners.push(owner); equal(id, ID); return null; } } });
  const response = await f.handler(request(`/api/jobs/${ID}`, { method: "GET", body: undefined, headers: { authorization: `Bearer ${otherToken}` } }));
  equal(response.status, 404);
  equal(owners, ["other"]);
  equal(f.calls.executed, 0);
});

Deno.test("malformed admission and stored envelopes fail closed instead of passing arbitrary data", async () => {
  const variants = [
    { ...running(), source: "never expose this" }, { ...running(), id: "not-a-job-id" }, { ...running(), createdAt: "bad date" },
    completed({ status: "passed", implementationComplexityVerified: false }),
  ];
  for (const malformed of variants) {
    const f = await fixture({ store: { async admit() { return malformed as JobView; } } });
    const response = await f.handler(request());
    equal(response.status, 502);
    equal(f.calls.executed, 0);
    assert(!(await response.text()).includes("never expose"));
  }
  const f = await fixture({ store: { async get() { return { ...completed(passed()), diagnostic: "private" } as JobView; } } });
  equal((await f.handler(request(`/api/jobs/${ID}`, { method: "GET", body: undefined }))).status, 502);
});

Deno.test("bounded worker aborts once, durably finishes service-error and ignores a later result", async () => {
  const late = Promise.withResolvers<ExecutionResult>();
  let signal: AbortSignal | undefined;
  let executions = 0;
  const f = await fixture({ executionTimeoutMs: 5, executor: { execute(_submission, workerSignal) { executions++; signal = workerSignal; return late.promise; } } });
  const events = await consume(await f.handler(request()));
  equal(events[1], { type: "completed", job: completed(unavailableResult()) });
  assert(signal?.aborted);
  late.resolve(passed());
  await Promise.all(f.work);
  equal(executions, 1);
  equal(f.calls.finished, 1);
  equal(f.calls.results, [unavailableResult()]);
});

const rpcConfig = { supabaseUrl: "http://127.0.0.1:54321", serviceRoleKey: "qa-server-only-role-key", inviteDailyLimit: 30, globalDailyLimit: 300, monthlyRunLimit: 90000 };

Deno.test("RPC error codes are bounded, generic and ambiguous admission is 502 not disabled", async () => {
  for (const [code, expected] of [["MC429", 429], ["MC400", 400], ["PGRST000", 502]] as const) {
    const store = createRpcStore(rpcConfig, async () => Response.json({ code, message: "provider key/learner source", hint: "private" }, { status: 400 }));
    const f = await fixture({ store });
    const response = await f.handler(request());
    equal(response.status, expected);
    assert(!(await response.text()).includes("provider key"));
    equal(f.calls.executed, 0);
  }
  for (const transport of [
    async () => { throw new Error("credentials in transport error"); },
    async () => new Response("x".repeat(64 * 1024 + 1)),
    async () => new Response(new Uint8Array([0xff])),
    async () => Response.json({ ...running(), source: "private source" }),
  ] as typeof fetch[]) {
    const f = await fixture({ store: createRpcStore(rpcConfig, transport) });
    const response = await f.handler(request());
    equal(response.status, 502);
    equal(f.calls.executed, 0);
    const text = await response.text();
    assert(!text.includes("credentials") && !text.includes("private source"));
  }
});

Deno.test("result sanitization rejects private unknown categories and arbitrary public output", async () => {
  equal(durableResult({ status: "wrong-answer", feedback: { status: "wrong-answer", failureCategories: ["private raw input"] } }), unavailableResult());
  const raw = { status: "wrong-answer", feedback: { status: "wrong-answer", cases: firstAtLeast.examples.map((example, index) => ({ index, expected: example.expected, actual: "secret learner source", passed: true })) } };
  const safe = durableResult(raw);
  assert(safe.feedback && "cases" in safe.feedback);
  assert(safe.feedback.cases.every(item => item.actual === null && item.passed === false));
  assert(!JSON.stringify(safe).includes("secret"));
});

Deno.test("runtime configuration is lazy/injected, defaults disabled, and never echoes invalid secrets", () => {
  const values: Record<string, string> = {
    MONKEYCODE_INVITES_JSON: JSON.stringify({ owner: "ab".repeat(32) }), MONKEYCODE_ALLOWED_ORIGIN: ORIGIN,
    SUPABASE_URL: rpcConfig.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: rpcConfig.serviceRoleKey,
  };
  const config = loadRuntimeConfig(name => values[name]);
  equal(config.executionEnabled, false);
  for (const bad of [
    { MONKEYCODE_INVITES_JSON: "raw-invite-token-must-not-escape" },
    { MONKEYCODE_ALLOWED_ORIGIN: `${ORIGIN}/path-with-secret` },
    { MONKEYCODE_EXECUTION_ENABLED: "true", ONLINECOMPILER_API_KEY: "raw-api-key-must-not-escape" },
    { SUPABASE_URL: "https://user:secret@example.test" },
  ]) {
    let failed = false;
    try { loadRuntimeConfig(name => ({ ...values, ...bad } as Record<string, string | undefined>)[name]); }
    catch (error) { failed = true; assert(error instanceof Error); equal(error.message, "Invalid execution service configuration"); }
    assert(failed);
  }
});
