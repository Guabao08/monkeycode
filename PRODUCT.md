# Monkeycode

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Implemented: React, TypeScript, Vite and plain CSS for the browser application, with an optional invite-protected Supabase Edge Function/Postgres backend and a Cloudflare Pages same-origin proxy. The React transcription engine remains independent of Monkeytype's implementation. Fonts are bundled locally.

## Users and Purpose
Desktop physical-keyboard users practicing code transcription speed/accuracy and solving short Python/Java method exercises. Practice comes first: no course, prerequisite lessons, mandatory notes or unlocks.

## Capabilities and Constraints
Python and Java. Deterministic local typing generation uses eight finite structured algorithm families, not AI or Markov generation. The MIT-attributed curated typing collection contains eight problems and 32 language/scope variants, with method/full scope and scored-length filters. Private custom typing paste is limited to 30,000 characters and is never persisted as source, uploaded or executed. Solving is a separate explicit-upload workspace, currently offering one original sorted-array exercise.

Sessions are completion-based: errors advance freely and Backspace corrects them. Automatic leading indentation is unscored; internal spaces and newlines are typed. Completion requires an exact final lexical unit; earlier errors may remain. Grapheme-based scoring distinguishes current errors from cumulative insertion attempts. Timing never pauses on blur. Results show actual sampled WPM/raw-WPM history, accuracy, character counts and elapsed time, without a fabricated consistency score.

Preferences use localStorage and completed history uses IndexedDB. Custom history retains title/result metadata, not source; generated and curated history retains source. The typing interface has no accounts, cross-device synchronization, hosted AI or code execution. Command line, settings, themes, local history, custom import, source, typed-code review and about are implemented dialogs. Escape opens the command line; Tab then Enter restarts, with Ctrl/Cmd+Enter available from the typing input.

The practice-first solving exercise uses public contracts in `src/learning/`, private grading material in `server/learning/`, and the protected API in `supabase/functions/execution/`. OnlineCompiler executes learner code; the Edge Function does not run it locally. Admission, quotas, leases and sanitized results are transactional in Postgres. Private feedback exposes known categories only. Execution defaults off and requires explicit provider-retention acceptance.

The browser saves an admitted ID from the live response stream, then receives completion and RAM-only public diagnostics. Interrupted streams and reloads recover the same ID by GET, never automatic POST replay. Drafts and invites remain in memory; local history keeps at most 100 source-free attempts. Functional passes and optional activity/exposure metadata never certify independence, mastery or implementation complexity. Typing behavior and custom-source privacy remain unchanged.

The invite-only deployment at https://monkeycode.pages.dev uses Cloudflare Pages and Supabase Free rather than paid Render/SQLite hosting. Free tiers have limits, inactivity pauses and no promised production SLA. Existing SQLite usage was imported without resetting current provider reservations. See `README.md` for secure configuration, cutover, verification and rollback.

Local migration acceptance includes 72 Node tests, 18 Deno tests, production build, real PostgreSQL invariant checks, authored Python/Java wrapper execution and the actual local Supabase gateway/Edge runtime. Browser checks with a controlled executor verified live feedback, private categories, diagnostic redaction, draft isolation and reload recovery without replacement POST. Hosted acceptance on November 4, 2026 additionally verified authentication/origin boundaries, desktop rendering, exact final-character completion, one real Python public Run and same-ID GET recovery after reload without resubmission. This does not establish hosted Java/private Submit coverage or a production availability guarantee.

## Brand Commitments
An intentionally close, independently implemented reproduction of Monkeytype's flat, distraction-free interface, adapted to multiline code transcription. Default serika dark charcoal/yellow, locally bundled Roboto Mono and Lexend Deca, compact controls, a three-line typing viewport, fading chrome and flat sampled results replace the earlier visual direction. Desktop physical keyboards remain the primary input; narrow layouts adapt without adding a separate mobile typing product.

Reference: [live Monkeytype](https://monkeytype.com) and [public source at revision 5478cd701df9e6a7d4611004ec84bef8999b3aaa](https://github.com/monkeytypegame/monkeytype/tree/5478cd701df9e6a7d4611004ec84bef8999b3aaa). No upstream GPL code or assets were copied; icons, wordmark and React engine are independent. No affiliation with Monkeytype.

## Open Decisions
No promise of all LeetCode problems, unlimited generated variety, verified difficulty labels or algorithm correctness. Corpus coverage is explicit; repeated recipe shapes are expected. Length thresholds (short ≤350, standard 351–900, long >900 scored graphemes) are editorial defaults, not research-validated typing difficulty. Final-unit matching is lexical, not a Python/Java parser. Method excerpts are not executable standalone programs.
