import type { Exercise } from "./types";

export interface FirstAtLeastInput {
  values: readonly number[];
  target: number;
}

export const firstAtLeast: Exercise<FirstAtLeastInput, number> = {
  id: "first-at-least",
  version: 1,
  title: "Find the first qualifying value",
  statement: "Given integers sorted in nondecreasing order and a target, return the first zero-based index whose value is at least the target. Return the array length if no value qualifies.",
  constraints: [
    "0 <= values.length <= 100000",
    "Values and target are signed 32-bit integers.",
    "Values are sorted in nondecreasing order; duplicates are allowed.",
    "Input is guaranteed to satisfy the contract; do not sort it or add input parsing.",
  ],
  examples: [
    { input: { values: [2, 4, 4, 9], target: 4 }, expected: 1, explanation: "Both 4s qualify, but index 1 is the first." },
    { input: { values: [2, 4, 9], target: 5 }, expected: 2, explanation: "The value 9 is the first value at least 5." },
    { input: { values: [], target: 5 }, expected: 0, explanation: "An empty array has no qualifying value; its length is 0." },
  ],
  implementations: {
    python: {
      signature: "def first_at_least(values: list[int], target: int) -> int:",
      instructions: "Write this function at module level. You may define helpers and import Python standard-library modules. The harness supplies the arguments and reads the return value; do not read stdin or print an answer.",
    },
    java: {
      signature: "public int firstAtLeast(int[] values, int target)",
      instructions: "Write this instance method, plus any helpers, as members of the supplied Solution class. No package, import, class wrapper, main method or input parsing is needed. Fully qualified standard-library names are allowed.",
    },
  },
  requirements: { time: "O(log(n + 1))", auxiliarySpace: "O(1)" },
  provenance: { kind: "original", author: "Monkeycode" },
};
