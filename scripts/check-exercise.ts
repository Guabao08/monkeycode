import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstAtLeast } from "../src/learning/first-at-least";
import { gradeExamples, gradeSubmission, linearAlternatives, privateCases, references, strictGreaterMistakes } from "../server/learning/first-at-least";

// Runs only the repository-authored implementations below. NOT a sandbox or an
// endpoint for learner code. Never expose this script through the web server.
const directory = await mkdtemp(join(tmpdir(), "monkeycode-exercise-"));
const cases = [...firstAtLeast.examples, ...privateCases];
// Independent linear oracle over a small exhaustive input space, including duplicates.
function enumerate(prefix: number[], remaining: number): void {
  for (let target = -3; target <= 3; target++) {
    const index = prefix.findIndex(value => value >= target);
    cases.push({ input: { values: [...prefix], target }, expected: index < 0 ? prefix.length : index, category: "exhaustive small arrays" });
  }
  if (!remaining) return;
  for (let value = prefix.at(-1) ?? -2; value <= 2; value++) enumerate([...prefix, value], remaining - 1);
}
enumerate([], 5);

function command(executable: string, args: string[], input?: string): string {
  const result = spawnSync(executable, args, { cwd: directory, input, encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} failed: ${result.error?.message ?? result.stderr ?? result.signal}`);
  }
  return result.stdout;
}

try {
  console.log(command("python3", ["--version"]).trim());
  console.log(command("javac", ["-version"]).trim());
  for (const [name, implementations] of Object.entries({ reference: references, "linear alternative": linearAlternatives, "strict-greater mistake": strictGreaterMistakes })) {
    for (const language of ["python", "java"] as const) {
      let output: string;
      if (language === "python") {
        const source = `${implementations.python}\nimport sys, json\nfor line in sys.stdin:\n    item = json.loads(line)\n    answer = first_at_least(item["values"], item["target"])\n    print(json.dumps(answer))\n`;
        await writeFile(join(directory, "solution.py"), source);
        output = command("python3", ["-I", "solution.py"], cases.map(item => JSON.stringify(item.input)).join("\n") + "\n");
      } else {
        const source = `import java.io.*;
import java.util.*;
class Solution {
${implementations.java}
}
public class Main {
  public static void main(String[] args) throws Exception {
    BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
    String line;
    while ((line = reader.readLine()) != null) {
      StringTokenizer tokens = new StringTokenizer(line);
      int target = Integer.parseInt(tokens.nextToken());
      int length = Integer.parseInt(tokens.nextToken());
      int[] values = new int[length];
      for (int i = 0; i < length; i++) values[i] = Integer.parseInt(tokens.nextToken());
      System.out.println(new Solution().firstAtLeast(values, target));
    }
  }
}
`;
        await writeFile(join(directory, "Main.java"), source);
        command("javac", ["Main.java"]);
        output = command("java", ["-Xmx128m", "-cp", directory, "Main"], cases.map(({ input }) => [input.target, input.values.length, ...input.values].join(" ")).join("\n") + "\n");
      }
      const actual: unknown[] = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.equal(actual.length, cases.length, `${language}: harness result count`);
      const submission = gradeSubmission(actual.slice(firstAtLeast.examples.length, firstAtLeast.examples.length + privateCases.length));
      if (name === "strict-greater mistake") {
        assert.equal(submission.status, "wrong-answer");
        assert.ok(submission.failureCategories.includes("duplicate handling"));
      } else {
        assert.equal(gradeExamples(actual.slice(0, firstAtLeast.examples.length)).status, "passed");
        assert.equal(submission.status, "passed");
        for (const [i, item] of cases.entries()) assert.equal(actual[i], item.expected, `${language}: ${name}, case ${i}`);
      }
      console.log(`${language} / ${name}: ${name === "strict-greater mistake" ? "correctly rejected" : `${cases.length} cases passed`}`);
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
