import { firstAtLeast, type FirstAtLeastInput } from "../../src/learning/first-at-least.ts";
import type { ApproachEvidence, ExampleFeedback, ReasoningQuestion, SubmissionFeedback } from "../../src/learning/types.ts";

/** Maintainer/server material. Never import this module into the browser entry. */
export const teaching = {
  concept: "binary-search",
  prerequisites: ["array indexing", "loops", "integer comparisons"],
  hints: [
    "Ask whether an index qualifies: is its value at least the target? What does sorted order imply about later indices?",
    "Keep a half-open candidate interval [low, high), initially [0, length). A qualifying midpoint might be the first answer, so keep it as the upper boundary.",
    "While low < high, choose mid = low + (high - low) // 2. If values[mid] < target, set low = mid + 1; otherwise set high = mid. Return low.",
  ],
  explanation: "Maintain the answer in the inclusive boundary range [low, high]. All indices below low fail; all array indices at or above high qualify. Inspecting the midpoint excludes roughly half the remaining candidates. On termination low == high, giving the first qualifying index or length. Computing the midpoint from the difference avoids signed-integer overflow in Java.",
} as const;

export const reasoningQuestions: readonly ReasoningQuestion[] = [
  {
    id: "discard",
    prompt: "If values[mid] is less than target, why can indices through mid be discarded?",
    choices: [
      { id: "sorted-prefix", text: "Sorted order makes every value at or before mid too small." },
      { id: "distinct", text: "Every value is distinct, so the answer must be elsewhere." },
      { id: "equal", text: "The target must appear exactly in the array." },
    ],
  },
  {
    id: "cost",
    prompt: "What gives the intended implementation logarithmic time and constant auxiliary space?",
    choices: [
      { id: "loop", text: "Any single loop has logarithmic time and constant space." },
      { id: "halving", text: "Each iteration roughly halves the candidate interval, using a fixed number of indices without slicing." },
      { id: "sorted", text: "Sorted input makes every search algorithm logarithmic." },
    ],
  },
];

export function gradeReasoning(answers: Readonly<Record<string, string>>): ApproachEvidence {
  const ids = reasoningQuestions.map(question => question.id);
  const complete = ids.every(id => Object.hasOwn(answers, id));
  return {
    reasoning: !complete ? "not-checked" : answers.discard === "sorted-prefix" && answers.cost === "halving" ? "supported" : "needs-review",
    implementationComplexityVerified: false,
  };
}

export interface PrivateCase {
  input: FirstAtLeastInput;
  expected: number;
  category: string;
}

export const privateCases: readonly PrivateCase[] = [
  { input: { values: [], target: 0 }, expected: 0, category: "empty input" },
  { input: { values: [7], target: 6 }, expected: 0, category: "single-element boundaries" },
  { input: { values: [7], target: 7 }, expected: 0, category: "single-element boundaries" },
  { input: { values: [7], target: 8 }, expected: 1, category: "upper boundary" },
  { input: { values: [2, 4, 4, 4, 9], target: 4 }, expected: 1, category: "duplicate handling" },
  { input: { values: [3, 3, 3], target: 3 }, expected: 0, category: "duplicate handling" },
  { input: { values: [-9, -4, -4, 0, 8], target: -5 }, expected: 1, category: "insertion between values" },
  { input: { values: [-9, -4, 0, 8], target: -10 }, expected: 0, category: "lower boundary" },
  { input: { values: [-9, -4, 0, 8], target: 9 }, expected: 4, category: "upper boundary" },
  { input: { values: [1, 3, 5, 7], target: 6 }, expected: 3, category: "insertion between values" },
  { input: { values: [-2147483648, 0, 2147483647], target: -2147483648 }, expected: 0, category: "integer extremes" },
  { input: { values: [-2147483648, 0, 2147483647], target: 2147483647 }, expected: 2, category: "integer extremes" },
  { input: { values: Array.from({ length: 100000 }, (_, i) => i - 50000), target: 49999 }, expected: 99999, category: "large input boundary" },
];

function equalOutput(actual: unknown, expected: number): boolean {
  return typeof actual === "number" && Number.isInteger(actual) && actual === expected;
}

/** Missing/extra results indicate a harness/protocol failure, not a wrong answer. */
function requireCaseCount(actual: readonly unknown[], expected: number): void {
  if (actual.length !== expected) throw new Error(`Invalid execution result: expected ${expected} outputs, received ${actual.length}`);
}

export function gradeExamples(actual: readonly unknown[]): ExampleFeedback<number> {
  requireCaseCount(actual, firstAtLeast.examples.length);
  const cases = firstAtLeast.examples.map((example, index) => ({ index, expected: example.expected, actual: actual[index], passed: equalOutput(actual[index], example.expected) }));
  return { status: cases.every(result => result.passed) ? "passed" : "wrong-answer", cases };
}

export function gradeSubmission(actual: readonly unknown[]): SubmissionFeedback {
  requireCaseCount(actual, privateCases.length);
  const failureCategories = [...new Set(privateCases.filter((item, i) => !equalOutput(actual[i], item.expected)).map(item => item.category))];
  return { status: failureCategories.length ? "wrong-answer" : "passed", failureCategories };
}

/** Calling this operation reveals private material; record assistance before delivery. */
export function firstCounterexample(actual: readonly unknown[]): PrivateCase | undefined {
  requireCaseCount(actual, privateCases.length);
  return privateCases.find((item, i) => !equalOutput(actual[i], item.expected));
}

export const references = {
  python: `def first_at_least(values: list[int], target: int) -> int:
    low, high = 0, len(values)
    while low < high:
        mid = low + (high - low) // 2
        if values[mid] < target:
            low = mid + 1
        else:
            high = mid
    return low
`,
  java: `public int firstAtLeast(int[] values, int target) {
    int low = 0, high = values.length;
    while (low < high) {
        int mid = low + (high - low) / 2;
        if (values[mid] < target) low = mid + 1;
        else high = mid;
    }
    return low;
}`,
};

/** Correct but linear: must pass functional grading without proving efficiency. */
export const linearAlternatives = {
  python: `def first_at_least(values: list[int], target: int) -> int:
    for i, value in enumerate(values):
        if value >= target:
            return i
    return len(values)
`,
  java: `public int firstAtLeast(int[] values, int target) {
    for (int i = 0; i < values.length; i++) {
        if (values[i] >= target) return i;
    }
    return values.length;
}`,
};

/** Plausible upper-bound mistake: skips values equal to target. */
export const strictGreaterMistakes = {
  python: references.python.replace("values[mid] < target", "values[mid] <= target"),
  java: references.java.replace("values[mid] < target", "values[mid] <= target"),
};
