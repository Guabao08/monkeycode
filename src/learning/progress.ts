import type { ExecutionResult, Submission } from "./execution";
import type { Assistance, AttemptConditions } from "./types";

export interface PendingAttempt {
  id: string;
  createdAt: string;
  action: Submission["action"];
  conditions: AttemptConditions;
}

export interface AttemptRecord {
  id: string;
  completedAt: number;
  action: Submission["action"];
  status: ExecutionResult["status"];
  conditions: AttemptConditions;
}

export interface SolveProgress {
  seen: string[];
  attempts: AttemptRecord[];
  pending: PendingAttempt | null;
}

const storageKey = "monkeycode.solve-progress.v1";
const jobIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const exposurePattern = /^[a-z0-9][a-z0-9-]{0,119}@\d+$/;
const statuses: Record<ExecutionResult["status"], true> = {
  passed: true, "wrong-answer": true, "compile-error": true, "runtime-error": true,
  "resource-limit": true, "service-error": true,
};
const assistanceKinds: Record<Assistance, true> = { hint: true, counterexample: true, solution: true };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
let readIssue: string | null = null;
let writeIssue: string | null = null;

/** RAM-only notice. Missing local history never establishes lack of outside exposure. */
export function progressStorageIssue(): string | null {
  return readIssue ?? writeIssue;
}

function cleanConditions(value: unknown): AttemptConditions | null {
  if (!record(value) || typeof value.exerciseId !== "string" || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(value.exerciseId) ||
      typeof value.exerciseVersion !== "number" || !Number.isSafeInteger(value.exerciseVersion) || value.exerciseVersion < 1 ||
      (value.language !== "python" && value.language !== "java") ||
      (value.activity !== "practice" && value.activity !== "independent-check") ||
      typeof value.previouslySeen !== "boolean" || !Array.isArray(value.assistance) ||
      !value.assistance.every(item => typeof item === "string" && Object.hasOwn(assistanceKinds, item))) return null;
  return {
    exerciseId: value.exerciseId, exerciseVersion: value.exerciseVersion, language: value.language,
    activity: value.activity, previouslySeen: value.previouslySeen,
    assistance: [...new Set(value.assistance as Assistance[])],
  };
}

function cleanAttempt(value: unknown): AttemptRecord | null {
  if (!record(value) || typeof value.id !== "string" || !jobIdPattern.test(value.id) ||
      typeof value.completedAt !== "number" || !Number.isFinite(value.completedAt) || value.completedAt < 0 ||
      (value.action !== "run" && value.action !== "submit") ||
      typeof value.status !== "string" || !Object.hasOwn(statuses, value.status)) return null;
  const conditions = cleanConditions(value.conditions);
  return conditions ? {
    id: value.id, completedAt: value.completedAt, action: value.action,
    status: value.status as ExecutionResult["status"], conditions,
  } : null;
}

function cleanPending(value: unknown): PendingAttempt | null {
  if (!record(value) || typeof value.id !== "string" || !jobIdPattern.test(value.id) ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      (value.action !== "run" && value.action !== "submit")) return null;
  const conditions = cleanConditions(value.conditions);
  return conditions ? { id: value.id, createdAt: value.createdAt, action: value.action, conditions } : null;
}

function cleanProgress(value: unknown): SolveProgress {
  if (!record(value)) return { seen: [], attempts: [], pending: null };
  const seen = Array.isArray(value.seen)
    ? [...new Set(value.seen.filter((item: unknown): item is string => typeof item === "string" && exposurePattern.test(item)))] : [];
  const candidates = Array.isArray(value.attempts)
    ? value.attempts.map(cleanAttempt).filter((item): item is AttemptRecord => item !== null) : [];
  candidates.sort((a, b) => b.completedAt - a.completedAt);
  const ids = new Set<string>();
  const attempts = candidates.filter(item => {
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  }).slice(0, 100);
  return { seen, attempts, pending: cleanPending(value.pending) };
}

export function loadProgress(): SolveProgress {
  readIssue = null;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return { seen: [], attempts: [], pending: null };
    const value: unknown = JSON.parse(stored);
    const progress = cleanProgress(value);
    if (!record(value) || !Array.isArray(value.seen) || !Array.isArray(value.attempts) ||
        !(value.pending === null || cleanPending(value.pending)) ||
        value.seen.some(item => typeof item !== "string" || !exposurePattern.test(item)) ||
        value.attempts.some(item => !cleanAttempt(item))) {
      readIssue = "Some local solve history could not be read. Missing records do not mean this exercise is unseen.";
    }
    return progress;
  } catch {
    readIssue = "Local solve history is unavailable or damaged. Missing records do not mean this exercise is unseen.";
    return { seen: [], attempts: [], pending: null };
  }
}

export function saveProgress(progress: SolveProgress): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(cleanProgress(progress)));
    writeIssue = null;
    return true;
  } catch {
    writeIssue = "Local solve history could not be saved. Keep the current job ID before leaving this page.";
    return false;
  }
}

export function recordExposure(progress: SolveProgress, exerciseId: string, version: number): { progress: SolveProgress; previouslySeen: boolean } {
  const clean = cleanProgress(progress);
  const key = `${exerciseId}@${version}`;
  const previouslySeen = clean.seen.includes(key);
  if (!previouslySeen && exposurePattern.test(key) && Number.isSafeInteger(version) && version > 0) clean.seen.push(key);
  return { progress: clean, previouslySeen };
}

export function completeAttempt(progress: SolveProgress, attempt: AttemptRecord): SolveProgress {
  const completed = cleanAttempt(attempt);
  const clean = cleanProgress(progress);
  if (!completed) return clean;
  return cleanProgress({
    seen: clean.seen,
    attempts: [completed, ...clean.attempts],
    pending: clean.pending?.id === completed.id ? null : clean.pending,
  });
}
