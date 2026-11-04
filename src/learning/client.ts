import type { ExecutionResult, JobView, Submission } from "./execution";
import { firstAtLeast } from "./first-at-least";

export class ExecutionApiError extends Error {
  readonly status: number | null;
  readonly uncertain: boolean;
  /** An admitted job can still be recovered when the rest of its response is invalid. */
  readonly jobId: string | null;

  constructor(message: string, status: number | null, uncertain = false, jobId: string | null = null) {
    super(message);
    this.name = "ExecutionApiError";
    this.status = status;
    this.uncertain = uncertain;
    this.jobId = jobId;
  }
}

const jobIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const admissionRejections = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429, 503]);
const failureStatuses: Record<string, true> = { "compile-error": true, "runtime-error": true, "resource-limit": true, "service-error": true };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

function httpMessage(status: number): string {
  switch (status) {
    case 401: return "Enter a valid invite to connect to the execution service.";
    case 403: return "This invite or browser origin is not allowed to use the execution service.";
    case 404: return "This exercise or job is unavailable for this invite. Check the invite and job before trying again.";
    case 400: case 422: return "The execution service rejected the submission. Check the exercise, language and source.";
    case 413: return "The source is too large. Reduce it to at most 32 KiB before trying again.";
    case 415: return "The execution service rejected the request format. Reload the app before trying again.";
    case 429: return "The execution service is at its job or usage limit. Do not resubmit an existing job.";
    case 503: return "New execution jobs are currently disabled or unavailable.";
    default: return "The execution service could not complete the request. Check an existing job before submitting again.";
  }
}

function parseResult(value: unknown, action?: Submission["action"]): ExecutionResult | null {
  if (!record(value) || value.implementationComplexityVerified !== false || !text(value.status) ||
      !onlyKeys(value, ["status", "feedback", "message", "implementationComplexityVerified"]) ||
      value.message !== undefined && (!text(value.message) || value.message.length > 8192)) return null;
  const status = value.status;
  const executionFailure = Object.hasOwn(failureStatuses, status);
  if (executionFailure && value.feedback === undefined) {
    return { status: status as ExecutionResult["status"], implementationComplexityVerified: false,
      ...(text(value.message) ? { message: value.message } : {}) };
  }
  if ((status !== "passed" && status !== "wrong-answer" && !executionFailure) || status === "service-error") return null;
  if (value.feedback === undefined) {
    return status === "wrong-answer" && text(value.message)
      ? { status, message: value.message, implementationComplexityVerified: false } : null;
  }
  const feedback = value.feedback;
  const feedbackStatus = status === "passed" ? "passed" : "wrong-answer";
  if (!record(feedback) || feedback.status !== feedbackStatus) return null;
  if ("failureCategories" in feedback) {
    if (action === "run" || !onlyKeys(feedback, ["status", "failureCategories"]) ||
        !texts(feedback.failureCategories) || feedback.failureCategories.length > 64 ||
        feedback.failureCategories.some(category => category.length === 0 || category.length > 160) ||
        (status === "passed") !== (feedback.failureCategories.length === 0)) return null;
    return { status: status as ExecutionResult["status"], feedback: { status: feedbackStatus, failureCategories: [...new Set(feedback.failureCategories)] }, implementationComplexityVerified: false };
  }
  // Submit may fail the visible examples before any private checks are started.
  if ((status !== "passed" && status !== "wrong-answer") || (action === "submit" && status === "passed") ||
      !onlyKeys(feedback, ["status", "cases"]) || !Array.isArray(feedback.cases) ||
      feedback.cases.length !== firstAtLeast.examples.length) return null;
  const cases = [];
  for (const [index, expectedExample] of firstAtLeast.examples.entries()) {
    const item: unknown = feedback.cases[index];
    if (!record(item) || !onlyKeys(item, ["index", "expected", "actual", "passed"]) ||
        item.index !== index || item.expected !== expectedExample.expected || typeof item.passed !== "boolean" ||
        !(item.actual === null || typeof item.actual === "boolean" || typeof item.actual === "number" && Number.isFinite(item.actual))) return null;
    const passed = integer(item.actual) && item.actual === expectedExample.expected;
    if (item.passed !== passed) return null;
    cases.push({ index, expected: expectedExample.expected, actual: item.actual, passed });
  }
  if ((status === "passed") !== cases.every(item => item.passed)) return null;
  return { status, feedback: { status, cases }, implementationComplexityVerified: false };
}

function parseJob(value: unknown, action?: Submission["action"]): JobView | null {
  if (!record(value) || !text(value.id) || !jobIdPattern.test(value.id) ||
      !text(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) return null;
  if (value.status === "queued" || value.status === "running") {
    return value.result === undefined ? { id: value.id, status: value.status, createdAt: value.createdAt } : null;
  }
  if (value.status !== "completed") return null;
  const result = parseResult(value.result, action);
  return result ? { id: value.id, status: "completed", createdAt: value.createdAt, result } : null;
}

function validExercise(value: unknown): value is typeof firstAtLeast {
  if (!record(value) || value.id !== firstAtLeast.id || value.version !== firstAtLeast.version ||
      !text(value.title) || !text(value.statement) || !texts(value.constraints) ||
      !record(value.requirements) || !text(value.requirements.time) || !text(value.requirements.auxiliarySpace) ||
      !record(value.provenance) || value.provenance.kind !== "original" || !text(value.provenance.author) ||
      !record(value.implementations) || !Array.isArray(value.examples) || value.examples.length !== firstAtLeast.examples.length) return false;
  for (const language of ["python", "java"]) {
    const implementation = value.implementations[language];
    if (!record(implementation) || !text(implementation.signature) || !text(implementation.instructions)) return false;
  }
  return value.examples.every((example: unknown, index: number) => {
    const canonical = firstAtLeast.examples[index];
    return record(example) && record(example.input) && Array.isArray(example.input.values) &&
      example.input.values.length === canonical.input.values.length &&
      example.input.values.every((item: unknown, itemIndex: number) => item === canonical.input.values[itemIndex]) &&
      example.input.target === canonical.input.target && example.expected === canonical.expected && text(example.explanation);
  });
}

async function request(token: string, path: string, signal?: AbortSignal, submission?: Submission): Promise<{ value: unknown; status: number }> {
  const post = submission !== undefined;
  if (signal?.aborted) throw new ExecutionApiError("Request stopped locally. Any already admitted job continues remotely.", null);
  const deadline = AbortSignal.timeout(15_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let response: Response;
  try {
    response = await fetch(path, {
      method: post ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(post ? { "Content-Type": "application/json" } : {}) },
      ...(post ? { body: JSON.stringify(submission) } : {}),
      cache: "no-store", redirect: "error", signal: combined,
    });
  } catch {
    throw new ExecutionApiError(combined.aborted
      ? "Request stopped or timed out locally. Any admitted job continues remotely; do not automatically resubmit."
      : "Could not reach the execution service. Check an existing job before submitting again.", null, post);
  }
  let value: unknown;
  try { value = await response.json(); }
  catch {
    throw new ExecutionApiError(response.ok
      ? "The execution service returned an unreadable response. Do not automatically resubmit."
      : httpMessage(response.status), response.status, post && (response.ok || !admissionRejections.has(response.status)));
  }
  if (!response.ok) {
    const knownId = post && record(value) && text(value.id) && jobIdPattern.test(value.id) ? value.id : null;
    throw new ExecutionApiError(httpMessage(response.status), response.status,
      post && !knownId && !admissionRejections.has(response.status), knownId);
  }
  return { value, status: response.status };
}

export async function loadExercise(token: string, signal?: AbortSignal): Promise<typeof firstAtLeast> {
  const { value, status } = await request(token, "/api/exercises/first-at-least", signal);
  if (!validExercise(value)) throw new ExecutionApiError("The execution service returned an unsupported or invalid exercise. Reload after checking the service version.", status);
  // The checked exercise is the bundled public version; never pass through extra server fields.
  return firstAtLeast;
}

export async function createJob(token: string, submission: Submission, signal?: AbortSignal): Promise<JobView> {
  const { value, status } = await request(token, "/api/jobs", signal, submission);
  const job = parseJob(value, submission.action);
  if (job) return job;
  const knownId = record(value) && text(value.id) && jobIdPattern.test(value.id) ? value.id : null;
  throw new ExecutionApiError("The execution service returned an invalid job response. Recover the known job before submitting again.", status, !knownId, knownId);
}

export async function getJob(token: string, id: string, signal?: AbortSignal): Promise<JobView> {
  if (!jobIdPattern.test(id)) throw new ExecutionApiError("The saved job ID is invalid. It cannot be resumed.", null);
  const { value, status } = await request(token, `/api/jobs/${id}`, signal);
  const job = parseJob(value);
  if (!job || job.id !== id) throw new ExecutionApiError("The execution service returned an invalid or mismatched job response. Keep the job ID and check again later.", status, false, id);
  return job;
}
