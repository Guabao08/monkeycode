import assert from "node:assert/strict";
import test from "node:test";
import { firstAtLeast } from "../../src/learning/first-at-least";
import { privateCases } from "../learning/first-at-least";
import { buildFixtureBundle, buildProgram, privateBundles, publicBundle } from "./harness";
import { OnlineCompilerExecutor } from "./onlinecompiler";
import type { Submission } from "../../src/learning/execution";

const submission: Submission = {
  exerciseId: "first-at-least", exerciseVersion: 1, language: "python", action: "run",
  code: "def first_at_least(values, target):\n    return 0\n",
};

function native(verdicts: readonly string[] = ["accepted"], hidden = false, output = publicBundle.expected_output): Record<string, unknown> {
  const passed = verdicts.filter(value => value === "accepted").length;
  return {
    verdict: verdicts.find(value => value !== "accepted") ?? "accepted",
    score: passed === verdicts.length ? 100 : 0,
    passed, total: verdicts.length, time_limit: 2, compile_error: null,
    tests: verdicts.map(verdict => hidden || verdict === "skipped" ? { verdict, hidden } : {
      verdict, hidden, output, error: "", exit_code: verdict === "accepted" || verdict === "wrong_answer" ? 0 : 1,
      signal: null, truncated: false, time: "0.01", memory: "1000", files: [], files_truncated: false,
    }),
  };
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

function executor(...responses: (Response | Error)[]): { executor: OnlineCompilerExecutor; requests: RequestInit[] } {
  const requests: RequestInit[] = [];
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.onlinecompiler.io/api/run-tests/");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    requests.push(init!);
    const next = responses.shift();
    assert.ok(next, "unexpected extra provider request (no retry allowed)");
    if (next instanceof Error) throw next;
    return next;
  };
  return { executor: new OnlineCompilerExecutor("test-secret-key", transport), requests };
}

function tests(value: Record<string, unknown>): Record<string, unknown>[] {
  return value.tests as Record<string, unknown>[];
}

test("visible pass validates numeric examples and strips provider files and metadata", async () => {
  const body = native();
  tests(body)[0]!.files = [{ content_base64: "PRIVATE_FILE", url: "https://untrusted.invalid/file" }];
  body.untrusted = "UNTRUSTED_METADATA";
  const service = executor(response(body));
  const result = await service.executor.execute(submission);
  assert.equal(result.status, "passed");
  assert.equal(result.implementationComplexityVerified, false);
  assert.ok(result.feedback && "cases" in result.feedback);
  assert.deepEqual(result.feedback.cases.map(item => item.actual), [1, 2, 0]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FILE|untrusted|UNTRUSTED_METADATA/);
  assert.equal(service.requests.length, 1);
});

test("wrong public answers include only public example feedback and stop before hidden tests", async () => {
  const service = executor(response(native(["wrong_answer"], false, "[0,2,0]\n")));
  const result = await service.executor.execute({ ...submission, action: "submit" });
  assert.equal(result.status, "wrong-answer");
  assert.ok(result.feedback && "cases" in result.feedback);
  assert.deepEqual(result.feedback.cases[0], { index: 0, expected: 1, actual: 0, passed: false });
  assert.equal(service.requests.length, 1);
});

test("booleans, strings, null and non-integer numbers never coerce to integer answers", async () => {
  for (const actual of [true, "1", null, 1.5]) {
    const result = await executor(response(native(["wrong_answer"], false, JSON.stringify([actual, 2, 0])))).executor.execute(submission);
    assert.equal(result.status, "wrong-answer");
    if (typeof actual === "number") {
      assert.ok(result.feedback && "cases" in result.feedback);
      assert.equal(result.feedback.cases[0]!.passed, false);
    } else {
      assert.equal(result.feedback, undefined);
    }
  }
});

test("accepted verdict requires matching numeric output and consistent aggregate counts", async () => {
  const inconsistent = [
    native(["accepted"], false, "[true,2,0]"),
    native(["accepted"], false, "[0,2,0]"),
    { ...native(), passed: 0 },
    { ...native(), total: 2 },
    { ...native(), score: 0 },
    { ...native(), verdict: "wrong_answer" },
    native(["wrong_answer"]),
  ];
  for (const body of inconsistent) {
    assert.equal((await executor(response(body)).executor.execute(submission)).status, "service-error");
  }
});

test("malformed native envelopes and invalid accepted outputs are service faults", async () => {
  const wrongHidden = native();
  tests(wrongHidden)[0]!.hidden = true;
  const missingExit = native();
  delete tests(missingExit)[0]!.exit_code;
  const nonzeroAccepted = native();
  tests(nonzeroAccepted)[0]!.exit_code = 1;
  for (const body of [null, [], {}, { ...native(), tests: [] }, { ...native(), time_limit: 99 },
    { ...native(), compile_error: {} }, wrongHidden, missingExit, nonzeroAccepted,
    native(["unknown_status"]), native(["accepted"], false, "not JSON"),
    native(["accepted"], false, "[1,2]"), native(["accepted"], false, "[{},2,0]"),
    native(["accepted"], false, "[1e999,2,0]")]) {
    const result = await executor(response(body)).executor.execute(submission);
    assert.equal(result.status, "service-error");
    assert.equal(result.feedback, undefined);
  }
});

test("malformed learner stdout is wrong-answer without persisting arbitrary stdout", async () => {
  for (const output of ["INCIDENTAL_PRINT\n[1,2,0]\n", "[1,2]", "[{},2,0]", "[\"PRIVATE_STRING\",2,0]", "[1, 2, 0]\n", "[1.0,2,0]\n"]) {
    const result = await executor(response(native(["wrong_answer"], false, output))).executor.execute(submission);
    assert.equal(result.status, "wrong-answer");
    assert.equal(result.feedback, undefined);
    assert.doesNotMatch(JSON.stringify(result), /INCIDENTAL_PRINT|PRIVATE_STRING/);
  }
});

test("native public failure verdicts map explicitly and safe diagnostics redact credentials", async () => {
  const expected: Record<string, string> = {
    compilation_error: "compile-error", runtime_error: "runtime-error",
    time_limit_exceeded: "resource-limit", memory_limit_exceeded: "resource-limit",
    output_limit_exceeded: "resource-limit",
  };
  for (const [verdict, status] of Object.entries(expected)) {
    const body = native([verdict]);
    tests(body)[0]!.error = "Public diagnostic test-secret-key\u0001";
    if (verdict === "compilation_error") body.compile_error = "Public compile diagnostic test-secret-key";
    const result = await executor(response(body)).executor.execute(submission);
    assert.equal(result.status, status);
    assert.match(result.message!, /Public/);
    assert.doesNotMatch(result.message!, /test-secret-key|\u0001/);
  }
});

test("submit passes only after one public and eight accepted native hidden bundles", async () => {
  const service = executor(response(native()), response(native(privateBundles.map(() => "accepted"), true)));
  const result = await service.executor.execute({ ...submission, language: "java", action: "submit" });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.feedback, { status: "passed", failureCategories: [] });
  assert.equal(service.requests.length, 2);
  const hiddenRequest = JSON.parse(service.requests[1]!.body as string) as { tests: { hidden: boolean }[]; stop_on_failure: boolean };
  assert.equal(hiddenRequest.tests.length, 8);
  assert.ok(hiddenRequest.tests.every(item => item.hidden));
  assert.equal(hiddenRequest.stop_on_failure, false);
});

test("private wrong answers expose only fixture-derived failure categories", async () => {
  const verdicts = privateBundles.map((_, index) => index === 3 || index === 6 ? "wrong_answer" : "accepted");
  const body = native(verdicts, true);
  body.untrusted_category = "PRIVATE_DIAGNOSTIC";
  const result = await executor(response(native()), response(body)).executor.execute({ ...submission, action: "submit" });
  assert.equal(result.status, "wrong-answer");
  assert.deepEqual(result.feedback, { status: "wrong-answer", failureCategories: [privateBundles[3]!.category, privateBundles[6]!.category] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DIAGNOSTIC|actual|expected|input|output|error/);
});

test("private native compile, runtime and resource failures have no private diagnostics", async () => {
  for (const [verdict, status] of [["compilation_error", "compile-error"], ["runtime_error", "runtime-error"],
    ["time_limit_exceeded", "resource-limit"], ["memory_limit_exceeded", "resource-limit"], ["output_limit_exceeded", "resource-limit"]]) {
    const verdicts = privateBundles.map((_, index) => index === 0 ? verdict! : "accepted");
    const result = await executor(response(native()), response(native(verdicts, true))).executor.execute({ ...submission, action: "submit" });
    assert.equal(result.status, status);
    assert.deepEqual(result.feedback, { status: "wrong-answer", failureCategories: [privateBundles[0]!.category] });
    assert.equal(result.message, undefined);
  }
});

test("hidden diagnostic leaks, mismatched flags, incomplete and internal failures fail closed", async () => {
  const leaking = native(privateBundles.map(() => "accepted"), true);
  tests(leaking)[0]!.output = "PRIVATE_OUTPUT";
  const compileLeak = { ...native(privateBundles.map(() => "accepted"), true), compile_error: "PRIVATE_COMPILER" };
  const wrongFlag = native(privateBundles.map(() => "accepted"), true);
  tests(wrongFlag)[0]!.hidden = false;
  const bodies = [leaking, compileLeak, wrongFlag,
    native(privateBundles.map((_, index) => index === 1 ? "internal_error" : "accepted"), true),
    { ...native(privateBundles.map(() => "skipped"), true), verdict: "incomplete" },
    native(privateBundles.map((_, index) => index === 7 ? "skipped" : "accepted"), true),
    native(privateBundles.map((_, index) => index === 0 ? "wrong_answer" : "skipped"), true),
  ];
  for (const body of bodies) {
    const result = await executor(response(native()), response(body)).executor.execute({ ...submission, action: "submit" });
    assert.equal(result.status, "service-error");
    assert.equal(result.feedback, undefined);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_OUTPUT|PRIVATE_COMPILER/);
  }
});

test("native compilation failure may legitimately skip remaining hidden bundles", async () => {
  const verdicts = privateBundles.map((_, index) => index === 0 ? "compilation_error" : "skipped");
  const result = await executor(response(native()), response(native(verdicts, true))).executor.execute({ ...submission, action: "submit" });
  assert.equal(result.status, "compile-error");
  assert.ok(result.feedback && "failureCategories" in result.feedback);
  assert.deepEqual(result.feedback.failureCategories, privateBundles.map(bundle => bundle.category));
});

test("HTTP and network failures never echo bodies or exception details and are never retried", async () => {
  for (const upstream of [new Response("SECRET_CODE test-secret-key", { status: 429 }),
    new Response("SECRET_CODE test-secret-key", { status: 500 }),
    new Response("SECRET_CODE", { status: 302, headers: { Location: "https://untrusted.invalid" } }),
    new Error("SECRET_CODE test-secret-key"), new Response("{invalid JSON")]) {
    const service = executor(upstream);
    const result = await service.executor.execute(submission);
    assert.equal(result.status, "service-error");
    assert.doesNotMatch(JSON.stringify(result), /SECRET_CODE|test-secret-key/);
    assert.equal(service.requests.length, 1);
  }
});

test("streamed response budget is enforced before unbounded response accumulation", async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
    },
    cancel() { cancelled = true; },
  });
  const result = await executor(new Response(stream)).executor.execute(submission);
  assert.equal(result.status, "service-error");
  assert.equal(cancelled, true);
  assert.ok(chunks <= 7);
});

test("ordinary bounded provider output files are discarded without affecting grading", async () => {
  const body = native();
  tests(body)[0]!.files = [{ content_base64: "x".repeat(4 * 1024 * 1024), url: null }];
  const result = await executor(response(body)).executor.execute(submission);
  assert.equal(result.status, "passed");
  assert.ok(JSON.stringify(result).length < 2000);
});

test("all private fixtures fit eight bundles and reconstruct the full original arrays", () => {
  assert.equal(privateBundles.length, 8);
  const decoded: { target: number; values: number[]; expected: number; category?: string }[] = [];
  for (const bundle of privateBundles) {
    assert.ok(Buffer.byteLength(bundle.input) < 100_000);
    const tokens = bundle.input.trim().split(/\s+/).map(Number);
    const count = tokens.shift()!;
    const expected = JSON.parse(bundle.expected_output) as number[];
    assert.equal(expected.length, count);
    for (let test = 0; test < count; test++) {
      const target = tokens.shift()!;
      const encoding = tokens.shift()!;
      const length = tokens.shift()!;
      let values: number[];
      if (encoding === 1) {
        const start = tokens.shift()!;
        const step = tokens.shift()!;
        values = Array.from({ length }, (_, index) => start + index * step);
      } else values = tokens.splice(0, length);
      decoded.push({ target, values, expected: expected[test]!, category: bundle.category });
    }
    assert.equal(tokens.length, 0);
  }
  assert.equal(decoded.length, 13);
  for (const fixture of privateCases) {
    assert.ok(decoded.some(item => item.category === fixture.category && item.target === fixture.input.target
      && item.expected === fixture.expected && JSON.stringify(item.values) === JSON.stringify(fixture.input.values)));
  }
  const large = decoded.find(item => item.category === "large input boundary")!;
  assert.equal(large.values.length, 100_000);
  assert.equal(large.values[0], -50_000);
  assert.equal(large.values[99_999], 49_999);
  assert.ok(privateBundles.find(item => item.category === "large input boundary")!.input.length < 100);
  assert.deepEqual(JSON.parse(publicBundle.expected_output), firstAtLeast.examples.map(item => item.expected));
});

test("wrapper byte and NUL limits reject before transport, including UTF-8 and wrapper overhead", async () => {
  for (const code of ["\0", "x".repeat(100_000), "é".repeat(50_000)]) {
    assert.throws(() => buildProgram("python", code));
    const service = executor();
    assert.equal((await service.executor.execute({ ...submission, code })).status, "service-error");
    assert.equal(service.requests.length, 0);
  }
  const nonArithmetic = Array.from({ length: 30_000 }, (_, index) => index * index);
  assert.throws(() => buildFixtureBundle([{ input: { values: nonArithmetic, target: 0 }, expected: 0 }]));
});
