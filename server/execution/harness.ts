import { Buffer } from "node:buffer";
import { firstAtLeast, type FirstAtLeastInput } from "../../src/learning/first-at-least.ts";
import type { Language } from "../../src/types.ts";
import { privateCases } from "../learning/first-at-least.ts";

export interface FixtureBundle {
  input: string;
  expected_output: string;
  category?: string;
}

interface Fixture {
  input: FirstAtLeastInput;
  expected: number;
}

export const NATIVE_BYTE_LIMIT = 100_000;

function requireNativeString(value: string): void {
  if (value.includes("\0") || Buffer.byteLength(value, "utf8") > NATIVE_BYTE_LIMIT) {
    throw new Error("Program or fixture exceeds the execution provider's input limits.");
  }
}

/** Whitespace protocol: case count, then target, encoding, length and payload.
 * Encoding 1 is a lossless arithmetic range (start, step); 0 lists the values.
 * Only maintainer fixtures enter this builder, never learner-supplied stdin.
 */
export function buildFixtureBundle(fixtures: readonly Fixture[], category?: string): FixtureBundle {
  const lines = fixtures.map(({ input: { values, target } }) => {
    if (values.length >= 3) {
      const step = values[1]! - values[0]!;
      if (values.every((value, index) => value === values[0]! + index * step)) {
        return `${target} 1 ${values.length} ${values[0]} ${step}`;
      }
    }
    return [target, 0, values.length, ...values].join(" ");
  });
  const input = `${fixtures.length}\n${lines.join("\n")}\n`;
  requireNativeString(input);
  return { input, expected_output: `${JSON.stringify(fixtures.map(item => item.expected))}\n`, ...(category === undefined ? {} : { category }) };
}

export const publicBundle: FixtureBundle = buildFixtureBundle(firstAtLeast.examples);

const grouped = new Map<string, Fixture[]>();
for (const fixture of privateCases) {
  const group = grouped.get(fixture.category);
  if (group) group.push(fixture);
  else grouped.set(fixture.category, [fixture]);
}

/** Eight native hidden tests cover all thirteen private cases, grouped by category. */
export const privateBundles: readonly (FixtureBundle & { category: string })[] = [...grouped].map(([category, fixtures]) => ({
  ...buildFixtureBundle(fixtures, category), category,
}));

/** Adapts the original method contract, not a sandbox or a security boundary. */
export function buildProgram(language: Language, code: string): string {
  let program: string;
  if (language === "python") {
    program = `${code}\n\ndef __monkeycode_run():
    import json
    import sys
    tokens = iter(sys.stdin.read().split())
    answers = []
    for _ in range(int(next(tokens))):
        target = int(next(tokens))
        encoding = int(next(tokens))
        length = int(next(tokens))
        if encoding == 1:
            start = int(next(tokens))
            step = int(next(tokens))
            values = [start + index * step for index in range(length)]
        else:
            values = [int(next(tokens)) for _ in range(length)]
        answer = first_at_least(values, target)
        # bool is an int subclass in Python, but is not an integer answer.
        answers.append(answer if type(answer) is int else None)
    print(json.dumps(answers, separators=(",", ":")))

__monkeycode_run()
`;
  } else if (language === "java") {
    // Main comes first for Java's single-file source launcher. Solution members
    // remain unmodified, including helpers using fully qualified library names.
    program = `public class Main {
  public static void main(String[] args) throws Exception {
    java.util.Scanner tokens = new java.util.Scanner(System.in);
    int count = tokens.nextInt();
    StringBuilder answers = new StringBuilder("[");
    for (int test = 0; test < count; test++) {
      int target = tokens.nextInt();
      int encoding = tokens.nextInt();
      int length = tokens.nextInt();
      int[] values = new int[length];
      if (encoding == 1) {
        long start = tokens.nextLong();
        long step = tokens.nextLong();
        for (int index = 0; index < length; index++) values[index] = (int) (start + index * step);
      } else {
        for (int index = 0; index < length; index++) values[index] = tokens.nextInt();
      }
      if (test > 0) answers.append(',');
      answers.append(new Solution().firstAtLeast(values, target));
    }
    System.out.println(answers.append(']'));
  }
}
class Solution {
${code}
}
`;
  } else {
    throw new Error("Unsupported execution language.");
  }
  requireNativeString(program);
  return program;
}
