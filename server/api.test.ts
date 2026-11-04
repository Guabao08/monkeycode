import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { createApi, type ApiServer } from "./api";
import { loadConfig, type ApiConfig } from "./config";
import type { Executor } from "./execution/types";
import type { ExecutionResult, JobView } from "../src/learning/execution";

const token = "a".repeat(40);
const otherToken = "b".repeat(40);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const passed: ExecutionResult = { status: "passed", feedback: { status: "passed", failureCategories: [] }, implementationComplexityVerified: false };
const submission = { exerciseId: "first-at-least", exerciseVersion: 1, language: "python", action: "run", code: "def first_at_least(values, target): return 0" };

interface TestApi {
  server: ApiServer;
  request(path: string, init?: RequestInit, auth?: string | null): Promise<Response>;
  post(body?: unknown, auth?: string): Promise<Response>;
}
interface ApiFixture extends TestApi {
  config: ApiConfig;
  start(executor?: Executor): Promise<TestApi>;
}
function storedNumber(db: DatabaseSync, sql: string, column = "count"): number {
  const row = db.prepare(sql).get();
  assert(row && typeof row[column] === "number");
  return row[column];
}

async function fixture(t: TestContext, executor: Executor = { execute: async () => passed }, overrides: Partial<ApiConfig> = {}): Promise<ApiFixture> {
  const directory = await mkdtemp(join(tmpdir(), "monkeycode-api-"));
  const config = { ...loadConfig({
    ONLINECOMPILER_API_KEY: "test-key-not-a-provider-credential", ONLINECOMPILER_RETENTION_ACCEPTED: "true",
    MONKEYCODE_EXECUTION_ENABLED: "true", MONKEYCODE_DB_PATH: join(directory, "jobs.sqlite"),
    MONKEYCODE_INVITES_JSON: JSON.stringify({ alice: digest(token), bob: digest(otherToken) }),
  }), ...overrides };
  const servers: ApiServer[] = [];
  async function start(nextExecutor = executor) {
    const server = createApi(config, nextExecutor);
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    return {
      server,
      request: (path: string, init: RequestInit = {}, auth: string | null = token) => fetch(base + path, {
        ...init, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...init.headers },
      }),
      post: (body: unknown = submission, auth = token) => fetch(base + "/api/jobs", { method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    };
  }
  t.after(async () => {
    for (const server of servers) await server.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const api = await start();
  return { ...api, config, start };
}
async function completed(api: TestApi, id: string, auth?: string): Promise<JobView> {
  for (let count = 0; count < 100; count++) {
    const response = await api.request(`/api/jobs/${id}`, {}, auth);
    assert.equal(response.status, 200);
    const job = await response.json() as JobView;
    if (job.status === "completed") return job;
    await delay(5);
  }
  throw new Error("Controlled executor did not finish");
}

test("configuration requires explicit provider privacy acceptance and unique hashed invites", () => {
  const env = { ONLINECOMPILER_API_KEY: "dummy", ONLINECOMPILER_RETENTION_ACCEPTED: "true", MONKEYCODE_INVITES_JSON: JSON.stringify({ alice: digest(token) }) };
  assert.equal(loadConfig(env).executionEnabled, false);
  assert.throws(() => loadConfig({ ...env, ONLINECOMPILER_API_KEY: "" }), /API_KEY/);
  assert.throws(() => loadConfig({ ...env, ONLINECOMPILER_RETENTION_ACCEPTED: "false" }), /RETENTION/);
  assert.throws(() => loadConfig({ ...env, MONKEYCODE_INVITES_JSON: JSON.stringify({ alice: digest(token), bob: digest(token).toUpperCase() }) }), /unique/);
  assert.throws(() => loadConfig({ ...env, MONKEYCODE_INVITES_JSON: JSON.stringify({ alice: "bad" }) }), /32-byte/);
  assert.throws(() => loadConfig({ ...env, MONKEYCODE_ALLOWED_ORIGIN: "*" }), /ORIGIN/);
  assert.throws(() => loadConfig({ ...env, MONKEYCODE_PORT: "0" }), /positive/);
});

test("Render binding and origin honor explicit overrides and reject invalid platform values", () => {
  const env = {
    ONLINECOMPILER_API_KEY: "dummy", ONLINECOMPILER_RETENTION_ACCEPTED: "true",
    MONKEYCODE_INVITES_JSON: JSON.stringify({ alice: digest(token) }),
    PORT: "10000", RENDER_EXTERNAL_URL: "https://monkeycode-example.onrender.com",
  };
  const platform = loadConfig(env);
  assert.equal(platform.port, 10000);
  assert.equal(platform.allowedOrigin, env.RENDER_EXTERNAL_URL);
  const custom = loadConfig({ ...env, MONKEYCODE_PORT: "4000", MONKEYCODE_ALLOWED_ORIGIN: "https://practice.example.com" });
  assert.equal(custom.port, 4000);
  assert.equal(custom.allowedOrigin, "https://practice.example.com");
  assert.throws(() => loadConfig({ ...env, PORT: "0" }), /PORT/);
  assert.throws(() => loadConfig({ ...env, RENDER_EXTERNAL_URL: "https://example.com/path" }), /ORIGIN/);
  assert.throws(() => loadConfig({ ...env, MONKEYCODE_SERVE_WEB: "yes" }), /SERVE_WEB/);
});

test("production web mode keeps the shell public without weakening API authentication or the execution kill switch", async t => {
  const directory = await mkdtemp(join(tmpdir(), "monkeycode-web-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Practice shell</title>");
  let executions = 0;
  const api = await fixture(t, { execute: async () => { executions++; return passed; } }, { webRoot: directory, executionEnabled: false });
  const shell = await api.request("/", {}, null);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(await shell.text(), "<!doctype html><title>Practice shell</title>");
  assert.equal((await api.request("/api/exercises/first-at-least", {}, null)).status, 401);
  const unknownApi = await api.request("/api/missing");
  assert.equal(unknownApi.status, 404);
  assert.match(unknownApi.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(await (await api.request("/healthz", {}, null)).json(), { status: "ok" });
  assert.equal((await api.request("/api/exercises/first-at-least", { headers: { Origin: "https://untrusted.example" } })).status, 403);
  assert.equal((await api.request("/api/exercises/first-at-least", { headers: { Origin: api.config.allowedOrigin } })).status, 200);
  assert.equal((await api.post()).status, 503);
  assert.equal(executions, 0);
});

test("auth, invite ownership, minimal health and public-only exercise", async t => {
  const api = await fixture(t);
  assert.equal((await api.request("/healthz", {}, null)).status, 200);
  const health = await api.request("/healthz", {}, null);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await api.request("/api/exercises/first-at-least", {}, null)).status, 401);
  assert.equal((await api.request("/api/exercises/first-at-least", {}, "short")).status, 401);
  assert.equal((await api.request("/api/exercises/first-at-least", {}, "z".repeat(40))).status, 401);
  const exercise = await (await api.request("/api/exercises/first-at-least")).text();
  assert.match(exercise, /"examples"/);
  assert.doesNotMatch(exercise, /privateCases|references|hints|reasoningQuestions|test-key/);
  const response = await api.post();
  assert.equal(response.status, 202);
  const job = await response.json() as JobView;
  assert.match(job.id, /^[a-f0-9-]{36}$/);
  assert.equal((await api.request(`/api/jobs/${job.id}`, {}, otherToken)).status, 404);
  assert.equal((await completed(api, job.id)).result?.status, "passed");
  assert.equal((await api.request(`/api/jobs/${job.id}`, { method: "DELETE" })).status, 404);
});

test("rejects untrusted origins and permits only matching browser preflight", async t => {
  const api = await fixture(t);
  assert.equal((await api.request("/api/exercises/first-at-least", { headers: { Origin: "https://attacker.invalid" } })).status, 403);
  const preflight = await api.request("/api/jobs", { method: "OPTIONS", headers: {
    Origin: api.config.allowedOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type",
  } }, null);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), api.config.allowedOrigin);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
  assert.equal((await api.request("/api/jobs", { method: "OPTIONS", headers: {
    Origin: api.config.allowedOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-arbitrary-option",
  } }, null)).status, 403);
});

test("strict JSON fields, UTF8 code size, NUL and total-body bounds", async t => {
  let calls = 0;
  const api = await fixture(t, { execute: async () => { calls++; return passed; } });
  for (const value of [null, [], { ...submission, extra: true }, { ...submission, exerciseVersion: "1" }, { ...submission, language: "javascript" }, { ...submission, action: "cancel" }, { ...submission, code: "a\0b" }]) {
    assert.equal((await api.post(value)).status, 400);
  }
  assert.equal((await api.request("/api/jobs", { method: "POST", body: JSON.stringify(submission) })).status, 415);
  assert.equal((await api.request("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
  assert.equal((await api.post({ ...submission, code: "é".repeat(16_385) })).status, 413);
  assert.equal((await api.post({ ...submission, code: "x".repeat(41_000) })).status, 413);
  assert.equal(calls, 0);
});

test("execution-disabled mode permits reads but never invokes executor", async t => {
  let calls = 0;
  const api = await fixture(t, { execute: async () => { calls++; return passed; } }, { executionEnabled: false });
  assert.equal((await api.post()).status, 503);
  assert.equal((await api.request("/healthz")).status, 200);
  assert.equal((await api.request("/api/exercises/first-at-least")).status, 200);
  assert.equal(calls, 0);
});

test("one global active job, durable source-free admission and no second process owner", async t => {
  const gate = Promise.withResolvers<ExecutionResult>();
  let calls = 0;
  const api = await fixture(t, { execute: () => { calls++; return gate.promise; } });
  const source = "UNIQUE_LEARNER_SOURCE_MUST_NOT_PERSIST";
  const response = await api.post({ ...submission, action: "submit", code: source });
  assert.equal(response.status, 202);
  const job = await response.json() as JobView;
  assert.equal((await api.post()).status, 429);
  assert.equal((await api.post(submission, otherToken)).status, 429);
  assert.equal(calls, 1);
  assert.throws(() => createApi(api.config, { execute: async () => passed }), /already owned/);
  const db = new DatabaseSync(api.config.dbPath);
  try {
    assert.equal(storedNumber(db, "SELECT count FROM counters WHERE scope='month'"), 9);
    assert.equal(storedNumber(db, "SELECT SUM(cost) AS count FROM minute_reservations"), 9);
    assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM jobs").all()), new RegExp(source));
  } finally { db.close(); }
  gate.resolve(passed);
  await completed(api, job.id);
  for (const path of [api.config.dbPath, api.config.dbPath + "-wal"]) {
    try { assert.equal((await readFile(path)).includes(Buffer.from(source)), false); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
});

test("daily and monthly quotas survive restart, and failed admissions reserve nothing", async t => {
  const api = await fixture(t, undefined, { inviteDailyLimit: 1, globalDailyLimit: 2, monthlyRunLimit: 10 });
  const first = await api.post({ ...submission, action: "submit" });
  const job = await first.json() as JobView;
  await completed(api, job.id);
  assert.equal((await api.post()).status, 429);
  await api.server.shutdown();
  const restarted = await api.start();
  assert.equal((await restarted.post()).status, 429);
  const second = await restarted.post(submission, otherToken);
  assert.equal(second.status, 202);
  const secondJob = await second.json() as JobView;
  await completed(restarted, secondJob.id, otherToken);
  assert.equal((await restarted.post(submission, otherToken)).status, 429);
  const db = new DatabaseSync(api.config.dbPath);
  try { assert.equal(storedNumber(db, "SELECT count FROM counters WHERE scope='month'"), 10); }
  finally { db.close(); }
});

test("rolling minute reserves 9 provider runs for submit and denies request beyond30", async t => {
  const api = await fixture(t);
  for (let index = 0; index < 3; index++) {
    const response = await api.post({ ...submission, action: "submit" });
    assert.equal(response.status, 202);
    const job = await response.json() as JobView;
    await completed(api, job.id);
  }
  assert.equal((await api.post({ ...submission, action: "submit" })).status, 429);
  const db = new DatabaseSync(api.config.dbPath);
  try {
    assert.equal(storedNumber(db, "SELECT SUM(cost) AS count FROM minute_reservations"), 27);
    // A reservation59s ago remains charged even across a wall-clock minute boundary.
    db.prepare("UPDATE minute_reservations SET created_at=?").run(Date.now() - 59_000);
  } finally { db.close(); }
  assert.equal((await api.post({ ...submission, action: "submit" })).status, 429);
});

test("uncertain execution and restart quarantine, no replay and no refund", async t => {
  const gate = Promise.withResolvers<ExecutionResult>();
  let replays = 0;
  const api = await fixture(t, { execute: () => gate.promise });
  const response = await api.post({ ...submission, action: "submit" });
  const job = await response.json() as JobView;
  await api.server.shutdown();
  const restarted = await api.start({ execute: async () => { replays++; return passed; } });
  const recovered = await (await restarted.request(`/api/jobs/${job.id}`)).json() as JobView;
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.result?.status, "service-error");
  assert.equal((await restarted.post()).status, 429);
  assert.equal(replays, 0);
  const db = new DatabaseSync(api.config.dbPath);
  try {
    assert.equal(storedNumber(db, "SELECT count FROM counters WHERE scope='month'"), 9);
    assert(storedNumber(db, "SELECT occupied_until FROM occupancy", "occupied_until") > Date.now() + 115_000);
  } finally { db.close(); }
  gate.resolve(passed);
});

test("unexpected executor throws are generic, quarantined and never expose secrets", async t => {
  const api = await fixture(t, { execute: async () => { throw new Error("source=SECRET_SOURCE key=test-key-not-a-provider-credential"); } });
  const response = await api.post();
  const admitted = await response.json() as JobView;
  const job = await completed(api, admitted.id);
  assert.equal(job.result?.status, "service-error");
  assert.doesNotMatch(JSON.stringify(job), /SECRET_SOURCE|test-key/);
  assert.equal((await api.post()).status, 429);
});

test("private response safety strips extra fields, source and case IDs", async t => {
  const dirty = {
    ...passed, code: "PRIVATE_SOURCE", message: "PRIVATE_DIAGNOSTIC",
    feedback: { status: "wrong-answer", failureCategories: ["duplicate handling"], privateCases: [{ values: [123456789], expected: 99 }], caseId: "private-7" },
    status: "wrong-answer",
  } as unknown as ExecutionResult;
  const api = await fixture(t, { execute: async () => dirty });
  const response = await api.post({ ...submission, action: "submit" });
  const admitted = await response.json() as JobView;
  const job = await completed(api, admitted.id);
  assert.deepEqual(job.result, { status: "wrong-answer", feedback: { status: "wrong-answer", failureCategories: ["duplicate handling"] }, implementationComplexityVerified: false });
  assert.doesNotMatch(JSON.stringify(job), /PRIVATE|123456789|caseId|private-7/);
});

test("private runtime failures retain categories without exposing diagnostics", async t => {
  const api = await fixture(t, { execute: async () => ({
    status: "runtime-error",
    feedback: { status: "wrong-answer", failureCategories: ["duplicate handling"] },
    message: "PRIVATE_INPUT_AND_DIAGNOSTIC",
    implementationComplexityVerified: false,
  }) });
  const response = await api.post({ ...submission, action: "submit" });
  const admitted = await response.json() as JobView;
  const job = await completed(api, admitted.id);
  assert.deepEqual(job.result, {
    status: "runtime-error",
    feedback: { status: "wrong-answer", failureCategories: ["duplicate handling"] },
    implementationComplexityVerified: false,
  });
});

test("compiler messages are ephemeral and provider keys are redacted", async t => {
  const source = "learner source line that must not reach sqlite";
  const api = await fixture(t, { execute: async () => ({ status: "compile-error", message: `${source} test-key-not-a-provider-credential`, implementationComplexityVerified: false }) });
  const response = await api.post({ ...submission, code: source });
  const admitted = await response.json() as JobView;
  const job = await completed(api, admitted.id);
  assert.equal(job.result?.status, "compile-error");
  assert.match(job.result?.message ?? "", /\[redacted\]/);
  const db = new DatabaseSync(api.config.dbPath);
  try { assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM jobs").all()), /learner source|test-key/); }
  finally { db.close(); }
});

test("stale crashed ownership recovers running rows without invoking the executor", async t => {
  const api = await fixture(t);
  const response = await api.post({ ...submission, action: "submit" });
  const job = await response.json() as JobView;
  await completed(api, job.id);
  await api.server.shutdown();
  const db = new DatabaseSync(api.config.dbPath);
  try {
    db.prepare("UPDATE jobs SET state='running',result=NULL WHERE id=?").run(job.id);
    db.prepare("INSERT INTO ownership VALUES (1)").run();
    db.prepare("UPDATE occupancy SET occupied_until=0").run();
  } finally { db.close(); }
  let calls = 0;
  const restarted = await api.start({ execute: async () => { calls++; return passed; } });
  const recovered = await (await restarted.request(`/api/jobs/${job.id}`)).json() as JobView;
  assert.equal(recovered.result?.status, "service-error");
  assert.equal((await restarted.post()).status, 429);
  assert.equal(calls, 0);
});

test("legacy crash recovery tolerates PID reuse without replaying work or refunding quota", async t => {
  const api = await fixture(t);
  const job = await (await api.post({ ...submission, action: "submit" })).json() as JobView;
  await completed(api, job.id);
  await api.server.shutdown();
  const db = new DatabaseSync(api.config.dbPath);
  try {
    db.exec("DROP TABLE ownership; CREATE TABLE ownership (singleton INTEGER PRIMARY KEY CHECK(singleton=1), pid INTEGER NOT NULL, token TEXT NOT NULL)");
    db.prepare("INSERT INTO ownership VALUES (1,?,'crashed-container')").run(process.pid);
    db.prepare("UPDATE jobs SET state='running',result=NULL WHERE id=?").run(job.id);
  } finally { db.close(); }
  let calls = 0;
  const restarted = await api.start({ execute: async () => { calls++; return passed; } });
  const recovered = await (await restarted.request(`/api/jobs/${job.id}`)).json() as JobView;
  assert.equal(recovered.result?.status, "service-error");
  assert.equal((await restarted.post()).status, 429);
  assert.equal(calls, 0);
  const persisted = new DatabaseSync(api.config.dbPath);
  try { assert.equal(storedNumber(persisted, "SELECT count FROM counters WHERE scope='month'"), 9); }
  finally { persisted.close(); }
});

test("completed results expire after24h while current budget counters remain", async t => {
  const api = await fixture(t);
  const response = await api.post();
  const job = await response.json() as JobView;
  await completed(api, job.id);
  const db = new DatabaseSync(api.config.dbPath);
  try {
    db.prepare("UPDATE jobs SET created_at=? WHERE id=?").run(Date.now() - 86_400_001, job.id);
  } finally { db.close(); }
  assert.equal((await api.request(`/api/jobs/${job.id}`)).status, 404);
  const inspect = new DatabaseSync(api.config.dbPath);
  try { assert.equal(storedNumber(inspect, "SELECT count FROM counters WHERE scope='month'"), 1); }
  finally { inspect.close(); }
});

test("monthly provider budget and global daily job limit each reject atomically", async t => {
  const monthly = await fixture(t, undefined, { monthlyRunLimit: 8 });
  assert.equal((await monthly.post({ ...submission, action: "submit" })).status, 429);
  const admitted = await monthly.post();
  assert.equal(admitted.status, 202);
  const job = await admitted.json() as JobView;
  await completed(monthly, job.id);
  const inspect = new DatabaseSync(monthly.config.dbPath);
  try { assert.equal(storedNumber(inspect, "SELECT count FROM counters WHERE scope='month'"), 1); }
  finally { inspect.close(); }
  const daily = await fixture(t, undefined, { globalDailyLimit: 1 });
  const response = await daily.post();
  const first = await response.json() as JobView;
  await completed(daily, first.id);
  assert.equal((await daily.post(submission, otherToken)).status, 429);
});

test("public booleans do not coerce into correct numeric answers", async t => {
  const feedback = { status: "wrong-answer" as const, cases: [
    { index: 0, expected: 1, actual: true, passed: true },
    { index: 1, expected: 2, actual: 2, passed: true },
    { index: 2, expected: 0, actual: false, passed: true },
  ] };
  const api = await fixture(t, { execute: async () => ({ status: "wrong-answer", feedback, implementationComplexityVerified: false }) });
  const response = await api.post();
  const admitted = await response.json() as JobView;
  const job = await completed(api, admitted.id);
  assert(job.result?.feedback && "cases" in job.result.feedback);
  assert.equal(job.result.feedback.cases[0]?.actual, true);
  assert.equal(job.result.feedback.cases[0]?.passed, false);
  assert.equal(job.result.feedback.cases[2]?.actual, false);
  assert.equal(job.result.feedback.cases[2]?.passed, false);
});

test("malformed learner output is wrong-answer without leaking raw output or diagnostics", async t => {
  const api = await fixture(t, { execute: async () => ({
    status: "wrong-answer", message: "RAW_STDOUT_AND_PROVIDER_METADATA", implementationComplexityVerified: false,
  }) });
  const response = await api.post();
  const admitted = await response.json() as JobView;
  const job = await completed(api, admitted.id);
  assert.equal(job.result?.status, "wrong-answer");
  assert.match(job.result?.message ?? "", /answer format or value/);
  assert.doesNotMatch(JSON.stringify(job), /RAW_STDOUT/);
  // A known wrong answer completed normally: capacity is released, not quarantined.
  assert.equal((await api.post()).status, 202);
});

test("inconsistent accepted private feedback becomes a quarantined service-error", async t => {
  const api = await fixture(t, { execute: async () => ({
    status: "passed", feedback: { status: "passed", failureCategories: ["duplicate handling"] }, implementationComplexityVerified: false,
  }) });
  const response = await api.post({ ...submission, action: "submit" });
  const admitted = await response.json() as JobView;
  const job = await completed(api, admitted.id);
  assert.equal(job.result?.status, "service-error");
  assert.equal((await api.post()).status, 429);
});
