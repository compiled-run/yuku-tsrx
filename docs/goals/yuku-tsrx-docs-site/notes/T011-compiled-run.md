# T011 - serve yuku-tsrx at compiled.run/yuku-tsrx

## PR

https://github.com/compiled-run/oxc-tsrx/pull/24

Branch `yuku-tsrx-rewrite` off `origin/main` (b2ddcef, `chore: release v0.5.0`), base `main`.
Not merged: the PM merges after review, because merging triggers the compiled.run
production deploy.

## Diff summary

Two files, 27 insertions and 10 deletions.

`docs/build.mjs`, in the emitted `vercel.json`:

- `rewrites: []` became a proxy pair to the separate `yuku-tsrx-docs` Vercel project:
  `{ source: '/yuku-tsrx', destination: 'https://yuku-tsrx-docs.vercel.app/yuku-tsrx' }`
  and `{ source: '/yuku-tsrx/:path*', destination: 'https://yuku-tsrx-docs.vercel.app/yuku-tsrx/:path*' }`.
  Both sources are needed because `:path*` does not match the bare path. The comment
  above it now says Guessless is embedded statically and yuku-tsrx is proxied.
- The COOP/COEP header `source` went from `'/(.*)'` to `'/((?!yuku-tsrx).*)'`, with a
  comment line saying the proxied yuku-tsrx pages need no cross-origin isolation.
  Guessless is untouched: it is served statically on purpose and has no exclusion.
- The landing page nav gained `<a href="/yuku-tsrx">yuku-tsrx &rarr;</a>` after the
  existing docs link.

`tests/site/launch-build.test.mjs`: the pinned assertions follow the new shape.
`vercel.headers` now deep-equals the single entry with `source: "/((?!yuku-tsrx).*)"`
and the same two COOP/COEP headers; the `rewrites.length === 0` assertion was
replaced by a `deepEqual` against the two yuku-tsrx entries.

## Verification

- Build: `node docs/build.mjs` (the `docs:build` script). Output:
  `built 20 pages, 153 search sections -> docs/dist`. The emitted
  `docs/dist/vercel.json` carries both rewrites and the excluded header source, and
  `docs/dist/index.html` carries `href="/yuku-tsrx"`.
- Tests: `pnpm run test:site:unit`. 36 pass, 0 fail.

## PM follow-up after the PR merges

Once compiled.run/yuku-tsrx is live, in this repo:

1. Switch `docs/site.config.mjs` `origin` from `https://yuku-tsrx-docs.vercel.app` to
   `https://compiled.run`. `base` stays `/yuku-tsrx/`.
2. Rebuild the docs site and redeploy it, so canonical URLs, the sitemap, and
   robots.txt point at the new origin.
3. Update the `README.md` links to the compiled.run URLs.

None of that is done here: this side changes only after the proxy route is live.
