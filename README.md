# monkeycode

A desktop-first code-practice app built with React, TypeScript and Vite. Python/Java typing works entirely in the browser. The **solve** workspace uses an optional invite-protected Supabase Edge Function and Postgres database, with explicit Run/Submit requests executed by OnlineCompiler.

## Run locally

Use **Node.js 22.23+** and npm:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Other commands:

```sh
npm test          # typing, content, provider contracts and Deno Edge tests; Deno 2 required
npm run build    # TypeScript checks and production bundle in dist/
npm run preview  # serve the production bundle locally after building
```

Python 3 and a JDK are used only for maintainer-side sample validation and the exercise execution check below. Neither is an application runtime dependency; the browser never executes practice code. Method excerpts need a supplied harness, and compilation alone does not establish algorithm correctness.

## Solving workspace

Select **solve** in the header or open `http://127.0.0.1:5173/#solve`. Vite proxies `/api` to the local Supabase gateway on port 54321. The browser receives an **execution invite**, never a provider or service-role key. Without an invite, the prompt and editor remain available locally.

- Write a Python function or Java instance method, with helpers if needed. Language drafts stay separate in memory. Reloading discards drafts and the invite; switching between typing and solving preserves them while the page stays open.
- **Run examples** checks public cases, showing expected/actual values. **Submit** checks public cases first, then private categories. Private inputs and diagnostics stay withheld. A passing Submit establishes functional results only, not the stated time/space bounds.
- From the editor, **Ctrl/Cmd+Enter** runs; add **Shift** to submit. Native Tab moves to the next control; use spaces for indentation.
- Each explicit action uploads its captured draft to OnlineCompiler, which retains execution history. Never include secrets. Editing during execution does not change the submitted snapshot; feedback identifies a changed draft or a resumed job.
- No automatic POST retry. An interrupted read offers **Check job again**. After reload, reenter the same invite to recover the saved job by ID without resubmitting. A 404 offers **Forget unavailable job (does not cancel)**; forgetting never cancels remote execution or sends a replacement.
- Optional **Practice / Independent check** records the intended activity, not proof of an unseen problem or unaided work. Prior visits are tracked across languages. No lessons, notes or waiting period block an attempt.
- Local history keeps at most 100 source-free attempt records plus one pending job in `monkeycode.solve-progress.v1`: action, language, timestamps, outcome and attempt conditions. Drafts, invites, notes and diagnostics are not stored. Storage failure is reported; the session can continue in memory.

Production uses Cloudflare Pages for the frontend and same-origin `/api` proxy, with Supabase for execution orchestration and durable storage. No Node application server or persistent SQLite volume is required.

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

## Supabase execution and Cloudflare Pages

Learner code executes only on [OnlineCompiler's native test service](https://onlinecompiler.io/docs/run-tests), never in the Edge Function or a local child process. The provider [retains source, inputs and outputs](https://onlinecompiler.io/privacy) in account execution history: **this is not zero-retention execution**. Do not submit secrets.

Solve uses a problem/editor split on desktop and stacks on narrow screens. Public examples remain visible; expand their input rows for explanations. Constraints, editor help, practice options and local attempts expand on demand. Open **Connect an invite to run code** to authorize execution; editing needs no invite. Run/Submit costs and the provider-retention warning remain beside the actions. Errors, pending-job recovery and result feedback are never hidden inside these disclosures.

### Local execution development

Install Deno 2 and start Docker. The Supabase and Wrangler CLIs are development dependencies.

1. Copy `.env.example` to ignored `.env`. Generate an invite with `npm run invite:create -- seat-1`; privately retain the raw token and configure only its SHA-256 digest in `MONKEYCODE_INVITES_JSON`. Configure 1–10 unique invites.
2. Keep `MONKEYCODE_EXECUTION_ENABLED=false` initially. Set the exact frontend origin, normally `http://127.0.0.1:5173`.
3. Start the local stack:

   ```sh
   npx supabase start --exclude gotrue,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor
   npm run dev:execution
   ```

4. In another terminal, run `npm run dev`. Verify invite access and disabled admission first. To execute real submissions, configure the provider key, explicitly accept retention and enable execution, then restart the function listener.

Supabase injects its URL and service-role key into the function. Never place these credentials in browser code, `VITE_` variables or Cloudflare Pages. Local Supabase data is separate from a hosted project. Do not run a database reset against a project containing real usage.

For a local Pages production preview, use `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx wrangler pages dev dist`. Wrangler otherwise automatically loads the backend `.env` into local Worker bindings. Keep Pages routing configuration in a separate ignored `.dev.vars` file containing only `EXECUTION_API_URL`; never copy backend secrets there.

### HTTP and streaming contract

The public Edge endpoint is `https://<project-ref>.supabase.co/functions/v1/execution`. Cloudflare's `functions/api/[[path]].ts` forwards only the supported `/api` routes to this fixed endpoint, preserving the response stream. Browser calls remain same-origin.

All `/api` requests require `Authorization: Bearer <invite token>`. Supabase gateway JWT verification is deliberately disabled: the function validates custom invite hashes itself. Browser origins must match exactly; no authentication cookies are used. Responses are non-cacheable.

- `GET /healthz` on the Edge endpoint: liveness only, not provider readiness.
- `GET /api/exercises/first-at-least`: public exercise only.
- `POST /api/jobs`: JSON containing exactly `exerciseId`, `exerciseVersion`, `language`, `action`, `code`. Exercise `first-at-least`, version 1, Python/Java and Run/Submit only.
- Successful POST returns HTTP 202, `application/x-ndjson`: an `admitted` event containing the durable job ID immediately, followed by a `completed` event after the result commits. The browser saves the ID before awaiting completion.
- `GET /api/jobs/:id`: authenticated owner-only recovery. Another invite receives 404. A broken stream or reload recovers this ID, **never automatically repeats POST**.

Python submissions are module-level functions; Java submissions are members of the supplied `Solution` class, not console programs. Request bodies are capped at 40 KiB and source at 32 KiB UTF-8; NUL is rejected. Public diagnostics are bounded to 8 KiB and credential-redacted. Java source-launcher compilation failures and Python syntax failures may be provider `runtime-error` verdicts; do not reclassify learner-controlled stderr.

### Transactional budgets, recovery and privacy

Run reserves one provider run for the public bundle. Submit reserves nine: the public bundle plus eight private-category bundles covering thirteen cases. Reservations are conservative and never refunded, including early public failure.

Defaults: 30 jobs/invite/UTC day, 300 jobs/UTC day globally, 30 reserved runs/rolling minute, 90,000 reserved runs/UTC month, and one active job globally. Postgres locks a singleton capacity row and commits quota reservation with admission. Multiple workers cannot independently admit overlapping jobs or reset budgets.

Workers have a 100-second execution deadline; provider HTTP calls each have a 45-second timeout. A job has a 150-second lease followed by a 120-second uncertainty quarantine. Expired work becomes a source-free service error, with no replay or refund. Duplicate or late completion cannot replace the first durable result. Disconnecting does not cancel admitted work.

Source and public diagnostics remain in worker/browser RAM only. Diagnostics travel on the live stream and are unavailable from later GET recovery. Postgres stores sanitized status, public numeric/boolean results or known private failure categories—never source, raw invites, arbitrary output or compiler diagnostics. Results expire 24 hours after job creation; current aggregate quota counters survive result expiry. Private inputs and diagnostics are withheld. Functional passes never verify implementation complexity.

Tables are in a private RLS-enabled schema. Only the service role can invoke the narrowly scoped public RPCs; anonymous/authenticated roles cannot access execution data. Disable request-body and Authorization logging in hosting/proxy configuration.

### Existing SQLite cutover

Do not silently start fresh counters against an already-used provider account.

1. Disable admissions and stop **every** old API process. Preserve the old database, WAL sidecars and any ownership file; do not delete or replace an existing ownership file. For older installations without a sidecar, the importer creates one without replacing an existing lock inode.
2. Apply the Supabase migration to an unused destination. Keep execution disabled.
3. In a private operator shell, configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `MONKEYCODE_LEGACY_STOPPED=true`, then run:

   ```sh
   npm run migrate:legacy -- /absolute/path/to/execution.sqlite
   ```

The command obtains the legacy ownership lock, reads a consistent source-free snapshot and sends it directly to the administrative import RPC without writing a snapshot file. The import preserves current daily/monthly/minute reservations and retained job IDs, sanitizes results and quarantines unfinished work. Nonempty destinations and repeated imports are rejected. If the HTTP outcome is uncertain, inspect destination state before retrying; **never reset counters to make an import succeed**. Keep the old API stopped after cutover.

### Free-tier deployment

Cloudflare Pages plus Supabase Free avoids the paid Render service. Free tiers have limits and availability restrictions; this is not an unlimited or production-SLA promise. Supabase projects can pause for inactivity. OnlineCompiler usage and optional domains remain separate. Review [Supabase pricing](https://supabase.com/pricing), [Edge limits](https://supabase.com/docs/guides/functions/limits) and [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) before enabling public traffic; do not upgrade paid plans automatically.

1. Create a **Free** Supabase project and link it with `npx supabase link --project-ref <project-ref>`. With Supabase CLI 3, review and apply `npx supabase db push --remote` (without `--remote`, this command targets the local database). For an existing SQLite account, perform the cutover above before admitting any new job.
2. Set server-only function secrets using Supabase's secure dashboard or an ignored, dedicated secrets file: invite digest JSON, exact frontend origin, provider key, retention acknowledgement, quota caps and `MONKEYCODE_EXECUTION_ENABLED=false`. Supabase supplies its own URL/service-role key; do not overwrite them.
3. Deploy with `npx supabase functions deploy execution --no-verify-jwt`. This deploys the real execution entrypoint; no QA endpoint belongs in a release.
4. Build with `npm ci && npm run build`. Create a Cloudflare Pages project with `dist` as output and this repository's root `functions/` and `wrangler.toml`. Deploy with `npx wrangler pages deploy dist --project-name monkeycode`, or configure the corresponding Git deployment. Preserve `public/_headers` in the build.
5. In Pages project settings, configure **only** the server-side routing variable `EXECUTION_API_URL=https://<project-ref>.supabase.co/functions/v1/execution`. Set Supabase's allowed origin to the exact canonical Pages/custom-domain origin. Redeploy Pages after changing its environment. Preview origins are not automatically authorized.
6. Before enabling execution, verify HTTPS, fonts/static assets, `/#solve`, unauthenticated/invalid-invite rejection, authenticated public exercise access, wrong-origin rejection, disabled POST rejection and owner-only job recovery. Health alone does not establish readiness.
7. Review logging, retention and provider-account usage. Explicitly enable execution only after these checks. Make one deliberate authored submission and recover its same ID after reload/redeploy; do not POST again to test persistence.

Live invite-only deployment: [monkeycode.pages.dev](https://monkeycode.pages.dev), verified November 4, 2026. Cloudflare Pages and Supabase are on their free tiers; execution is enabled for the existing invites. No paid Render resource was created.

For rollback, disable admissions and drain work first. Preserve Postgres data and budget counters; code rollback is not data rollback. Never restore an older snapshot or switch back to stale SQLite counters without reconciling provider usage. Free-tier backup/recovery guarantees must be reviewed separately.

### Verification

```sh
npm test
npm run build
npm run check:execution   # repository-authored Python/Java only; not a sandbox
```

Migration verification passed 72 Node tests, 18 Deno tests, the TypeScript/Vite build, real PostgreSQL SQL invariants and authored Python/Java wrapper execution. A real local Supabase gateway/Edge runtime verified authentication, origins, disabled execution and service-role database lookup. Browser checks against the real local Edge/Postgres stack with a **controlled executor** verified early admission, public feedback, private-category feedback, diagnostic redaction, draft snapshot isolation and reload recovery: five explicit POSTs total, zero replacement POSTs after reload. These checks made no real provider requests and do not establish hosted production acceptance.

The actual local Cloudflare Pages worker also compiled and rendered the production workspace with its security headers, rejected unknown API routes and failed closed when upstream configuration was absent. The offline import command was exercised with temporary SQLite fixtures and real Postgres: current quota survived, unfinished IDs became unavailable, diagnostics were stripped and duplicate import was rejected.

Hosted acceptance verified the actual Pages-to-Supabase proxy, authenticated public exercise access, unauthenticated and wrong-origin rejection, disabled admission before enablement, bundled fonts, desktop workspace and the typing final-character correction rule. One real authored Python Run passed all three public examples. Its completed ID recovered by GET after reload with zero replacement POSTs, and browser storage contained neither its draft nor invite. The offline import retained 50 November provider reservations; the accepted Run raised that total to 51. An earlier browser request failed before admission: database inspection confirmed unchanged counters and no new job before a separate explicit request. The app did not automatically replay it. Hosted Java/private Submit acceptance has not been exercised by this deployment check.

For an explicitly authorized real-provider smoke, set `MONKEYCODE_SMOKE_TOKEN`, `ONLINECOMPILER_RETENTION_ACCEPTED=true` and optionally `MONKEYCODE_SMOKE_URL` to the HTTPS frontend origin, then run `npm run check:hosted`. It makes five sequential authored submissions, reserves up to 29 provider runs, prints admitted IDs for recovery and never automatically retries a failed/ambiguous POST. It is not a readiness probe.

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
