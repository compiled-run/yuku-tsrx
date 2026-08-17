# T027 engine-backed guide figures, and the fourth home card

Three guide pages now carry a figure that runs the WebAssembly build of the
dialect in the reader's tab, and the home benchmark section prints four
build-time figures instead of three. Nothing on any of them is recorded,
approximated, or typed in.

## Deployment

| | |
| --- | --- |
| Deployment id | `dpl_5rtr83iS38TDXLqhb5pBM1qeSNEd` |
| Production alias | https://yuku-tsrx-docs.vercel.app |
| Project / scope | `yuku-tsrx-docs` / `jack-shelton` |
| Target | production |
| Screenshot deployment | `dpl_4FfQPj3A8H9dWuYAtW5wqyipgUGZ` |

The three screenshots in this folder were taken against the production alias at
a 1280x900 viewport and a device pixel ratio of 2, and the capture run collected
console errors, page errors and failed requests and found none. They were taken
one deployment before the final one: the only edit between the two is this note,
which is not part of the site, and the built bytes are the same.

**One cleanup for the PM.** `docs/build.mjs` deletes and recreates `docs/dist`,
which takes the `.vercel` link file with it, so a `vercel deploy --cwd
docs/dist` that follows a rebuild without a fresh `vercel link` creates a new
project from the directory name. That happened once here and produced a stray
project called `dist` (deployment `dpl_4jPyyFCpxjLrtvv3tdVhgkRX4VaW`, aliased
`dist-phi-six-39.vercel.app`). `vercel project rm dist` is denied to this
worker, so the stray project is still there and wants removing by hand. The
order in the verification block, `vercel link && vercel deploy`, is the right
one and is what produced the deployment above.

## What shipped

### Home: four cards, all computed

`homeBenchCards()` reads `benchmarks/m6-baseline.json` at build time and throws
if `valid` is not `true`, so a run the harness rejected can never reach the
page. The fourth card is the throughput one.

| Card | Rendered | Formula | Comparison line |
| --- | --- | --- | --- |
| Speed | `3.47×` faster median parse than @tsrx/core | `core.ns_per_parse.median / yuku.ns_per_parse.median` | `29,666 ns vs 103,075 ns per parse` |
| Rate | `33,708 parses/s` median parses per second | `yuku.parses_per_second.median` | `@tsrx/core: 9,702 parses/s` |
| Throughput | `32.3 MB/s` source parsed per second | `yuku.bytes_per_second.median / 1e6` | `@tsrx/core: 9.3 MB/s` |
| Memory | `15% less` peak memory than @tsrx/core | `(1 - ratios.peak_rss) * 100` | `264.7 MB vs 310.0 MB peak RSS` |

The caption reads the CPU and the file count out of the same JSON: "One
measurement on one machine (Apple M5 Pro, a 224-file corpus). Your hardware will
differ. MB means 1,000,000 bytes." The T023 comparison chart, its caption and
the report link are untouched. `.gate-grid` is four columns to 940px, two below
that, one below 460px. The old `0.2878` ratio string is gone from the page: the
speed card now divides the two medians directly, which is the same arithmetic
the other way round and reads as a multiple without a footnote.

`docs/reference/benchmarks.md` gained the same four numbers in its "Read as a
sentence" paragraph, so the home page and the report say the same thing.

### The module

`docs/assets/yuku-explorers.js` is imported by `app.js` only when a page carries
one of the three markers, and it boots the wasm only when a figure comes within
400px of the viewport. `docs/assets/yuku-shared.js` is new and holds the pieces
the playground and the explorers both use (`escapeHtml`, `byteToCharIndex`,
`quickCode`/`quickTokens`, `formatMs`, `plural`, `flagNames`);
`yuku-playground.js` imports them now instead of carrying its own copies.
`quickCode` grew one option: the playground's panels are always dark and keep
the inline colour, a guide page asks for the two shiki custom properties alone
and the stylesheet picks the stop for the reader's theme.

The build ships the fence and the panes and never an answer. With JavaScript
off, or if `ready()` rejects, every figure stays the shiki-highlighted listing
and its status line says why.

### The three figures

**`/guide/parser`, `<!-- ast-explorer -->`.** `parse()` at run time. The left
pane becomes one span per stretch of text cut at every distinct node boundary;
the right pane is the pre-order node list, `<code>Type</code> start:end`,
indented by depth, capped at depth 12 with a "… N deeper nodes" row for what is
below it. Hovering a row highlights its exact `[start, end)` in the source;
hovering the source lights the innermost node that covers that character and
scrolls the row into the tree's own scroll box; clicking pins. Status:
`parsed in 9.1 ms · 69 nodes · 0 diagnostics · runs in your browser`.

**`/guide/analyzer`, `<!-- symbol-explorer -->`.** `analyze()` at run time.
Symbols table (Symbol / Flags / Scope / Decls / Refs) plus a `<details open>`
scope tree built from `scope.parentId`. Clicking a symbol, in the table or in
the source, lights its declaration and every reference the analyzer resolved to
it; hovering a scope row outlines the scope's span. Status:
`10 scopes · 5 symbols · 6 references (2 unresolved) · runs in your browser`.

**`/guide/codegen`, `<!-- codegen-walkthrough -->`.** `generate()` on every
change. Chips for `format`, `quotes`, `comments`, a number input for `indent`
(disabled under compact, because the generator ignores it there), and checkboxes
for `strip` and the host's `minify` bit. `shortest` is present and disabled with
the real reason in its title, and the output pane carries the equivalent
`generate(program, { … })` call for the current state. The figure parses with
`attachComments: true` and the page says so, because without it every
`comments` mode prints the same text and the control would be theatre.

All three carry Edit and Reset. Edit swaps the pane for a plain textarea,
debounced 120ms, and re-runs the figure on what you typed.

## What the screenshots show

**`T027-parser.png`.** The parser figure with the `JSXForExpression 176:255`
row hovered. The three source lines from `@for` to its closing brace carry the
highlight, and nothing else does: that is the node's own span, not a guess about
which lines look related.

**`T027-analyzer.png`.** The analyzer figure with the `items` row selected. The
declaration in the parameter list is filled, and both references, the one in
`items.length` and the one in the `@for` head, are underlined. The `reset` in
the `@catch` body carries the dotted unresolved underline. The scope tree is
open under the table.

**`T027-codegen.png`.** The codegen figure after `format` was switched to
`compact`. The generated pane holds the real compact output, the `indent` input
has gone dashed and disabled, `shortest` sits disabled beside the three quote
modes that work, and the line under the output reads
`generate(program, { format: "compact" })`.

## One finding the analyzer figure surfaced

The sample on `/guide/analyzer` is the one the spec asked for, with
`@for (const item of items; index i; key item.id)` and
`@catch (error, reset)`. The analyzer's answer today is that `error` becomes a
symbol and `reset` does not, and that a reference to the `index` binding
resolves to nothing either. In the sample as shipped that shows as
`6 references (2 unresolved)`, with `reset` dotted in the source and titled
"resolves to nothing declared in this file".

That is what `analyze()` returned, so it is what the figure prints. It is also
one clause short of the sentence three paragraphs above it, which names "the
`error` and `reset` parameters of a `@catch`" among the bindings the dialect
turns into real symbols. Two things could be true: the analyzer should be
creating those symbols and does not, or the paragraph is claiming more than the
seam does today. Deciding that needs the engine, which is outside this unit's
contract, so nothing under `src/` was touched and the prose was left as it
stands. It wants a PM call: either an engine issue for the missing bindings, or
an edit to that paragraph.

## Verification

Every command in the unit's verification block was run and passed:
`pnpm run docs:wasm && node tools/wasm-smoke.mjs --fences` (20 fences checked,
including the three new ones, all parse clean), `pnpm run docs:build`, the four
grep gates on `docs/dist`, `node docs/verify-playground.mjs` locally and
`--url https://yuku-tsrx-docs.vercel.app` against production, the em-dash sweep,
the forbidden-word sweep, and the product-file guard.

One assertion in the verifier had to be written differently from the spec's
wording. Section 4 asks that the compact output "contains no `\n  `
indentation". The text children of a JSX element are significant, so compact
output keeps the markup's own line breaks and that assertion is false for real
TSRX output. What compact actually drops is the discretionary whitespace, so the
check reads it directly: the output must contain `total===0` and must not
contain `total === 0`, and must be shorter than the pretty output. Both were
true on the local run and on production.
