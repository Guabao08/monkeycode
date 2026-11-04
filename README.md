# monkeycode

A desktop-first code-practice app built with React, TypeScript and Vite. Python/Java typing works entirely in the browser. The **solve** workspace adds a method editor for the first original exercise, with an optional invite-protected Node API executing explicit Run/Submit requests through OnlineCompiler.

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

## Solving workspace

Select **solve** in the header or open `http://127.0.0.1:5173/#solve`. Start the optional API below on port 3001; Vite proxies relative `/api` requests to it. The browser receives an **execution invite**, never the provider API key. Without an invite, the prompt and editor remain available locally.

- Write a Python function or Java instance method, with helpers if needed. Language drafts stay separate in memory. Reloading discards drafts and the invite; switching between typing and solving preserves them while the page stays open.
- **Run examples** checks public cases, showing expected/actual values. **Submit** checks public cases first, then private categories. Private inputs and diagnostics stay withheld. A passing Submit establishes functional results only, not the stated time/space bounds.
- From the editor, **Ctrl/Cmd+Enter** runs; add **Shift** to submit. Native Tab moves to the next control; use spaces for indentation.
- Each explicit action uploads its captured draft to OnlineCompiler, which retains execution history. Never include secrets. Editing during execution does not change the submitted snapshot; feedback identifies a changed draft or a resumed job.
- No automatic POST retry. An interrupted read offers **Check job again**. After reload, reenter the same invite to recover the saved job by ID without resubmitting. A 404 offers **Forget unavailable job (does not cancel)**; forgetting never cancels remote execution or sends a replacement.
- Optional **Practice / Independent check** records the intended activity, not proof of an unseen problem or unaided work. Prior visits are tracked across languages. No lessons, notes or waiting period block an attempt.
- Local history keeps at most 100 source-free attempt records plus one pending job in `monkeycode.solve-progress.v1`: action, language, timestamps, outcome and attempt conditions. Drafts, invites, notes and diagnostics are not stored. Storage failure is reported; the session can continue in memory.

Production `npm start` serves the built `dist/` frontend and `/api` from one Node process on one port; run `npm run build` first. `npm run start:api` remains API-only. The Vite development and preview servers use a localhost API proxy; configure the API's allowed origin to match the frontend URL when using preview.

## Practice exercise contracts

The first solving exercise has public content, private grading material, a protected hosted-execution backend and an integrated browser workspace. The typing interface remains independently usable. Practice remains the priority: no prerequisite lessons, mandatory approach notes, unlocks, or enforced waiting periods.

- `src/learning/types.ts`: public exercise, attempt-condition, assistance, feedback, and execution-failure contracts. Functional correctness and approach evidence are separate; neither passing tests nor answering reasoning questions certifies implementation complexity.
- `src/learning/execution.ts`: shared public submission, job and execution-result wire types. `src/learning/client.ts` validates browser responses and never automatically replays a submission; `src/learning/progress.ts` persists whitelisted source-free attempt metadata.
- `src/learning/first-at-least.ts`: original sorted-array problem, explicit constraints, examples, Python/Java method signatures, and time/space requirements. Learners supply methods and helpers, not console parsing or a full program.
- `server/learning/first-at-least.ts`: private grading fixtures, reference implementations, hints, explanation, and authored reasoning checks. Never import this server material into the browser entry. “Private” means withheld from normal learner feedback, not secret from someone reading this repository.

Run feedback includes expected and actual public-example results when output is a valid numeric array. Submit first checks those examples, then returns private failure categories without private inputs or diagnostics. Malformed learner output is a wrong answer; incomplete or invalid provider responses are service failures, not learner failures. Local attempt/exposure metadata is implemented. The separate counterexample helper is not exposed by the API: assistance reveals and their event tracking remain unimplemented. Passing tests never certifies implementation complexity.

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

Default API-only listener: `127.0.0.1:3001`. Production requires **one API process on one host with a persistent writable SQLite volume** at `MONKEYCODE_DB_PATH` (default `.data/execution.sqlite`). Do not horizontally scale this store or place it on a shared network filesystem. The native Render deployment below supplies TLS and serves frontend and API together; a static-only deployment cannot execute code.

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

The integrated workspace was exercised in a real browser against the configured provider: Python public pass, private boundary failure, corrected private pass, Java public pass and invalid-Java diagnostics. Interrupted GET polling and reload recovered the original job with no replacement POST; newer drafts were preserved and local records excluded source, invite and diagnostics. Before production: deploy the single-process persistent API behind TLS, route `/api`, and verify deployment secrets, logging, retention, quotas and origin handling in that environment. Local acceptance is not a production deployment. Remove `MONKEYCODE_SMOKE_TOKEN` from `.env` after verification if it was added there; retain the invite token securely for later authenticated access.

### Render production deployment (operator-run, not deployed)

`render.yaml` defines one native Node 24 **paid Starter web service**, one instance, and a **1 GB persistent disk** mounted at `/var/data`. It builds with `npm ci --include=dev && npm run build`, starts with `npm start`, and checks `/healthz`. This is not a free/ephemeral, serverless, multi-process or autoscaling deployment. The disk-owning process serves `dist/` and the API on the same origin and port. Render stops the old disk-backed instance before starting its replacement: expect short downtime on deploys/restarts, not zero downtime.

Local release verification passed: 101 tests, TypeScript/Vite build, and normalized Blueprint validation against Render's published Draft 2020-12 JSON Schema. The actual `npm start` process served the built app and locally bundled fonts in a browser, authenticated the same-origin exercise request, rejected execution while disabled, and returned correct static MIME/cache/HEAD and API authorization/origin responses. A separate real cross-process smoke rejected a concurrent owner; after SIGKILL, recovery retained all nine reserved units, marked the unfinished job unavailable, and quarantined new admission without contacting the provider. These are local checks, not Render HTTPS, disk or account acceptance.

Treat `dist/` as immutable while the process is running; restart after replacing the build. Static serving is limited to its startup manifest, without a catch-all HTML fallback for missing assets.

**Outstanding prerequisites:** an operator must create/access a Render account/workspace with billing permission, authorize Render's GitHub integration with access to this repository, and have permission to publish/select the deployment branch. No Render account or service has been provisioned here; production deployment and its checks remain unverified. Paid hosting has been chosen, but review the current [service and disk charges](https://render.com/pricing) and approve the Dashboard's billing summary before creating resources. Provider execution charges/quotas are separate; disabling execution does not stop Render billing.

1. Publish the complete changes to a branch containing **both the React UI and `render.yaml` plus the server changes**. In the [Render Dashboard](https://dashboard.render.com), choose **New → Blueprint**, connect this repository, select that branch, and use the root `render.yaml`. The Blueprint deliberately pins neither `repo` nor `branch`; confirm the created service's source branch before deploying. Do not select a backend-only branch.
2. Review the proposed single paid Starter service and 1 GB disk. Supply the three `sync: false` values in Render's secure environment-variable prompts/settings, **not chat, committed files, browser `VITE_` variables, screenshots or logs**:
   - `ONLINECOMPILER_API_KEY`: the server-only provider key.
   - `ONLINECOMPILER_RETENTION_ACCEPTED`: `true` only after reviewing and accepting the provider retention policy above.
   - `MONKEYCODE_INVITES_JSON`: generate invites with `npm run invite:create -- seat-1`, securely deliver each **raw token** to its invitee, and enter only the ID-to-**SHA-256 digest** JSON mapping in Render. Never configure raw invite tokens in this mapping; keep raw tokens in a private password manager for authenticated checks.
3. Keep `MONKEYCODE_EXECUTION_ENABLED=false` for first boot. Required provider/invite configuration is still needed for startup. The Blueprint binds `0.0.0.0`; the application uses Render's `PORT` unless `MONKEYCODE_PORT` is explicitly set. Leave that override unset. The allowed browser origin defaults to `RENDER_EXTERNAL_URL` (the service's HTTPS `onrender.com` URL) unless `MONKEYCODE_ALLOWED_ORIGIN` is explicit. No proxy configuration or wildcard CORS is needed.
4. Create the Blueprint and inspect the deploy logs without exposing secrets or logging request bodies/Authorization headers. Confirm the service has exactly one instance/process, the disk is mounted, and `MONKEYCODE_DB_PATH=/var/data/execution.sqlite`. The database and its SQLite `-wal`/`-shm` sidecars must remain under this persistent directory, never in the ephemeral source tree. The disk is available at runtime only, not during builds/pre-deploy commands.
5. Before enabling execution, check HTTPS `/healthz`, the root page and its assets, and `/#solve`. Liveness alone does **not** prove provider readiness. Check that unauthenticated `/api/exercises/first-at-least` is rejected, an authenticated request with the private raw invite succeeds, an invalid invite is rejected, and the exact configured browser origin is enforced. Keep raw tokens out of shell history/output. Confirm the execution-disabled UI/API behavior without creating a provider job. Restart the service and repeat health/static/auth checks; inspect that the same SQLite database remains, rather than a new ephemeral database.
6. For a custom domain, configure DNS/TLS in Render, then set **`MONKEYCODE_ALLOWED_ORIGIN=https://practice.example.com`** to the exact chosen frontend origin (scheme + host and nondefault port if any; no path or trailing slash). Redeploy/restart and use that canonical URL; the old `onrender.com` browser origin will no longer be authorized. Do not set `*` or a comma-separated origin list.
7. Only after these checks and budget/retention/logging review, explicitly enable execution and redeploy. For a lasting release, change the Blueprint's `MONKEYCODE_EXECUTION_ENABLED` value to `'true'` in the reviewed release branch and sync it. A Dashboard-only override can be reset to `'false'` by a later Blueprint sync; deliberately reconcile both sources. `sync: false` secrets are entered at creation and subsequently managed in the Dashboard, not supplied anew by YAML sync. Start with one explicit authored example and poll its returned ID. The optional hosted smoke above costs up to 29 reserved provider runs; it is not a boot/readiness probe. Never automatically retry a submission POST after an ambiguous result.
8. Record the accepted commit and configuration. `autoDeployTrigger: 'off'` disables commit-triggered service deploys, not the initial creation or intentional Blueprint/configuration updates. Review Blueprint syncs and manually deploy the selected release commit from the Dashboard. For staging, create a **separate service/disk/database and separate invites**, keep execution disabled initially, and isolate provider credentials/budgets; never mount or copy production's live database into staging.

**Ownership cutover:** stop every prior-version API process before first starting this release against an existing database. The new owner holds an OS-backed exclusive SQLite lock in `execution.sqlite.ownership`; do not unlink or replace that file while any process is running. The old PID/token ownership schema migrates transactionally to a crash marker, avoiding false ownership after container PID reuse. Old and new ownership implementations must never overlap. PID-based releases cannot use the upgraded schema unchanged; rolling back across this migration requires a reviewed offline compatibility migration that preserves jobs and quota counters, not a database reset.

**Persistence, backups and rollback:** after an explicitly approved execution, record its job ID and quota state, restart/redeploy, and confirm authenticated GET can recover the same durable result and quotas remain consumed (RAM-only diagnostics are expected to disappear). Never reset SQLite to regain budget, and never replay POST to verify persistence. An unfinished job can become unavailable on restart and impose the documented quarantine. For backups, first disable admissions, let active work finish, and stop the owning application/service before taking an offline consistent copy of the database and any remaining WAL sidecars; arrange supported maintenance access before stopping, and store backups securely outside the service disk. Never copy only a live `execution.sqlite` file while WAL writes are possible. A SQLite-aware online backup requires an appropriate backup tool/maintenance procedure; none is provided by this app. Render's daily disk snapshots (seven-day retention) are not a substitute for a database-consistent backup: Render warns against custom-database snapshot recovery, and restoration discards newer writes.

For a controlled rollback, disable execution, drain work, preserve a consistent backup, review the old code's compatibility with the current database and environment, and manually deploy the known-good commit with the **same disk**. Code rollback does not roll back data, quotas, provider runs or environment values. Do not blindly restore an older database/snapshot: losing budget counters can authorize already-spent usage again. Expect downtime, repeat health/static/auth and persistence checks, then explicitly re-enable only after review. Deleting or suspending resources has billing/data consequences; consult Render before cleanup rather than assuming disabled execution means free hosting.

Official references: [Blueprint fields and schema validation](https://render.com/docs/blueprint-spec), [persistent disk lifecycle, limitations and snapshots](https://render.com/docs/disks), [default `PORT`/external URL environment variables](https://render.com/docs/environment-variables), [secret/environment configuration](https://render.com/docs/configure-environment-variables), and [Node version precedence](https://render.com/docs/node-version). The public [JSON Schema](https://render.com/schema/render.yaml.json) supports local IDE validation without a Render token; schema validation does not establish account permissions, runtime behavior or successful deployment.


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

Typing preferences use localStorage; completed typing-run history uses IndexedDB in this browser. There is no account or cross-device synchronization. Custom **typing** source is not persisted, uploaded, or executed; its history entry retains the title and result metadata but stores an empty source string. Generated and curated typing source is stored with completed-run records. Solving uploads code only on explicit Run/Submit and retains only source-free attempt/pending metadata locally, as described above. Clearing browser site data removes local preferences and history, not provider execution history. Fonts are bundled and self-hosted rather than fetched from a font CDN.

## Provenance and design

Curated solutions derive from [neetcode-gh/leetcode](https://github.com/neetcode-gh/leetcode/tree/8fed5f7daa6a517e375a0562d876e4a72dfdafb8), pinned to revision `8fed5f7daa6a517e375a0562d876e4a72dfdafb8`, under MIT. The in-app source panel links each immutable upstream file. Preserve the attribution and license in `public/THIRD_PARTY_NOTICES.txt`; font and React runtime licenses are in `public/licenses/`.

The interface independently reproduces the layout and interaction style of [Monkeytype](https://monkeytype.com), using the [public source pinned at `5478cd701df9e6a7d4611004ec84bef8999b3aaa`](https://github.com/monkeytypegame/monkeytype/tree/5478cd701df9e6a7d4611004ec84bef8999b3aaa) as a reference, not as vendored implementation. No upstream GPL code or assets were copied. Monkeycode keeps its own React transcription engine, icons and wordmark and is not affiliated with Monkeytype.

The default **serika dark** palette is charcoal (`#323437`), yellow (`#e2b714`), muted gray (`#646669`) and warm text (`#d1d0c5`). Locally bundled Roboto Mono 400 carries controls, code and metrics; Lexend Deca 400 carries the wordmark, both under SIL OFL. Settings offer serika light, high contrast, 24/28/32px code and optional smooth caret motion.

The flat page uses compact configuration groups, an unboxed three-line code viewport with horizontal scrolling, a custom caret and fading chrome during typing. The shell grows smoothly with available width up to 1536px; wrapping configuration and solution-scope controls reserve their own space. Settings keep your selected 24/28/32px code size on narrow screens, with whitespace preserved and long lines scrolling inside the viewport. The caret follows container resizing and font loading as well as typing. Header/footer controls and results reflow on narrow screens; short screens scroll vertically rather than overlapping, and dialogs stay within the viewport with scrollable contents. Blurred code and a focus prompt indicate lost focus. Command line, settings, themes, history, custom import, source, review and about live in keyboard-accessible dialogs rather than permanent side panels. `DESIGN.md` records the implemented system; `.impeccable/design.json` carries its component previews and extension metadata. `src/styles.css` and `src/appearance.ts` remain the implementation sources of truth.
