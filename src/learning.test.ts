import assert from "node:assert/strict";
import test from "node:test";
import { firstCounterexample, gradeExamples, gradeReasoning, gradeSubmission, privateCases } from "../server/learning/first-at-least";

test("submission rejects non-integer and coerced outputs instead of accepting truthy equality", () => {
  for (const invalid of [true, "0", null, undefined, 0.5, NaN, Infinity]) {
    const actual: unknown[] = privateCases.map(item => item.expected);
    actual[0] = invalid;
    assert.equal(gradeSubmission(actual).status, "wrong-answer", String(invalid));
  }
});

test("Run reveals example values while Submit reveals only failure categories", () => {
  const run = gradeExamples([2, 2, 0]);
  assert.deepEqual(run.cases[0], { index: 0, expected: 1, actual: 2, passed: false });
  const actual = privateCases.map(item => item.expected);
  actual[4] = 2;
  actual[5] = 2;
  assert.deepEqual(gradeSubmission(actual), { status: "wrong-answer", failureCategories: ["duplicate handling"] });
  assert.deepEqual(firstCounterexample(actual), privateCases[4]);
});

test("truncated and extra execution results cannot be mistaken for learner failures or success", () => {
  assert.throws(() => gradeSubmission([]), /Invalid execution result/);
  assert.throws(() => gradeSubmission([...privateCases.map(item => item.expected), 0]), /Invalid execution result/);
  assert.throws(() => gradeExamples([1, 2]), /Invalid execution result/);
});

test("correct reasoning supports an approach but never certifies implementation complexity", () => {
  assert.deepEqual(gradeReasoning({ discard: "sorted-prefix", cost: "halving" }), {
    reasoning: "supported", implementationComplexityVerified: false,
  });
  assert.equal(gradeReasoning({ discard: "sorted-prefix" }).reasoning, "not-checked");
  assert.equal(gradeReasoning({ discard: "distinct", cost: "halving" }).reasoning, "needs-review");
  assert.equal(gradeReasoning({ discard: "sorted-prefix", cost: "unknown" }).reasoning, "needs-review");
});
