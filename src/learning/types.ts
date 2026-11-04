import type { Language } from "../types.ts";

export type Concept = "hash-maps" | "two-pointers" | "sliding-window" | "binary-search";
export type Activity = "practice" | "independent-check";

export interface Example<Input, Output> {
  input: Input;
  expected: Output;
  explanation: string;
}

/** Safe prompt content. Private fixtures, hints and solutions belong outside src/. */
export interface Exercise<Input, Output> {
  id: string;
  version: number;
  title: string;
  statement: string;
  constraints: readonly string[];
  examples: readonly Example<Input, Output>[];
  implementations: Record<Language, {
    signature: string;
    instructions: string;
  }>;
  requirements: {
    time: string;
    auxiliarySpace: string;
  };
  provenance: { kind: "original"; author: string };
}

export type Assistance = "hint" | "counterexample" | "solution";

/** Exposure identity is exercise-wide, not language-specific. No unlocks or waits. */
export interface AttemptConditions {
  exerciseId: string;
  exerciseVersion: number;
  language: Language;
  activity: Activity;
  previouslySeen: boolean;
  assistance: readonly Assistance[];
  approachNotes?: string;
}

export interface ReasoningQuestion {
  id: string;
  prompt: string;
  choices: readonly { id: string; text: string }[];
}

export type ExecutionFailure =
  | { status: "compile-error" | "runtime-error" | "resource-limit"; message: string }
  | { status: "service-error"; message: string };

export interface ApproachEvidence {
  reasoning: "not-checked" | "supported" | "needs-review";
  /** Neither execution nor a multiple-choice answer proves code complexity. */
  implementationComplexityVerified: false;
}

export type ExampleFeedback<Output> = {
  status: "passed" | "wrong-answer";
  cases: readonly {
    index: number;
    expected: Output;
    actual: unknown;
    passed: boolean;
  }[];
};

export type SubmissionFeedback = {
  status: "passed" | "wrong-answer";
  /** Submit intentionally excludes private inputs, expected outputs and case IDs. */
  failureCategories: readonly string[];
};
