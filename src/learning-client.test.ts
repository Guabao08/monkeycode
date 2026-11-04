import assert from "node:assert/strict";
import test from "node:test";
import { createJob, ExecutionApiError, getJob, loadExercise } from "./learning/client";
import type { Submission } from "./learning/execution";
import { firstAtLeast } from "./learning/first-at-least";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const createdAt = "2026-11-03T10:00:00.000Z";
const submission: Submission = { exerciseId: "first-at-least", exerciseVersion: 1, language: "python", action: "submit", code: "private learner source" };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const passed = { status: "passed", feedback: { status: "passed", failureCategories: [] }, implementationComplexityVerified: false };
const running = { id, createdAt, status: "running" };
const frame = (type: string, job: unknown) => `${JSON.stringify({ type, job })}\n`;
const streamReply = (job: unknown, result: unknown = passed) => new Response(
  frame("admitted", job) + frame("completed", { id, createdAt, status: "completed", result }),
  { headers: { "Content-Type": "application/x-ndjson" } },
);

function apiError(error: unknown): error is ExecutionApiError {
  assert.ok(error instanceof ExecutionApiError);
  assert.doesNotMatch(error.message, /raw-secret|private learner source|invite-secret/);
  return true;
}


test("unknown versions and malformed public exercises are rejected", async t => {
  const badExercises = [
    { ...firstAtLeast, version: 2 },
    { ...firstAtLeast, implementations: { python: { signature: "x" } } },
    { ...firstAtLeast, examples: [{ input: { values: [2, 4, 4, 9], target: 4 }, expected: 8, explanation: "wrong" }] },
    null,
  ];
  const fetch = t.mock.method(globalThis, "fetch", async () => reply(badExercises.shift()));
  for (let index = 0; index < 4; index++) await assert.rejects(loadExercise("invite-secret"), error => apiError(error) && !error.uncertain);
  assert.equal(fetch.mock.callCount(), 4);
});

test("definite POST admission rejections are safe, actionable and never retried", async t => {
  const statuses = [400, 401, 403, 404, 413, 415, 429, 503];
  const fetch = t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    assert.equal(options.method, "POST");
    assert.equal(new Headers(options.headers).get("content-type"), "application/json");
    return reply({ error: "raw-secret invite-secret private learner source" }, statuses.shift());
  });
  for (const status of [400, 401, 403, 404, 413, 415, 429, 503]) {
    await assert.rejects(createJob("invite-secret", submission), error => apiError(error) && error.status === status && !error.uncertain && error.jobId === null);
  }
  assert.equal(fetch.mock.callCount(), 8);
});

test("ambiguous POST failures never retry and tell the caller not to assume rejection", async t => {
  let scenario = 0;
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    switch (scenario++) {
      case 0: throw new Error("raw-secret invite-secret");
      case 1: return reply({ error: "raw-secret" }, 500);
      case 2: return new Response("raw-secret", { status: 202 });
      default: return reply({ status: "queued" }, 202);
    }
  });
  for (let index = 0; index < 4; index++) {
    await assert.rejects(createJob("invite-secret", submission), error => apiError(error) && error.uncertain && error.jobId === null);
  }
  assert.equal(fetch.mock.callCount(), 4);
});

test("admission returns a recoverable ID before live completion without another POST", async t => {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }));
  const pending = createJob("invite-secret", submission);
  writer.enqueue(new TextEncoder().encode(frame("admitted", running)));
  const admission = await pending;
  assert.equal(admission.job.id, id);
  assert.equal(admission.job.status, "running");
  let completed = false;
  void admission.completion.then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  writer.enqueue(new TextEncoder().encode(frame("completed", { id, createdAt, status: "completed", result: passed })));
  writer.close();
  assert.equal((await admission.completion).result?.status, "passed");
  assert.equal(fetch.mock.callCount(), 1);
});

test("a known UUID survives invalid POST result or missing timestamps for GET recovery", async t => {
  const values = [
    { id, createdAt, status: "completed", result: { ...passed, implementationComplexityVerified: true } },
    { id, status: "running" },
  ];
  const fetch = t.mock.method(globalThis, "fetch", async () => streamReply(values.shift()));
  for (let index = 0; index < 2; index++) {
    await assert.rejects(createJob("invite-secret", submission), error => apiError(error) && !error.uncertain && error.jobId === id);
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test("polling rejects inconsistent completion, private case leaks and mismatched identity", async t => {
  const invalidResults = [
    { ...passed, feedback: { status: "wrong-answer", failureCategories: [] } },
    { ...passed, feedback: { status: "passed", failureCategories: ["duplicate handling"] } },
    { status: "wrong-answer", feedback: { status: "wrong-answer", failureCategories: [] }, implementationComplexityVerified: false },
    { ...passed, feedback: { status: "passed", failureCategories: [], privateInputs: [1, 2] } },
    { status: "passed", implementationComplexityVerified: false },
    { status: "runtime-error", feedback: passed.feedback, implementationComplexityVerified: false },
    { ...passed, implementationComplexityVerified: true },
  ];
  const jobs: unknown[] = invalidResults.map(result => ({ id, createdAt, status: "completed", result }));
  jobs.push({ id: otherId, createdAt, status: "running" }, { id, createdAt, status: "queued", result: passed });
  t.mock.method(globalThis, "fetch", async () => reply(jobs.shift()));
  for (let index = 0; index < invalidResults.length + 2; index++) {
    await assert.rejects(getJob("invite-secret", id), error => apiError(error) && !error.uncertain && error.jobId === id);
  }
});

test("public cases allow numeric and boolean wrong outputs but reject inconsistent grading", async t => {
  const cases = [
    { index: 0, expected: 1, actual: true, passed: false },
    { index: 1, expected: 2, actual: 2.5, passed: false },
    { index: 2, expected: 0, actual: 0, passed: true },
  ];
  let invalid = false;
  t.mock.method(globalThis, "fetch", async () => reply({ id, createdAt, status: "completed", result: {
    status: "wrong-answer", implementationComplexityVerified: false,
    feedback: { status: "wrong-answer", cases: invalid ? cases.map((item, index) => index === 0 ? { ...item, passed: true } : item) : cases },
  } }));
  assert.equal((await getJob("invite-secret", id)).result?.status, "wrong-answer");
  invalid = true;
  await assert.rejects(getJob("invite-secret", id), apiError);
});

test("Submit rejects a public-only pass while Run rejects private category feedback", async t => {
  let action: "run" | "submit" = "submit";
  t.mock.method(globalThis, "fetch", async () => streamReply(running, action === "run" ? passed : {
    status: "passed", implementationComplexityVerified: false,
    feedback: { status: "passed", cases: firstAtLeast.examples.map((example, index) => ({ index, expected: example.expected, actual: example.expected, passed: true })) },
  }));
  await assert.rejects((await createJob("invite-secret", submission)).completion, apiError);
  action = "run";
  await assert.rejects((await createJob("invite-secret", { ...submission, action })).completion, apiError);
});

test("caller abort stops a read locally and an in-flight POST remains admission-uncertain", async t => {
  const fetch = t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) => {
    const { promise, reject } = Promise.withResolvers<Response>();
    options.signal!.addEventListener("abort", () => reject(new DOMException("raw-secret", "AbortError")), { once: true });
    return promise;
  });
  for (const post of [false, true]) {
    const controller = new AbortController();
    const pending = post ? createJob("invite-secret", submission, controller.signal) : getJob("invite-secret", id, controller.signal);
    const rejected = assert.rejects(pending, error => apiError(error) && error.uncertain === post && /locally/.test(error.message));
    controller.abort();
    await rejected;
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test("already-aborted requests are not dispatched and do not imply POST admission", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not run"); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createJob("invite-secret", submission, controller.signal), error => apiError(error) && !error.uncertain);
  await assert.rejects(getJob("invite-secret", "../../not-a-job", controller.signal), apiError);
  assert.equal(fetch.mock.callCount(), 0);
});

test("private execution failures remain recoverable without exposing diagnostic text", async t => {
  t.mock.method(globalThis, "fetch", async () => reply({
    id, createdAt, status: "completed", result: {
      status: "runtime-error",
      feedback: { status: "wrong-answer", failureCategories: ["duplicate handling"] },
      message: "private diagnostic must not reach the learner",
      implementationComplexityVerified: false,
    },
  }));
  const job = await getJob("invite-secret", id);
  assert.equal(job.result?.status, "runtime-error");
  assert.deepEqual(job.result?.feedback, { status: "wrong-answer", failureCategories: ["duplicate handling"] });
  assert.equal(job.result?.message, undefined);
});

test("Submit can complete with public mismatch feedback before private checks run", async t => {
  t.mock.method(globalThis, "fetch", async () => streamReply(running, {
    status: "wrong-answer", implementationComplexityVerified: false,
    feedback: {
      status: "wrong-answer",
      cases: firstAtLeast.examples.map((example, index) => ({
        index, expected: example.expected, actual: index === 0 ? -1 : example.expected, passed: index !== 0,
      })),
    },
  }));
  const job = await (await createJob("invite-secret", submission)).completion;
  assert.equal(job.result?.status, "wrong-answer");
  assert(job.result?.feedback && "cases" in job.result.feedback);
  assert.equal(job.result.feedback.cases[0].passed, false);
});

test("a truncated or mismatched completion preserves the admitted ID and never replays", async t => {
  const responses = [
    new Response(frame("admitted", running), { headers: { "Content-Type": "application/x-ndjson" } }),
    new Response(frame("admitted", running) + frame("completed", { id: otherId, createdAt, status: "completed", result: passed }), { headers: { "Content-Type": "application/x-ndjson" } }),
  ];
  const fetch = t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  for (let index = 0; index < 2; index++) {
    const admission = await createJob("invite-secret", submission);
    await assert.rejects(admission.completion, error => apiError(error) && error.jobId === id && !error.uncertain);
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test("caller abort after admission stops only live feedback and preserves recovery identity", async t => {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }));
  const controller = new AbortController();
  const pending = createJob("invite-secret", submission, controller.signal);
  writer.enqueue(new TextEncoder().encode(frame("admitted", running)));
  const admission = await pending;
  controller.abort();
  await assert.rejects(admission.completion, error => apiError(error) && error.jobId === id && !error.uncertain);
  assert.equal(fetch.mock.callCount(), 1);
});
