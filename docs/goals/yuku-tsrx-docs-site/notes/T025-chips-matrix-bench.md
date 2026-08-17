# T025: node-type chips, the extension-point matrix, and measure-in-this-tab

Package T025 of `docs/goals/yuku-tsrx-docs-site/`, built to
`notes/T022-guide-interactivity-spec.md` sections 3.9, 3.10, 3.11 and 4.

## 1. The parser runs inside the build (`bootWasmForBuild`)

`docs/build.mjs` now instantiates `zig-out/wasm/yuku-tsrx.wasm` with
`WebAssembly.Instance` and imports the generated `npm/yuku-tsrx/decode.js`,
mirroring `tools/wasm-smoke.mjs`: same flag packing (`packBuildFlags`), same
`alloc` / length-prefixed result / `free` dance, same decoder. `parseForBuild`
is the one call the rest of the build uses.

There is no fallback. A missing module, a module that will not instantiate, or a
fence the parser refuses to accept all throw and the build stops, because a
chip that was not read out of a tree is a chip nobody can check.

## 2. Node-type chips on `guide/tsrx-syntax`

The page carries `<!-- node-chips -->`, which turns on two things: an
explanatory paragraph, and a chip row under every ```tsrx fence on the page.
Every fence is parsed once, keyed by its exact text, before the markdown
renderer runs; a fence with no parse is a build failure rather than a fence
that quietly loses its chips.

Two kinds of chip, both read out of the decoded tree:

- **Records**, the standalone TSRX nodes from `src/dialect/schema.zig`:
  `JSXCodeBlock`, `JSXIfExpression`, `JSXForExpression`, `JSXSwitchExpression`,
  `JSXTryExpression`, `TSRXExpression`, `JSXStyleElement`, `StyleSheet`.
- **Overlays**, an ordinary Yuku node carrying a field the dialect added, so the
  chip names the node and the field rather than a type that does not exist:
  `ForOfStatement.index`, `ForOfStatement.key`, `ObjectPattern.lazy`,
  `ArrayPattern.lazy`, `CatchClause.resetParam`, `JSXOpeningElement.name` (a
  dynamic tag, so the name is a `JSXExpressionContainer`),
  `ImportDeclaration.source` (a submodule import, so the specifier is an
  identifier and not a string literal), and `JSXText.value` (entity decoding, so
  the value is not the source it came from).

Each chip carries a `title` saying which of the two it is. Nothing inspects the
source text for an `@`; every chip is a question asked of a node.

The 19 fences produced, in page order:

```
JSXCodeBlock                                    (x3)
JSXIfExpression
JSXForExpression ForOfStatement.index ForOfStatement.key
JSXForExpression
JSXSwitchExpression
JSXTryExpression CatchClause.resetParam
JSXTryExpression
JSXOpeningElement.name                          (x2)
JSXStyleElement StyleSheet
JSXCodeBlock JSXStyleElement StyleSheet
ObjectPattern.lazy ArrayPattern.lazy
JSXCodeBlock ImportDeclaration.source
JSXText.value
JSXCodeBlock 1 diagnostic
JSXSwitchExpression 2 diagnostics
JSXOpeningElement.name 6 diagnostics
```

The last three are the `no-playground` fences, the invalid examples. Their
diagnostic counts are the real ones, and the first message is in the chip's
`title`. The Markdown twin gets the same names as a one-line italic sentence
under each fence, so `llms-full.txt` carries the same claim.

## 3. Extension-point matrix on `architecture/yuku-dialect`

The authored table gained an `Area` column ({Statement 2, Expression 2,
Pattern 3, Function 2, For-of 1, Module 1, JSX 7, Text 2} = 20) and its rows are
now in the declaration order of the zig file. `<!-- hook-matrix -->` before it
turns it into a filterable matrix.

`readHooks()` was extended: as well as the 20 `pub fn` names it now slices each
hook body (declaration to the next top-level `pub`) and reads the dialect module
it hands the work to. The build throws if the table's names, their count, or
their areas disagree with the zig. What it derived:

| Implemented in | Hooks |
| --- | --- |
| `code_block.zig` | statement_at_code_block, expression_at_code_block, function_body, jsx_child_at_code_block, function_body_starts |
| `control_flow.zig` | statement_at_control_flow, expression_at_control_flow, for_of_tail, jsx_child_at_control_flow |
| `patterns.zig` | lazy_assignment_pattern, binding_pattern, can_start_binding |
| `modules.zig` | module_specifier |
| `jsx.zig` | jsx_element_name, validate_jsx_element_name, jsx_names_match |
| `style.zig` + `parser_extension.zig` | jsx_element_after_open |
| `parser_extension.zig` | jsx_fragment_after_open |
| `text.zig` | jsx_text_boundary, jsx_text_value |

`hookNode` and `decisionNode` are excluded from the "implemented here" test:
they are the two comptime wrappers every hook passes through to turn a
`Decision` into a node, so counting them would file all twenty under
`parser_extension.zig`. Every other top-level `fn` in the file does real work,
which is why `jsx_element_after_open` (`style.afterOpen` plus the local
`parseExtendedJsxElement`) and `jsx_fragment_after_open` are the two rows that
name the file itself. This is what section 3.10 predicted.

Filtering is `initMatrixFilters` from T024, unchanged: chips per area with
counts, `data-classification` per row, status line "Showing 7 of 20 hooks."
Eight `matrix-badge-*` colour rules were added next to the existing ones.

## 4. "Measure in this tab" on `reference/benchmarks`

Its own section at the end of the page, after the report and before "What this
is not". It is never beside, inside, or in the same table as the committed
numbers, and the verifier now asserts that none of `29,666`, `103,075`,
`33,708`, `9,702` or `0.2878` appears anywhere inside the figure.

The caveat is a fixed paragraph at the top of the figure, on screen before a run
and after it, and it says the two are **not comparable** and why.

Controls: seven samples (the hero snippet and the six valid playground
fixtures, with their byte counts on the chips), iterations 100 / 500 / 2000, and
Run. The invalid fixture is deliberately not a sample: timing a rejected parse
would measure the error path.

One honesty problem showed up in the first run and is worth recording. A browser
clamps `performance.now()` to about a tenth of a millisecond, and one parse of a
guide-sized snippet takes 20 to 30 microseconds, so timing single parses printed
a median of `0`. The figure now times batches: 20 warm-up parses, then 20
calibration parses to size a batch at about a millisecond (at least four
batches), then N timed batches, and every printed number is per-parse arithmetic
on a batch the clock could actually resolve. The table says so in its own rows,
and the p95 row is labelled "by batch" because that is what it is.

Typical run on the hero snippet (375 bytes), Chrome 151, this machine:

| Iterations | Batches | Median ns | p95 ns (by batch) | Parses/s | MB/s |
| --- | --- | --- | --- | --- | --- |
| 100 | 10 of 10 | 30,000 | 50,000 | 33,333 | 12.5 |
| 500 | 21 of 23 | 26,087 | 52,174 | 38,333 | 14.4 |
| 2000 | 58 of 34 | 17,647 | 35,294 | 56,667 | 21.3 |

Those are the WebAssembly build in a browser and belong to nothing else on the
page.

## 5. Verification

- `pnpm run docs:wasm && node tools/wasm-smoke.mjs --fences`: 20 fences checked,
  3 marked `no-playground`, ok.
- `pnpm run docs:build`: 14 pages.
- Grep gates: 53 `node-chip` occurrences on tsrx-syntax with `JSXCodeBlock`
  present; exactly 20 `data-classification=` on yuku-dialect with
  "Implemented in"; `data-bench-live` and "not comparable" on benchmarks.
- `node docs/verify-playground.mjs`: passes with zero console errors, including
  the new T025 section (chip rows and the diagnostic chip, 20 hook rows filtered
  to 7 JSX rows with an "Implemented in" cell ending in `.zig` on every row, a
  bench run that prints four numbers).
- Em dash sweep and the oxlint/oxfmt sweep: clean.
- Product-file guard: nothing under `src`, `build.zig`, `npm`, `test`, `tools`,
  `README.md`, `package.json` was touched.

Screenshots: `notes/T025-syntax.png` (chips under the `@if` and `@for`
examples), `notes/T025-matrix.png` (the matrix filtered to JSX), and
`notes/T025-bench.png` (the figure after a 500-iteration run).
