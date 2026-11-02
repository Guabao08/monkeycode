# monkeycode

A desktop-first code-transcription practice app built with React, TypeScript and Vite. Practice Python or Java without accounts, a backend, or code execution.

## Run locally

Use **Node.js 22.12+** and npm:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Other commands:

```sh
npm test          # engine and content tests
npm run build    # TypeScript checks and production bundle in dist/
npm run preview  # serve the production bundle locally after building
```

Python 3 and a JDK are used only for maintainer-side sample validation and the exercise execution check below. Neither is an application runtime dependency; the browser never executes practice code. Method excerpts need a supplied harness, and compilation alone does not establish algorithm correctness.

## Practice exercise contracts

The first solving exercise is implemented as content and grading material, **not yet as an in-app mode or hosted execution service**. The current typing interface is unchanged. Practice remains the priority: the contract adds no prerequisite lessons, mandatory approach notes, unlocks, or enforced waiting periods.

- `src/learning/types.ts`: public exercise, attempt-condition, assistance, feedback, and execution-failure contracts. Functional correctness and approach evidence are separate; neither passing tests nor answering reasoning questions certifies implementation complexity.
- `src/learning/first-at-least.ts`: original sorted-array problem, explicit constraints, examples, Python/Java method signatures, and time/space requirements. Learners supply methods and helpers, not console parsing or a full program.
- `server/learning/first-at-least.ts`: private grading fixtures, reference implementations, hints, explanation, and authored reasoning checks. This is maintainer/server material, not a running backend; never import it into the browser entry. “Private” means withheld from normal learner feedback, not secret from someone reading this repository.

Run feedback includes expected and actual public-example results. Submit feedback contains only failure categories. A separate counterexample operation reveals the first failing private case; a future execution endpoint must record assistance before returning it. Missing/extra execution results are protocol failures, not wrong-answer grades. Attempt conditions share exposure identity across languages; storage and assistance-event enforcement are not implemented yet.

Validate the authored implementations locally with Python 3 and a JDK on PATH:

```sh
npm run check:exercise
```

This command compiles/runs both reference implementations and correct linear alternatives against 1,780 cases each, including exhaustive small sorted arrays, duplicates, empty arrays, integer extremes, and the maximum input length. It also verifies rejection of a plausible strict-greater-than boundary mistake in both languages. A linear solution passes functional grading without satisfying the stated logarithmic-time requirement. Local verification used Python 3.14.0 and javac 26.0.2.1; hosted runtime versions remain unselected.

The checker executes **only repository-authored code**, uses temporary files removed on exit, and has process/output bounds. It is **not a sandbox**: never expose it as an endpoint or use it to execute untrusted submissions. No learner code is uploaded, no provider is provisioned, and no application source-privacy behavior changes.

## Practice modes

- **Generated:** deterministic, seeded local generation from eight finite algorithm families: binary search, Euclidean reduction, sliding windows, interval merging, run-length scanning, frequency ranking, grid breadth-first search and dependency ordering. These are structured recipes, not an AI service, an unlimited corpus, or a general-purpose language model; repeated algorithm shapes are expected.
- **Solutions:** eight curated problems, each available in Python and Java as a method excerpt or full `Solution` class: **32 variants** total. Excerpts retain helper methods; full variants include required imports but no execution harness. The collection is deliberately small, not exhaustive LeetCode coverage. Difficulty labels are omitted because they have not been verified.
- **Your code:** paste a Python or Java target, optionally name it, and practice it locally. Targets must be nonempty, at most 30,000 characters, and contain no tabs after a line’s leading indentation. Paste is accepted in the import field, not as a practice shortcut.

Length filters count scored graphemes, not file bytes: **short ≤350**, **standard 351–900**, **long >900**, or any length. Automatic leading indentation is excluded.

## Typing and scoring

Click the code area and type the target. Leading spaces and tabs on every line are displayed automatically and are neither typed nor scored. Internal spaces and newlines must be typed. Line endings normalize to LF; one terminal newline is removed. Scoring uses Unicode grapheme clusters rather than UTF-16 code units.

Errors advance normally; Backspace removes one entered grapheme, including a newline. Completion requires the entire target length to be entered and the **final lexical unit** to match exactly; earlier errors may remain. The final unit is a terminal identifier, recognized numeric literal, closed quoted literal (including its opening quote, contents and escaped quotes/Python triple quotes), or contiguous punctuation run such as `};`. Any trailing whitespace is part of that final unit. This is a lexical rule, not a Python/Java parser; unmatched quotes are punctuation. A wrong final unit must be backspaced and corrected before finishing.

- **CPM:** currently correct entered graphemes × 60 / elapsed seconds.
- **WPM:** CPM / 5.
- **Accuracy:** correct insertion attempts / all insertion attempts. Backspacing does not erase an attempt or its accuracy penalty.
- **Errors:** currently incorrect positions, distinct from cumulative mistakes.

Timing starts at the first insertion and ends at completion. There is **no pause**: losing focus or switching tabs does not stop elapsed time. **Escape opens the command line** (and closes an open dialog). **Tab then Enter** restarts through the focused restart control; Ctrl/Cmd+Enter also restarts from the typing input. Tab otherwise navigates controls. The command line supports search, arrow-key navigation and Enter to select.

Results show WPM, accuracy, raw WPM (all insertion attempts × 12 / elapsed seconds), correct/error/attempt counts, elapsed time and the actual test configuration. The SVG chart connects recorded speed samples; its error crosses indicate remaining incorrect positions at each sample, not new error events. It does not invent a consistency score. Next, repeat, typed-code review and source actions remain available after completion.

## Local data and privacy

Preferences use localStorage; completed-run history uses IndexedDB in this browser. There is no account or cross-device synchronization. Custom source text is **not persisted, uploaded, or executed**; its history entry retains the title and result metadata but stores an empty source string. Generated and curated source is stored with completed-run records. Clearing browser site data removes local preferences and history. Fonts are bundled and self-hosted rather than fetched from a font CDN.

## Provenance and design

Curated solutions derive from [neetcode-gh/leetcode](https://github.com/neetcode-gh/leetcode/tree/8fed5f7daa6a517e375a0562d876e4a72dfdafb8), pinned to revision `8fed5f7daa6a517e375a0562d876e4a72dfdafb8`, under MIT. The in-app source panel links each immutable upstream file. Preserve the attribution and license in `public/THIRD_PARTY_NOTICES.txt`; font and React runtime licenses are in `public/licenses/`.

The interface independently reproduces the layout and interaction style of [Monkeytype](https://monkeytype.com), using the [public source pinned at `5478cd701df9e6a7d4611004ec84bef8999b3aaa`](https://github.com/monkeytypegame/monkeytype/tree/5478cd701df9e6a7d4611004ec84bef8999b3aaa) as a reference, not as vendored implementation. No upstream GPL code or assets were copied. Monkeycode keeps its own React transcription engine, icons and wordmark and is not affiliated with Monkeytype.

The default **serika dark** palette is charcoal (`#323437`), yellow (`#e2b714`), muted gray (`#646669`) and warm text (`#d1d0c5`). Locally bundled Roboto Mono 400 carries controls, code and metrics; Lexend Deca 400 carries the wordmark, both under SIL OFL. Settings offer serika light, high contrast, 24/28/32px code and optional smooth caret motion.

The flat page uses compact configuration groups, an unboxed three-line code viewport with horizontal scrolling, a custom caret and fading chrome during typing. The shell grows smoothly with available width up to 1536px; wrapping configuration and solution-scope controls reserve their own space. Settings keep your selected 24/28/32px code size on narrow screens, with whitespace preserved and long lines scrolling inside the viewport. The caret follows container resizing and font loading as well as typing. Header/footer controls and results reflow on narrow screens; short screens scroll vertically rather than overlapping, and dialogs stay within the viewport with scrollable contents. Blurred code and a focus prompt indicate lost focus. Command line, settings, themes, history, custom import, source, review and about live in keyboard-accessible dialogs rather than permanent side panels. `DESIGN.md` records the implemented system; `.impeccable/design.json` carries its component previews and extension metadata. `src/styles.css` and `src/appearance.ts` remain the implementation sources of truth.
