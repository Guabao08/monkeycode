import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  completeAttempt, loadProgress, progressStorageIssue, recordExposure, saveProgress,
  type AttemptRecord, type SolveProgress,
} from "./learning/progress";
import type { AttemptConditions } from "./learning/types";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  denyReads = false;
  denyWrites = false;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) {
    if (this.denyReads) throw new DOMException("Storage is denied", "SecurityError");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.denyWrites) throw new DOMException("Storage is full", "QuotaExceededError");
    this.values.set(key, String(value));
  }
  removeItem(key: string) { this.values.delete(key); }
}

function installStorage(t: TestContext): MemoryStorage {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  loadProgress();
  saveProgress({ seen: [], attempts: [], pending: null });
  storage.clear();
  return storage;
}

const conditions: AttemptConditions = {
  exerciseId: "first-at-least", exerciseVersion: 1, language: "python", activity: "practice",
  previouslySeen: false, assistance: [],
};
const idFor = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
function attempt(number: number, completedAt = number): AttemptRecord {
  return { id: idFor(number), completedAt, action: "submit", status: "passed", conditions };
}

test("exposure is exercise-and-version-wide across languages without mutating input", t => {
  installStorage(t);
  const original: SolveProgress = { seen: [], attempts: [], pending: null };
  const python = recordExposure(original, "first-at-least", 1);
  assert.equal(python.previouslySeen, false);
  assert.equal(original.seen.length, 0);
  const javaProgress = completeAttempt(python.progress, { ...attempt(1), conditions: { ...conditions, language: "java" } });
  assert.equal(recordExposure(javaProgress, "first-at-least", 1).previouslySeen, true);
  assert.equal(recordExposure(javaProgress, "first-at-least", 2).previouslySeen, false);
  const twice = recordExposure(python.progress, "first-at-least", 1).progress;
  assert.equal(twice.seen.length, 1);
  assert.equal(saveProgress(twice), true);
  assert.equal(recordExposure(loadProgress(), "first-at-least", 1).previouslySeen, true);
});

test("history retains only the newest 100 unique jobs, including after reload", t => {
  installStorage(t);
  let progress: SolveProgress = { seen: [], attempts: [], pending: null };
  for (let number = 0; number < 130; number++) progress = completeAttempt(progress, attempt(number));
  progress = completeAttempt(progress, { ...attempt(129, 500), status: "wrong-answer" });
  progress = completeAttempt(progress, { ...attempt(129, 1), status: "runtime-error" });
  assert.equal(progress.attempts.length, 100);
  assert.equal(new Set(progress.attempts.map(item => item.id)).size, 100);
  assert.equal(progress.attempts[0].id, idFor(129));
  assert.equal(progress.attempts[0].status, "wrong-answer");
  assert.equal(progress.attempts.at(-1)?.id, idFor(30));
  assert.equal(saveProgress(progress), true);
  const restored = loadProgress();
  assert.equal(restored.attempts.length, 100);
  assert.equal(restored.attempts[0].completedAt, 500);
});

test("completing an older job does not clear a newer pending job", t => {
  installStorage(t);
  const pending = { id: idFor(2), createdAt: "2026-11-03T10:00:00.000Z", action: "run" as const, conditions };
  const progress: SolveProgress = { seen: [], attempts: [], pending };
  const unrelated = completeAttempt(progress, attempt(1));
  assert.equal(unrelated.pending?.id, idFor(2));
  assert.equal(saveProgress(unrelated), true);
  assert.equal(loadProgress().pending?.id, idFor(2));
  const matching = completeAttempt(unrelated, attempt(2));
  assert.equal(matching.pending, null);
  assert.equal(progress.pending?.id, idFor(2));
});

test("write whitelist excludes source, invite, diagnostics and approach notes at every level", t => {
  const storage = installStorage(t);
  const unsafeConditions = { ...conditions, approachNotes: "secret-approach", source: "secret-nested-source", token: "secret-nested-invite" };
  const unsafeAttempt = { ...attempt(1), conditions: unsafeConditions, message: "secret-diagnostic", code: "secret-attempt-source" };
  const unsafePending = {
    id: idFor(2), createdAt: "2026-11-03T10:00:00.000Z", action: "run" as const, conditions: unsafeConditions,
    code: "secret-pending-source", token: "secret-pending-invite", result: { message: "secret-result" },
  };
  const unsafeProgress = {
    seen: ["first-at-least@1", "secret-source-not-exposure"], attempts: [unsafeAttempt], pending: unsafePending,
    source: "secret-root-source", token: "secret-root-invite", message: "secret-root-message",
  };
  assert.equal(saveProgress(unsafeProgress), true);
  assert.equal(storage.length, 1);
  const serialized = storage.getItem(storage.key(0)!)!;
  assert.doesNotMatch(serialized, /secret-|approachNotes|"code"|"source"|"message"|"token"|"result"/);
  const restored = loadProgress();
  assert.equal(restored.attempts.length, 1);
  assert.equal(restored.pending?.id, idFor(2));
  assert.equal(restored.attempts[0].conditions.approachNotes, undefined);
});

test("read whitelist strips injected fields and deduplicates unsorted records", t => {
  const storage = installStorage(t);
  saveProgress({ seen: [], attempts: [], pending: null });
  const key = storage.key(0)!;
  storage.setItem(key, JSON.stringify({
    seen: ["first-at-least@1", "first-at-least@1"],
    attempts: [
      { ...attempt(1, 1), conditions: { ...conditions, approachNotes: "secret-old-notes" }, code: "secret-source" },
      { ...attempt(2, 10), message: "secret-diagnostic" },
      { ...attempt(1, 20), status: "wrong-answer", token: "secret-invite" },
    ],
    pending: { id: idFor(3), createdAt: "2026-11-03T10:00:00.000Z", action: "submit", conditions: { ...conditions, approachNotes: "secret-pending-notes" }, source: "secret-pending-source" },
    diagnostic: "secret-root",
  }));
  const loaded = loadProgress();
  assert.equal(loaded.attempts.length, 2);
  assert.equal(loaded.attempts[0].id, idFor(1));
  assert.equal(loaded.attempts[0].completedAt, 20);
  assert.equal(loaded.seen.length, 1);
  assert.doesNotMatch(JSON.stringify(loaded), /secret-|approachNotes|"code"|"source"|"message"|"token"/);
  saveProgress(loaded);
  assert.doesNotMatch(storage.getItem(key)!, /secret-/);
});

test("corrupt or partially invalid history recovers safely with an explicit uncertainty notice", t => {
  const storage = installStorage(t);
  saveProgress({ seen: [], attempts: [], pending: null });
  const key = storage.key(0)!;
  for (const corrupt of ["not-json", "null", "{}", JSON.stringify({ seen: [], attempts: [{ ...attempt(1), status: "made-up" }], pending: { id: "not-a-job" } })]) {
    storage.setItem(key, corrupt);
    const progress = loadProgress();
    assert.equal(progress.attempts.length, 0);
    assert.equal(progress.pending, null);
    assert.match(progressStorageIssue()!, /Missing records do not mean this exercise is unseen/);
  }
  storage.clear();
  assert.equal(loadProgress().attempts.length, 0);
  assert.equal(progressStorageIssue(), null);
});

test("denied reads and failed writes never throw or leak secrets into notices", t => {
  const storage = installStorage(t);
  storage.denyReads = true;
  assert.doesNotThrow(() => loadProgress());
  assert.match(progressStorageIssue()!, /unavailable/);
  storage.denyReads = false;
  loadProgress();
  storage.denyWrites = true;
  assert.equal(saveProgress({ seen: [], attempts: [], pending: null }), false);
  assert.match(progressStorageIssue()!, /could not be saved/);
  storage.denyWrites = false;
  assert.equal(saveProgress({ seen: [], attempts: [], pending: null }), true);
  assert.equal(progressStorageIssue(), null);
});
