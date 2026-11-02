# Monkeycode

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Implemented: React, TypeScript, Vite and plain CSS; a static browser application. The React transcription engine remains independent of Monkeytype's implementation. Fonts are bundled locally.

## Users and Purpose
Desktop physical-keyboard users practicing code transcription speed and accuracy, not solving or executing code.

## Capabilities and Constraints
Python and Java. Deterministic local generation uses eight finite structured algorithm families, not AI or Markov generation. The MIT-attributed curated collection contains eight problems and 32 language/scope variants, with method/full scope and scored-length filters. Private custom paste is limited to 30,000 characters and is never persisted as source, uploaded or executed.

Sessions are completion-based: errors advance freely and Backspace corrects them. Automatic leading indentation is unscored; internal spaces and newlines are typed. Completion requires an exact final lexical unit; earlier errors may remain. Grapheme-based scoring distinguishes current errors from cumulative insertion attempts. Timing never pauses on blur. Results show actual sampled WPM/raw-WPM history, accuracy, character counts and elapsed time, without a fabricated consistency score.

Preferences use localStorage and completed history uses IndexedDB. Custom history retains title/result metadata, not source; generated and curated history retains source. No accounts, backend, cross-device synchronization, hosted AI or code execution. Command line, settings, themes, local history, custom import, source, typed-code review and about are implemented dialogs. Escape opens the command line; Tab then Enter restarts, with Ctrl/Cmd+Enter available from the typing input.

The first practice-first solving exercise is authored separately from the current typing UI: public contracts in `src/learning/`, private grading/teaching material in `server/learning/`, and a maintainer-only Python/Java execution checker. It uses supplied method harnesses, separates correctness from approach evidence, and provides optional-support metadata without lesson gates or enforced waits. There is no learner-facing solving screen, persistent learning state, execution endpoint, or sandbox yet. Existing transcription behavior and custom-source privacy remain unchanged.

## Brand Commitments
An intentionally close, independently implemented reproduction of Monkeytype's flat, distraction-free interface, adapted to multiline code transcription. Default serika dark charcoal/yellow, locally bundled Roboto Mono and Lexend Deca, compact controls, a three-line typing viewport, fading chrome and flat sampled results replace the earlier visual direction. Desktop physical keyboards remain the primary input; narrow layouts adapt without adding a separate mobile typing product.

Reference: [live Monkeytype](https://monkeytype.com) and [public source at revision 5478cd701df9e6a7d4611004ec84bef8999b3aaa](https://github.com/monkeytypegame/monkeytype/tree/5478cd701df9e6a7d4611004ec84bef8999b3aaa). No upstream GPL code or assets were copied; icons, wordmark and React engine are independent. No affiliation with Monkeytype.

## Open Decisions
No promise of all LeetCode problems, unlimited generated variety, verified difficulty labels or algorithm correctness. Corpus coverage is explicit; repeated recipe shapes are expected. Length thresholds (short ≤350, standard 351–900, long >900 scored graphemes) are editorial defaults, not research-validated typing difficulty. Final-unit matching is lexical, not a Python/Java parser. Method excerpts are not executable standalone programs.
