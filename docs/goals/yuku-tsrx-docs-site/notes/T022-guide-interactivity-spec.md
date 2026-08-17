# T022 Judge spec: guide-page interactivity and the home benchmark reframe

Owner's words: "I still don't see many of the interactive components I see in
the oxc-tsrx docs, for example the interactive walkthrough, running the CLI,
etc. Not saying you have to copy it, but we want something that makes sense for
yuku-tsrx. Add what makes sense. And make sure the most eye catching benchmarks
are what is on the homepage."

Read for this decision: oxc-tsrx docs/build.mjs (terminalDemoHtml ~830-897,
matrixFilterHtml ~899-950, chooserHtml ~1132-1190, howItWorksHtml ~1747-1800,
the terminal-demo:NAME loader ~1993-2450), oxc docs/assets/interactive.js,
oxc docs/generate-transcripts.mjs and terminal-transcripts.json, oxc
guide/introduction.md, guide/getting-started.md, reference/cli.md markers;
yuku-tsrx docs/build.mjs, docs/assets/{app.js,yuku-wasm.js,yuku-playground.js,
style.css}, docs/verify-playground.mjs, tools/wasm-smoke.mjs,
npm/yuku-tsrx/decode-analyzer.js, src/dialect/{parser_extension,abi}.zig,
benchmarks/m6-baseline.json, docs/guide/*.md, docs/reference/benchmarks.md,
docs/architecture/yuku-dialect.md, the T012 spec, T015 package, T019 audit.

## 0. Facts that shape every decision

- Engine in the browser: `docs/assets/yuku-wasm.js` exports `parse`, `analyze`,
  `generate`, `ready`, `symbolFlags`. `analyze()` returns the full analyzer
  view: `reference.start/end/symbolId/isWrite`, `symbol.declNode(i, j)` (a node
  with `start`/`end`), `symbol.flags/scopeId/declCount`, `scope.kind/parentId/
  start/end`, plus import/export tables. Everything the symbol explorer and the
  scope tree need already exists; nothing has to be added under `src/` or
  `npm/`.
- `generate()` in the wasm host packs `strip`, `minify` (bit 1, the syntax
  mode), `format` (`compact` bit), `quotes` from `['preserve','double','single']`
  only, `comments` from `['none','all','some','line','block']`, `indent` 0..255.
  `quotes: "shortest"` cannot even be requested through the host, which is the
  same limitation the codegen guide already states. It is shown as a disabled
  option, never hidden.
- The stylesheet was copied verbatim from oxc-tsrx, so `.gs-terminal*`,
  `.hiw-steps/.hiw-strip/.hiw-text`, `.chooser*`, `.matrix-chips/.matrix-badge`,
  `.explorer*`, `.projection-map-panes/.projection-map-code`, `.gate-grid/
  .gate-card/.gate-value/.gate-label/.gate-budget` all exist. `app.js` already
  carries `initHowItWorks`, `initTerminalDemos`, `initProjectionMaps` and the
  delegated `[data-explorer]` tab handler; the lazy `interactive.js` import
  (chooser, matrix filter) was dropped in the port and `docs/assets/
  interactive.js` does not exist. It has to come back for the chooser and the
  matrix.
- CSS shells: the doc shell (guide pages) does NOT receive the `code-panel`,
  `demo-*`, `pg-panes`, `pg-plain`, `pg-structure-table`, `pg-note` regions
  (they open as `#css-pages: home playground`). Guide-page components must
  either use doc-shell classes (`.explorer`, `.projection-map-*`, `.matrix-chips
  button`, `.code-block`, `.table-wrap table`) or the Worker adds `doc` to the
  specific region opener it needs. Do not build guide components on `.pg-*`
  without doing that; the page would render unstyled.
- `.how-it-works` CSS keys the visible step text on hard-coded ids `scan/
  project/lint/map` (`style.css` ~1336-1350). A yuku step-through with its own
  ids needs the equivalent selectors added in that region (or the JS in
  `initHowItWorks` toggles `hidden` on the non-selected `.hiw-text`).
- `parser_extension.zig` declares exactly 20 top-level `pub fn <snake_case>(`
  hooks (lines 929-1027). `abi.zig`'s `Hook` enum has 19 (no
  `jsx_fragment_after_open`). The matrix reads the 20 `pub fn` declarations,
  which is what `docs/architecture/yuku-dialect.md` already lists; it must not
  read the enum.
- `benchmarks/m6-baseline.json`: `valid: true`; `statistics.{yuku,core}.
  {ns_per_parse,parses_per_second,bytes_per_second,peak_rss_bytes}.median`,
  `ratios.{ns_per_parse,peak_rss}`, `provenance.runtime.cpu = "Apple M5 Pro"`,
  `input.file_count = 224`, `input.bytes = 214751`. There is no run date in
  the file; the caption must not invent one.
- `zig build` and `zig build test` are silent on success. `zig build test
  --summary all` prints the test tree. `pnpm test` is `vp test`, coloured
  output. Transcripts are captured by a tool the Worker runs once, committed as
  JSON, and rendered at build. `docs/build.mjs` never invokes zig.
- The wasm is 1,275,960 bytes (277 KB brotli, T019). Any guide page that
  embeds an engine-backed component now pays that fetch, so the module is
  imported only when a component is present and only when its figure is near
  the viewport (IntersectionObserver, rootMargin 400px, immediate fallback).

## 1. Keep / cut table

| # | Component | Decision | Page and marker | Data source | Reason |
| --- | --- | --- | --- | --- | --- |
| 1 | How-it-works step-through | KEEP, reshaped to 5 steps | `guide/introduction.md`, `<!-- how-it-works -->` after "A dialect on Yuku, not a fork" | Build time: hook names from `parser_extension.zig`, intro snippet via shiki; no engine call | It answers "what does yuku-tsrx actually do" in one figure. Fully static, `initHowItWorks` already ported, zero new JS. |
| 2a | Getting-started chooser | KEEP | `guide/getting-started.md`, `<!-- chooser -->` before a two-column table, new section "Which route are you on" | Static prose, every answer checkable | Three real routes exist (Node via `link:`, wasm in a browser, hack on the dialect). Port `chooserHtml` verbatim, restore `interactive.js`. |
| 2b | Playable terminal transcripts | KEEP | `guide/getting-started.md`, `<!-- terminal-demo:getting-started-build -->` under Build and `<!-- terminal-demo:getting-started-wasm -->` under the chooser | `docs/transcripts/*.json` captured by `tools/capture-transcripts.mjs`, real runs, dated | Owner asked for "running the CLI"; there is no CLI, the build and test commands are the honest equivalent. Never captured at docs build. |
| 3a | AST <-> source explorer | KEEP | `guide/parser.md`, `<!-- ast-explorer -->` before a tsrx fence in "What comes back" | Browser: `parse()` at run time | The parser guide's core claim is "every node has start/end"; hovering proves it. |
| 3b | Inline "run" blocks on parser JS snippets | CUT | | | Those snippets `import` the npm package (`parseModule`, `walk`); the wasm host is a different API. Running something else under them would be a faked run. Try-in-playground already covers tsrx fences. |
| 4 | Symbol explorer + scope tree | KEEP | `guide/analyzer.md`, `<!-- symbol-explorer -->` before a tsrx fence in "Why the analyzer is dialect work" | Browser: `analyze()` at run time | Exactly the TSRX bindings the page talks about (`@{ }` const, `@for` variable, `@catch (error, reset)`) become clickable proof. |
| 5 | Codegen options walkthrough | KEEP | `guide/codegen.md`, `<!-- codegen-walkthrough -->` before a tsrx fence after `GenerateOptions` | Browser: `generate()` at run time | Options are the whole page; toggling them beats a table. `shortest` and `minify: true` are disabled controls with the exact reason, not hidden. |
| 6 | Syntax node-type chips | KEEP | `guide/tsrx-syntax.md`, page-level `<!-- node-chips -->` marker; every tsrx fence gets chips | Build time: wasm instantiated in Node inside `build.mjs`, `decode.js` from `npm/yuku-tsrx` | Static and truthful: the page says which node types each construct produces because the parser was asked at build. Rejected fences get their real diagnostic count instead. |
| 7 | Extension-point matrix | KEEP | `architecture/yuku-dialect.md`, `<!-- hook-matrix -->` before the existing twenty-hook table | Build time: `pub fn` names and callee module from `parser_extension.zig`; area from a `**Area**` column in the table | The table exists and is verified; the build now checks its 20 names against the zig file, adds the implementing file column from the source, and makes it filterable by area. |
| 8 | Benchmarks "measure in your browser" | KEEP, reshaped | `reference/benchmarks.md`, `<!-- bench-live -->` new section "Measure in this tab" | Browser: `parse()` N times | Kept, but NOT side by side with the committed table as if comparable: it measures the wasm ReleaseSmall build on a small sample in a browser, the report measured the native addon in Node on a 224-file corpus. Shown under its own heading with that caveat. |
| 9a | Home benchmark cards reframe | KEEP | `build.mjs` `homeBenchCards()` | Build time from `m6-baseline.json` | Section 2 below. |
| 9b | Home "in this tab" live figure | CUT | | | The hero status already prints "parsed in X ms · N nodes · runs in your browser". A second live figure inside the benchmark section would sit next to native-addon numbers and invite a comparison the data does not support. |

## 2. Home benchmark card spec

Four cards, all computed in `homeBenchCards()` from the parsed JSON, none
hard-coded. Build throws if `baseline.valid !== true` (do not print speed
claims from a run the harness itself rejected). `y` = `statistics.yuku`,
`c` = `statistics.core`.

| Card | Headline value | Formula | Label | `.gate-budget` line |
| --- | --- | --- | --- | --- |
| Speed | `3.47x` | `(c.ns_per_parse.median / y.ns_per_parse.median).toFixed(2) + 'x'` (103,075.4 / 29,666.2 = 3.4745) | `faster median parse than @tsrx/core` | `29,666 ns vs 103,075 ns per parse` (`benchNumber` on both medians) |
| Rate | `33,708 parses/s` | `benchNumber(y.parses_per_second.median)` | `median parses per second` | `@tsrx/core: 9,702 parses/s` |
| Throughput | `32.3 MB/s` | `(y.bytes_per_second.median / 1e6).toFixed(1) + ' MB/s'` (32,316,552 / 1e6) | `source parsed per second` | `@tsrx/core: 9.3 MB/s` (`c.bytes_per_second.median / 1e6`) |
| Memory | `15% less` | `Math.round((1 - ratios.peak_rss) * 100) + '% less'` (1 - 0.8541 = 14.6% rounds to 15%) | `peak memory than @tsrx/core` | `264.7 MB vs 310.0 MB peak RSS` (`peak_rss_bytes.median / 1e6`, `toFixed(1)`) |

Markup: existing `.gate-grid` with `.bench-row.gate-card`, `.gate-value`,
`.gate-label`, plus `.gate-budget` for the comparison line (all present in the
home shell). `.gate-grid` is `repeat(3, 1fr)` / max-width 720px; change to
`repeat(4, 1fr)` and max-width 920px in the same rule (the 2-column fallback
under 720px already exists). `role="img"` + `aria-label` per card as today,
label text `${headline} ${label}, ${budget}`.

Copy: heading stays "Measured, not claimed". Intro paragraph becomes "These
four numbers are computed from `benchmarks/m6-baseline.json` when this page is
built, so they cannot drift from the committed report." Caption becomes "One
measurement on one machine (Apple M5 Pro, a 224-file corpus). Your hardware will
differ." with the CPU and file count read from `provenance.runtime.cpu` and
`input.file_count`. MB means 1,000,000 bytes; say so in the caption or a
`title`. The "See the report and its caveats" link stays.

`docs/reference/benchmarks.md` "Read as a sentence" paragraph gains the same
framing (3.47x, 33,708 vs 9,702, 32.3 vs 9.3 MB/s, 15% less peak memory) so
the home page and the report agree; those are markdown edits, and the numbers
are the ones already in that page's table.

## 3. Component specs

Common rules for every component:
- Marker syntax is an HTML comment on its own line, like the existing
  `<!-- details:… -->`. Build fails loudly on a marker with no following
  fence/table (same as oxc's throw), never silently.
- Each engine-backed figure ships a no-JS fallback: the shiki-highlighted
  fence (or the table) is in the HTML; JS enhances it. If `ready()` rejects,
  the figure shows "in-browser parser unavailable: <message>" and stays a
  read-only listing (same policy as `initDemo`).
- Markdown twin (`.md`, llms-full.txt): the fence/table plus one sentence
  ("On the site this is an interactive figure driven by the parser running in
  your browser."). No pretend output in the twin.
- No em dashes; no oxc-only words (oxlint, oxfmt, lint, format-as-formatter).

### 3.1 New browser module `docs/assets/yuku-explorers.js` (T023, extended in T025)

Exports `init(cleanupCallbacks)`. `app.js initPage()` adds, next to the
hero-demo import: if `document.querySelector('[data-ast-explorer], [data-symbol-explorer], [data-codegen-walkthrough], [data-bench-live]')` then `import('./yuku-explorers.js')` and call `init(pageCleanupCallbacks)`. Inside `init`, each figure registers an IntersectionObserver (rootMargin `400px`); the first figure to enter calls `ready()` from `./yuku-wasm.js`. Idempotent via `data-ready`. All timers/observers pushed to `cleanupCallbacks` (SPA navigation).

Shared helpers inside the module (not exported from yuku-playground.js unless
the Worker prefers to move `quickCode`/`escapeHtml`/`byteToCharIndex` into a
tiny `docs/assets/yuku-shared.js` and import it from both; either is fine):
- `walkNodes(program)` -> flat array `{type,start,end,depth,parentIndex}` by
  recursing into object properties that are nodes or arrays of nodes
  (`type` string + numeric `start`/`end`), skipping `comments`.
- `segmentSource(source, spans)` -> render the source as `<pre class="ex-source"><code>` of `<span class="ex-seg" data-start data-end>` pieces split at every distinct start/end offset (snippets are a few hundred chars; a few hundred spans is fine). Highlight = toggle `.ex-hit` on segments within `[start,end)`.
- Editable mode: an "Edit" button swaps the pre for a plain `<textarea>` with the same text (no overlay editor here); input is debounced 120 ms and re-runs the figure; "Done" returns to the segmented pre. Reset restores the fence text.

New CSS (doc region, small): `.ex-source`, `.ex-seg.ex-hit` (background
`var(--c-brand-soft)`, `box-shadow: inset 0 -2px var(--c-brand)`), `.ex-tree`
nested list rows with `[aria-pressed=true]`, `.ex-ref`/`.ex-decl`/`.ex-unresolved`
underlines, `.ex-controls` (reuse `.matrix-chips button` styling for chip
groups). Nothing else new.

### 3.2 AST <-> source explorer (`<!-- ast-explorer -->`, guide/parser.md)

Build: marker + following ```tsrx fence -> `<figure class="explorer ast-explorer" data-ast-explorer data-source="<escaped fence>">` with `.projection-map-panes`: left pane heading "Source" containing the shiki fence (fallback), right pane heading "AST" containing `<p class="pg-note">` "the parser runs when this figure scrolls into view". Keep the Try in playground button inside the figure (`.try-button` with `data-code`).
Run time: `parse(source, {lang:'tsx', sourceType:'module', semanticErrors:true})`; right pane becomes `<ul class="ex-tree">` rows `<button aria-pressed>` `<code>Type</code> <span class="explorer-span">start:end</span>`, indented by depth (max depth 12, deeper collapsed under a "…" row). Hover/focus a row highlights its segments; hover a segment highlights the innermost node's row (smallest containing span) and scrolls the tree row into view; click pins. Status line under the panes: `parsed in X ms · N nodes · D diagnostics · runs in your browser` (all from the result). Diagnostics, if any, listed under the source pane with `.explorer-diagnostics`.
Sample fence: the introduction Cart snippet or a shorter one with `@{ }`, `@if`, `@for … ; key`, so JSXCodeBlock/JSXIfExpression/JSXForExpression rows appear. Must parse clean (`wasm-smoke --fences` enforces).

### 3.3 Symbol explorer (`<!-- symbol-explorer -->`, guide/analyzer.md)

Build: same figure shape, `data-symbol-explorer`, panes "Source" and "Symbols".
Run time: `analyze(source, {lang:'tsx', sourceType:'module'})`; compute per symbol: name, `flagNames`, `scope.kind(scopeId)`, decl spans `declNode(i, j)` for j < declCount, ref spans where `reference.symbolId(r) === i`. Right pane: `<table>` inside `.table-wrap` (doc styles) with columns Symbol / Flags / Scope / Decls / Refs, rows are `<tr tabindex=0 data-symbol>`; below it `<details open><summary>Scope tree</summary><ul class="ex-tree">` from `scope.parentId`, each row `kind start:end`, hover highlights the scope span. Click a symbol row (or a source segment inside any decl/ref span) -> declaration segments get `.ex-decl`, references `.ex-ref`, row `aria-pressed`. Segments in references with `symbolId === null` carry `.ex-unresolved` with `title="resolves to nothing declared in this file"`. Status: `S scopes · Y symbols · R references · runs in your browser`.
Sample fence must contain a `const` inside `@{ }`, a `@for (const item of items; index i; key item.id)`, and a `@try { … } @catch (error, reset) { … }` so the three bindings the prose names are the ones on screen. Must parse clean.

### 3.4 Codegen options walkthrough (`<!-- codegen-walkthrough -->`, guide/codegen.md)

Build: figure `data-codegen-walkthrough`, panes "Source" (shiki fence) and "Generated". Controls row (`.ex-controls`, chip groups styled like `.matrix-chips button`, `aria-pressed`):
- format: `pretty` | `compact`
- indent: number input 0..8 (disabled when compact)
- quotes: `preserve` | `double` | `single` | `shortest` (disabled, `title="not available: codegen.zig Quotes has preserve, double, single; see the limitation above"`)
- comments: `none` | `all` | `some` | `line` | `block` (default `some`)
- strip: checkbox
- minify syntax: checkbox (packed as the wasm host's `minify` bit); a note "minify: true also sets quotes: shortest, which is why it is not offered here"
Run time: every change calls `generate(source, {lang:'tsx'}, opts)`; output pane shows `<pre class="shiki"><code>` via `quickCode`, an error list from `result.errors` if any, and a line `equivalent call: generate(program, { format: "compact", quotes: "single", comments: "none", strip: true, minify: { syntax: true } })` built from the current state (only non-default keys; `indent` shown when pretty and not 2). Status: `generated in X ms · runs in your browser`.
Sample fence: has a `// comment`, a `/* block */`, a `"double"` and a `'single'` string, an `import type`, a typed parameter, `@{ }` and `@for … ; key`, so every toggle visibly changes the output. Must parse clean; strip must produce a different string (verifier checks).

### 3.5 Home cards: section 2.

### 3.6 How-it-works (`<!-- how-it-works -->`, guide/introduction.md) (T024)

`howItWorksHtml()` in build.mjs renders `<figure class="how-it-works" data-how-it-works>` with `.hiw-steps` buttons (`data-hiw-step`), `.hiw-strip` texts (`data-hiw-text`), and one `.hiw-panel[data-hiw-panel]` per step. Steps and their "who owns it" line:
1. `source` "Your .tsrx": panel = the intro Cart snippet (shiki + tsrx hovers). Yuku owns nothing yet; it is your file.
2. `hooks` "Yuku parses, the dialect answers 20 hooks": panel = 20 hook name chips (`<code>`), grouped by area, read at build from `parser_extension.zig` (`/^pub fn ([a-z_]+)\(/gm`, build throws unless the count is exactly 20). Yuku owns the JS/TS grammar; yuku-tsrx owns only the `handled` answers.
3. `tree` "A TSRX tree, not a lowering": panel = the node-type list from the parser guide's table (JSXCodeBlock, JSXIfExpression, JSXForExpression, JSXSwitchExpression, JSXTryExpression, TSRXExpression, JSXStyleElement, StyleSheet), each linking to `/guide/parser#the-tsrx-node-types-and-why-the-names-are-exact`. Yuku owns the ordinary nodes; yuku-tsrx owns these records (`schema.zig`).
4. `buffer` "One buffer across the boundary": panel = one paragraph + link to `/guide/parser#the-wire-format-underneath` and `src/dialect/transfer.zig` / `semantic_transfer.zig`. No invented field lists.
5. `api` "decode, analyze, generate": panel = the three JS calls (`parse`/`parseModule`, `analyze`, `generate`) with links to their guides, and one line "the same module compiled to WebAssembly is what runs in the playground and in the figures on the guide pages".
CSS: add to the `.how-it-works` region selectors for the new step ids (`[data-step="source"] [data-hiw-text="source"]` … and the matching `.hiw-panel` visibility rules), or have `initHowItWorks` toggle `hidden`; the Worker picks one and both must work without JS (all texts and panels visible). `howItWorksMarkdown` twin: a five-item numbered list with the same sentences.

### 3.7 Chooser (`<!-- chooser -->`, guide/getting-started.md) (T024)

Port `chooserHtml` verbatim. New section "Which route are you on" placed after "What you need", table header cell = the prompt ("What do you want to do with yuku-tsrx?"), rows:
- "Consume it from Node" -> build with `zig build`, then `link:../yuku-tsrx/zig-out/npm/yuku-tsrx` and `import { parseModule } from "yuku-tsrx"`; link to "Use the built package from another project".
- "Run it in a browser" -> `pnpm run docs:wasm` (`zig build wasm -Doptimize=ReleaseSmall`) writes `zig-out/wasm/yuku-tsrx.wasm`; `node tools/wasm-smoke.mjs` proves it in Node; `docs/assets/yuku-wasm.js` is the browser host and the playground is that module. Point at `/playground`.
- "Hack on the dialect" -> the files are `src/dialect/*.zig`, run `zig build test`, then `pnpm test`; the seam is PR #164; link to `/architecture/yuku-dialect` and `/architecture/upstreaming-to-yuku`.
Every claim above is checkable in package.json scripts, tools/, docs/assets, src/dialect. `docs/assets/interactive.js`: copy oxc's file, keep `initChoosers` and `initMatrixFilters` (drop review-route and editor-replay), and restore the lazy import in `app.js initPage()` guarded by `document.querySelector('[data-matrix-filter], [data-chooser]')`.

### 3.8 Terminal transcripts (T024)

`tools/capture-transcripts.mjs` (new; script `docs:transcripts`): runs, from the repo root, with `NO_COLOR=1 FORCE_COLOR=0 CI=1`, each demo's commands in order via `spawnSync(cmd, {shell:false})`, strips ANSI escapes, records `{comment, command, exit_code, duration_ms, output, omitted_lines}`; long output is trimmed to the first 15 and last 15 lines with `omitted_lines` set and a literal line `… N lines omitted …` inserted, which the renderer prints as a `.gs-terminal-comment` line. Writes one file per demo, `docs/transcripts/<name>.json`:
`{ "generated_by": "tools/capture-transcripts.mjs", "captured_at": ISO date, "platform": {os, arch, cpu, node, zig (from \`zig version\`)}, "caption": string, "transcript": [ … ] }`.
Demos:
- `getting-started-build`: `zig build`; `ls zig-out/npm/yuku-tsrx`; `zig build test --summary all`; `pnpm test`.
- `getting-started-wasm`: `zig build wasm -Doptimize=ReleaseSmall`; `node tools/wasm-smoke.mjs`.
Judge call on noise: `zig build` prints nothing on success, so its entry is the command plus `# exit 0` and the `ls` that follows shows the produced package files; `zig build test` is captured with `--summary all` (the flag only adds the summary; the comment line says so); `pnpm test` (`vp test`) is trimmed head/tail with the marker. The tool exits nonzero and writes nothing if any command exits nonzero.
Build: port `terminalDemoHtml`/`terminalDemoMarkdown`/`transcriptOutputHtml` verbatim, loader reads `docs/transcripts/<name>.json` for `<!-- terminal-demo:NAME -->` and throws on a missing file (a missing transcript is a build failure, not a placeholder). Caption rendered from the JSON: `Captured on <captured_at date> by tools/capture-transcripts.mjs on <os> <arch> (<cpu>), Node <node>, Zig <zig>. Every line is what the command printed; long output is trimmed where marked.` Each entry ends with a `.gs-terminal-comment` line `# exit <code>`. `initTerminalDemos` (already in app.js) plays it.

### 3.9 Node-type chips (`<!-- node-chips -->` page marker, guide/tsrx-syntax.md) (T025)

Build-time engine: `docs/build.mjs` gains `bootWasmForBuild()` that instantiates `zig-out/wasm/yuku-tsrx.wasm` (already a hard requirement of the build) with `WebAssembly.Instance` and imports `npm/yuku-tsrx/decode.js`, mirroring `tools/wasm-smoke.mjs` (`packFlags`, `writeSource`, `takePrefixed`). Failure to instantiate is a build failure. For every ```tsrx fence on a page carrying `<!-- node-chips -->`, parse with `lang: 'tsx', sourceType: 'module', semanticErrors: true`, walk the program, and collect the TSRX node types present (`JSXCodeBlock, JSXIfExpression, JSXForExpression, JSXSwitchExpression, JSXTryExpression, TSRXExpression, JSXStyleElement, StyleSheet`, plus `ForOfStatement` when `index` or `key` is set, shown as `ForOfStatement.index` / `.key`). Render under the code block: `<p class="node-chips" aria-label="TSRX node types the parser produced for this example"><span class="node-chip"><code>JSXCodeBlock</code></span>…</p>`; for `no-playground` fences render `<span class="node-chip node-chip-diag">N diagnostics</span>` with the real count and the first message in `title`. New CSS: `.node-chips`, `.node-chip` (doc region; small pill using `--c-brand-soft`). The `.md` twin lists the same names in a one-line italic sentence.

### 3.10 Extension-point matrix (`<!-- hook-matrix -->`, architecture/yuku-dialect.md) (T025)

Author side: the existing table gains a third column `Area` with a bold value from {`Statement`, `Expression`, `JSX`, `Text`, `Pattern`, `Function`, `Module`, `For-of`} (2+2+7+2+3+2+1+1 = 20). Build side: `readHooks()` parses `parser_extension.zig` for the 20 `pub fn` names in order and, per function body, the callee module (`/\b(code_block|control_flow|patterns|modules|jsx|style|text)\.[A-Za-z]+/`; none -> `parser_extension.zig` itself; `jsx_element_after_open` yields `style.zig` + `parser_extension.zig`). Build throws if the table's hook names (first column `code`) are not exactly the 20 zig names. It appends an "Implemented in" column (file names as `<code>`), then applies the generalized `matrixFilterHtml` (chips per area with counts, `data-matrix-chip`, `matrix-badge-<slug>` classes; add the 8 slug colour rules next to the existing `matrix-badge-*` rules). `initMatrixFilters` from `interactive.js` filters rows; the status line reads "Showing N of 20 hooks". `readHooks()` is also what step 2 of how-it-works uses (T024 introduces it; T025 extends).

### 3.11 Measure in this tab (`<!-- bench-live -->`, reference/benchmarks.md) (T025)

New section "Measure in this tab" at the end, before "What this is not": `<figure class="explorer bench-live" data-bench-live>` with a sample chip group (hero snippet from `demo-sources.mjs`, and the seven playground fixtures inlined as JSON like `/playground`), an iterations chip group (100 | 500 | 1000, default 500), a Run button, and a result table: sample bytes, iterations, median ns per parse, p95, parses/s, MB/s (all computed from `performance.now()` deltas around `parse()` calls; warm-up 20 parses discarded). Fixed caption above the results, always visible: "This runs the WebAssembly build of yuku-tsrx (ReleaseSmall) on one small sample in your browser. The report above measured the native Node addon on a 224-file corpus in a fresh child process per sample. The two are not comparable; this figure exists so you can see the parser work, not to reproduce the report." Nothing from the JSON is repeated inside this figure. Status line labels the number `your machine · your browser · <navigator.userAgent brand if available>`.

## 4. Verification (docs/verify-playground.mjs extensions)

The verifier already boots Chrome against `docs/dist` or `--url`, fails on any console/page/request error, and checks home, playground, tsrx-syntax try button, and SPA navigation. Each package adds a labelled section:

T023:
- `/guide/parser`: `[data-ast-explorer]` present; wait for status text `/nodes/`; hover the third `.ex-tree button`; assert `document.querySelectorAll('.ex-seg.ex-hit').length > 0`; hover a `.ex-seg` and assert exactly one `.ex-tree [aria-pressed="true"]`.
- `/guide/analyzer`: `[data-symbol-explorer]`; wait for `/symbols/`; click the row whose first cell is `item` (or the first row); assert `.ex-decl` count >= 1 and `.ex-ref` count >= 1; assert the scope tree has >= 3 rows.
- `/guide/codegen`: `[data-codegen-walkthrough]`; wait for `/generated in/`; capture output text; click `compact`; assert output changed and contains no `\n  ` indentation; click `strip`; assert output changed again; assert the `shortest` chip is `disabled`; assert the "equivalent call" line contains `format: "compact"`.
- Home: `.gate-card` count == 4; first card text matches `/\d\.\d\dx/`.
- Grep gates on dist: `grep -q 'data-ast-explorer' docs/dist/yuku-tsrx/guide/parser.html`, same for analyzer/codegen; `test "$(grep -o 'gate-card' docs/dist/yuku-tsrx/index.html | wc -l | tr -d ' ')" = 4`; `grep -Eq '3\.47x' docs/dist/yuku-tsrx/index.html`; `grep -q '33,708' docs/dist/yuku-tsrx/index.html`; `! grep -q '0.2878' docs/dist/yuku-tsrx/index.html`.

T024:
- `/guide/introduction`: `[data-how-it-works]` present, 5 `[data-hiw-step]`; click the second; assert `figure.dataset.step === 'hooks'` and exactly one visible `.hiw-panel`; the hooks panel has 20 `code` chips.
- `/guide/getting-started`: `[data-chooser]` present with 3 options; click the second; assert only `[data-chooser-panel="1"]` is not hidden; two `[data-terminal-demo]` figures; click the first Play; wait; assert every `.gs-terminal-line` visible and the transcript contains `zig build` and `# exit 0`.
- Grep gates: `grep -c 'data-hiw-step' docs/dist/yuku-tsrx/guide/introduction.html` >= 5; `grep -q 'data-chooser' docs/dist/yuku-tsrx/guide/getting-started.html`; `test "$(grep -o 'data-terminal-demo' docs/dist/yuku-tsrx/guide/getting-started.html | wc -l | tr -d ' ')" -ge 2`; `grep -q 'Captured on 2026-' docs/dist/yuku-tsrx/guide/getting-started.html`; `node -e` check that every `docs/transcripts/*.json` has `exit_code === 0` for every entry and a `captured_at` that parses.

T025:
- `/guide/tsrx-syntax`: `.node-chips` count >= 10; the chips under the first fence include `JSXCodeBlock`; a `no-playground` fence has a `.node-chip-diag`.
- `/architecture/yuku-dialect`: `[data-matrix-filter]` with 20 `tr[data-classification]`; click the `JSX` chip; assert 7 visible rows and status text `Showing 7 of 20 hooks`; every row has an "Implemented in" cell ending in `.zig`.
- `/reference/benchmarks`: `[data-bench-live]`; click Run; wait for the result table; assert median cell matches `/^\d/` and the caveat paragraph containing `not comparable` is visible.
- Grep gates: `test "$(grep -o 'node-chip' docs/dist/yuku-tsrx/guide/tsrx-syntax.html | wc -l | tr -d ' ')" -ge 10`; `test "$(grep -o 'data-classification=' docs/dist/yuku-tsrx/architecture/yuku-dialect.html | wc -l | tr -d ' ')" = 20`; `grep -q 'data-bench-live' docs/dist/yuku-tsrx/reference/benchmarks.html`.

Every package: `pnpm run docs:wasm && node tools/wasm-smoke.mjs --fences` (new fences must parse clean), `pnpm run docs:build`, `node docs/verify-playground.mjs`, em-dash sweep (`! grep -rIl -e '—' docs --exclude-dir=goals --exclude-dir=node_modules --exclude-dir=dist`), forbidden words (`! grep -rniE 'oxlint|oxfmt' docs/dist/yuku-tsrx/guide docs/dist/yuku-tsrx/reference docs/dist/yuku-tsrx/architecture docs/dist/yuku-tsrx/index.html`), product-file guard (`test -z "$(git status --porcelain -- src build.zig npm test README.md)"`), redeploy (`vercel link --cwd docs/dist --project yuku-tsrx-docs --scope jack-shelton --yes && vercel deploy --cwd docs/dist --prod --yes --scope jack-shelton`), then `node docs/verify-playground.mjs --url https://yuku-tsrx-docs.vercel.app`.

## 5. Ordered Worker packages

Order by owner value: the engine-backed figures and the home cards first (that is what the owner sees missing), then the getting-started story, then the build-time truth widgets. Each is one vertical slice with its own verifier section; none needs `src/`, `build.zig`, `npm/`, or `test/`.

### T023 Worker: home bench reframe + codegen walkthrough + symbol explorer + AST/source explorer
objective: Reframe the home benchmark cards to four build-time-computed cards (3.47x faster, 33,708 parses/s, 32.3 MB/s, 15% less peak memory, each with its @tsrx/core comparison line, section copy and caption per notes/T022 section 2, build throws if valid is not true, gate-grid to 4 columns); add docs/assets/yuku-explorers.js (lazy, viewport-gated import from app.js) and the three guide figures per notes/T022 sections 3.1-3.4: `<!-- ast-explorer -->` on guide/parser.md, `<!-- symbol-explorer -->` on guide/analyzer.md, `<!-- codegen-walkthrough -->` on guide/codegen.md, each with a shiki no-JS fallback, edit mode, honest unavailable state, and the small `.ex-*` CSS in the doc region; extend docs/verify-playground.mjs with the T023 checks; rebuild, verify, redeploy, and screenshot the three figures and the home cards for PM review.
allowed_files:
- docs/build.mjs
- docs/assets/app.js
- docs/assets/yuku-explorers.js
- docs/assets/yuku-shared.js
- docs/assets/yuku-playground.js
- docs/assets/style.css
- docs/guide/parser.md
- docs/guide/analyzer.md
- docs/guide/codegen.md
- docs/reference/benchmarks.md
- docs/index.md
- docs/verify-playground.mjs
- docs/dist/**
- docs/goals/yuku-tsrx-docs-site/notes/T023-*.md
- docs/goals/yuku-tsrx-docs-site/notes/T023-*.png
verify:
- pnpm run docs:wasm && node tools/wasm-smoke.mjs --fences
- pnpm run docs:build
- grep -q 'data-ast-explorer' docs/dist/yuku-tsrx/guide/parser.html && grep -q 'data-symbol-explorer' docs/dist/yuku-tsrx/guide/analyzer.html && grep -q 'data-codegen-walkthrough' docs/dist/yuku-tsrx/guide/codegen.html
- test "$(grep -o 'gate-card' docs/dist/yuku-tsrx/index.html | wc -l | tr -d ' ')" = 4 && grep -Eq '3\.47x' docs/dist/yuku-tsrx/index.html && grep -q '33,708' docs/dist/yuku-tsrx/index.html && ! grep -q '0.2878' docs/dist/yuku-tsrx/index.html
- grep -q 'yuku-explorers.js' docs/dist/yuku-tsrx/assets/app.js && test -f docs/dist/yuku-tsrx/assets/yuku-explorers.js
- node docs/verify-playground.mjs
- "! grep -rIl -e '—' docs --exclude-dir=goals --exclude-dir=node_modules --exclude-dir=dist"
- "! grep -rniE 'oxlint|oxfmt' docs/dist/yuku-tsrx/guide docs/dist/yuku-tsrx/index.html"
- test -z "$(git status --porcelain -- src build.zig npm test README.md)"
- vercel link --cwd docs/dist --project yuku-tsrx-docs --scope jack-shelton --yes && vercel deploy --cwd docs/dist --prod --yes --scope jack-shelton && node docs/verify-playground.mjs --url https://yuku-tsrx-docs.vercel.app
stop_if:
- Any figure would need pre-computed, hand-written, or approximated engine output.
- The analyzer view lacks a span the symbol explorer needs (it does not; report if found).
- A new sample fence does not parse clean and cannot be rewritten to parse clean.
- Any change is needed under src/, build.zig, npm/, or test/.
- The wasm fails to instantiate in Chrome, or docs/verify-playground.mjs fails twice after fixes.
- Vercel prompts for auth or offers a different project.

### T024 Worker: getting-started chooser + terminal transcript capture + how-it-works
objective: Add tools/capture-transcripts.mjs (script docs:transcripts) that runs the two demos in notes/T022 section 3.8 for real, strips colour, trims head/tail with a labelled marker, and writes docs/transcripts/getting-started-build.json and getting-started-wasm.json with captured_at, platform, exit codes; port terminalDemoHtml/terminalDemoMarkdown into build.mjs reading those files for `<!-- terminal-demo:NAME -->` (missing file is a build error) with the dated caption and `# exit N` lines; port chooserHtml and add docs/assets/interactive.js (initChoosers + initMatrixFilters) with the lazy import restored in app.js; write the "Which route are you on" chooser table and place the two terminal demos on guide/getting-started.md; add howItWorksHtml (five steps, hook chips read from src/dialect/parser_extension.zig with a hard count of 20, per-step panels, no-JS visible) with `<!-- how-it-works -->` on guide/introduction.md and the CSS rules for the new step ids; extend the verifier with the T024 checks; rebuild, verify, redeploy, screenshot.
allowed_files:
- tools/capture-transcripts.mjs
- docs/transcripts/*.json
- package.json
- docs/build.mjs
- docs/assets/app.js
- docs/assets/interactive.js
- docs/assets/style.css
- docs/guide/getting-started.md
- docs/guide/introduction.md
- docs/verify-playground.mjs
- docs/dist/**
- docs/goals/yuku-tsrx-docs-site/notes/T024-*.md
- docs/goals/yuku-tsrx-docs-site/notes/T024-*.png
verify:
- pnpm run docs:transcripts && node -e "for (const f of require('fs').readdirSync('docs/transcripts')) { const j = JSON.parse(require('fs').readFileSync('docs/transcripts/'+f,'utf8')); if (!j.captured_at || Number.isNaN(Date.parse(j.captured_at))) throw new Error(f+': captured_at'); for (const e of j.transcript) if (e.exit_code !== 0) throw new Error(f+': '+e.command+' exit '+e.exit_code) }"
- pnpm run docs:wasm && node tools/wasm-smoke.mjs --fences
- pnpm run docs:build
- test "$(grep -o 'data-hiw-step' docs/dist/yuku-tsrx/guide/introduction.html | wc -l | tr -d ' ')" -ge 5 && grep -q 'data-chooser' docs/dist/yuku-tsrx/guide/getting-started.html && test "$(grep -o 'data-terminal-demo' docs/dist/yuku-tsrx/guide/getting-started.html | wc -l | tr -d ' ')" -ge 2 && grep -q 'Captured on 2026-' docs/dist/yuku-tsrx/guide/getting-started.html
- test -f docs/dist/yuku-tsrx/assets/interactive.js && grep -q 'interactive.js' docs/dist/yuku-tsrx/assets/app.js
- node docs/verify-playground.mjs
- "! grep -rIl -e '—' docs --exclude-dir=goals --exclude-dir=node_modules --exclude-dir=dist"
- "! grep -rniE 'oxlint|oxfmt' docs/dist/yuku-tsrx/guide docs/dist/yuku-tsrx/index.html"
- test -z "$(git status --porcelain -- src build.zig npm test README.md)"
- vercel link --cwd docs/dist --project yuku-tsrx-docs --scope jack-shelton --yes && vercel deploy --cwd docs/dist --prod --yes --scope jack-shelton && node docs/verify-playground.mjs --url https://yuku-tsrx-docs.vercel.app
stop_if:
- Any captured command exits nonzero (fix the environment or drop that command from the demo; never publish a failing or edited transcript).
- The sibling ../yuku-minimal-seam checkout is missing, so zig build cannot run.
- The hook count read from parser_extension.zig is not 20.
- A chooser answer would state something not checkable in package.json, tools/, docs/assets, or src/dialect.
- Any change is needed under src/, build.zig, npm/, or test/.
- Vercel prompts for auth or offers a different project.

### T025 Worker: syntax node-type chips + extension-point matrix + measure-in-this-tab
objective: Add bootWasmForBuild() to docs/build.mjs (Node instantiation of zig-out/wasm/yuku-tsrx.wasm with npm/yuku-tsrx/decode.js, failure is a build failure) and render node-type chips under every tsrx fence on guide/tsrx-syntax.md (page marker `<!-- node-chips -->`, real diagnostic-count chip for no-playground fences); add the `Area` column to the twenty-hook table in architecture/yuku-dialect.md and the `<!-- hook-matrix -->` build step that validates the 20 names against parser_extension.zig, appends the "Implemented in" column from the source, and applies area chips via the generalized matrix filter; add the "Measure in this tab" figure to reference/benchmarks.md per notes/T022 section 3.11 with its non-comparability caveat, driven by yuku-explorers.js; extend the verifier with the T025 checks; rebuild, verify, redeploy, screenshot.
allowed_files:
- docs/build.mjs
- docs/assets/app.js
- docs/assets/interactive.js
- docs/assets/yuku-explorers.js
- docs/assets/yuku-shared.js
- docs/assets/style.css
- docs/guide/tsrx-syntax.md
- docs/architecture/yuku-dialect.md
- docs/reference/benchmarks.md
- docs/verify-playground.mjs
- docs/dist/**
- docs/goals/yuku-tsrx-docs-site/notes/T025-*.md
- docs/goals/yuku-tsrx-docs-site/notes/T025-*.png
verify:
- pnpm run docs:wasm && node tools/wasm-smoke.mjs --fences
- pnpm run docs:build
- test "$(grep -o 'node-chip' docs/dist/yuku-tsrx/guide/tsrx-syntax.html | wc -l | tr -d ' ')" -ge 10 && grep -q 'JSXCodeBlock' docs/dist/yuku-tsrx/guide/tsrx-syntax.html
- test "$(grep -o 'data-classification=' docs/dist/yuku-tsrx/architecture/yuku-dialect.html | wc -l | tr -d ' ')" = 20 && grep -q 'Implemented in' docs/dist/yuku-tsrx/architecture/yuku-dialect.html
- grep -q 'data-bench-live' docs/dist/yuku-tsrx/reference/benchmarks.html && grep -q 'not comparable' docs/dist/yuku-tsrx/reference/benchmarks.html
- node docs/verify-playground.mjs
- "! grep -rIl -e '—' docs --exclude-dir=goals --exclude-dir=node_modules --exclude-dir=dist"
- "! grep -rniE 'oxlint|oxfmt' docs/dist/yuku-tsrx/guide docs/dist/yuku-tsrx/architecture docs/dist/yuku-tsrx/reference docs/dist/yuku-tsrx/index.html"
- test -z "$(git status --porcelain -- src build.zig npm test README.md)"
- vercel link --cwd docs/dist --project yuku-tsrx-docs --scope jack-shelton --yes && vercel deploy --cwd docs/dist --prod --yes --scope jack-shelton && node docs/verify-playground.mjs --url https://yuku-tsrx-docs.vercel.app
stop_if:
- The wasm cannot be instantiated in Node inside build.mjs (report the error; do not fall back to hand-written chips).
- The twenty-hook table and parser_extension.zig disagree on a name (report; do not edit the zig).
- The in-tab benchmark would be presented next to, or in the same table as, the committed numbers.
- Any change is needed under src/, build.zig, npm/, or test/.
- Vercel prompts for auth or offers a different project.

### T026 Judge: audit of the guide interactivity tranche
objective: On the production URL, prove each kept component against notes/T022: home shows four computed cards whose values match a fresh read of benchmarks/m6-baseline.json (3.47x, 33,708, 32.3 MB/s, 15% less) with the one-machine caption; parser AST explorer hover highlights both ways; analyzer symbol click lights declaration and references and the scope tree exists; codegen toggles change real output and `shortest` is a disabled option with the reason; introduction how-it-works has five steps with 20 hook chips read from the zig; getting-started chooser has three routes and both transcripts play, are dated, and every entry is `# exit 0` and matches the committed docs/transcripts JSON; tsrx-syntax chips are present under every fence and name the right node types for at least three constructs; the hook matrix has 20 rows, filters by area, and its "Implemented in" column agrees with parser_extension.zig for a spot check of five hooks; benchmarks "Measure in this tab" runs and carries the non-comparability caveat; no oxlint/oxfmt/linter/formatter claims; no em dashes; docs/verify-playground.mjs --url passes with 0 console errors; page weight recorded (guide page bytes before/after the wasm fetch). Decide pass or name a fix package; then hand to T013/T999.

## 6. Risks and how each package contains them

- Build-time wasm in Node (T025): `WebAssembly.Instance` on a 1.27 MB module and `decode.js` import add well under a second to the build; the failure mode is a thrown build, never a placeholder chip. `docs/build.mjs` continues to never invoke zig.
- Transcript capture (T024): `zig build` and `zig build test` take minutes and need the sibling checkout, so capture is a separate `docs:transcripts` script the Worker runs once; the JSON is committed and rendered at build; a nonzero exit blocks the package rather than shipping. Timings inside outputs will differ per run; that is what "captured on <date>" is for.
- Page weight (T023, T025): parser, analyzer, codegen and benchmarks pages now fetch the wasm; the import is viewport-gated and shares the browser cache with the home page. T026 records the numbers. The T019 note about wasm cache headers becomes relevant now; if the audit shows repeat fetches, a one-line `headers` entry in the generated vercel.json is the fix (PM decision).
- CSS shells: the doc shell lacks the `.pg-*`/`.demo-*` regions; the spec keeps guide figures on doc-shell classes plus a few new `.ex-*`/`.node-chip*` rules. If a Worker reaches for `.pg-*` it must add `doc` to that region opener rather than duplicate rules.
- Honesty edges called out in the specs: `shortest`/`minify: true` disabled with the reason; the in-tab benchmark is never placed beside the report; no home live figure; the how-it-works buffer step links to the source instead of listing fields; the hook matrix reads the zig and fails on drift.
- No product-file changes anywhere; the analyzer decoder already carries every span the explorers need.
