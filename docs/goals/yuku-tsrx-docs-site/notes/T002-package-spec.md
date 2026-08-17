# T002 Judge note: package spec for the yuku-tsrx docs site

Decision date 2026-08-17. Read: state.yaml, goal.md, notes/T001-site-map.md, then
spot-checked oxc-tsrx/docs (site.config.mjs, build.mjs, generate-assets.mjs,
generate-social-card.mjs, highlight.mjs, serve.mjs, assets/app.js, style.css) and
yuku-tsrx (package.json, pnpm-workspace.yaml, .gitignore, vite.config.ts,
tsconfig.json, .githooks/pre-commit, README.md, npm/yuku-tsrx/index.d.ts,
benchmarks/m6-baseline.json, test/parser/misc/tsrx/). Ran only read-only
commands (`vercel whoami`, `vercel teams ls`, `vercel project ls`).

## 1. Verdict on the Scout plan: approved with amendments

The T001 map is accurate on every claim I checked. Amendments:

- build.mjs is not a "copy verbatim" file. It imports `benchmarks-data.mjs`
  (echarts, acceptance reports), `demo-sources.mjs` (typeAwareCode assert),
  `rolldown` (demo-highlighter bundle), reads `../crates/oxc_adapter/src/lib.rs`
  at module scope, execs `render-diagrams.mjs` (d2) at the top of `build()`,
  and reads `type-error-example.json`, `projection-example.json`,
  `terminal-transcripts.json`. The scaffold package must copy it verbatim and
  then prune those couplings. Everything else (page shell, sidebar, outline,
  prev/next, search index, llms.txt, .md twins, pm tabs, disclosure, filetree,
  sitemap, robots, vercel.json emit, css shell splitting) stays as-is.
- Hard-coded "OXC for TSRX" strings exist in build.mjs (og:image:alt, footer
  links to npmjs.com/oxc-tsrx, home-upstream section, home-bench section).
  These are pruned/rewritten in T003, not left for T005.
- The home page hero code panel (`#hero-demo`) is already a static shiki
  highlighted panel when no wasm engine exists. That IS the "static highlighted
  panel that is trivially cheap". Keep it, drop everything interactive.

## 2. Decisions

| Question | Decision | Why |
|---|---|---|
| Site root | `docs/` (mirrors oxc-tsrx; sidebar-driven build, `docs/goals/` untouched). Add `docs/dist/` and `.vercel/` to `.gitignore`. | Scout verified build.mjs never globs; README.md in oxc says the same. |
| Tooling | Same vanilla generator: marked, minisearch, shiki, playwright-core (social card only). Drop rolldown, echarts, d2, axe-core. Deps go in root `package.json` devDependencies + `pnpm install` (pnpm-workspace only lists `npm/*`; root is the workspace root, fine). Scripts: `docs:build`, `docs:serve`, `docs:assets`, `docs:social-card`. | One lockfile, one install, matches oxc-tsrx layout. |
| Playground | DROP the `/playground` page, nav item, `playground.js`, `interactive.js`, `fuel.js`, `demo-wasm-backend.js`, `demo-capabilities.json`, wasm bundling, COOP/COEP headers. KEEP the static home hero code panel (`.code-panel`) with the README `Cart` snippet, highlighted with the tsrx grammar. | No wasm build; never ship a broken demo. Panel is free. |
| Base path | `base: '/yuku-tsrx/'`, `origin: 'https://yuku-tsrx-docs.vercel.app'`. Deviation from the charter's `base: "/"` default, with reason: both siblings (oxc-tsrx at `/oxc-tsrx/`, guessless at `/guessless/`) build under a base path, and the recorded follow-up (compiled.run/yuku-tsrx via a rewrite in oxc-tsrx build.mjs) only works if pages and assets already live under `/yuku-tsrx/`; a `base: '/'` build would need a rebuild for that step. Root of the Vercel domain gets a `vercel.json` redirect `/` -> `/yuku-tsrx` (temporary), so the landing page is not needed. This is a one-line reversal in `site.config.mjs` if the PM prefers `/`. |
| Deploy | New Vercel project `yuku-tsrx-docs` in scope `jack-shelton` (the scope that already holds `oxc-tsrx-docs` and `guessless-docs`; `vercel project ls` confirms no `yuku-tsrx-docs` yet). Output dir `docs/dist`. Production URL `https://yuku-tsrx-docs.vercel.app/yuku-tsrx`. See section 6. | Charter default. |
| style.css / app.js | Copy verbatim, then prune only: playground/hero-demo interactive imports, `try-button`/playground href handlers, `fuel`, `.comp-chart` observer, `interactive.js` import, and the four em-dash comments. Keep all `#css-pages` regions and CSS_SHELLS (`doc`, `home`, `playground`) so `splitStylesheet` still works; simply do not emit playground.html. Dead CSS is accepted so the look stays identical. | Charter: same components and styling. |
| Fonts, grammar | Copy `assets/fonts/*`, `tsrx.tmLanguage.json`, `highlight.mjs` verbatim. | Verified identical needs. |
| serve.mjs | Copy, delete the demo API (`/api/*`, native binaries, tsgolint import, demo-type-lane import), keep static serving with cleanUrls emulation. | Local serve check. |
| Wordmark | `config.title = 'yuku-tsrx'`; hero name `yuku-tsrx`. Rendered by the existing `.site-title` (Space Grotesk 700). Social card `.name` = `yuku-tsrx`. | Charter. |

## 3. Logo color spec (T004)

Hue family: teal. Reason: teal sits roughly 120 degrees from oxc-tsrx's violet
on the hue wheel, so the same at-mark geometry reads as a different product at
favicon size, while the Tailwind teal ramp gives the same light/dark contrast
ratios the violet ramp had.

Logo `GRAD` (generate-assets.mjs, x1=0 y1=0 x2=1 y2=1):

| offset | oxc-tsrx | yuku-tsrx |
|---|---|---|
| 0 | `#a855f7` | `#14b8a6` |
| 0.55 | `#7c3aed` | `#0d9488` |
| 1 | `#5b21b6` | `#115e59` |

CSS brand vars (style.css `:root` and `html.dark`):

| var | light oxc | light yuku | dark oxc | dark yuku |
|---|---|---|---|---|
| `--c-brand` | `#6d28d9` | `#0f766e` | `#c4b5fd` | `#5eead4` |
| `--c-brand-hover` | `#5b21b6` | `#115e59` | `#ddd6fe` | `#99f6e4` |
| `--c-brand-soft` | `rgba(139,92,246,0.13)` | `rgba(20,184,166,0.13)` | `rgba(139,92,246,0.18)` | `rgba(20,184,166,0.18)` |

Hero band (`hero-rays.svg`, generate-assets.mjs lines 38-53) and every other
purple token: apply this whole-file substitution table to `generate-assets.mjs`,
`assets/style.css` (35 occurrences), `generate-social-card.mjs`:

| oxc | yuku | role |
|---|---|---|
| `#3b0764` | `#042f2e` | band stop 1 |
| `#4c1d95` | `#134e4a` | band stop 0, `.hero` background |
| `#5b21b6` | `#115e59` | band stop 0.5, brand-hover |
| `#6d28d9` | `#0f766e` | brand light |
| `#7c3aed` | `#0d9488` | glow, GRAD mid |
| `#a855f7` | `#14b8a6` | GRAD start |
| `#a78bfa` | `#2dd4bf` | glow start, social gradient end |
| `#c4b5fd` | `#5eead4` | brand dark, social title start, mono |
| `#ddd6fe` | `#99f6e4` | brand-hover dark |
| `#e9d5ff` | `#ccfbf1` | warm streak, social gradient mid, tagline b |
| `#8be9fd` | `#fde68a` | cool streak becomes a warm amber streak so streaks still contrast with a teal band |
| `139, 92, 246` (rgba) | `20, 184, 166` | soft/selection tints (16 occurrences) |
| `#0d0b14` | `#0b1413` | social card background |

Social card title gradient becomes `linear-gradient(115deg, #5eead4 15%, #ccfbf1 50%, #2dd4bf 90%)`.
`mulberry32` seed stays `20260716` (deterministic rays, different colors).
Keep only the `at-mark` candidate; drop the other nine and `assets/logos/`.
Change the `hero-rays` gradient id/comment text if it names OXC. Replace the
10 em dashes in candidate names by removing the candidate list.

## 4. Page list (T003 stubs, T005 content)

Nav: Guide (`/guide/introduction`), Architecture (`/architecture/yuku-dialect`),
Reference (`/reference/api`), GitHub (`https://github.com/compiled-run/yuku-tsrx`).
No Playground, no Integrations.

Sidebar (13 pages):

| link | title | source | facts from |
|---|---|---|---|
| `/guide/introduction` | Introduction | copy-and-rewrite `oxc guide/introduction.md` | README lines 1-19, 111-125; goal.md objective |
| `/guide/getting-started` | Getting Started | copy-and-rewrite `oxc guide/getting-started.md` (drop pm-install tabs, Vite+, setup report) | README Install: unpublished 0.0.0, PR #164, `../yuku-minimal-seam` path, Zig 0.16, `zig build`, `zig build test`, `pnpm test`, `zig-out/npm/yuku-tsrx/` |
| `/guide/tsrx-syntax` | TSRX Syntax Support | copy-and-rewrite `oxc guide/tsrx-syntax.md` | README "What works today"; the 15 fixtures by name |
| `/guide/parser` | Parser | copy-and-rewrite `oxc guide/parsing.md` (drop npm install, oxc-parser comparison) | index.d.ts: `parse`, `parseModule`, `parseWire`, `walk`, `decode`, `encode`, `ParseOptions`, `ParseModuleOptions`, `ParseResult`, `Diagnostic`, node types |
| `/guide/analyzer` | Analyzer | write new (structure of parsing.md) | index.d.ts: `analyze`, `AnalyzeResult`, `SemanticView` (reference/scope/symbol), `decodeAnalyzer`, `semanticErrors` option; src/dialect/semantic.zig, semantic_transfer.zig file names only |
| `/guide/codegen` | Code Generator | write new | index.d.ts: `generate`, `GenerateOptions` (strip, minify, format, indent, quotes, comments), `GenerateResult` (code, errors, map); src/dialect/codegen.zig by name |
| `/architecture/yuku-dialect` | Zig/Yuku Dialect Core | copy-and-rewrite `oxc architecture/rust-oxc-core.md` | README para 2-3 (dialect, 20 extension points, no fork), src/dialect file list (18 .zig files), build.zig.zon path dependency, goal.md rulings |
| `/architecture/upstreaming-to-yuku` | Upstreaming to Yuku | copy-and-rewrite `oxc architecture/upstreaming-to-oxc.md` (drop matrix-filter, review-route, diagrams) | PR #164 link, goal.md "Local link first, PR last", README |
| `/reference/api` | API | write new (replaces CLI page) | every export in index.d.ts, signatures verbatim |
| `/reference/benchmarks` | Benchmarks | copy structure of `oxc reference/benchmarks.md`, static table (no `benchmarks:auto`) | m6-baseline.json: medians 29666.2 vs 103075.4 ns, ratios 0.2878 / 0.8541, node 24.15.0, zig 0.16.0, darwin arm64; README caveats "one measurement" |
| `/reference/platform-support` | Platform Support | copy-and-rewrite `oxc reference/platform-support.md` | 12 `@yuku-tsrx/binding-*` names from npm/yuku-tsrx/package.json, all 0.0.0 and unpublished, build targets only |
| `/reference/limitations` | Limitations | copy-and-rewrite `oxc reference/limitations.md` | README "What does not exist" (no npm publish, no linter, no formatter, no editor integration), invalid fixtures (`*-invalid`), goal.md open problems if quoted verbatim |

Dropped: vite-plus, linting, formatting, configuration, editor,
custom-js-plugins, provider-protocol, embedded-css-boundary (supplemental), cli,
playground, `/logos`.

Home (`docs/index.md` + `renderHomePage`): hero (`yuku-tsrx`, text and tagline
from README para 1), static code panel with the README `Cart` snippet
(file label `src/Cart.tsrx`), `home-bench` section rebuilt as three
`.gate-card`s read from `benchmarks/m6-baseline.json` at build time (median
ns/parse yuku vs @tsrx/core, ratio; caption "one measurement on one machine"),
six `features` rewritten (dialect on Yuku, real parser API, analyzer semantic
view, code generator, TSRX AST names, no fork), `home-upstream` section
rewritten to "Built on the Yuku seam in PR #164". Footer: GitHub link, MIT,
disclaimer "An independent project, not affiliated with the Yuku team". Footer
badge: replace pinned OXC revision with the `benchmarks/m6-baseline.json`
`provenance` date or drop the badge.

Getting Started stubs must never say `npm install yuku-tsrx`.

## 5. Ordered Worker packages

### T003 Scaffold + build green (largest slice; includes stubs so the build proves the whole page tree)

objective: Copy the oxc-tsrx docs generator into `docs/`, retarget it to
yuku-tsrx (title `yuku-tsrx`, base `/yuku-tsrx/`, origin
`https://yuku-tsrx-docs.vercel.app`, repository
`https://github.com/compiled-run/yuku-tsrx`), prune every oxc-only coupling
(benchmarks-data, demo-sources except heroCode, rolldown, d2/render-diagrams,
wasm, playground page, projection/transcript/type-error json, adapter lib.rs
read, COOP/COEP headers, guessless rewrites, landing page), write the 13 stub
pages and home config in section 4, install deps, add scripts, and get
`pnpm run docs:build` and `docs:serve` green.

allowed_files:
- `docs/build.mjs`
- `docs/site.config.mjs`
- `docs/highlight.mjs`
- `docs/tsrx.tmLanguage.json`
- `docs/serve.mjs`
- `docs/demo-sources.mjs`
- `docs/README.md`
- `docs/index.md`
- `docs/guide/*.md`
- `docs/architecture/*.md`
- `docs/reference/*.md`
- `docs/assets/style.css`
- `docs/assets/app.js`
- `docs/assets/fonts/*`
- `docs/assets/brands/*`
- `docs/assets/logo.svg` (temporary copy of the oxc mark; T004 replaces)
- `docs/assets/hero-rays.svg` (temporary copy; T004 replaces)
- `package.json`
- `pnpm-lock.yaml`
- `.gitignore`
- `vite.config.ts` (only to add `docs/**` to `lint.ignorePatterns` if `pnpm vp lint` fails on copied files)

verify:
1. `pnpm install`
2. `pnpm run docs:build`
3. `test -f docs/dist/yuku-tsrx/index.html && test -f docs/dist/yuku-tsrx/guide/introduction.html && test -f docs/dist/yuku-tsrx/guide/parser.html && test -f docs/dist/yuku-tsrx/guide/analyzer.html && test -f docs/dist/yuku-tsrx/guide/codegen.html && test -f docs/dist/yuku-tsrx/reference/api.html && test -f docs/dist/yuku-tsrx/assets/style-doc.css && test -f docs/dist/yuku-tsrx/assets/style-home.css && test -f docs/dist/yuku-tsrx/search-index.json && test -f docs/dist/yuku-tsrx/llms.txt && test -f docs/dist/vercel.json && test -f docs/dist/robots.txt`
4. `test ! -e docs/dist/yuku-tsrx/playground.html && test ! -e docs/dist/yuku-tsrx/assets/playground.js`
5. `node -e 'const v=JSON.parse(require("fs").readFileSync("docs/dist/vercel.json","utf8")); if(!v.cleanUrls||JSON.stringify(v).includes("Cross-Origin")||JSON.stringify(v).includes("guessless")) process.exit(1)'`
6. `! grep -rIl -e "OXC for TSRX" -e "oxlint" -e "oxfmt" -e "Vite+" -e "npm install yuku-tsrx" docs/dist/yuku-tsrx --include=*.html --include=*.md --include=*.txt`
7. `! grep -rIl -e '—' docs --exclude-dir=goals --exclude-dir=node_modules`
8. `grep -q "docs/dist" .gitignore && grep -q ".vercel" .gitignore`
9. `pnpm vp lint`
10. `(node docs/serve.mjs 4519 & pid=$!; sleep 2; curl -sf -o /dev/null http://127.0.0.1:4519/yuku-tsrx/guide/introduction && curl -sf -o /dev/null http://127.0.0.1:4519/yuku-tsrx/; rc=$?; kill $pid; exit $rc)`
11. `git status --porcelain -- src build.zig npm test | wc -l | grep -qx 0`

stop_if:
- Need files outside allowed_files.
- The pruned build still needs a package that is not marked, minisearch, shiki, or playwright-core, and no drop decision above covers it.
- Verification fails twice.

### T004 Logo + assets

objective: Port `generate-assets.mjs` (at-mark only) and
`generate-social-card.mjs` with the section 3 color table and the `yuku-tsrx`
wordmark; regenerate `logo.svg`, `hero-rays.svg`, `social-card.png`,
`.github/assets/readme-hero.png`; apply the same color table to
`assets/style.css`; add `docs:assets` and `docs:social-card` scripts; rebuild.

allowed_files:
- `docs/generate-assets.mjs`
- `docs/generate-social-card.mjs`
- `docs/assets/logo.svg`
- `docs/assets/hero-rays.svg`
- `docs/assets/social-card.png`
- `docs/assets/style.css`
- `docs/README.md`
- `.github/assets/readme-hero.png`
- `package.json`
- `pnpm-lock.yaml`

verify:
1. `node docs/generate-assets.mjs && node docs/generate-social-card.mjs`
2. `grep -q "#14b8a6" docs/assets/logo.svg && grep -q "#0d9488" docs/assets/logo.svg && grep -q "#115e59" docs/assets/logo.svg && ! grep -qi -e "#a855f7" -e "#7c3aed" -e "#5b21b6" docs/assets/logo.svg docs/assets/hero-rays.svg`
3. `! grep -qi -e "#a855f7" -e "#7c3aed" -e "#5b21b6" -e "#6d28d9" -e "#c4b5fd" -e "#a78bfa" -e "#ddd6fe" -e "#e9d5ff" -e "#4c1d95" -e "#3b0764" -e "139, 92, 246" -e "139,92,246" docs/assets/style.css docs/generate-assets.mjs docs/generate-social-card.mjs`
4. `grep -q "0f766e" docs/assets/style.css && grep -q "5eead4" docs/assets/style.css`
5. `magick identify docs/assets/social-card.png | grep -q "1200x630" && test -s .github/assets/readme-hero.png`
6. `grep -q "yuku-tsrx" docs/generate-social-card.mjs && ! grep -q "OXC" docs/generate-social-card.mjs docs/generate-assets.mjs`
7. `pnpm run docs:build && ! grep -rIl -e '—' docs --exclude-dir=goals --exclude-dir=node_modules`

stop_if:
- Need files outside allowed_files.
- `magick` or system Chrome missing (both present today: `/opt/homebrew/bin/magick`, `/Applications/Google Chrome.app`), and no fallback that yields a 1200x630 PNG.
- Verification fails twice.

### T005 Content pages

objective: Replace every stub with real content per the section 4 table
(13 pages + `docs/index.md` frontmatter + `site.config.mjs` hero/features
text if wording changes), every fact traceable to index.d.ts, src/dialect file
names, test/parser/misc/tsrx names, benchmarks/m6-baseline.json, README.md, or
goal.md; no lint/format/LSP/editor claims for yuku-tsrx; unpublished npm and
PR #164 stated on Getting Started and Platform Support.

allowed_files:
- `docs/index.md`
- `docs/guide/*.md`
- `docs/architecture/*.md`
- `docs/reference/*.md`
- `docs/site.config.mjs`
- `docs/build.mjs` (only home page copy strings and the m6 gate cards)

verify:
1. `pnpm run docs:build`
2. `for f in parse analyze generate parseWire parseModule isEventAttribute normalizeEventName walk decode decodeAnalyzer encode; do grep -q "$f" docs/reference/api.md || { echo "missing $f"; exit 1; }; done`
3. `for o in lang sourceType preserveParens semanticErrors attachComments loose collect; do grep -q "$o" docs/guide/parser.md || exit 1; done && for o in strip minify format indent quotes comments; do grep -q "$o" docs/guide/codegen.md || exit 1; done && grep -q "SemanticView" docs/guide/analyzer.md`
4. `grep -q "29666" docs/reference/benchmarks.md || grep -q "29.7" docs/reference/benchmarks.md; grep -q "0.2878\|0.288" docs/reference/benchmarks.md`
5. `grep -q "yuku/pull/164" docs/guide/getting-started.md && grep -qi "not published\|unpublished\|nothing has been published" docs/guide/getting-started.md`
6. `! grep -rIl -e "This page is being written" -e "TODO" docs/guide docs/architecture docs/reference docs/index.md`
7. `! grep -rIil -e "npm install yuku-tsrx" -e "oxlint" -e "oxfmt" -e "language server" -e "VS Code extension" docs/guide docs/architecture docs/reference docs/index.md docs/site.config.mjs`
8. `! grep -rIl -e '—' docs --exclude-dir=goals --exclude-dir=node_modules`
9. `for p in / /guide/introduction /guide/getting-started /guide/tsrx-syntax /guide/parser /guide/analyzer /guide/codegen /architecture/yuku-dialect /architecture/upstreaming-to-yuku /reference/api /reference/benchmarks /reference/platform-support /reference/limitations; do f="docs/dist/yuku-tsrx${p%/}"; [ "$p" = "/" ] && f="docs/dist/yuku-tsrx/index"; test -f "$f.html" || exit 1; done`

stop_if:
- Need files outside allowed_files.
- A page needs a fact that cannot be verified from the repo; leave that sentence out rather than invent it.
- Verification fails twice.

The `oxlint`/`oxfmt` grep in step 7 is intentional: the Architecture page may
name the sibling project `oxc-tsrx` and OXC in a contrast sentence, but must
not name the lint/format tools as anything yuku-tsrx offers. If a contrast
sentence really needs those words, the Worker stops and reports rather than
weakening the check.

### T006 README trim (already specced; confirmed with two amendments)

Keep `allowed_files: [README.md]` and the verify. Add to objective: use
`.github/assets/readme-hero.png` (from T004) at the top and a Docs link to
`https://yuku-tsrx-docs.vercel.app/yuku-tsrx`; remove "no docs site" from the
"What does not exist" sentence but keep "no linter, no formatter, no editor
integration". Order: T006 after T004 (hero) and can run before or after T007;
if T006 runs before T007 the URL is the deterministic project URL above.

### T007 Vercel production deploy

objective: Create the Vercel project `yuku-tsrx-docs` in scope `jack-shelton`,
link `docs/dist` to it non-interactively, deploy `docs/dist` to production, and
prove every nav and sidebar page returns 200 at the production URL.

allowed_files:
- `docs/dist/**` (build output; gitignored)
- `docs/README.md` (record the deploy commands)
- `docs/goals/yuku-tsrx-docs-site/notes/T007-deploy.md` (receipt detail: URL, deployment id, curl table)

verify:
1. `pnpm run docs:build`
2. `vercel project ls --scope jack-shelton 2>/dev/null | grep -q "yuku-tsrx-docs"`
3. `test -f docs/dist/.vercel/project.json && grep -q "yuku-tsrx-docs" docs/dist/.vercel/project.json`
4. `vercel inspect https://yuku-tsrx-docs.vercel.app --scope jack-shelton 2>&1 | grep -qi "production\|ready"`
5. `for p in /yuku-tsrx /yuku-tsrx/guide/introduction /yuku-tsrx/guide/getting-started /yuku-tsrx/guide/tsrx-syntax /yuku-tsrx/guide/parser /yuku-tsrx/guide/analyzer /yuku-tsrx/guide/codegen /yuku-tsrx/architecture/yuku-dialect /yuku-tsrx/architecture/upstreaming-to-yuku /yuku-tsrx/reference/api /yuku-tsrx/reference/benchmarks /yuku-tsrx/reference/platform-support /yuku-tsrx/reference/limitations /yuku-tsrx/assets/logo.svg /yuku-tsrx/assets/social-card.png; do code=$(curl -s -o /dev/null -w '%{http_code}' "https://yuku-tsrx-docs.vercel.app$p"); [ "$code" = 200 ] || { echo "$p $code"; exit 1; }; done`
6. `test "$(curl -s -o /dev/null -w '%{http_code}' https://yuku-tsrx-docs.vercel.app/)" = "307" -o "$(curl -s -o /dev/null -w '%{http_code}' https://yuku-tsrx-docs.vercel.app/)" = "308"`
7. `git status --porcelain | grep -v "^?? docs/goals" | grep -q "docs/dist" && exit 1 || true` (dist stays gitignored)

stop_if:
- Vercel prompts for login, scope selection, or team authorization that `--yes --scope jack-shelton` does not satisfy; record the exact prompt.
- `vercel project ls` already shows `yuku-tsrx-docs` with prior deployments not made by this task (would target an existing unrelated project); or `vercel link` offers to link to any project other than `yuku-tsrx-docs`.
- Verification fails twice.

## 6. Deploy spec

- Project: `yuku-tsrx-docs`, scope `jack-shelton` (the team slug from `vercel teams ls`; it holds `oxc-tsrx-docs` and `guessless-docs`).
- Output dir: `docs/dist` (deploy root; pages under `docs/dist/yuku-tsrx/`, `vercel.json` and `robots.txt` at root).
- vercel.json (emitted by build.mjs): `{"cleanUrls":true,"trailingSlash":false,"redirects":[{"source":"/","destination":"/yuku-tsrx","permanent":false}],"rewrites":[],"headers":[]}`. No COOP/COEP.
- Commands (Vercel CLI 57.0.0 already logged in as jackshelton):
  1. `pnpm run docs:build`
  2. `vercel project add yuku-tsrx-docs --scope jack-shelton` (skip if it exists and was created by this task)
  3. `vercel link --cwd docs/dist --project yuku-tsrx-docs --scope jack-shelton --yes`
  4. `vercel deploy --cwd docs/dist --prod --yes --scope jack-shelton`
  5. Record the printed production URL and `https://yuku-tsrx-docs.vercel.app/yuku-tsrx` in the receipt.
- The link file lives in `docs/dist/.vercel/` and is wiped by every rebuild, so step 3 is repeated before every deploy. `.vercel/` and `docs/dist/` are gitignored (T003).
- Follow-up owner step (not this goal): add `/yuku-tsrx` and `/yuku-tsrx/:path*` rewrites to `https://yuku-tsrx-docs.vercel.app/yuku-tsrx...` in oxc-tsrx `docs/build.mjs` and a landing link, then redeploy oxc-tsrx-docs. Record in the T007 receipt.
- No `--name`, no git integration, no env vars, no build command on Vercel (static upload).

## 7. Order and gates

T003 -> T004 -> T005 -> T006 -> T007 -> T008 (visual/content audit) -> T999.
T004 before T005 only because T005 renders home cards that sit on the recolored
band; either order builds. T006 needs T004's hero PNG. T007 needs T003-T005
merged into the same working tree (single Worker, sequential, no parallelism).
Judge review is due after T005 (content is where the lint/format misfire can
happen) and after T007; T003/T004/T006 need only the checker plus PM diff review.

## 8. Contradiction resolutions from T001

- README oracle "shorter than 143": superseded by T006 verify `< 90` lines. Charter already says under 90.
- compiled.run/yuku-tsrx: not reachable from this repo; production URL is `https://yuku-tsrx-docs.vercel.app/yuku-tsrx`; the rewrite is a recorded follow-up.
- Site root: `docs/`.
- Playground: dropped; static hero panel kept.
- style.css/app.js: verbatim with the pruning list above.
