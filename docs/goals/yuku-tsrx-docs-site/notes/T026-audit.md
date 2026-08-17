# T026 Judge audit: guide interactivity tranche on production

Audited: https://yuku-tsrx-docs.vercel.app/yuku-tsrx on 2026-08-17, headless
Chrome via playwright-core at 1440x900, plus fresh reads of
`benchmarks/m6-baseline.json`, `src/dialect/parser_extension.zig`,
`docs/transcripts/*.json`, and the wasm run in Node (same pattern as
`tools/wasm-smoke.mjs`). Screenshots are under `notes/T026/`.

Decision: **defects**. One blocking content defect on `/guide/analyzer`, three
cosmetic items. Everything else in the T022 spec and the owner's asks is proven
on production.

## Verifier

`node docs/verify-playground.mjs --url https://yuku-tsrx-docs.vercel.app`
passes: 0 console errors, 0 page errors, 0 failed requests, all sections
(home cards, hero, playground, ast/symbol/codegen explorers, how-it-works,
chooser, terminal demo, chips, matrix, bench live, SPA round trip). My own two
audit passes across all pages also collected 0 console/page errors.

## Home (owner asks: eye-catching benchmarks, fuel race, side-by-side demo, buttons, scrollbars)

| Check | Result |
| --- | --- |
| Four cards | `3.47× faster median parse than @tsrx/core, 29,666 ns vs 103,075 ns`; `33,708 parses/s, @tsrx/core: 9,702`; `32.3 MB/s, @tsrx/core: 9.3 MB/s`; `15% less peak memory, 264.7 MB vs 310.0 MB` |
| Fresh read of m6-baseline.json | valid=true; 103075.4/29666.2 = 3.47; 33,708 / 9,702; 32.3 / 9.3 MB/s; 1-0.8541 = 15%; 264.7 / 310.0 MB; lane 28.8%. All four cards and both budget lines agree. |
| Caption | "One measurement on one machine (Apple M5 Pro, a 224-file corpus). Your hardware will differ. MB means 1,000,000 bytes." CPU and file count match the JSON. No invented date. |
| Fuel race | Two `.comp-row` lanes, `style="width:28.8%"` and `width:100.0%`; measured fills 200/696 px = 28.8% and 100%. After scrolling into view a WebGL canvas is present on each lane (290 px = bar + 90 px tail, and 696 px). `home-bench-fuel.png` shows the gold/red plume stopping under a third and the teal/blue lane full width. |
| Landing demo band at 1440 | `.band` height 604 px (< 650). Panes `#hero-demo` (x 100, w 613) and `#pg-output` (x 727, w 613) at the same y: side by side. `home-band-1440.png`. |
| Button centering (getComputedStyle) | `.action-brand`, `.action-alt`: display flex, align-items center, justify-content center, 48.66 px. `.demo-button`: flex/center, 28.38 px. `.try-button` (tsrx-syntax): flex/center/center, 28.38 px. `[role=tab]` (home and /playground): flex/center, 31.25 px. `.theme-toggle`, `.search-button`: flex/center. |
| Scrollbars | Computed `scrollbar-width: thin` on `.code-panel-editor`, `.code-panel-editor pre`, `.pg-output-body`, `.pg-plain`, `.pg-panes .code-panel`; thumb transparent at rest (hover rule). Shipped CSS carries `::-webkit-scrollbar` rules for `.pg-output-body`, `.code-panel-editor`, `.demo-input`, `.pg-plain` (68 webkit scrollbar rules total). |
| Total transferred bytes, fresh context, networkidle | **425,727 bytes** (second run 420,221). Largest: wasm 277,521 (brotli), inter 48,605, space-grotesk 22,474, app.js 16,127, decode-analyzer.js 12,873, decode.js 10,709. |

## Parser: AST explorer (`/guide/parser`)

- Status `parsed in 1.70 ms · 69 nodes · 0 diagnostics · runs in your browser`; 57 tree rows.
- Hover row 4 (`Identifier 16:20`) -> exactly one `.ex-seg.ex-hit`, text `Cart`. Hover a mid-source segment -> exactly one `aria-pressed="true"` row (`JSXOpeningElement 136:140`). Both directions proven; `parser-hover-row.png`, `parser-hover-seg.png`.
- Page weight, fresh context: **126,347 bytes before the wasm** (9 requests: page, css, fonts, app.js, yuku-explorers.js 10,745, yuku-wasm.js 2,777), **427,493 bytes after** the figure scrolled into view (wasm 277,544 brotli of 1,275,960 raw, decode.js 10,723, decode-analyzer.js 12,879, yuku-shared.js 1,965). The wasm is fetched only after the IntersectionObserver fires, as specced.
- Cache: wasm is served `cache-control: public, max-age=0, must-revalidate` with an ETag. SPA navigation parser -> analyzer refetches nothing (7,775 extra bytes, no wasm). A full navigation to a second guide page revalidates the wasm (304, 68 bytes), not a re-download. Not a defect; noted for the PM per the T022 risk note.

## Analyzer: symbol explorer (`/guide/analyzer`)

- Status `10 scopes · 5 symbols · 6 references (2 unresolved) · runs in your browser`. Table rows: Cart, items, total, item, error. Clicking `items` lights 1 `.ex-decl` and 2 `.ex-ref` (`items.length`, the `@for` head). Scope tree `<details open>` with 10 rows. `analyzer-items.png`.
- Unresolved count is stated in prose ("The status line counts what did not resolve too: today the analyzer creates no symbol for the second @catch parameter or for a @for index binding, so references to those show as unresolved").
- **Defect (blocking, content accuracy).** The two unresolved references on screen are `reset` (true to the prose) and **`total`** in `data-count={total}`. There is no reference to the `@for` index `i` in the sample at all, so the prose explains an unresolved reference that is not on the page and does not explain the one that is. I ran `analyze()` in Node on the shipped sample and on variants: the analyzer block-scopes `@{ }` exactly like a plain JS block (`{ const total } return total` also resolves to null), and `total` referenced *inside* the same `@{ }` block resolves fine (symbol 2, scope 3). So the sample places the reference outside the block that declares it, and the figure shows the page's own headline claim ("a const declared in a @{ } code block ... has to become a real scope with real symbols") apparently failing: `total` sits in the table with Refs 0 while the source shows `total` dotted with `title="resolves to nothing declared in this file"` (it is declared in this file). A reader is misled about the analyzer on the analyzer guide. Fix is a markdown edit plus rebuild/redeploy: move the `<ul>` markup inside the `@{ }` block (or hoist the reference), and reword the paragraph to name what is actually unresolved in the sample (`reset`, and `i` only if the sample references it). The T027 note's claim that "a reference to the index binding resolves to nothing" is true of the engine but not of what the shipped sample shows.

## Codegen walkthrough (`/guide/codegen`)

- Default output 314 chars; `compact` changes it (`total===0`, indent input disabled), equivalent call `generate(program, { format: "compact" })`; `single` and `double` change quotes; `comments: all|line|block` change output; `indent 4` changes output; `strip` drops `import type` and the annotation; `minify syntax` changes output and the call line ends `minify: { syntax: true }`. Final call line: `generate(program, { format: "compact", quotes: "single", comments: "none", strip: true, minify: { syntax: true } })`. `codegen-toggled.png`.
- `shortest` chip present, `disabled`, visible, `title="not available: the Quotes enum in src/dialect/codegen.zig has preserve, double and single, so the host cannot request shortest"`. The reason is checkable against `src/dialect/codegen.zig` and matches the page's Limitations paragraph.
- Cosmetic 1: `comments: none` produces the same text as the default `some` for this sample (neither prints the `//` or `/* */` comments; only `all`, `line`, `block` do), so that one chip does not visibly change anything from the default. A `/** */` or `/*! */` comment in the sample, or a default of `all`, would fix it.
- Cosmetic 2: the T022 3.4 note "minify: true also sets quotes: shortest, which is why it is not offered here" is not rendered in the figure; the reason lives only in the chip's `title` tooltip and in the prose two sections above. A visible one-line note under the controls would make the disabled state self-explaining.

## Introduction: how-it-works

5 `[data-hiw-step]` (Your .tsrx; Yuku parses, the dialect answers; A TSRX tree, not a lowering; One buffer across the boundary; parse, analyze, generate). Clicking step 2 sets `data-step="hooks"`, exactly one visible panel, **20** `code` chips whose names are exactly the 20 snake_case `pub fn` declarations in `parser_extension.zig` (lines 929-1021; `Container`, `Host`, `parseLooseAncestorClose` are correctly excluded by the lowercase regex). `intro-hooks.png`.

## Getting started: chooser and transcripts

- 3 chooser options (Consume it from Node, Run it in a browser, Hack on the dialect); clicking the third leaves only `data-chooser-panel="2"` unhidden.
- 2 `[data-terminal-demo]` figures; both play to completion (Play -> "Replay terminal walkthrough"), 13 and 28 lines, 0 hidden lines after play, `# exit 0` x2 and x3, no non-zero exits anywhere on the page.
- Every command and every output line of both `docs/transcripts/*.json` is present verbatim in the production HTML; captions read `Captured on 2026-08-17 by tools/capture-transcripts.mjs on Darwin 25.5.0 arm64 (Apple M5 Pro), Node v24.15.0, Zig 0.16.0`, matching `captured_at` and `platform` in the JSON. `dropped: [{pnpm test, exit 1, 61956 ms}]` in the JSON is stated on the page under the build demo ("`pnpm test` is not in that recording ... two checks in test/m1.test.ts ... were failing"). `gs-terminal-0.png`, `gs-terminal-1.png`.

## tsrx-syntax: node-type chips

19 fences, 19 `.node-chips` rows, every fence has one. I extracted all 19 fence texts from the production HTML and parsed each with `zig-out/wasm/yuku-tsrx.wasm` + `npm/yuku-tsrx/decode.js` in Node (tsx, module, semantic): the record and overlay chips agree on all 19 (JSXCodeBlock x3; JSXIfExpression; JSXForExpression + ForOfStatement.index + .key; JSXForExpression; JSXSwitchExpression; JSXTryExpression + CatchClause.resetParam; JSXTryExpression; JSXOpeningElement.name x2; JSXStyleElement + StyleSheet; JSXCodeBlock + JSXStyleElement + StyleSheet; ObjectPattern.lazy + ArrayPattern.lazy; JSXCodeBlock + ImportDeclaration.source; JSXText.value, whose decoded value `"ABB&<>'&unknown;` differs from the raw text; then the three `no-playground` fences with 1, 2, 6 diagnostics, which are the real counts). `syntax-chips.png`.

## Architecture: hook matrix

20 `tr[data-classification]`, chips All 20 / Statement 2 / Expression 2 / Pattern 3 / Function 2 / For-of 1 / Module 1 / JSX 7 / Text 2. Clicking JSX -> 7 visible rows, "Showing 7 of 20 hooks."; Pattern -> 3, "Showing 3 of 20 hooks." Implemented-in column checked against the zig for all 20 (five named here): `statement_at_code_block` -> code_block.zig (`code_block.statement`), `for_of_tail` -> control_flow.zig (`control_flow.forOfTail`), `module_specifier` -> modules.zig, `jsx_element_after_open` -> style.zig + parser_extension.zig (`style.afterOpen` then local `parseExtendedJsxElement`), `jsx_text_value` -> text.zig. All agree. `matrix-pattern.png`.

## Benchmarks: Measure in this tab

Own `## Measure in this tab` heading; figure top at y=2248 vs the last committed table bottom at y=1924, not side by side. Caveat paragraph containing "not comparable" visible before the run. Run: `your machine · Google Chrome 151 · 493 parses in 20 ms`, rows Sample 375 bytes, 493 of 500 parses, 29 batches of 17, median 29,412 ns, p95 64,706 ns, 34,000 parses/s, 12.8 MB/s. None of 29,666 / 103,075 / 33,708 / 9,702 / 0.2878 appears inside the figure. `bench-live.png`.

## Sweeps

- Em dashes: none in any of the 14 production HTML pages, none in `llms-full.txt`, none in `docs/` sources outside goals/dist.
- oxlint / oxfmt / linter / formatter / lint / LSP / editor extension: only in `/reference/limitations` ("No linter.", "No formatter.") and the same two negatives in `llms-full.txt`.
- Product-file guard: `git status --porcelain -- src build.zig npm test README.md` empty at HEAD 2bf27d9.

## Defects

Blocking:
1. `/guide/analyzer`, `<!-- symbol-explorer -->` figure and the paragraph beneath it: the sample's unresolved references are `total` and `reset`; the prose attributes them to the `@catch` second parameter and a `@for` index binding; `i` is never referenced; `total` is unresolved because the sample references a `@{ }`-block const outside the block. Evidence: `analyzer-items.png` (dotted `total`, Refs 0), Node `analyze()` on the shipped sample (`ref total 113:118 -> null`) and on the in-block variant (`ref total -> 2`).

Cosmetic:
2. `/guide/codegen` figure: `comments: none` is indistinguishable from the default `some` on this sample.
3. `/guide/codegen` figure: no visible note explaining why `shortest`/`minify: true` are not offered; reason is tooltip-only.
4. `/guide/analyzer` figure at 1440: the source pane clips long lines (`ke`, `error.mes`) and the symbol table's Decls/Refs columns sit behind a horizontal scroll; both are scrollable, so this is layout polish, not loss.

## Fix package (Worker)

objective: Make the analyzer symbol-explorer sample and its explanatory paragraph agree with what analyze() returns: reference `total` inside the `@{ }` block that declares it (or otherwise make the code-block const resolve on screen), keep the `@for ... index i; key` and `@catch (error, reset)` bindings, and reword the paragraph under the figure so the unresolved references it names are exactly the ones the shipped sample produces (`reset`, plus `i` only if the sample references it); optionally, on codegen, add a `/** */` comment so `comments: none` visibly differs from `some` and render a one-line visible note under the controls saying minify: true implies quotes: shortest, which is why it is not offered. Rebuild, verify locally and against production, redeploy, screenshot the analyzer figure with `total` clicked.
allowed_files: docs/guide/analyzer.md, docs/guide/codegen.md, docs/assets/yuku-explorers.js, docs/verify-playground.mjs, docs/dist/**, docs/goals/yuku-tsrx-docs-site/notes/T028-*.md, docs/goals/yuku-tsrx-docs-site/notes/T028-*.png
verify:
- pnpm run docs:wasm && node tools/wasm-smoke.mjs --fences
- pnpm run docs:build
- node docs/verify-playground.mjs
- "! grep -rIl -e '—' docs --exclude-dir=goals --exclude-dir=node_modules --exclude-dir=dist"
- "! grep -rniE 'oxlint|oxfmt' docs/dist/yuku-tsrx/guide docs/dist/yuku-tsrx/index.html"
- test -z "$(git status --porcelain -- src build.zig npm test README.md)"
- vercel link --cwd docs/dist --project yuku-tsrx-docs --scope jack-shelton --yes && vercel deploy --cwd docs/dist --prod --yes --scope jack-shelton && node docs/verify-playground.mjs --url https://yuku-tsrx-docs.vercel.app
- Judge/PM check on production: click `total` in the symbol table and assert >= 1 `.ex-ref`; assert the set of `.ex-unresolved` texts equals the names the paragraph under the figure lists.
stop_if:
- The rewritten sample does not parse clean or `total` still resolves to null when referenced inside its own `@{ }` block (report; do not edit src/).
- Any change is needed under src/, build.zig, npm/, or test/.
- Vercel prompts for auth or offers a different project.

## Measurements

- home_transfer_bytes: 425,727 (fresh context, networkidle, hero parsed)
- guide_bytes_before_wasm: 126,347 (/guide/parser, fresh context, before the explorer entered the viewport)
- guide_bytes_after_wasm: 427,493 (same page after the figure loaded and parsed)
