import test from "node:test";
import assert from "node:assert/strict";
import { backspace, insert, metrics, newSession, prepare } from "./engine.ts";

test("prepare normalizes line endings and preserves display-only indentation offsets", () => {
  const prepared = prepare(" \talpha\r\n    beta\r\n");
  assert.equal(prepared.text, " \talpha\n    beta");
  assert.equal(prepared.units.join(""), "alpha\nbeta");
  assert.deepEqual(prepared.offsets, [2, 3, 4, 5, 6, 7, 12, 13, 14, 15]);
  assert.equal(prepared.finalStart, 6);
});

test("prepare removes exactly one EOF newline, not internal or additional newlines", () => {
  assert.equal(prepare("a\n\n").text, "a\n");
  assert.deepEqual(prepare("a\n\n").units, ["a", "\n"]);
  assert.equal(prepare("a\rb\r").text, "a\nb");
  assert.equal(prepare("a  \n").units.join(""), "a  ");
});

test("blank-line indentation is display-only but its newline is scored", () => {
  const prepared = prepare(" \t\n    x");
  assert.deepEqual(prepared.units, ["\n", "x"]);
  assert.deepEqual(prepared.offsets, [2, 7]);
});

test("graphemes are indivisible and offsets index UTF-16 display text", () => {
  const prepared = prepare(" \te\u0301 👩‍💻\n");
  assert.deepEqual(prepared.units, ["e\u0301", " ", "👩‍💻"]);
  assert.deepEqual(prepared.offsets, [2, 4, 5]);
  for (let i = 0; i < prepared.units.length; i++) {
    assert.equal(
      prepared.text.slice(
        prepared.offsets[i],
        prepared.offsets[i] + prepared.units[i].length,
      ),
      prepared.units[i],
    );
  }
});

test("terminal lexical rule selects words, numbers, quoted literals, and punctuation runs", () => {
  const cases = [
    ["return value", "value"],
    ["return variable_name2", "variable_name2"],
    ["return café", "café"],
    ["return 12.50e-2", "12.50e-2"],
    ["return 0xFF", "0xFF"],
    ["return 12.", "12."],
    ['return "hello"', '"hello"'],
    ["return 'hello'", "'hello'"],
    ['return "a\\"b"', '"a\\"b"'],
    ['return """a\nb"""', '"""a\nb"""'],
    ['return ""', '""'],
    ['print("hi");', ");"],
    ["class Result {};", "{};"],
    ["return value  ", "value  "],
    ["return value\n\n", "value\n"],
  ];
  for (const [code, terminal] of cases) {
    const prepared = prepare(code);
    assert.equal(
      prepared.units.slice(prepared.finalStart).join(""),
      terminal,
      code,
    );
  }
});

test("new sessions have no attempts or clock until actual input", () => {
  const session = newSession("abc");
  assert.deepEqual(session.input, []);
  assert.equal(session.attempts, 0);
  assert.equal(session.right, 0);
  assert.equal(session.startedAt, null);
  assert.equal(session.finishedAt, null);
  assert.equal(session.complete, false);
  assert.equal(insert(session, "", 100), session);
  assert.equal(backspace(session), session);
  assert.deepEqual(metrics(session, 100), {
    cpm: 0,
    wpm: 0,
    accuracy: 100,
    elapsed: 0,
    correct: 0,
    errors: 0,
    attempts: 0,
  });
});

test("empty and indentation-only targets are already complete", () => {
  for (const code of ["", "\n", " \t"]) {
    const session = newSession(code);
    assert.equal(session.complete, true);
    assert.equal(insert(session, "x", 100), session);
    assert.equal(backspace(session), session);
    assert.equal(metrics(session, 100).cpm, 0);
  }
});

test("a wrong final character blocks completion until corrected with Backspace", () => {
  let session = insert(newSession("run();"), "run():", 100);
  assert.equal(session.input.length, session.prepared.units.length);
  assert.equal(session.complete, false);
  assert.equal(session.finishedAt, null);
  session = insert(backspace(session), ";", 200);
  assert.equal(session.complete, true);
  assert.equal(session.finishedAt, 200);
  assert.equal(session.startedAt, 100);
  assert.equal(session.attempts, 7);
  assert.equal(session.right, 6);
});

test("correct final character does not hide a wrong earlier character in the final word", () => {
  let session = insert(newSession("return value"), "return xalue", 100);
  assert.equal(session.complete, false);
  for (let i = 0; i < 5; i++) session = backspace(session);
  session = insert(session, "value", 200);
  assert.equal(session.complete, true);
  assert.equal(session.input.join(""), "return value");
});

test("a partially typed final word cannot finish", () => {
  let session = insert(newSession("return value"), "return valu", 100);
  assert.equal(session.complete, false);
  session = insert(session, "e", 200);
  assert.equal(session.complete, true);
});

test("earlier positional errors advance freely and do not block the correct terminal word", () => {
  const session = insert(newSession("return value"), "xeturn value", 100);
  assert.equal(session.complete, true);
  assert.equal(session.input.join(""), "xeturn value");
  assert.equal(metrics(session, 500).errors, 1);
  assert.equal(metrics(session, 500).correct, 11);
});

test("the final line need not be correct outside its terminal lexical unit", () => {
  const session = insert(
    newSession("    answer = value"),
    "ansxer = value",
    100,
  );
  assert.equal(session.complete, true);
  assert.equal(metrics(session, 200).errors, 1);
});

test("the complete final quoted literal must match, not just its closing quote", () => {
  let session = insert(newSession('return "hello"'), 'return "hxllo"', 100);
  assert.equal(session.complete, false);
  for (let i = 0; i < 7; i++) session = backspace(session);
  session = insert(session, '"hello"', 200);
  assert.equal(session.complete, true);
});

test("a numeric terminal unit includes decimal and exponent characters", () => {
  const session = insert(newSession("return 12.50e-2"), "return 19.50e-2", 100);
  assert.equal(session.complete, false);
});

test("all characters in a final punctuation run must match", () => {
  const session = insert(newSession("class A {\n};"), "class A {\nx;", 100);
  assert.equal(session.complete, false);
  assert.equal(session.input.at(-1), ";");
});

test("typing newline skips display indentation and Backspace crosses line boundaries", () => {
  let session = insert(newSession("if ready:\n    work()"), "if ready:", 100);
  session = insert(session, "\n", 200);
  assert.equal(session.prepared.units[session.input.length], "w");
  session = insert(session, "w", 300);
  session = backspace(session);
  assert.equal(session.input.at(-1), "\n");
  session = backspace(session);
  assert.equal(session.input.join(""), "if ready:");
  session = insert(session, "\nwork()", 400);
  assert.equal(session.complete, true);
});

test("internal spaces and newlines are scored positional characters", () => {
  const session = insert(newSession("a b\nc"), "a_bxc", 100);
  assert.equal(session.complete, true);
  assert.equal(session.attempts, 5);
  assert.equal(session.right, 3);
  assert.equal(metrics(session, 200).errors, 2);
});

test("insert normalizes CRLF and never admits overflow beyond the target", () => {
  const session = insert(newSession("a\nb"), "a\r\nb ignored", 100);
  assert.deepEqual(session.input, ["a", "\n", "b"]);
  assert.equal(session.attempts, 3);
  assert.equal(session.complete, true);
});

test("overflow cannot escape a wrong final unit or inflate attempted character counts", () => {
  const session = insert(newSession("done"), "dXneEXTRA", 100);
  assert.equal(session.complete, false);
  assert.equal(session.input.join(""), "dXne");
  assert.equal(session.attempts, 4);
  assert.equal(insert(session, "done", 200), session);
});

test("Backspace removes a whole grapheme without refunding attempt history", () => {
  let session = insert(newSession("👩‍💻 done"), "👩‍💻", 100);
  assert.equal(session.input.length, 1);
  assert.equal(session.attempts, 1);
  session = backspace(session);
  assert.deepEqual(session.input, []);
  assert.equal(session.attempts, 1);
  assert.equal(session.right, 1);
  assert.equal(session.startedAt, 100);
});

test("correction removes current errors but preserves accuracy penalties", () => {
  let session = insert(newSession("abc"), "ax", 0);
  assert.equal(metrics(session, 500).errors, 1);
  session = backspace(session);
  session = insert(session, "b", 1000);
  assert.deepEqual(metrics(session, 2000), {
    cpm: 60,
    wpm: 12,
    accuracy: (2 / 3) * 100,
    elapsed: 2,
    correct: 2,
    errors: 0,
    attempts: 3,
  });
  session = insert(session, "c", 3000);
  assert.deepEqual(metrics(session, 9000), {
    cpm: 60,
    wpm: 12,
    accuracy: 75,
    elapsed: 3,
    correct: 3,
    errors: 0,
    attempts: 4,
  });
});

test("completed sessions freeze both clock and input for the recorded run", () => {
  let session = insert(newSession("ok"), "o", 1000);
  session = insert(session, "k", 2000);
  assert.equal(insert(session, "x", 3000), session);
  assert.equal(backspace(session), session);
  assert.deepEqual(metrics(session, 3000), metrics(session, 9000));
  assert.equal(metrics(session, 9000).elapsed, 1);
});

test("metrics are finite at zero elapsed and clamp clocks before the start", () => {
  const session = insert(newSession("abc"), "a", 1000);
  assert.equal(metrics(session, 1000).cpm, 0);
  assert.equal(metrics(session, 500).elapsed, 0);
  assert.equal(metrics(session, 500).wpm, 0);
});

test("state transitions never mutate an existing session or its prepared target", () => {
  const initial = newSession("abc");
  const prepared = initial.prepared;
  const typed = insert(initial, "ax", 100);
  const deleted = backspace(typed);
  assert.deepEqual(initial.input, []);
  assert.equal(initial.attempts, 0);
  assert.equal(initial.startedAt, null);
  assert.deepEqual(typed.input, ["a", "x"]);
  assert.deepEqual(deleted.input, ["a"]);
  assert.equal(typed.prepared, prepared);
  assert.equal(deleted.prepared, prepared);
});
