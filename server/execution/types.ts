import type { Submission, ExecutionResult } from "../../src/learning/execution.ts";

export interface Executor {
  execute(submission: Submission, signal?: AbortSignal): Promise<ExecutionResult>;
}

/** Reserve pessimistically: one public bundle plus eight private category runs. */
export function executionCost(action: Submission["action"]): number {
  return action === "run" ? 1 : 9;
}
