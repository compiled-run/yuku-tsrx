# compiled.run website: a neutral repo owns the domain and its rewrites

## Objective
Stop oxc-tsrx's docs build from deciding what compiled.run serves. Create `compiled-run/website`, a tiny static landing plus `vercel.json` rewrites (one pair per project) and a deploy workflow, on its own Vercel project; prove every route on the project URL; move `compiled.run` to it; retire the oxc-tsrx-side rewrite PR; point yuku-tsrx at `compiled.run/yuku-tsrx`. From then on each project PRs its rewrite line to the website repo.

## Original Request
"oxc-tsrx should NOT be the one that decides all of our rewrites and what deploys etc. Use fable opus cockpit, 15m /loop and make a new compiled.run/website repo or something that holds all of the rewrites there, and we make PRs to that repo instead."

## Goal Oracle
`https://compiled.run/` is served by the website project; `/oxc-tsrx`, `/oxc-tsrx/guide/introduction`, `/oxc-tsrx/playground` (crossOriginIsolated true), `/guessless`, `/yuku-tsrx`, `/yuku-tsrx/guide/introduction`, `/yuku-tsrx/playground` all 200 through rewrites; the domain is attached to the website project; the repo exists with the rewrites and a main-to-production workflow; oxc-tsrx PR #24 is closed as superseded; yuku-tsrx docs and README point at compiled.run/yuku-tsrx.

## Non-Negotiable Constraints
- Sequence: deploy the website project, prove all routes and cross-origin isolation on its own URL, THEN move the domain. Never move first.
- Proxy rewrites, never embedded builds. Why: embedding recreates the coupling.
- COOP/COEP headers scoped to `/oxc-tsrx` paths only (its wasm playground needs them); nothing else gets them.
- No em dashes, no AI attribution in the new repo, commits, PR comments, or workflow.
- Workers write the new repo through Bash (the scope guard only permits Edit/Write under this checkout); every diff is reviewed by the PM before push.
- Do not delete or reconfigure the oxc-tsrx-docs or guessless-docs projects. Only the domain attachment moves.

## Canonical Board
`docs/goals/compiled-run-website/state.yaml`

## Run Command
`/goal Follow docs/goals/compiled-run-website/goal.md.` under `/loop 15m`.
