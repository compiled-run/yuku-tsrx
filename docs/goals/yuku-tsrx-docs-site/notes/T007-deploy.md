# T007 receipt: Vercel production deploy

Deployed 2026-08-17 from `docs/dist` to a new Vercel project in scope
`jack-shelton`. No custom domain, no env vars, no git integration, static
upload only.

## URLs and ids

| item | value |
|---|---|
| production alias | `https://yuku-tsrx-docs.vercel.app` |
| site entry point | `https://yuku-tsrx-docs.vercel.app/yuku-tsrx` |
| deployment id | `dpl_UNcnyCY3pyerN1Py4wZyWGx5UUVb` |
| deployment URL | `https://yuku-tsrx-docs-ii040h1p6-jack-shelton.vercel.app` |
| inspector | `https://vercel.com/jack-shelton/yuku-tsrx-docs/UNcnyCY3pyerN1Py4wZyWGx5UUVb` |
| project id | `prj_6vMmCmo9ARaA4hKUlWWaY8VhwiaY` |
| org id | `team_4TrBQsvIkFM0lYTqh08Fqxgd` |
| project name | `yuku-tsrx-docs` |
| target / state | production / Ready |
| second alias | `https://yuku-tsrx-docs-jack-shelton.vercel.app` |

`vercel project ls --scope jack-shelton` showed no `yuku-tsrx-docs` before this
run, so the project was created here and holds no deployment made by anyone
else.

## Commands run, in order

```sh
pnpm run docs:build
vercel whoami                                    # jackshelton
vercel project ls --scope jack-shelton           # confirmed yuku-tsrx-docs absent
vercel project add yuku-tsrx-docs --scope jack-shelton
vercel link --cwd docs/dist --project yuku-tsrx-docs --scope jack-shelton --yes
vercel deploy --cwd docs/dist --prod --yes --scope jack-shelton
vercel inspect https://yuku-tsrx-docs.vercel.app --scope jack-shelton
```

`build.mjs` removes `docs/dist/` at the start of every build, so the link file
`docs/dist/.vercel/project.json` is wiped by a rebuild. Link after building,
never before. `vercel link` also wrote `docs/dist/.env.local` and
`docs/dist/.gitignore`; both sit inside the gitignored output directory.

## HTTP status table

All against `https://yuku-tsrx-docs.vercel.app`, checked after the deploy
reported Ready.

| path | status |
|---|---|
| `/` | 307 to `/yuku-tsrx` |
| `/yuku-tsrx` | 200 |
| `/yuku-tsrx/guide/introduction` | 200 |
| `/yuku-tsrx/guide/getting-started` | 200 |
| `/yuku-tsrx/guide/tsrx-syntax` | 200 |
| `/yuku-tsrx/guide/parser` | 200 |
| `/yuku-tsrx/guide/analyzer` | 200 |
| `/yuku-tsrx/guide/codegen` | 200 |
| `/yuku-tsrx/architecture/yuku-dialect` | 200 |
| `/yuku-tsrx/architecture/upstreaming-to-yuku` | 200 |
| `/yuku-tsrx/reference/api` | 200 |
| `/yuku-tsrx/reference/benchmarks` | 200 |
| `/yuku-tsrx/reference/platform-support` | 200 |
| `/yuku-tsrx/reference/limitations` | 200 |
| `/yuku-tsrx/assets/logo.svg` | 200 |
| `/yuku-tsrx/assets/social-card.png` | 200 |

Extensionless page URLs work because the emitted `vercel.json` sets
`cleanUrls: true` and `trailingSlash: false`; the root redirect is the
temporary (`permanent: false`) `/` to `/yuku-tsrx` entry in the same file.

## Owner follow-up

To serve at compiled.run/yuku-tsrx, add a rewrite pair in oxc-tsrx
`docs/build.mjs` (the same shape as its `/guessless` rewrite) pointing at
`https://yuku-tsrx-docs.vercel.app/yuku-tsrx`; the site is already built under
base `/yuku-tsrx/` so no rebuild is needed.
