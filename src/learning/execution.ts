import type { Language } from "../types.ts";
import type { ExampleFeedback, SubmissionFeedback } from "./types.ts";

/** Public wire contracts; no provider credentials, fixtures or server runtime. */
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

export interface JobView {
  id: string;
  status: "queued" | "running" | "completed";
  createdAt: string;
  result?: ExecutionResult;
}
