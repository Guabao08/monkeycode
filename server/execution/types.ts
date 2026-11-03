import type { Language } from "../../src/types";
import type { ExampleFeedback, SubmissionFeedback } from "../../src/learning/types";

export interface Submission {
  exerciseId: "first-at-least";
  exerciseVersion: 1;
  language: Language;
  action: "run" | "submit";
  code: string;
}

export interface ExecutionResult {
  status: "passed" | "wrong-answer" | "compile-error" | "runtime-error" | "resource-limit" | "service-error";
  feedback?: ExampleFeedback<number> | SubmissionFeedback;
  message?: string;
  implementationComplexityVerified: false;
}

export interface Executor {
  execute(submission: Submission): Promise<ExecutionResult>;
}

/** Reserve pessimistically: one public bundle plus eight private category runs. */
export function executionCost(action: Submission["action"]): number {
  return action === "run" ? 1 : 9;
}
