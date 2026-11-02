import assert from "node:assert/strict";
import test from "node:test";
import { generateSnippet } from "./generator";
import { prepare } from "./engine";
import type { Language, Length } from "./types";

// Python and Java have different transcription lengths for the same recipe.
// Selecting by a nominal recipe label previously threw for valid selections.
for (const language of ["python", "java"] satisfies Language[]) {
  for (const length of ["short", "standard", "long"] satisfies Length[]) {
    test(`${language} generation honors the requested ${length} workload across seeds`, () => {
      for (let seed = 0; seed < 32; seed++) {
        const snippet = generateSnippet(language, length, seed);
        const count = prepare(snippet.code).units.length;
        assert.equal(snippet.language, language);
        assert.ok(
          length === "short" ? count > 0 && count <= 350 : length === "standard" ? count > 350 && count <= 900 : count > 900,
          `seed ${seed}: ${snippet.id} produced ${count} scored characters`,
        );
      }
    });
  }
}
