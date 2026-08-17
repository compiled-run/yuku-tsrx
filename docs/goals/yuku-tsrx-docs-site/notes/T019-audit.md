# T019 Judge audit: interactive surfaces on production

Judge, read-only, 2026-08-17. Board: docs/goals/yuku-tsrx-docs-site/state.yaml.
Target: https://yuku-tsrx-docs.vercel.app/yuku-tsrx and /yuku-tsrx/playground.
Reference: https://compiled.run/oxc-tsrx/playground.
Contract: notes/T012-interactivity-spec.md sections 4-5; receipts T014-T016.

Verdict: PASS. No blocking defects. Four cosmetic observations, none needing a
Worker package.

## 1. Mechanical proof: docs/verify-playground.mjs against production

Command: `node docs/verify-playground.mjs --url https://yuku-tsrx-docs.vercel.app`
Exit 0. Report verbatim:

```
playground verification
  home status: parsed in 8.80 ms · 92 nodes · 0 diagnostics · runs in your browser
  home status after typing: parsed in 0.20 ms · 96 nodes · 0 diagnostics · runs in your browser
  playground status: parsed in 9.30 ms · 92 nodes · 0 diagnostics · runs in your browser
  invalid fixture status: parsed in 0.70 ms · 59 nodes · 2 diagnostics · runs in your browser
  try button loaded 13 lines into the playground
  spa round trip status: parsed in 0.30 ms · 92 nodes · 0 diagnostics · runs in your browser
  wasm: 1246 KiB in docs/dist

ok: hero editor, /playground, all four tabs, and the try button work with no console errors
```

The verifier fails on any console error, pageerror or failed request, asserts
the AST tab contains JSXCodeBlock, the Diagnostics tab reads 0 diagnostics on
the hero snippet, Generated code mentions Cart, Semantic has a symbol count,
typing changes the status, the invalid fixture yields an error diagnostic, the
try button lands on /playground with the fence, and the SPA round trip
survives. It is the proof for this tranche.

## 2. Independent headless-Chrome audit (Judge script, playwright-core + Chrome)

Screenshots under notes/T019/:
- playground-initial-1440.png, playground-invalid-diagnostics-1440.png,
  playground-semantic-1440.png, playground-generated-1440.png,
  playground-dark-1440.png, playground-mobile-390.png (full page),
  playground-from-guide-1440.png, home-hero-edited-1440.png,
  guide-try-button-1440.png, reference-oxc-playground-1440.png.

Findings (all on the production origin):

| Check | Result |
|---|---|
| Hero editor editable, status changes | before `92 nodes` -> after typing `let x = 1;` `96 nodes`; hero actions Reset / Open in playground shown |
| Open in playground from hero | lands on /yuku-tsrx/playground#code=..., editor contains the edit |
| Fixture buttons load committed text verbatim | 7/7 exact byte match against test/parser/misc/tsrx/*.module.tsrx (code-block 266, control-flow-if 499, control-flow-for 611, control-flow-switch 549, dynamic-tag 361, style-element 576, control-flow-switch-invalid 340 chars); scenario note names the fixture path |
| Diagnostics on Invalid switch | 2 real errors: "`break` is invalid inside `@switch` cases." 112:118 and "`return` is invalid inside `@switch` cases." 180:206; 2 underline markers in the editor; status "59 nodes · 2 diagnostics" |
| AST tab, Code block fixture | JSON Program, 11,466 chars, contains JSXCodeBlock |
| Generated code tab | real codegen output (`const view = (<section> before @{ const label = "ready"; ... export { view, rendered };`) |
| Semantic tab | "4 scopes · 5 symbols · 3 references · 0 imports · 2 exports"; symbol table 5 rows + exports table 2 rows |
| Share | writes #code=<base64url> to the URL; Reset restores hero snippet (92 nodes) |
| Try in playground (guide/tsrx-syntax) | 16 buttons; first click -> /yuku-tsrx/playground#code=..., editor value === data-code exactly, status 47 nodes 0 diagnostics |
| Tabs keyboard | ArrowRight from Generated code selects Semantic; aria-selected/hidden toggle correctly |
| Console | 0 errors, 0 warnings, 0 failed requests across playground, mobile, home, guide pages |
| Lint/format claims | grep of live /playground and / HTML for lint, oxlint, oxfmt, formatter, formatting, language server: no matches |
| Cross-Origin-* headers | none on /, /playground, wasm, guide (curl -sI and Playwright response headers) |
| Content types | HTML text/html; wasm application/wasm; HTTP/2 200 everywhere |
| Mobile 390 | single column, no horizontal document overflow (scrollWidth 390), examples wrap, editor and output stack; long editor lines scroll inside the editor |
| Dark mode | panels legible, gold accents, no contrast problem visible |

## 3. Measurements

- wasm bytes: 1,275,960 (content-length, uncompressed); transferred with
  content-encoding br: 277,433 bytes.
- wasm fetch: 97 ms (PerformanceResourceTiming duration, warm CDN, cle1 edge).
- decode.js 10.9 KB / decode-analyzer.js 13.0 KB / yuku-playground.js 9.5 KB /
  yuku-wasm.js 3.0 KB transferred.
- first parse: 8.3 ms (playground), 8.8 ms (home), 8.4 ms (mobile emulation);
  subsequent parses 0.1-0.8 ms.
- navigation start to first parsed status on /playground: ~500 ms.
- Cache-Control is `public, max-age=0, must-revalidate` for the wasm as well;
  acceptable at 277 KB brotli, noted as a possible later tweak (immutable
  hashed asset), not a defect.

## 4. Shape parity with compiled.run/oxc-tsrx/playground

Same: `.pg-topbar` title + tagline, `.pg-examples-bar` with label + `.demo-button`
scenarios + `#pg-scenario-note`, `.pg-panes` with two `.code-panel`s of equal
width (720/720 at 1440), editor bar with dots, file name `playground.tsrx`,
`#demo-hint` "edit me · runs in your browser", Share/Reset actions, output
tablist with a pane label and four tabs, per-tab `.pg-note` explanation,
`.code-panel-status` on both panes, single-column stack on mobile.

Differences, all intended:
- No Format button and no lint/format scenarios (yuku-tsrx has no formatter or
  linter; the spec drops them).
- Tabs are AST | Diagnostics | Generated code | Semantic instead of Projected
  TSX | Structure | Diagnostics | Formatted.
- Pane label reads "OUTPUT" not "ENGINE OUTPUT"; output status reads "output
  follows the editor as you type" without a clock; editor status is one line
  ("parsed in N ms · nodes · diagnostics · runs in your browser") where oxc
  shows two lines (lint verdict + parse/rules line). Fine for a parser.
- Generated code pane is plain `.pg-plain` with quickTokens colouring and no
  line-number gutter, where oxc's Projected TSX pane has a gutter. Cosmetic.

## 5. Defects

Blocking: none.

Cosmetic (no package; record for a later polish pass if wanted):
1. /playground, Generated code pane: the dialect codegen prints the head of an
   `@{ ... }` code block on one long line, so the first line of the hero
   snippet's output runs past the pane and needs horizontal scroll
   (playground-generated-1440.png). This is the real codegen output, not the
   site; the pane scrolls (`overflow-x: auto`).
2. Generated code pane has no line-number gutter unlike oxc's Projected TSX
   pane. Parity nicety only.
3. Try in playground buttons are opacity 0 until the block is hovered or the
   button is focused; identical to oxc's `.try-button` rule, so intended, but a
   reader on touch has to tap the block first.
4. Wasm served with `max-age=0, must-revalidate`; every visit revalidates a
   277 KB brotli asset (fast, 97 ms observed). Optional: hash the file name and
   set immutable caching.

## 6. Decision

pass. The tranche's interactive surfaces are live, real (wasm fetched and
instantiated in the tab; no pre-computed outputs in yuku-playground.js), match
the T012 spec sections 4-5 and the oxc-tsrx shape minus lint/format, and are
proven by docs/verify-playground.mjs against the production origin. T999 can
proceed to the final outcome mapping.
