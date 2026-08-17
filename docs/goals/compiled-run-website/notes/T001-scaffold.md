# T001 scaffold: compiled-run/website

- Repo: https://github.com/compiled-run/website (main, cfebd0c "compiled.run: landing, rewrites, and deploy workflow")
- Local checkout: /Users/jacksm5pro/dev/open-source/compiled-run-website
- Vercel project: compiled-run-website, id prj_YrOA5nLHClfuxUjfOtRNjuVWeJuZ, org team_4TrBQsvIkFM0lYTqh08Fqxgd, scope jack-shelton
- Production URL (project alias, no custom domain yet): https://compiled-run-website.vercel.app (deployment compiled-run-website-iupx106eo-jack-shelton.vercel.app, target production, Ready)
- Executed by the PM as Worker fallback: two cockpit attempts died on transient API 500s before writing anything (recorded as killed).

Route table on the project URL:

| path | status |
| --- | --- |
| / | 200 |
| /oxc-tsrx | 200 |
| /oxc-tsrx/guide/introduction | 200 |
| /oxc-tsrx/playground | 200, COOP same-origin + COEP require-corp present |
| /guessless | 200, no COOP/COEP |
| /yuku-tsrx | 200, no COOP/COEP |
| /yuku-tsrx/guide/introduction | 200 |
| /yuku-tsrx/playground | 200 |
| /yuku-tsrx/assets/wasm/yuku-tsrx.wasm | 200, content-type application/wasm |

Headless Chrome (playwright-core, system Chrome):
- /oxc-tsrx/playground: crossOriginIsolated: true, title "Playground | OXC for TSRX", 0 console errors
- /yuku-tsrx/playground: status "parsed in 9.60 ms · 92 nodes · 0 diagnostics · runs in your browser", 0 console errors

Domain compiled.run NOT touched (still on oxc-tsrx-docs). Workflow needs the VERCEL_TOKEN secret set on the repo's production environment before it can deploy from CI.
