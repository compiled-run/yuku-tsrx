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
- `serve.mjs`: minimal static server for the built site, with the same
  extensionless-route behaviour the deploy has.

`goals/` is internal project state and is not part of the site. The build never
globs this directory: a page exists on the site only if `site.config.mjs` lists
it.

## Commands

```sh
pnpm run docs:build   # write docs/dist/
pnpm run docs:serve   # serve docs/dist/ at http://127.0.0.1:4519/yuku-tsrx/
```

## Output layout

The site is served under a base path, so pages land in
`dist/yuku-tsrx/` and the deploy-root files (`vercel.json`, `robots.txt`) sit in
`dist/`. `dist/` is gitignored.

Alongside each page the build writes a `.md` twin (used by the copy-page
button), plus `search-index.json`, `llms.txt`, `llms-full.txt` and
`sitemap.xml`.
