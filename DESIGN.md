---
name: monkeycode
description: Independently reproduced Monkeytype-style code transcription workspace.
colors:
  background: "#323437"
  main: "#e2b714"
  sub: "#646669"
  sub-alt: "#2c2e31"
  text: "#d1d0c5"
  error: "#ca4754"
  backdrop: "#0008"
  light-background: "#e1e1e3"
  high-contrast-background: "#181818"
typography:
  wordmark:
    fontFamily: '"Lexend Deca", sans-serif'
    fontSize: "32px"
    fontWeight: 400
    lineHeight: "36px"
    letterSpacing: "-1.5px"
  body:
    fontFamily: '"Roboto Mono", monospace'
    fontWeight: 400
    lineHeight: 1.25
    fontSize: "16px"
  code:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.5
  metric:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "64px"
    fontWeight: 400
    lineHeight: "80px"
  compact:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "12px"
  micro:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "10px"
  tagline:
    fontFamily: '"Lexend Deca", sans-serif'
    fontSize: "10.08px"
  dialog:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "14px"
  dialog-heading:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "24px"
  compact-dialog-heading:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "20px"
  compact-wordmark:
    fontFamily: '"Lexend Deca", sans-serif'
    fontSize: "28px"
  mobile-wordmark:
    fontFamily: '"Lexend Deca", sans-serif'
    fontSize: "25px"
  compact-secondary-metric:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "26px"
  mobile-primary-metric:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "48px"
  mobile-progress:
    fontFamily: '"Roboto Mono", monospace'
    fontSize: "18px"
rounded:
  control: "8px"
  dialog: "16px"
  command: "4px"
  caret: "2px"
spacing:
  small: "8px"
  medium: "16px"
  dialog-padding: "24px"
  page-padding: "32px"
components:
  button-solid:
    backgroundColor: "{colors.sub-alt}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "12px"
    width: "100%"
  button-solid-hover:
    backgroundColor: "{colors.text}"
    textColor: "{colors.background}"
  button-ghost:
    textColor: "{colors.sub}"
    rounded: "{rounded.control}"
    padding: "8px"
  config-group:
    backgroundColor: "{colors.sub-alt}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  dialog:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "24px"
    width: "600px"
---

# Design System: monkeycode

## Overview

The implemented visual reference is [live Monkeytype](https://monkeytype.com), with [public source pinned to revision 5478cd701df9e6a7d4611004ec84bef8999b3aaa](https://github.com/monkeytypegame/monkeytype/tree/5478cd701df9e6a7d4611004ec84bef8999b3aaa). This is an intentionally close independent reproduction of its flat layout and interaction style, adapted to Python and Java transcription. No upstream GPL code or assets were copied; Monkeycode retains its own React engine, icons and wordmark. It is not affiliated with Monkeytype.

The practice surface is **Operate**: configure, type, review and repeat. The code sits directly on the page, with quiet surrounding controls rather than a hero or boxed workspace. Secondary tasks occupy dialogs.

**Key Characteristics:**
- Charcoal and warm gray with restrained yellow emphasis.
- Monospaced controls, code and results; a rounded sans-serif wordmark.
- Three-line code viewport, custom caret and fading chrome during active typing.
- Flat result hierarchy with a chart of actual speed samples.

## Colors

### Primary

`main` is serika yellow: selected configuration text, caret, progress and result values. It is not a universal filled-button background. Settings option selection does use main fill with background-colored text.

### Secondary

`error` marks wrong positions and final-token warnings. Wrong positions are also underlined, so color is not the sole cue.

### Neutral

`background` is the page and dialog surface. `sub-alt` provides compact configuration tracks, form fills and quiet actions. `sub` carries pending code, automatic indentation and secondary labels; `text` carries correct code and primary text. Default tokens above describe **serika dark**.

The implemented **serika** light theme uses background (#e1e1e3), main (#e2b714), sub (#aaaeb3), alternate (#d1d3d8), text (#323437) and error (#ca4754). **High contrast** uses background (#181818), main (#ffda45), sub (#a4a4a4), alternate (#242424), text (#f5f5f5) and error (#ff8a94). `src/appearance.ts` owns theme values.

## Typography

Roboto Mono 400 is locally bundled for the body, controls, code, charts and metrics. Lexend Deca 400 is locally bundled for the wordmark. Both use SIL OFL; no font CDN request is needed.

Code defaults to (32px) with (48px) line height; settings allow (24px), (28px) or (32px). The selected code size remains unchanged at every viewport width; long lines scroll inside the code viewport instead of shrinking or wrapping. Whitespace is preserved and ligatures are disabled. Configuration and footer text remain (12px). The wordmark uses the frontmatter role, reducing to (28px), then (25px). Main WPM/accuracy values are (64px); secondary result values are (32px), with narrower-screen reductions. Dialog headings are (24px), body text (14px).

## Layout

The page is a three-row grid: an intrinsically sized header, a flexible practice/results area, and footer. The shared shell fills available width continuously up to (1536px), with fluid horizontal gutters from (16px) to (48px). Vertical page padding and row gaps adapt to viewport height rather than imposing a fixed-height practice row. On short screens, the page scrolls vertically instead of overlapping or clipping its content.

Configuration groups have a minimum height of (39px) and wrap when their actual contents require it. Configuration and the optional method/full scope row occupy normal document flow; the practice surface centers in the remaining main-area space with a minimum breathing gap. The typing viewport is `font-size × 4.5 + 9px` tall: (153px) at the default size, showing three lines with breathing room. Code does not soft-wrap; internal horizontal and vertical scrolling preserve indentation and keep the current character visible. Caret geometry derives from the rendered line and font metrics and updates on typing, font-size settings, container resizing and font loading. There are no line numbers, syntax-colored tokens or enclosing workspace border.

At (720px) and below, mode choices take their own row, progress sits in a reserved row beneath the snippet label, and results put the chart below the main metrics. At (480px) and below, header navigation takes a separate row while the command control remains available beside the wordmark; the main result metrics stack. Footer controls and long result values wrap without expanding the page. The body minimum width is (320px). Dialogs are normally (600px) wide, or (900px) for history, source and review, constrained by (16px) side margins. Their top/bottom clearance scales with viewport height, and the dialog itself scrolls even on short screens; history, reference and review code retain internal scrolling.

## Elevation & Depth

There are no box shadows or decorative gradients. Configuration tracks and fields use tonal contrast, while native modal dialogs use a translucent black backdrop (#0008). Controls transition color, background and opacity over (125ms); active chrome fades without changing layout. Smooth caret movement uses (100ms) left/top transitions and is optional. Reduced-motion preferences disable animations and transitions.

## Shapes

Controls and configuration groups use softly rounded corners (8px); dialogs use (16px). Command rows use (4px), the thin custom caret (2px). The code surface is unboxed and visually continuous with the page. Avoid adding a card silhouette around it.

## Components

### Controls and navigation

Ghost/icon buttons are muted at rest and brighten on hover. Standard icon targets are (36px) square. Solid import actions use alternate background and text color, inverting to text/background on hover. Selected configuration choices use yellow text without a separate selected pill. Visible keyboard outlines are (2px) main-colored, offset (4px) for buttons/links and (3px) for fields. Disabled controls use (0.35) opacity. Navigation uses independently drawn inline icons with accessible names; no unsupported account or social destinations are advertised.

### Typing states

Pending code and automatic indentation are muted; correct text becomes primary text. Incorrect positions use error color plus a (2px) underline with (5px) offset. Newline markers make manual line breaks visible. The custom caret marks the next position and blinks while idle. On focus loss the code is blurred (4px) and faded to (0.25) opacity under a focus prompt. During active typing, header navigation, configuration, label, restart and footer fade away without shifting code. A wrong final lexical unit shows an explicit Backspace correction warning; earlier errors do not prevent completion.

### Results

Large WPM and accuracy sit beside an SVG chart of recorded correct/raw speed samples. Dashed raw speed and error crosses have descriptions; crosses mean remaining incorrect positions at a sample, not fresh mistakes. Secondary rows show actual test type, raw WPM, correct/errors/attempts and time. No consistency score is fabricated. Icon actions provide next, repeat, typed-code review and source.

### Dialogs and fields

Native accessible dialogs host searchable command line, settings, themes, local history, custom import, source/reference, typed-code review and about. Import fields use alternate background, text color and main-colored caret. Command rows invert to text/background on hover or focus. History is a flat scrollable table, not a collection of cards. Empty custom/filter states offer direct recovery actions; notices use status messaging.

### Solve workspace

Solve is an Operate surface: the problem and public examples occupy the smaller desktop column; a larger, unboxed implementation editor occupies the other. A single vertical rule separates the tasks without introducing cards. At 960px and below, the columns stack and the divider becomes horizontal. Long code scrolls within the editor, never across the page.

Use native details/summary disclosures for constraints, example explanations, editor help, practice options, execution access and local attempts. Keep the initial view focused on reading and editing. Run examples is the primary practice action; Submit is secondary. Costs and the upload/retention warning remain visible. Execution errors, uncertain admissions, pending-job recovery, storage failures and results stay in the normal visible flow.

Retain the established theme and 12/14/16/24px type steps. Secondary Solve copy blends 78% foreground with the page background rather than using the lower-contrast typing-placeholder color. This hierarchy follows [NN/g's progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/) and [VS Code's separation of editor, contextual actions and supporting output](https://code.visualstudio.com/api/ux-guidelines/overview); it does not copy their implementation.

### Keyboard interaction

Escape opens the command line when no dialog is open; Escape closes an open dialog. Command search supports arrows and Enter. Tab then Enter restarts through the focused restart control; Ctrl/Cmd+Enter restarts from the typing input. Tab otherwise remains normal control navigation. Leading indentation is automatic; internal spaces and Enter/newlines remain manual. Timing does not pause when focus leaves.

## Do's and Don'ts

### Do:
- **Do** use the implemented theme roles and locally bundled fonts.
- **Do** preserve underlined errors, visible keyboard focus and accessible dialog controls.
- **Do** keep code unwrapped, horizontally scrollable and directly on the page.
- **Do** display real result samples and respect reduced-motion preferences.

### Don't:
- **Don't** reintroduce the rejected hero, card-based workspace or line numbers.
- **Don't** add gradients, shadows or remote font dependencies.
- **Don't** invent metrics, corpus coverage or unsupported navigation destinations.
- **Don't** copy upstream GPL implementation or assets to reproduce the reference.
