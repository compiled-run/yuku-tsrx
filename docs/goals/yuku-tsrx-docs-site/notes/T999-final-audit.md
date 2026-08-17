# T999 final audit: yuku-tsrx docs site, logo, README, production deploy

Audited 2026-08-17 13:11-13:20 CDT by the Judge. Read-only apart from this note
and one fresh screenshot, `notes/T008/final-home.png`. Every oracle item below
was re-run in this session; receipts were not trusted for any of them.

Verdict: **complete**. `full_outcome_complete: true`.

## Original request mapped to receipts

| Request clause (goal.md Original Request) | Receipt(s) | Re-verified here |
| --- | --- | --- |
| "Make the README way less wording" | T006 (141 to 88 lines, same facts) | `wc -l` 88; hero, docs URL, PR #164, parseModule present |
| "Copy the oxc-tsrx logo (new gradient, colors changed a little, yuku-tsrx wordmark)" | T004 | logo.svg carries #14b8a6/#0d9488/#115e59, no purple; screenshot shows teal at-mark + `yuku-tsrx` wordmark |
| "the oxc-tsrx docs site style and components" | T003, T004, T008 | final-home.png vs oxc-home-desktop.png: same nav/search/hero/band/code panel/metric cards/feature grid/CTA/footer |
| "focus on parser, analyzer, codegen instead of lint/format" | T005, T008 | pages guide/parser, analyzer, codegen, reference/api; lint/format/editor appear only as negatives on Limitations |
| "full Vercel deploy" | T007, T009 | `vercel inspect` target production, status Ready; 15 paths 200; root 307 |
| goal prep / fable-opus cockpit / 15m loop | process, T003-T009 summaries | not an artifact; not judged |

## Oracle results

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | `pnpm run docs:build` exits 0 | pass | "built 13 pages, 90 search sections"; EXIT=0; working tree still clean after build |
| 2 | 13 pages + logo.svg + social-card.png return 200; root redirects | pass | all 15 = 200; `/` = 307 to https://yuku-tsrx-docs.vercel.app/yuku-tsrx |
| 3 | `vercel inspect` production Ready | pass | id dpl_BrB1TeiY16BnZ1HHBcEpe372R5Zd, target production, status Ready, aliases yuku-tsrx-docs.vercel.app and yuku-tsrx-docs-jack-shelton.vercel.app. See note A. |
| 4 | Forbidden terms in live HTML, README.md, docs/**/*.md | pass with one note | em dash 0/0; "Generated with" 0/0; oxlint 0/0; oxfmt 0/0; "npm install yuku-tsrx" 0/0; MIT on home 0. "Claude" 0 in sources; 12 hits in live HTML, all the "Open in Claude" item of the Copy-page menu, a component copied from oxc-tsrx (same string on compiled.run/oxc-tsrx). Not attribution; classified pass. |
| 5 | README under 90 lines with required tokens | pass | 88 lines; readme-hero.png x1, yuku-tsrx-docs.vercel.app x6, yuku/pull/164 x1, parseModule x3 |
| 6 | Logo teal stops present, no oxc purple in logo/hero-rays/style.css/generators | pass | each teal stop x1; purple grep (14 tokens incl. rgba, #d6d3e1, #e912a8) rc=1 (no matches); style.css has 0f766e x6, 5eead4 x9 |
| 7 | Structure parity vs oxc-tsrx | pass | final-home.png (1440px, live) vs oxc-home-desktop.png: nav (logo, Search Cmd-K, Guide/Architecture/Reference, GitHub, theme), hero (mark, gradient wordmark, tagline, two CTAs), rays band with code panel, metric cards, 6-card feature grid, CTA, footer (GitHub + disclaimer; oxc adds pinned hash and MIT). Guide page (yuku-guide-parser-desktop.png): sidebar, outline rail with read time, Copy page dropdown, code blocks with language tags, same as oxc-guide-parsing-desktop.png. Intended drops: Playground, Integrations, wasm demo buttons. |
| 8 | Five facts vs repo | pass | (a) reference/api names all 11 exports found in npm/yuku-tsrx/index.d.ts; (b) benchmarks page 29,666.2 / 103,075.4 / 0.2878 / 0.8541 / v24.15.0 / Zig 0.16.0 / Apple M5 Pro = benchmarks/m6-baseline.json; (c) tsrx-syntax names exactly the 15 fixtures in test/parser/misc/tsrx/; (d) getting-started quotes `.yuku = .{ .path = "../yuku-minimal-seam" }` and minimum_zig_version 0.16.0 = build.zig.zon; (e) platform-support "twelve" binding packages at 0.0.0 = npm/yuku-tsrx/package.json optionalDependencies (12) |
| 9 | No lint/format/LSP/playground/editor advertised | pass | "lint", "playground", "editor integration" occur only on Limitations as "No linter / No formatter / no interactive playground / No editor integration"; "language server", "VS Code" 0 hits; other "format"/"extension" hits are wire format / extension points |
| 10 | Clean tree; product dirs untouched by docs commits | pass | `git status --porcelain` empty; `git diff --stat f7cbafc..HEAD -- src build.zig npm test` empty; docs commits touch only docs/, README.md, .github/assets/readme-hero.png, .gitignore, package.json, pnpm-lock.yaml; no AI trailers in the 7 docs commit messages |

Additional: all 13 live pages plus logo.svg and social-card.png are byte-identical
to the fresh local build from HEAD (`cmp`), so the production deploy is exactly
the committed source.

### Note A: deployment id differs from the T009 receipt

T009 recorded dpl_8auutaHzYEWzakrBjp43ogZTqD8Y (13:09). `vercel ls` shows a
third production deployment dpl_BrB1TeiY16BnZ1HHBcEpe372R5Zd at 13:11:52 by the
same account (jackshelton), now aliased. Its content is byte-identical to the
HEAD build, so it is a redeploy of the same artifact (presumably the PM after
committing 01a9c97). Not a defect; recorded so the receipt trail is honest.

## Board state

- No queued or active Worker tasks. T001-T009 all done; T999 is the only active task.
- Deploy is production, not preview.
- Working tree clean.

## Owner follow-ups (not blockers, all recorded)

1. LICENSE choice: repo has no LICENSE file; the footer no longer claims MIT.
   Once a license is chosen, set `footer.copyright` in docs/site.config.mjs and redeploy.
2. compiled.run/yuku-tsrx: add a rewrite pair in oxc-tsrx docs/build.mjs pointing at
   https://yuku-tsrx-docs.vercel.app/yuku-tsrx (T007 note). No rebuild needed.
3. Product bug: npm/yuku-tsrx/index.d.ts:233 declares `quotes: "shortest"` (and
   `minify: true` expands to it) but src/dialect/codegen.zig:611 is
   `Quotes = enum { preserve, double, single }`; the native boundary throws.
   codegen.md carries a caveat; product fix is outside this goal.
4. src/dialect/abi.zig `Hook` enum has 19 members vs 20 hook fns in
   parser_extension.zig (T005 flag). Outside this goal.
5. Push: `git status -sb` shows `agent/yuku-tsrx-toolchain...origin/agent/yuku-tsrx-toolchain [ahead 7]`.
   The seven docs commits (2d5b4dd..01a9c97) are local only and on the agent
   branch, not main. Push and merge to main are owner actions.
6. Cosmetic leftovers from T008: unused assets/style-playground.css shell (C4),
   benchmarks "alternates" wording (C5), Claude-Session trailers on older
   product commits (C6).

## Missing evidence

None for the outcome. Screenshots for the final proof exist under notes/T008/
(home and guide, both sites, desktop/mobile/dark) plus final-home.png here.
