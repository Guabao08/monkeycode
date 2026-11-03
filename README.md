# monkeycode

A desktop-first code-transcription practice app built with React, TypeScript and Vite. Python/Java typing works entirely in the browser. An optional invite-protected Node API executes the first solving exercise through OnlineCompiler; the solving screen is not integrated yet.

## Run locally

Use **Node.js 22.23+** and npm:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Other commands:

```sh
npm test          # typing, content, HTTP/SQLite and provider-contract tests
npm run build    # TypeScript checks and production bundle in dist/
npm run preview  # serve the production bundle locally after building
```

Python 3 and a JDK are used only for maintainer-side sample validation and the exercise execution check below. Neither is an application runtime dependency; the browser never executes practice code. Method excerpts need a supplied harness, and compilation alone does not establish algorithm correctness.

## Practice exercise contracts

The first solving exercise has content, grading material and a protected hosted-execution backend, **not yet an in-app mode**. The current typing interface is unchanged. Practice remains the priority: no prerequisite lessons, mandatory approach notes, unlocks, or enforced waiting periods.

- `src/learning/types.ts`: public exercise, attempt-condition, assistance, feedback, and execution-failure contracts. Functional correctness and approach evidence are separate; neither passing tests nor answering reasoning questions certifies implementation complexity.
- `src/learning/first-at-least.ts`: original sorted-array problem, explicit constraints, examples, Python/Java method signatures, and time/space requirements. Learners supply methods and helpers, not console parsing or a full program.
- `server/learning/first-at-least.ts`: private grading fixtures, reference implementations, hints, explanation, and authored reasoning checks. Never import this server material into the browser entry. “Private” means withheld from normal learner feedback, not secret from someone reading this repository.

Run feedback includes expected and actual public-example results when output is a valid numeric array. Submit first checks those examples, then returns private failure categories without private inputs or diagnostics. Malformed learner output is a wrong answer; incomplete or invalid provider responses are service failures, not learner failures. The separate counterexample helper is not exposed by the API: assistance-event enforcement and persistent learning progress remain unimplemented. Passing tests never certifies implementation complexity.

Validate the authored implementations locally with Python 3 and a JDK on PATH:

```sh
npm run check:exercise
```

This command compiles/runs both reference implementations and correct linear alternatives against 1,780 cases each, including exhaustive small sorted arrays, duplicates, empty arrays, integer extremes, and the maximum input length. It also verifies rejection of a plausible strict-greater-than boundary mistake in both languages. A linear solution passes functional grading without satisfying the stated logarithmic-time requirement. Local verification used Python 3.14.0 and javac 26.0.2.1. Live hosted reference submissions also passed using the adapter's `python-3.14` and `openjdk-25` runtimes.

The local checkers execute **only repository-authored code**, use temporary files removed on exit, and have process/output bounds. They are **not sandboxes**: never expose them as endpoints or use them to execute untrusted submissions. They do not upload code. `npm run check:execution` additionally exercises the exact production wrappers with the public bundle and all eight private categories, including reconstruction of the full 100,000-element input.

## Optional hosted execution API

`server/main.ts` runs the API; learner code executes only on [OnlineCompiler's native test service](https://onlinecompiler.io/docs/run-tests), never in a local child process. Deployment requires a provider account/key and explicit acceptance of its [privacy policy](https://onlinecompiler.io/privacy). The provider retains submitted source, input and output in account execution history while the account is active: **this is not zero-retention execution**. Do not submit secrets. Protect provider-account access as well as the API key.

1. Copy `.env.example` to the ignored `.env` file and configure the server-only key. Never put credentials in `VITE_` variables.
2. Review provider retention, then set `ONLINECOMPILER_RETENTION_ACCEPTED=true`.
3. Run `npm run invite:create -- seat-1`. Securely share its raw token with that invitee; configure only the printed SHA-256 digest in `MONKEYCODE_INVITES_JSON`, for example `{"seat-1":"<64-hex digest>"}`. Configure 1–10 unique invites. The generator deliberately prints the secret once; do not paste it into logs or commit it.
4. Set `MONKEYCODE_ALLOWED_ORIGIN` to the exact frontend origin. Default: `http://127.0.0.1:5173` (not `http://localhost:5173`). Set `MONKEYCODE_EXECUTION_ENABLED=true` only when ready to accept submissions.
5. Run `npm run start:api` (or `npm run dev:api` for restart-on-change development). Missing key, retention acceptance or valid invites prevents startup. Execution defaults to disabled; changing this switch requires restarting the process.

Default listener: `127.0.0.1:3001`. Production needs a TLS reverse proxy and **one API process on one host with a persistent writable SQLite volume** at `MONKEYCODE_DB_PATH` (default `.data/execution.sqlite`). Do not horizontally scale this store or place it on a shared network filesystem. Node 22's built-in SQLite currently emits an experimental-feature warning. The Vite build remains a static frontend, not an API deployment.

### HTTP contract

All `/api/` requests require `Authorization: Bearer <invite token>`. Browser requests require the exact allowed origin; there are no authentication cookies or wildcard CORS. CLI clients may omit `Origin`. API responses are non-cacheable.

- `GET /healthz`: minimal liveness response, not a provider-readiness check.
- `GET /api/exercises/first-at-least`: public statement, signatures and examples only.
- `POST /api/jobs`: JSON with exactly `exerciseId`, `exerciseVersion`, `language`, `action`, `code`; returns HTTP 202 with a job ID. Only exercise `first-at-least`, version `1`, Python/Java and `run`/`submit` are accepted.
- `GET /api/jobs/:id`: owner-only queued/running/completed state and result; another invite sees 404. Poll this ID rather than resubmitting.

Example body (Python method, not a full console program):

```json
{
  "exerciseId": "first-at-least",
  "exerciseVersion": 1,
  "language": "python",
  "action": "run",
  "code": "def first_at_least(values, target):\n    for index, value in enumerate(values):\n        if value >= target:\n            return index\n    return len(values)"
}
```

Java submissions are members of the supplied `Solution` class, including any helpers; do not supply a `Main` class or console parser. Bodies are capped at 40 KiB and submitted source at 32 KiB UTF-8, with NUL rejected. Public feedback can include bounded compiler/runtime messages. Private feedback contains categories only, including for private runtime/resource failures; no private diagnostics are returned. Results distinguish passed, wrong-answer, compile-error, runtime-error, resource-limit and service-error, and always report `implementationComplexityVerified: false`. These categories preserve native provider verdicts: Java compiles inside its source-launcher run, so a compilation failure can return `runtime-error` with compiler diagnostics. Python syntax errors also return `runtime-error`. Do not infer a different category by parsing learner-controlled stderr; see the provider's [startup and verdict contract](https://onlinecompiler.io/docs/run-tests).

### Budgets, recovery and local retention

Run bundles the three visible examples into **one provider run**. Submit reserves **nine provider runs**: that public bundle plus eight private category bundles covering all thirteen private cases. It stops before private execution if public examples fail. This differs from one provider execution per button click.

Default limits are 30 admitted jobs/invite/day, 300 jobs/day globally, 30 reserved provider runs per rolling minute, 90,000 per UTC calendar month, and one active job globally. Day limits reset at UTC midnight. Limits are atomically persisted before execution. Failed admission spends nothing; admitted reservations are conservative and are **not refunded**, even after an early failure. Use a dedicated provider account/key or account for other consumers separately; this database cannot observe their usage.

There are no automatic retries, fallback runners, restart replays or remote cancellation guarantees. Ambiguous service failures and unfinished jobs on recovery impose a 120-second capacity quarantine; recovery marks unfinished jobs unavailable rather than running them again. Do not delete/reset the database to clear limits or deploy multiple copies against one provider account without a separate shared limiter.

Submitted source is held only for the active in-process execution and is not written to application logs or SQLite. Public diagnostic messages can quote submitted source; they are owner-only, key-redacted, held only in RAM (at most 8 KiB/job, up to 24 hours), and disappear after restart. Durable job results contain only sanitized status, public numeric/boolean feedback or private categories; completed records expire after 24 hours. Current aggregate budget counters survive result expiry and restart. Proxy/hosting logging must also avoid request bodies and authorization headers.

### Verification and deployment gate

```sh
npm test
npm run build
npm run check:exercise    # local authored code; Python/JDK required
npm run check:execution   # local production harness smoke; Python/JDK required
```

Local checks passed, including actual Python/Java execution. HTTP tests use a controlled executor and temporary SQLite; provider-contract tests use controlled transport. Separately, live acceptance verified Python and Java reference submissions, a functionally correct Python linear submission, rejection of the Python boundary mistake, and an invalid Java method reported as `runtime-error` with compiler diagnostics. The initial smoke command expected `compile-error` for that final case and failed; its expectation was corrected to match Java's source-launcher behavior. All five completed jobs were then verified through authenticated HTTP without resubmitting them. This proves those hosted paths, not every provider failure or production deployment.

After configuring a real account, retention acceptance, enabled API and invite, set `MONKEYCODE_SMOKE_TOKEN` securely in the shell and run `npm run check:hosted` against that running API (`MONKEYCODE_SMOKE_URL` optionally selects another HTTPS API origin). This opt-in command submits only repository-authored programs, runs five sequential jobs and reserves up to **29 provider runs**. Leave minute-budget headroom and inspect any ambiguous job before trying again; the script never automatically resubmits.

Before production: deploy the single-process persistent API behind TLS, verify deployment-secret/logging configuration, then integrate and exercise the solving editor, Run/Submit controls and local attempt/assistance state. The provider is configured for local acceptance; no production deployment or learner-facing solving screen was provisioned by this backend change. Remove `MONKEYCODE_SMOKE_TOKEN` from `.env` after verification if it was added there; retain the invite token securely for later authenticated access.


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
