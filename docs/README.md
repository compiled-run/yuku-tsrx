# docs/

The yuku-tsrx documentation site. Static HTML generated from the markdown in
this directory by a small vanilla-JavaScript toolchain, no framework.

## Files

- `site.config.mjs`: title, origin, base path, nav, sidebar order, home hero
  and features. Changing the sidebar changes which pages get built.
- `build.mjs`: the generator. Reads `site.config.mjs`, renders every sidebar
  page from `<link>.md`, and writes `dist/`.
- `highlight.mjs`: shared shiki setup.
- `tsrx.tmLanguage.json`: the TSRX TextMate grammar, vendored so `tsrx` fences
  highlight as TSRX rather than as plain text.
- `demo-sources.mjs`: the one TSRX snippet the home page hero panel shows.
- `assets/style.css`, `assets/app.js`: theme toggle, search dialog, mobile
  drawer, outline scroll spy, copy buttons, client-side routing.
- `assets/fonts/`: self-hosted Space Grotesk (display) and Inter (body).
- `assets/logo.svg`, `assets/hero-rays.svg`: generated art.
- `generate-assets.mjs`: writes those two SVGs. The logo is an at-mark on the
  teal brand gradient; the hero band is 88 light streaks radiating from a fixed
  point, placed by a seeded PRNG so every run produces the same file.
- `generate-social-card.mjs`: writes `assets/social-card.png` (1200x630, the
  `og:image`) and `../.github/assets/readme-hero.png` (the same card with
  rounded corners baked into the alpha channel, for the repo README). It lays
  the card out in HTML, screenshots it at 2x with system Chrome through
  `playwright-core`, then downscales with ImageMagick so the type stays crisp.
  The sentence under the wordmark is read from `site.config.mjs`, so the card
  cannot drift from the home page hero.
- `serve.mjs`: minimal static server for the built site, with the same
  extensionless-route behaviour the deploy has.

`goals/` is internal project state and is not part of the site. The build never
globs this directory: a page exists on the site only if `site.config.mjs` lists
it.

## Commands

```sh
pnpm run docs:build         # write docs/dist/
pnpm run docs:serve         # serve docs/dist/ at http://127.0.0.1:4519/yuku-tsrx/
pnpm run docs:assets        # regenerate assets/logo.svg and assets/hero-rays.svg
pnpm run docs:social-card   # regenerate the OG card and the README hero
```

`docs:assets` is deterministic and safe to re-run. `docs:social-card` needs
Google Chrome and ImageMagick (`magick`) installed locally, and it reads the
logo, so run `docs:assets` first if the mark changed.

## Output layout

The site is served under a base path, so pages land in
`dist/yuku-tsrx/` and the deploy-root files (`vercel.json`, `robots.txt`) sit in
`dist/`. `dist/` is gitignored.

Alongside each page the build writes a `.md` twin (used by the copy-page
button), plus `search-index.json`, `llms.txt`, `llms-full.txt` and
`sitemap.xml`.

## Deploy

The site is a static upload to the Vercel project `yuku-tsrx-docs` in scope
`jack-shelton`, live at <https://compiled.run/yuku-tsrx> (proxied from the yuku-tsrx-docs Vercel project by compiled-run/website).

```sh
pnpm run docs:build
vercel link --cwd docs/dist --project yuku-tsrx-docs --scope jack-shelton --yes
vercel deploy --cwd docs/dist --prod --yes --scope jack-shelton
```

Link after building, not before: the build empties `dist/`, which removes the
`dist/.vercel/` link file written by `vercel link`.
