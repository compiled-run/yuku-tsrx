# T002 pre-cutover audit: compiled-run-website

Date: 2026-08-17. Judge, read only. Current = https://compiled.run (oxc-tsrx-docs). New = https://compiled-run-website.vercel.app.

Decision: approve cutover. No route that is 200 on current fails or degrades on new. Isolation is correct on new. One non-cutover defect in the deploy workflow (below), plus cosmetic notes.

## 1. Route parity (curl, status | title | COOP/COEP | canonical)

| path | current | new |
| --- | --- | --- |
| / | 200, "compiled.run", COOP+COEP, links only oxc-tsrx | 200, "compiled.run", no COOP/COEP, links oxc-tsrx, guessless, yuku-tsrx |
| /oxc-tsrx | 200, "OXC for TSRX", COOP+COEP, canon compiled.run/oxc-tsrx | same |
| /oxc-tsrx/ | 308 -> /oxc-tsrx | 308 -> /oxc-tsrx |
| /oxc-tsrx/guide/introduction | 200, "Introduction \| OXC for TSRX", COOP+COEP, canon compiled.run | same |
| /oxc-tsrx/guide/getting-started | 200, "Getting Started \| OXC for TSRX", COOP+COEP | same |
| /oxc-tsrx/reference/cli | 200, "CLI Reference \| OXC for TSRX", COOP+COEP | same |
| /oxc-tsrx/playground | 200, "Playground \| OXC for TSRX", COOP+COEP | same |
| /oxc-tsrx/llms.txt | 200 text/plain, COOP+COEP | same |
| /oxc-tsrx/llms-full.txt | 200 | 200 |
| /oxc-tsrx/sitemap.xml | 200 application/xml | same |
| all 20 URLs in /oxc-tsrx/sitemap.xml | 200 | 200 (0 mismatches) |
| /oxc-tsrx/index.html | 308 -> /oxc-tsrx | same |
| /oxc-tsrx/nonexistent | 404 | 404 |
| /guessless | 200, "Guessless — Agents shouldn't grade their own homework.", COOP+COEP (leaks from oxc config) | 200, same title, no COOP/COEP |
| /guessless/ | 308 -> /guessless | 308 -> /guessless |
| /guessless/index.html | 308 -> /guessless | same |
| /guessless/favicon.ico, /apple-touch-icon.png, /favicon-32x32.png | 200 | 200 |
| guessless subpage | none: single page site; assets /guessless/assets/*.png, /guessless/support.js, /guessless/uploads/* all load (browser check below) | same |
| /yuku-tsrx | 404 | 200, "yuku-tsrx", no COOP/COEP, canon yuku-tsrx-docs.vercel.app (expected, flipped in T004) |
| /yuku-tsrx/ | 308 -> /yuku-tsrx | 308 -> /yuku-tsrx |
| /yuku-tsrx/guide/introduction | 404 | 200, "Introduction \| yuku-tsrx" |
| /yuku-tsrx/playground | 404 | 200, "Playground \| yuku-tsrx" |
| /yuku-tsrx/reference/api | 404 | 200, "API \| yuku-tsrx" |
| /yuku-tsrx/assets/wasm/yuku-tsrx.wasm | 404 | 200 application/wasm |
| /robots.txt | 200 | 200 |
| /sitemap.xml, /llms.txt, /favicon.ico, /playground, /OXC-TSRX, /nonexistent | 404 | 404 |

No path is 200 on current and non-200 on new. Trailing-slash and index.html redirects are identical (308 to clean URL) on both hosts. Uppercase paths and /playground shortcut are 404 on both.

## 2. Assets (headless Chrome, system Chrome via playwright-core, networkidle + 3 s)

| page (new host) | requests | failed (requestfailed or >= 400) | console errors |
| --- | --- | --- | --- |
| /oxc-tsrx/ | 11 | 0 | 0 |
| /oxc-tsrx | 10 | 0 | 0 |
| /guessless | 22 | 0 | 0; fonts.googleapis.com css, fonts.gstatic.com woff2, cdn.simpleicons.org npm/github/javascript/typescript all 200 |
| /yuku-tsrx/ | 15 | 0 | 0 |
| /yuku-tsrx | 14 | 0 | 0 |
| / | 1 | 0 | 1: favicon.ico 404 (identical on current compiled.run; cosmetic) |

## 3. Cross-origin isolation

- /oxc-tsrx/playground on new: crossOriginIsolated === true. Readiness signal: the page's status line renders "✓ lint clean · oxlint found nothing / 1 canonical parse · 95 rules · diagnostics on original bytes / compiled in 22 ms" and the output pane shows the compiled source (`/*_t0_0*/` markers), so the wasm compiler ran. 13 requests, 0 failed, 0 console errors.
- /yuku-tsrx/playground on new: status "parsed in 7.30 ms · 92 nodes · 0 diagnostics · runs in your browser". 0 failed, 0 console errors. crossOriginIsolated false (correct, no COEP needed).

## 4. Headers

COOP same-origin + COEP require-corp present on new for /oxc-tsrx, /oxc-tsrx/guide/*, /oxc-tsrx/reference/cli, /oxc-tsrx/playground, /oxc-tsrx/llms.txt, /oxc-tsrx/sitemap.xml. Absent on /, /guessless, /yuku-tsrx, /yuku-tsrx/*, /robots.txt. This is an improvement over current, where oxc-tsrx-docs applies COOP/COEP to / and /guessless too.

## 5. Redirects

Current redirects: /oxc-tsrx/ -> /oxc-tsrx, /guessless/ -> /guessless, /yuku-tsrx/ -> /yuku-tsrx, */index.html -> clean URL, all 308. New host reproduces every one of them (cleanUrls + trailingSlash false). Nothing else redirects on current.

## 6. Landing

New /: three links, /oxc-tsrx, /guessless, /yuku-tsrx, each resolved 200. Current /: one link (/oxc-tsrx), as expected.

## 7. Repo (/Users/jacksm5pro/dev/open-source/compiled-run-website, main cfebd0c)

- vercel.json: cleanUrls true, trailingSlash false, exactly six rewrites (bare + /:path* for oxc-tsrx, guessless, yuku-tsrx), headers only for /oxc-tsrx and /oxc-tsrx/(.*). Correct.
- deploy.yml: on push main + workflow_dispatch, environment production, `vercel@57.0.0 deploy --prod --yes`, then curls /, /oxc-tsrx, /guessless, /yuku-tsrx expecting 200. Structure correct.
- README: explains proxy model, the two-rewrite rule, when to add COOP/COEP, the VERCEL_TOKEN secret. Correct.
- No em dashes, no AI attribution in tracked files or the commit message. Tracked files: deploy.yml, .gitignore, README.md, index.html, robots.txt, vercel.json. .env.local and .vercel/ are gitignored and untracked.

Defect (not cutover-blocking, blocks the oracle's "workflow deploys main to production"):
- The route check curls the deployment URL printed by `vercel deploy` (for example compiled-run-website-iupx106eo-jack-shelton.vercel.app). That URL is behind Vercel Deployment Protection and returns 302 to vercel.com/sso-api for every path, so the check will fail with "returned 302" even after VERCEL_TOKEN is set. Verified: all four paths return 302 on the deployment URL, 200 on the production alias.
- VERCEL_TOKEN is not set (repo and production environment secrets are empty); run 32079415468 failed at the guard. Owner action.

## 8. Robots / SEO

/robots.txt 200 on new. Canonicals in proxied oxc-tsrx pages point at https://compiled.run/oxc-tsrx/... (good). yuku-tsrx canonicals point at https://yuku-tsrx-docs.vercel.app/yuku-tsrx/... (expected until T004 flips origin).

## Blocking defects
None.

## Cosmetic / follow-up
1. deploy.yml route check must target the production alias (https://compiled-run-website.vercel.app, and after cutover https://compiled.run) instead of the protected deployment URL. Fix package below.
2. VERCEL_TOKEN secret must be added on the production environment (owner).
3. /favicon.ico is 404 on the landing on both hosts; optional.
4. yuku-tsrx canonicals flip in T004.

## Fix package (post-cutover or in parallel, disjoint from T003)
- objective: In compiled-run/website deploy.yml, check routes against the production alias rather than the deployment URL (use https://compiled.run once the domain is attached, or read the alias from `vercel inspect`), keep the four-route loop, push to main.
- allowed_files: /Users/jacksm5pro/dev/open-source/compiled-run-website/.github/workflows/deploy.yml, /Users/jacksm5pro/dev/open-source/compiled-run-website/README.md
- verify: `grep -q 'compiled.run' .github/workflows/deploy.yml`; `! grep -q 'steps.deploy.outputs.url' .github/workflows/deploy.yml || grep -q 'x-vercel-protection-bypass' .github/workflows/deploy.yml`; `gh run list -R compiled-run/website --limit 1` shows success once VERCEL_TOKEN is set.
