import { firstAtLeast } from "../../src/learning/first-at-least";
import { gradeExamples } from "../learning/first-at-least";
import { buildProgram, privateBundles, publicBundle, type FixtureBundle } from "./harness";
import type { Executor } from "./types";
import type { ExecutionResult, Submission } from "../../src/learning/execution";

const ENDPOINT = "https://api.onlinecompiler.io/api/run-tests/";
const RESPONSE_BYTE_LIMIT = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 65_000;
const TIME_LIMIT = 2;
const SERVICE_MESSAGE = "The execution service could not return a complete, valid result. Please try again later.";

const verdicts = ["accepted", "wrong_answer", "compilation_error", "runtime_error", "time_limit_exceeded", "memory_limit_exceeded", "output_limit_exceeded", "internal_error", "skipped"] as const;
type Verdict = typeof verdicts[number];
type FailureStatus = "compile-error" | "runtime-error" | "resource-limit";
interface NativeTest {
  verdict: Verdict;
  output?: string;
  error?: string;
}
interface NativeResult {
  tests: NativeTest[];
  compileError: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(): never {
  throw new Error("Invalid execution service response.");
}

function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (verdicts as readonly string[]).includes(value);
}

/** Select only the documented grading fields; never retain files or metadata. */
function validateResult(value: unknown, count: number, hidden: boolean): NativeResult {
  if (!record(value) || !Array.isArray(value.tests) || value.tests.length !== count || value.total !== count
      || !Number.isInteger(value.passed) || value.time_limit !== TIME_LIMIT
      || !(value.compile_error === null || (typeof value.compile_error === "string" && value.compile_error.length <= 4096))
      || (hidden && value.compile_error !== null)) invalid();
  if (value.verdict === "incomplete" || value.verdict === "internal_error" || !isVerdict(value.verdict)) invalid();
  const tests: NativeTest[] = value.tests.map((item: unknown) => {
    if (!record(item) || !isVerdict(item.verdict) || item.hidden !== hidden || item.verdict === "internal_error") invalid();
    if (hidden || item.verdict === "skipped") {
      // Hidden diagnostics violate the provider privacy contract. Fail closed,
      // rather than accidentally making them available through another path.
      for (const field of ["output", "error", "exit_code", "signal", "time", "memory", "truncated", "files", "files_truncated"]) {
        if (Object.hasOwn(item, field)) invalid();
      }
      return { verdict: item.verdict };
    }
    if (typeof item.output !== "string" || item.output.length > 4096 || typeof item.error !== "string" || item.error.length > 4096
        || typeof item.truncated !== "boolean"
        || !(item.exit_code === null || Number.isInteger(item.exit_code))
        || !(item.signal === null || Number.isInteger(item.signal))) invalid();
    if ((item.verdict === "accepted" || item.verdict === "wrong_answer") && (item.exit_code !== 0 || item.signal !== null)) invalid();
    return { verdict: item.verdict, output: item.output, error: item.error };
  });
  const passed = tests.filter(test => test.verdict === "accepted").length;
  const firstFailure = tests.find(test => test.verdict !== "accepted")?.verdict;
  if (value.passed !== passed || value.score !== (passed === count ? 100 : 0)
      || value.verdict !== (firstFailure ?? "accepted")) invalid();
  const skippedAt = tests.findIndex(test => test.verdict === "skipped");
  if (skippedAt !== -1) {
    // Compilation failures natively skip the rest even with stop_on_failure:false.
    // Any other skipped test means coverage was incomplete, never a wrong answer.
    if (firstFailure !== "compilation_error" || !tests.slice(skippedAt).every(test => test.verdict === "skipped")) invalid();
  }
  if (value.compile_error !== null && !tests.some(test => test.verdict === "compilation_error")) invalid();
  return { tests, compileError: value.compile_error as string | null };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) invalid();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const pieces: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_BYTE_LIMIT) invalid();
      pieces.push(decoder.decode(value, { stream: true }));
    }
    pieces.push(decoder.decode());
    return JSON.parse(pieces.join("")) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function failureStatus(verdict: Verdict): FailureStatus | undefined {
  switch (verdict) {
    case "compilation_error": return "compile-error";
    case "runtime_error": return "runtime-error";
    case "time_limit_exceeded":
    case "memory_limit_exceeded":
    case "output_limit_exceeded": return "resource-limit";
    default: return undefined;
  }
}

function result(status: ExecutionResult["status"], message?: string): ExecutionResult {
  return { status, ...(message === undefined ? {} : { message }), implementationComplexityVerified: false };
}

export class OnlineCompilerExecutor implements Executor {
  /** Optional transport injection is only a test seam; production origin is fixed. */
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async run(code: string, language: Submission["language"], bundles: readonly FixtureBundle[], hidden: boolean): Promise<NativeResult> {
    if (!this.apiKey.trim()) invalid();
    const response = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Authorization: this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        compiler: language === "python" ? "python-3.14" : "openjdk-25",
        code,
        tests: bundles.map(bundle => ({ input: bundle.input, expected_output: bundle.expected_output, hidden })),
        time_limit: TIME_LIMIT,
        checker: "exact",
        scoring: "all_or_nothing",
        stop_on_failure: false,
      }),
    });
    if (response.status !== 200) {
      // Error bodies can contain submitted code or credentials. Never read them.
      await response.body?.cancel().catch(() => {});
      invalid();
    }
    return validateResult(await readBoundedJson(response), bundles.length, hidden);
  }

  private diagnostic(value: string | undefined, fallback: string): string {
    if (!value) return fallback;
    return value.split(this.apiKey).join("[redacted]").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 4096);
  }

  async execute(submission: Submission): Promise<ExecutionResult> {
    try {
      if (submission.exerciseId !== "first-at-least" || submission.exerciseVersion !== 1
          || (submission.action !== "run" && submission.action !== "submit")) invalid();
      const code = buildProgram(submission.language, submission.code);
      const visible = await this.run(code, submission.language, [publicBundle], false);
      const example = visible.tests[0]!;
      const failedStatus = failureStatus(example.verdict);
      if (failedStatus) {
        const fallback = failedStatus === "compile-error" ? "The program did not compile."
          : failedStatus === "runtime-error" ? "The program failed while running the examples."
            : "The program exceeded an execution resource limit.";
        return result(failedStatus, this.diagnostic(visible.compileError || example.error, fallback));
      }
      if (example.verdict !== "accepted" && example.verdict !== "wrong_answer") invalid();
      let outputs: unknown;
      try { outputs = JSON.parse(example.output!); } catch { outputs = undefined; }
      const validAnswers = Array.isArray(outputs) && outputs.length === firstAtLeast.examples.length
        && outputs.every(item => typeof item === "number" && Number.isFinite(item));
      if (example.verdict === "wrong_answer") {
        if (example.output === publicBundle.expected_output) invalid();
        if (!validAnswers) return result("wrong-answer", "The program did not return the required integer answers for the examples.");
        const feedback = gradeExamples(outputs as number[]);
        // Exact checking also rejects noncanonical output formatting even when
        // parsed numbers happen to match. Never turn that rejection into a pass.
        return feedback.status === "wrong-answer"
          ? { ...result("wrong-answer"), feedback }
          : result("wrong-answer", "The program output did not match the required answer format.");
      }
      if (!validAnswers || example.output !== publicBundle.expected_output) invalid();
      const feedback = gradeExamples(outputs as number[]);
      if (feedback.status !== "passed") invalid();
      if (submission.action === "run") {
        return { ...result("passed"), feedback };
      }
      const hidden = await this.run(code, submission.language, privateBundles, true);
      const failureCategories = privateBundles.filter((_, index) => hidden.tests[index]!.verdict !== "accepted").map(bundle => bundle.category);
      const firstNativeFailure = hidden.tests.find(test => test.verdict !== "accepted");
      const status = firstNativeFailure ? failureStatus(firstNativeFailure.verdict) ?? "wrong-answer" : "passed";
      return {
        ...result(status),
        feedback: { status: failureCategories.length ? "wrong-answer" : "passed", failureCategories },
      };
    } catch {
      // Never log the exception: fetch/provider failures may embed sensitive data.
      return result("service-error", SERVICE_MESSAGE);
    }
  }
}
