export interface Prepared {
  /** Normalized display text, including indentation that is not typed. */
  text: string;
  /** Scored graphemes. Leading spaces and tabs on every line are display-only. */
  units: string[];
  /** UTF-16 offsets of scored graphemes in text, suitable for DOM slicing. */
  offsets: number[];
  /** First scored grapheme of the terminal lexical unit. */
  finalStart: number;
}

export interface Session {
  prepared: Prepared;
  input: string[];
  attempts: number;
  right: number;
  startedAt: number | null;
  finishedAt: number | null;
  complete: boolean;
}

export interface Metrics {
  cpm: number;
  wpm: number;
  accuracy: number;
  /** Seconds, with completed sessions frozen at their completion time. */
  elapsed: number;
  correct: number;
  errors: number;
  attempts: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordUnit = /[\p{L}\p{N}\p{M}_$]/u;
const whitespace = /^\s+$/u;

/**
 * Completion requires the final lexical unit, not the whole final line, to match.
 * A terminal identifier/number is one unit; a closed quoted literal includes its
 * opening quote and contents (including escaped quotes and Python triple quotes).
 * Otherwise the terminal punctuation run is one unit, so `};` must both match.
 * Trailing whitespace belongs to that terminal unit as well. This intentionally
 * is a lexical rule, not a Python/Java parser; unmatched quotes are punctuation.
 */
function terminalStart(units: string[]): number {
  let end = units.length - 1;
  while (end >= 0 && whitespace.test(units[end])) end--;
  if (end < 0) return 0;

  // Keep closed literals as tokens, so a trailing quote cannot by itself finish
  // a misspelled string. Quoted punctuation never joins a punctuation run.
  const literalEnds = new Map<number, number>();
  for (let i = 0; i <= end; i++) {
    const quote = units[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    const triple = units[i + 1] === quote && units[i + 2] === quote;
    const width = triple ? 3 : 1;
    let closing = -1;
    for (let j = i + width; j <= end; j++) {
      if (units[j] === "\\") {
        j++;
        continue;
      }
      if (units[j] !== quote) continue;
      if (triple && (units[j + 1] !== quote || units[j + 2] !== quote))
        continue;
      closing = j + width - 1;
      break;
    }
    if (closing >= 0) {
      literalEnds.set(closing, i);
      i = closing;
    }
  }

  const literal = literalEnds.get(end);
  if (literal !== undefined) return literal;
  const prefix = units.slice(0, end + 1).join("");
  const number =
    /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?)[jJfFdDlL]?$/.exec(
      prefix,
    );
  if (
    number &&
    (number.index === 0 ||
      !/[\p{L}\p{N}\p{M}_$.]/u.test(prefix[number.index - 1]))
  ) {
    let offset = prefix.length;
    let start = end + 1;
    while (start > 0 && offset > number.index) offset -= units[--start].length;
    return start;
  }
  if (wordUnit.test(units[end])) {
    let start = end;
    while (start > 0 && wordUnit.test(units[start - 1])) start--;
    return start;
  }

  let start = end;
  while (start > 0) {
    const previous = units[start - 1];
    if (
      whitespace.test(previous) ||
      wordUnit.test(previous) ||
      literalEnds.has(start - 1)
    )
      break;
    start--;
  }
  return start;
}

export function prepare(code: string): Prepared {
  const text = code.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const units: string[] = [];
  const offsets: number[] = [];
  const lines = text.split("\n");
  let lineOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = /^[ \t]*/.exec(line)![0].length;
    for (const part of segmenter.segment(line.slice(indent))) {
      units.push(part.segment);
      offsets.push(lineOffset + indent + part.index);
    }
    lineOffset += line.length;
    if (i < lines.length - 1) {
      units.push("\n");
      offsets.push(lineOffset);
      lineOffset++;
    }
  }
  return { text, units, offsets, finalStart: terminalStart(units) };
}

export function newSession(code: string): Session {
  const prepared = prepare(code);
  return {
    prepared,
    input: [],
    attempts: 0,
    right: 0,
    startedAt: null,
    finishedAt: null,
    complete: prepared.units.length === 0,
  };
}

/** Positional errors advance normally; only the final lexical unit gates finish. */
export function insert(session: Session, text: string, now: number): Session {
  if (
    session.complete ||
    text.length === 0 ||
    session.input.length >= session.prepared.units.length
  )
    return session;
  const input = session.input.slice();
  let attempts = session.attempts;
  let right = session.right;
  for (const part of segmenter.segment(text.replace(/\r\n?/g, "\n"))) {
    if (input.length === session.prepared.units.length) break;
    if (part.segment === session.prepared.units[input.length]) right++;
    input.push(part.segment);
    attempts++;
  }
  if (input.length === session.input.length) return session;
  let complete = input.length === session.prepared.units.length;
  if (complete) {
    for (let i = session.prepared.finalStart; i < input.length; i++) {
      if (input[i] !== session.prepared.units[i]) {
        complete = false;
        break;
      }
    }
  }
  return {
    ...session,
    input,
    attempts,
    right,
    startedAt: session.startedAt ?? now,
    finishedAt: complete ? now : null,
    complete,
  };
}

/** Backspace removes one scored grapheme, including a newline, never indentation. */
export function backspace(session: Session): Session {
  if (session.complete || session.input.length === 0) return session;
  return {
    ...session,
    input: session.input.slice(0, -1),
    finishedAt: null,
    complete: false,
  };
}

export function metrics(session: Session, now: number): Metrics {
  let correct = 0;
  for (let i = 0; i < session.input.length; i++) {
    if (session.input[i] === session.prepared.units[i]) correct++;
  }
  const elapsed =
    session.startedAt === null
      ? 0
      : Math.max(0, ((session.finishedAt ?? now) - session.startedAt) / 1000);
  const cpm = elapsed > 0 ? (correct * 60) / elapsed : 0;
  return {
    cpm,
    wpm: cpm / 5,
    accuracy:
      session.attempts > 0 ? (session.right / session.attempts) * 100 : 100,
    elapsed,
    correct,
    errors: session.input.length - correct,
    attempts: session.attempts,
  };
}
