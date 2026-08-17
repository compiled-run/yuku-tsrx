# T008 audit: live yuku-tsrx docs site vs compiled.run/oxc-tsrx

Audited 2026-08-17 against https://yuku-tsrx-docs.vercel.app/yuku-tsrx (13 pages)
and https://compiled.run/oxc-tsrx (home, guide/introduction, guide/parsing).
Screenshots live in `notes/T008/`. Read-only audit; nothing outside `notes/` was
written.

Verdict: **defects** (one blocking, small). Everything else passes.

## 1. Deploy, HTTP, links

- All 13 pages return 200 (curl, no `.html` suffix). `/yuku-tsrx` 200; `/yuku-tsrx/`
  308 to it; `/` 308 to `/yuku-tsrx` (T007 receipt).
- Extracted every `href` from the 13 live HTML pages: 160 unique, 36 internal.
  All 36 internal targets return 200 (page routes, `#anchors` on existing pages,
  12 `.md` mirrors, `style-doc.css`, `style-home.css`, `logo.svg`, both fonts).
- External: every GitHub, oxc.rs, yuku PR #164 link 200. `chatgpt.com`,
  `claude.ai` (the "Copy page" menu items, same component as oxc-tsrx) and
  `npmjs.com/package/@tsrx/core` return 403 to curl (bot blocking), not defects.
- `search-index.json` (75 KB), `llms.txt`, `assets/app.js`, `social-card.png`
  (1200x630), `robots.txt`, `guide/parser.md` all 200.
- Local `docs/dist/yuku-tsrx/{index,guide/parser,reference/api}.html` are
  byte-identical to the live pages, so the deploy is the current build.

## 2. Structure and components vs oxc-tsrx

| Component | oxc-tsrx | yuku-tsrx | Match |
| --- | --- | --- | --- |
| Top nav | logo, Search (Cmd-K), Guide, Playground, Integrations, Architecture, Reference, GitHub, theme | logo, Search (Cmd-K), Guide, Architecture, Reference, GitHub, theme | intended drops (Playground, Integrations) |
| Search dialog | minisearch dialog | same markup (`search-dialog`, `search-input`, `search-results`) | yes |
| Sidebar groups | Guide(7) Integrations(3) Architecture(3) Reference(4) | Guide(6) Architecture(2) Reference(4) | intended: no Linting/Formatting/Walkthrough/Editor/Config/Plugins/Provider Protocol/CLI; API replaces CLI |
| Outline rail "On this page" + read time | yes | yes | yes |
| Copy page + dropdown (Markdown, ChatGPT, Claude) | yes | yes | yes |
| Prev/next pager | yes | `nav.pager` prev/next | yes |
| Home hero (mark, gradient wordmark, tagline, two CTAs) | yes | yes | yes |
| Hero band + code panel | editable wasm demo with 4 mode buttons | static highlighted `src/Cart.tsrx` panel, caption "highlighted with the TSRX grammar" | intended (no wasm) |
| Bench section | bar chart + "Release gates" 6 gate cards with gate bars | "Measured, not claimed" 3 metric cards (29,666 ns / 103,075 ns / 0.2878) read from m6-baseline.json, no gate bars | intended (no gates exist) |
| Feature grid | 6 cards | 6 cards | yes |
| CTA section | "We want to upstream this to OXC" | "Built on the Yuku seam in PR #164" | yes |
| Footer | GitHub, pinned OXC hash, MIT Licensed, disclaimer | GitHub, MIT Licensed, disclaimer | see defect B1 |
| Dark theme toggle | yes | `#theme-toggle` present on every page; clicking sets `html.dark`, body bg rgb(27,27,31) | yes (yuku-guide-parser-dark.png, yuku-home-dark.png) |
| Mobile (390x844 emulated) | header collapses to logo+search+theme, hamburger on doc pages | identical behaviour, scrollWidth == innerWidth == 390 on home and guide | yes (yuku-home-mobile-emulated.png, yuku-guide-parser-mobile-emulated.png) |

Note: raw `--window-size=390,844` headless Chrome renders both sites at a wider
layout (no device emulation); the oxc-tsrx page shows the exact same clipping in
`oxc-home-mobile.png`, so the emulated Playwright shots are the valid mobile
evidence.

## 3. Logo

- `assets/logo.svg`: identical at-mark geometry to oxc-tsrx, gradient
  `#14b8a6 / #0d9488 / #115e59` (oxc: `#a855f7 / #7c3aed / #5b21b6`).
- At 32 px in the header (yuku-home-desktop.png vs oxc-home-desktop.png) the
  teal square is unmistakably a different product from the violet one; at hero
  size (64 px) and on the social card the difference is stronger still. The
  wordmark reads `yuku-tsrx` in Space Grotesk in header, hero, and social card.
- The hero band, glow, and code panel are teal/black; no purple remains
  (T004 receipt confirmed the token sweep; screenshots agree).
- Judgment: passes the "same family, clearly re-colored, yuku-tsrx wordmark" bar
  the owner asked for.

## 4. Forbidden-term grep

Live HTML (13 pages) and markdown sources (`docs/**/*.md` minus goals,
`site.config.mjs`, `build.mjs`, `README.md`):

| Term | Live HTML | Sources | Verdict |
| --- | --- | --- | --- |
| em dash U+2014 | 0 | 0 | pass |
| oxlint / oxfmt | 0 | 0 | pass |
| linter / formatter | limitations only: "No linter", "No formatter ... That is not a formatter" | limitations.md:19-22, README.md:75 "no linter, no formatter, no editor integration" | legitimate negatives |
| language server / VS Code | 0 | build.mjs:228 comment "quick-info experience of the Markless VS Code extension" (not shipped) | pass |
| playground | limitations only: "no interactive playground on this site" | build.mjs:180 `CSS_SHELLS` still lists 'playground' (emits an unused style-playground.css) | cosmetic |
| npm install yuku-tsrx | 0 | 0 | pass |
| Generated with | 0 | 0 | pass |
| Claude | "Open in Claude" copy-page menu item (same as oxc-tsrx) | build.mjs:702 | not attribution |

Commits: the five docs-site commits (2d5b4dd, 978b1ce, 52953d8, de221f3,
c983bf4) carry no AI trailer. Older product commits (Aug 15) carry a
`Claude-Session:` trailer; out of this goal's scope, noted for the owner.

## 5. Fact check (22 claims)

| # | Page | Claim | Source |
| --- | --- | --- | --- |
| 1 | home, benchmarks | 29,666 ns median, 103,075 ns, ratio 0.2878 | benchmarks/m6-baseline.json statistics.yuku.ns_per_parse.median 29666.2, core 103075.4, ratios.ns_per_parse 0.28781 |
| 2 | benchmarks | peak RSS 264,740,864 vs 309,960,704, ratio 0.8541 | m6-baseline.json peak_rss_bytes medians, ratios.peak_rss 0.85411 |
| 3 | benchmarks | 224 files, 214,751 bytes, 25 iterations, 20 samples, 5 warmups, collect/loose false | m6-baseline.json input + protocol |
| 4 | benchmarks | Node v24.15.0, pnpm 10.33.2, Zig 0.16.0, Apple M5 Pro, 18 CPUs, 51,539,607,552 bytes, locale C | m6-baseline.json provenance.runtime |
| 5 | benchmarks, getting-started, README | Markless suite 229 files / 1832 tests, 47/47, 2026-08-17 | README.md:70-72 |
| 6 | api, parser | 11 exports parse/analyze/generate/parseWire/parseModule/isEventAttribute/normalizeEventName/walk/decode/decodeAnalyzer/encode | npm/yuku-tsrx/index.d.ts:255-269 |
| 7 | parser | ParseOptions lang/sourceType/preserveParens/semanticErrors/attachComments/loose | index.d.ts:203-210 |
| 8 | parser | Zig defaults source_type .module, lang .js, preserve_parens true, comments .flat, loose false | src/dialect/root.zig:13-17 |
| 9 | parser | inferLang: .tsrx/.tsx to tsx, .jsx, .d.ts to dts, .ts, else js; query/hash ignored; sourceType module; semanticErrors default on | index.js:14-21, 56-69 |
| 10 | parser | `parseLooseAncestorClose` in parser_extension.zig | src/dialect/parser_extension.zig:1420 |
| 11 | parser, limitations | redeclaration family lowered to warning; reference @tsrx/core acorn fork | src/dialect/diagnostics.zig:7, 49-67 |
| 12 | parser | walk skips `comments` | npm/yuku-tsrx/walk.js:14 |
| 13 | parser | ForOfStatement gains index/key; JSXStyleElement fields; Program hashbang | index.d.ts:46-54, 164-175, 14-19 |
| 14 | codegen | TypeError "Expected a Program node from yuku-tsrx" | index.js:51 |
| 15 | codegen | comments default `some` = legal headers, JSDoc, __PURE__/__NO_SIDE_EFFECTS__ | src/dialect/codegen.zig:619-638 |
| 16 | codegen | minify true expands to whitespace/syntax/quotes; whitespace sets format compact, quotes sets shortest | index.js:38-47 |
| 17 | codegen | round trip test across every valid fixture | test/m4.test.ts:57-81 |
| 18 | analyzer | `semantic` built lazily on first read | decode-analyzer.js:1373 getter |
| 19 | dialect | twenty hooks by name in parser_extension.zig; 18 files in src/dialect | grep: all 20 names present; `ls src/dialect` = 18 files |
| 20 | dialect | transfer.zig serializeInto/deserializeFromBuf, little endian, no version byte | src/dialect/transfer.zig:6-17, 421 |
| 21 | getting-started, dialect | build.zig.zon `.yuku = .{ .path = "../yuku-minimal-seam" }`, minimum_zig_version 0.16.0, name .yuku_tsrx, version 0.0.0 | build.zig.zon:2-12 |
| 22 | platform-support | twelve @yuku-tsrx/binding-* optional deps at 0.0.0; loader suffix logic and error text | npm/yuku-tsrx/package.json; zig-out/npm/yuku-tsrx/binding.js (built from build.zig:506) |
| 23 | tsrx-syntax | every code snippet comes from a named fixture; all rejection messages exist | scripted match of 19 snippets to test/parser/misc/tsrx/*.tsrx; messages in control_flow.zig:476-498, jsx.zig |
| 24 | introduction, dialect | oxc-tsrx parser engine 17,057 lines | goal.md:119, 151 |
| 25 | upstreaming | 19 hook sites in 8 files; @sizeOf(Node) == 52; grep tsrx zero hits | goal.md:242, 303, 540-545 |
| 26 | home hero | Cart.tsrx example parses with 0 diagnostics, analyzes (5 refs), generates | ran zig-out/npm/yuku-tsrx against the introduction.md snippet |

## 6. Defects

### Blocking

**B1. Home footer says "MIT Licensed"; nothing in the repo supports it.**
- Page: home, element `p.footer-badge` (yuku-home-desktop-full.png, bottom).
- Source: docs/site.config.mjs:95 `copyright: 'MIT Licensed'`, copied from
  oxc-tsrx (which has a LICENSE file).
- Evidence: no `LICENSE*` in the repo, no `license` field in package.json or
  npm/yuku-tsrx/package.json, README and goal.md do not mention MIT,
  `gh api repos/compiled-run/yuku-tsrx` license is null.
- Violates the oracle ("every stated fact is checkable in the yuku-tsrx repo")
  and the non-negotiable "no invented ... facts". Choosing a license is an owner
  decision; the site must not assert one. Fix: drop the claim from the footer
  (or replace with a neutral string) and redeploy.

### Cosmetic / non-blocking

- C1. guide/codegen and reference/api document `quotes: "shortest"` and
  `minify: true` per index.d.ts/index.js, but the built addon throws
  `invalid enum value for codegen.Quotes: 'shortest'` for both
  (codegen.zig:611 `Quotes = enum { preserve, double, single }`). The docs are
  faithful to the declared surface (checkable), the bug is product code, which
  this goal must not touch (T005 already flagged it). Recommend one honesty
  sentence on codegen.md and a product follow-up outside this goal.
- C2. architecture/yuku-dialect says all three decoders open with
  "generated by tools/estree/decoder.zig"; encode.js opens with
  "generated by tools/estree/encoder.zig, do not edit".
- C3. Home code panel shows an empty trailing line 17 (heroCode ends with a
  newline); oxc's panel ends on `}`.
- C4. build.mjs:180 keeps 'playground' in CSS_SHELLS and emits an unused
  `assets/style-playground.css`. Harmless.
- C5. benchmarks.md "Run order alternates between the two parsers across
  samples": positions[] is a seeded order (yuku,core / core,yuku / core,yuku
  ...), not strict alternation. The follow-on sentence ("neither one
  consistently goes first") is accurate.
- C6. Older product commits carry a `Claude-Session:` trailer (not this goal's
  commits). Owner note only.

## 7. Oracle mapping (for T999)

- Production Vercel URL serves the site: yes (dpl_UNcnyCY3pyerN1Py4wZyWGx5UUVb, production, Ready per T007; live checks above).
- Structure/components/styling match oxc-tsrx: yes (section 2).
- Re-colored logo with yuku-tsrx wordmark: yes (section 3).
- Guides cover parser, analyzer, codegen; no lint/format/editor claims: yes (section 4).
- Every stated fact checkable in the repo: no, one exception (B1). Otherwise 26 claims verified.
- Local build passes: docs/dist rebuilt 12:51 today and byte-identical to live; T005/T007 receipts green. Not re-run here (read-only sandbox).
- README under 90 lines, same facts, no em dashes: 88 lines, 0 em dashes.
