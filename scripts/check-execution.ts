import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram, publicBundle, privateBundles } from "../server/execution/harness";
import { references, linearAlternatives, strictGreaterMistakes } from "../server/learning/first-at-least";

// Maintainer-only: the exact hosted wrapper, but ONLY repository-authored code.
// No learner input, source path argument, HTTP endpoint or sandbox claim.
const directory = await mkdtemp(join(tmpdir(), "monkeycode-hosted-harness-"));
function command(executable: string, args: string[], input?: string): string {
  const result = spawnSync(executable, args, { cwd: directory, input, encoding: "utf8", timeout: 20000, maxBuffer: 256 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${executable}: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
try {
  for (const [name, implementations] of Object.entries({ reference: references, linear: linearAlternatives, mistake: strictGreaterMistakes })) {
    for (const language of ["python", "java"] as const) {
      const program = buildProgram(language, implementations[language]);
      await writeFile(join(directory, language === "python" ? "solution.py" : "Main.java"), program);
      if (language === "java") command("javac", ["Main.java"]);
      const results = [publicBundle, ...privateBundles].map(bundle => ({
        category: "category" in bundle ? bundle.category : "public examples",
        actual: JSON.parse(language === "python" ? command("python3", ["-I", "solution.py"], bundle.input) : command("java", ["-Xmx256m", "-cp", directory, "Main"], bundle.input)),
        expected: JSON.parse(bundle.expected_output),
      }));
      if (name === "mistake") {
        const duplicates = results.find(item => item.category === "duplicate handling");
        assert.ok(duplicates);
        assert.notDeepEqual(duplicates.actual, duplicates.expected);
      } else {
        for (const item of results) assert.deepEqual(item.actual, item.expected, `${language} ${name}: ${item.category}`);
        const large = results.find(item => item.category === "large input boundary");
        assert.deepEqual(large?.actual, [99999], "the maximum-length fixture must still execute in full");
      }
      console.log(`${language} ${name}: ${name === "mistake" ? "duplicate-boundary mistake detected" : "public examples and all private categories passed, including 100000-element input"}`);
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
