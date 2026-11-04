# Monkeycode

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Implemented: React, TypeScript, Vite and plain CSS for the static browser application, plus an optional invite-protected Node HTTP/SQLite execution backend. The React transcription engine remains independent of Monkeytype's implementation. Fonts are bundled locally.

## Users and Purpose
Desktop physical-keyboard users practicing code transcription speed/accuracy and solving short Python/Java method exercises. Practice comes first: no course, prerequisite lessons, mandatory notes or unlocks.

## Capabilities and Constraints
Python and Java. Deterministic local typing generation uses eight finite structured algorithm families, not AI or Markov generation. The MIT-attributed curated typing collection contains eight problems and 32 language/scope variants, with method/full scope and scored-length filters. Private custom typing paste is limited to 30,000 characters and is never persisted as source, uploaded or executed. Solving is a separate explicit-upload workspace, currently offering one original sorted-array exercise.

Sessions are completion-based: errors advance freely and Backspace corrects them. Automatic leading indentation is unscored; internal spaces and newlines are typed. Completion requires an exact final lexical unit; earlier errors may remain. Grapheme-based scoring distinguishes current errors from cumulative insertion attempts. Timing never pauses on blur. Results show actual sampled WPM/raw-WPM history, accuracy, character counts and elapsed time, without a fabricated consistency score.

Preferences use localStorage and completed history uses IndexedDB. Custom history retains title/result metadata, not source; generated and curated history retains source. The typing interface has no accounts, cross-device synchronization, hosted AI or code execution. Command line, settings, themes, local history, custom import, source, typed-code review and about are implemented dialogs. Escape opens the command line; Tab then Enter restarts, with Ctrl/Cmd+Enter available from the typing input.

The first practice-first solving exercise is integrated in `src/Solve.tsx`: public contracts in `src/learning/`, private grading/teaching material in `server/learning/`, a maintainer-only Python/Java checker, and a protected execution API in `server/`. OnlineCompiler supplies the hosted execution boundary, not a local child process. The API provides authenticated Run/Submit jobs, owner-only polling, durable quotas, source-free SQLite results and private category feedback; execution defaults off and requires a server-only key plus explicit provider-retention acceptance. The browser keeps separate language drafts and invite in memory, captures each submitted snapshot, recovers saved jobs by GET without automatically replaying POST, and persists at most 100 source-free attempts plus pending metadata. Optional practice/independent-check activity and prior visits are context, never proof of independent mastery. Hints/explanations and assistance-reveal event tracking are not exposed yet. Existing typing behavior and custom-source privacy remain unchanged. Tests/build and real browser-to-provider Python/Java paths, private feedback, Java compiler diagnostics, changed-draft handling and interrupted/reloaded job recovery were verified locally. Java source-launcher compilation failures can be reported as runtime errors; native verdicts are preserved. Functional passes do not verify implementation complexity. Production deployment remains unverified. See `README.md` for configuration, budgets, retention and deployment gates.

Production runtime support: `npm start` serves the built frontend and API together from one Node process/port; `start:api` remains API-only. `render.yaml` targets a single paid native Node 24 Render web service with a 1 GB persistent SQLite disk, execution disabled initially and automatic service deploys off. Render port/external-origin defaults support same-origin hosting; a custom domain requires an exact origin override. No autoscaling, serverless or zero-downtime capability is claimed: disk-backed deploys stop the old process first. The Render account, repository permissions, billing review and operator deployment/health/auth/persistence gates remain outstanding; this is deployment configuration, not a provisioned or production-verified service. See the README's Render runbook for secrets, controlled enablement, backups and rollback.

Local deployment acceptance includes 101 passing tests, production build, official Blueprint-schema validation, real-browser same-origin static/API loading with execution disabled, and real cross-process/SIGKILL recovery with quota preservation and no provider calls. Ownership uses an OS-backed exclusive SQLite sidecar lock rather than reusable PIDs; upgrading an existing database requires stopping all prior API processes first. No live Render acceptance is claimed.

## Brand Commitments
An intentionally close, independently implemented reproduction of Monkeytype's flat, distraction-free interface, adapted to multiline code transcription. Default serika dark charcoal/yellow, locally bundled Roboto Mono and Lexend Deca, compact controls, a three-line typing viewport, fading chrome and flat sampled results replace the earlier visual direction. Desktop physical keyboards remain the primary input; narrow layouts adapt without adding a separate mobile typing product.

Reference: [live Monkeytype](https://monkeytype.com) and [public source at revision 5478cd701df9e6a7d4611004ec84bef8999b3aaa](https://github.com/monkeytypegame/monkeytype/tree/5478cd701df9e6a7d4611004ec84bef8999b3aaa). No upstream GPL code or assets were copied; icons, wordmark and React engine are independent. No affiliation with Monkeytype.

## Open Decisions
No promise of all LeetCode problems, unlimited generated variety, verified difficulty labels or algorithm correctness. Corpus coverage is explicit; repeated recipe shapes are expected. Length thresholds (short ≤350, standard 351–900, long >900 scored graphemes) are editorial defaults, not research-validated typing difficulty. Final-unit matching is lexical, not a Python/Java parser. Method excerpts are not executable standalone programs.
