# T024: getting-started chooser, recorded transcripts, how-it-works

Package T024 of `docs/goals/yuku-tsrx-docs-site/`, built to
`notes/T022-guide-interactivity-spec.md` sections 3.6, 3.7, 3.8 and 4.

## Deployment

- Production: <https://yuku-tsrx-docs.vercel.app>
- Deployment: `yuku-tsrx-docs-lzxihkg9l-jack-shelton.vercel.app`
  (an earlier one, `yuku-tsrx-docs-5ifb4qptm-jack-shelton.vercel.app`, carried
  the same pages from the first transcript capture; the second capture reran
  every command, so the site was rebuilt and redeployed from it)
- `node docs/verify-playground.mjs --url https://yuku-tsrx-docs.vercel.app`
  passes with zero console errors, page errors and failed requests.

## What was captured, and what was dropped

`tools/capture-transcripts.mjs` (script `docs:transcripts`) runs each demo's
commands from the repository root with `NO_COLOR=1 FORCE_COLOR=0 CI=1
TERM=dumb`, strips any escape sequence that survives that, trims output to a
head of 15 and a tail of 15 lines around a `... N lines omitted ...` marker, and
writes one file per demo into `docs/transcripts/`.

Captured 2026-08-17 on Darwin 25.5.0 arm64 (Apple M5 Pro), Node v24.15.0,
Zig 0.16.0.

`getting-started-build.json`

| Command | Exit | Published |
| --- | --- | --- |
| `zig build` | 0 | yes, no output on success |
| `ls zig-out/npm/yuku-tsrx` | 0 | yes, 9 entries |
| `zig build test --summary all` | 0 | yes, `7/7 steps succeeded; 2/2 tests passed` |
| `pnpm test` | 1 | **dropped** |

`getting-started-wasm.json`

| Command | Exit | Published |
| --- | --- | --- |
| `zig build wasm -Doptimize=ReleaseSmall` | 0 | yes, no output on success |
| `node tools/wasm-smoke.mjs` | 0 | yes, 7 lines ending in `ok` |

Nothing was trimmed in the end: every published command's output is under the
30-line threshold, so no `omitted_lines` is non-zero in either file. The trim
path is still there and still exercised by the renderer, which prints the marker
as a comment line rather than as output.

### The drop

`pnpm test` exited 1 after 64 seconds: 2 of 57 tests failed, both in
`test/m1.test.ts` through `tools/m1-control.ts`, with `13 passed` test files
against `2 failed`. Those two assert things about the build environment, not
about the parser, the analyzer or the code generator. The rule the tool enforces
is that a command that did not exit zero is removed from the demo rather than
edited, so `pnpm test` is not in the published transcript and its output was not
touched. `getting-started.md` says so in prose directly under the figure, so a
reader is not left to notice the gap on their own. The JSON keeps the drop in a
`dropped` array with the exit code and the duration.

The build refuses to render a transcript whose file is missing, whose
`captured_at` does not parse, or that carries an entry with a non-zero
`exit_code`. A failing transcript cannot reach the site through the build any
more than it can through the capture tool.

## What shipped

- `tools/capture-transcripts.mjs`, `package.json` script `docs:transcripts`,
  `docs/transcripts/getting-started-build.json` and `getting-started-wasm.json`.
- `docs/build.mjs`: `loadTranscript`, `transcriptOutputHtml`,
  `terminalDemoHtml`, `terminalDemoMarkdown` for
  `<!-- terminal-demo:NAME -->`; `chooserHtml` for `<!-- chooser -->`;
  `readHooks`, `howItWorksSteps`, `howItWorksHtml`, `howItWorksMarkdown` for
  `<!-- how-it-works -->`. `readHooks` parses
  `src/dialect/parser_extension.zig` for `^pub fn ([a-z_]+)\(` and throws
  unless there are exactly 20, and throws again if a name has no area in
  `HOOK_AREAS`. Areas came out 2 Statement, 2 Expression, 3 Pattern, 2
  Function, 1 For-of, 1 Module, 7 JSX, 2 Text, which is the split section 3.10
  of the spec predicts.
- `docs/assets/interactive.js`: `initChoosers` and `initMatrixFilters` only.
  The review-route and editor-replay components of the oxc-tsrx original were
  dropped, since neither has anything to drive here. `initMatrixFilters` is
  ported now so T025 has it; nothing on the site uses it yet.
- `docs/assets/app.js`: the lazy `./interactive.js` import restored in
  `initPage()`, guarded by `[data-chooser], [data-matrix-filter]`.
- `docs/assets/style.css`: a `.hiw-yuku` box, the five yuku step ids wired into
  the existing `.how-it-works[data-step]` rules, `.hiw-panel` visibility, and
  chip styling for the hook names and node types. All of it inside the existing
  `#css-pages: doc` region. Nothing keys on JavaScript having run: without it
  the figure carries no `data-step`, so all five explanations and all five
  panels are on the page in order, which is the numbered list the Markdown twin
  prints.
- `docs/guide/getting-started.md`: a "Which route are you on" section after
  "What you need" with the three-row chooser table, the wasm transcript under
  it, and the build transcript under "Build".
- `docs/guide/introduction.md`: `<!-- how-it-works -->` at the end of "A dialect
  on Yuku, not a fork".
- `docs/verify-playground.mjs`: the T024 section.

## Chooser answers, and what makes each one checkable

| Route | Claim | Where it is checked |
| --- | --- | --- |
| Consume it from Node | `zig build` writes `zig-out/npm/yuku-tsrx/` | the `ls` entry in the published transcript |
| Consume it from Node | `link:../yuku-tsrx/zig-out/npm/yuku-tsrx` and `import { parseModule }` | the fences already on the same page |
| Run it in a browser | `pnpm run docs:wasm` is `zig build wasm -Doptimize=ReleaseSmall` | `package.json` scripts |
| Run it in a browser | it writes `zig-out/wasm/yuku-tsrx.wasm` | `tools/wasm-smoke.mjs` resolves exactly that path |
| Run it in a browser | `docs/assets/yuku-wasm.js` is the browser host | the file exists and the playground imports it |
| Hack on the dialect | `parser_extension.zig`, `schema.zig`, `transfer.zig` | all three are in `src/dialect/` |
| Hack on the dialect | `zig build test` and `pnpm test` | `build.zig` test step and the `test` script |

No answer states anything that is not in `package.json`, `tools/`,
`docs/assets/` or `src/dialect/`.

## Verifier section

`docs/verify-playground.mjs` gained, under the existing T023 block:

- `/guide/introduction`: the figure is present, has exactly 5
  `[data-hiw-step]` buttons, clicking the second sets `data-step="hooks"`,
  exactly one `.hiw-panel` is visible as the browser computes visibility
  (`offsetParent !== null`, so the CSS is what is being tested rather than the
  markup), and the hooks panel holds exactly 20 `code` chips.
- `/guide/getting-started`: 3 chooser options, clicking the second leaves only
  `[data-chooser-panel="1"]` unhidden, 2 `[data-terminal-demo]` figures, Play on
  the build transcript reveals every `.gs-terminal-line` and finishes, the
  played text contains `zig build` and `# exit 0`, and every command and every
  output line of `docs/transcripts/getting-started-build.json` is present in it
  with the committed caption verbatim. That last check is what makes the figure
  a transcript rather than an illustration.

One production-only failure showed up and was fixed rather than worked around:
`interactive.js` is a dynamic import, so on a real network the chooser chips
exist in the HTML before anything listens to them, and a click that arrived
first did nothing. The verifier now waits for `[data-chooser][data-ready]`,
which `initChoosers` sets, before clicking.

## Screenshots

- `T024-getting-started.png`: the chooser on "Run it in a browser" and the wasm
  transcript mid-play, with the dated caption under it.
- `T024-how-it-works.png`: the introduction figure on step 2, showing the 20
  hook chips grouped by area.

## Green at hand-off

```
pnpm run docs:transcripts                 2 files, every entry exit 0
pnpm run docs:wasm && wasm-smoke --fences 20 fences checked, ok
pnpm run docs:build                       14 pages
node docs/verify-playground.mjs           ok, 0 console errors
node docs/verify-playground.mjs --url ...  ok, 0 console errors
git status --porcelain src build.zig npm test README.md   empty
```
