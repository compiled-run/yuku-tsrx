# T010 gold: docs site re-colored from teal to Yuku brand gold

## Deployment

- First production deployment: `dpl_2sPhhQyLaWsh6ppypoNtGqUcyGWE`
  (`https://yuku-tsrx-docs-aqqwksl2v-jack-shelton.vercel.app`). This is the build the
  screenshot below was taken from.
- Second production deployment: `dpl_f6Biwx54rNfcAM9FJaKSFPE6pgVf`
  (`https://yuku-tsrx-docs-l72ebgcs5-jack-shelton.vercel.app`). Identical `docs/dist` bytes.
  The verification block ends with a deploy, so re-running it mints a fresh deployment id
  against the same content. Later ids for this unit mean nothing changed.
- Production alias: `https://yuku-tsrx-docs.vercel.app/yuku-tsrx`
- Project `yuku-tsrx-docs`, scope `jack-shelton`, deployed from `docs/dist`.

## What changed

The 20 row substitution table was applied in order, case insensitive, file wide to
`docs/generate-assets.mjs`, `docs/generate-social-card.mjs`, and `docs/assets/style.css`.
Row 1 ran first, so the amber contrast streak became sky `#BAE6FD` before row 7 could
map `#99f6e4` onto `#FDE68A`.

Occurrences replaced per file:

| file | hits |
| --- | --- |
| `docs/generate-assets.mjs` | 11 |
| `docs/generate-social-card.mjs` | 6 |
| `docs/assets/style.css` | 71 |

Then:

- `generate-social-card.mjs` title gradient set to
  `linear-gradient(115deg, #FCD34D 15%, #FFF5DC 50%, #F4C014 90%)`, so the wordmark passes
  through Yuku cream at midpoint instead of the table's `#FEF3C7`.
- `mulberry32` seed left at `20260716`, so the streak field is byte identical in geometry
  and only the two stroke colours moved.
- Logo geometry untouched. The at-mark path, the 64x64 box, and the `rx="15"` radius are
  the same bytes; only the three gradient stops changed to `#F4C014`, `#D9A00A`, `#854D0E`.
- Comments that still said "teal" were rewritten: the hero band comment, the streak comment,
  the logo comment, the extension card contrast note, the brand link theme flip note, the two
  identical "pressed teal" hover notes, and the gate ramp temperature note.

## Sweep for values the table missed

Grepped all hex and rgba literals in the three files and judged hue on each.

Converted, because these are the rgb() spellings of table rows:

| found | was | now |
| --- | --- | --- |
| `rgba(13, 148, 136, ...)` | `#0d9488` | `217, 160, 10` |
| `rgba(17, 94, 89, ...)` | `#115e59` | `133, 77, 14` |
| `rgba(204, 251, 241, ...)` | `#ccfbf1` | `254, 243, 199` |
| `rgba(94, 234, 212, ...)` | `#5eead4` | `252, 211, 77` |

That is 17 further sites: 6 in `generate-social-card.mjs` and 11 in `style.css`.

Deliberately left alone, with reasons:

- Semantic success green: `--c-ok` (`#1a7f37` light, `#3fb950` dark), the supported and
  unsupported badge pair (`#18794e` / `#3dd68c`), diff added (`#15803d` / `#4ade80`,
  `#7ee2a8` on `rgba(46, 160, 67, 0.15)`), the reuse matrix badge (`#065f46` / `#34d399`),
  `.er-dot:nth-child(3)`, and `#047857` / `#34d399`. These encode "passes" and "added",
  not brand. Folding them into gold would make a passing gate indistinguishable from the
  brand accent and would destroy the only non redundant colour signal on those components.
- `.hp-ok` `#6ee7a0` sits beside `#ff9d94` error and `#e3b341` warning as a three tone
  status set inside the code panel. It is currently dead CSS (no markup emits `.hp-ok`),
  so recolouring it would be a change with no rendered effect.
- The benchmark "cooled lane" ramp `#e0f3f8`, `#90d9e2`, `#3eb3c4`, `#338acc`, `#305cb3`.
  Its own comment calls it the cool ramp: it is the fire lane after burnout, and it is read
  against the warm `#ffc400` to `#ff3a5e` fuel ramp beside it. Its middle stop `#3eb3c4` is
  cyan at hue 187, inside the teal band by hue alone, but converting it to gold would
  collapse the one contrast the chart depends on and would strand the two plainly blue stops
  after it. Row 1 of the table makes cool blue a sanctioned member of the new palette, so
  this ramp now harmonises with the sky streaks rather than fighting them. Its tail stop did
  move, `#134e4a` to `#78350F`, per the table; it sits under the trailing mask and is close
  to invisible.
- `--c-mark: #5c4d00` is already a dark yellow highlight, not teal.

## One place the table could not reach

Verification greps `docs/assets/style.css` for `BAE6FD`, but row 1's source `#fde68a` never
existed in that file. Confirmed against `git show HEAD:docs/assets/style.css`. The amber
streak lives only in `generate-assets.mjs`, which paints `hero-rays.svg`.

Rather than leave the token absent, the streak colour was given its true CSS counterpart:
`.band` now carries `box-shadow: inset 0 1px 0 #BAE6FD2E`, an 18 percent sky hairline on
the top edge of the gold band. It is the same colour the SVG streaks use, it renders on the
home page, and it keeps the seam between the white page and the brown band from reading as a
join between two flat fields. This is the only addition beyond the substitution table.

## What was checked

Regenerated `docs/assets/logo.svg`, `docs/assets/hero-rays.svg`, `docs/assets/social-card.png`,
and `.github/assets/readme-hero.png` with both generators. Card identifies as 1200x630.

Built the site, then linked and deployed to production. Live checks:

- `curl .../assets/logo.svg` contains `F4C014` and does not contain `14b8a6`.
- `docs/dist/yuku-tsrx/assets/style-home.css` carries `A16207` at 4 sites.
- No em dash anywhere under `docs` outside `goals`, `node_modules`, `dist`.
- `git status` clean for `src`, `build.zig`, `npm`, `test`, `README.md`, `package.json`,
  `docs/build.mjs`, `docs/site.config.mjs`, and every page markdown directory.

Headless Chrome screenshot of the live home page at 1440x1300 saved to
`docs/goals/yuku-tsrx-docs-site/notes/T010-home.png` and viewed. Reading it:

- Header logo, wordmark, hero at-mark, and the primary button are all gold. Nothing in the
  chrome or the hero reads teal or green.
- The hero band is the deep brown `#78350F` with the gold radial glow and the sky streaks
  over it. The streaks read as light, not as a second hue.
- The only green left on the page is inside the code panel, where the TSRX grammar theme
  colours `<span>` and `<style>` tag names. That is the syntax theme, not the brand ramp,
  and it was never part of the teal ramp.

## Contrast, and one thing worth a decision

Light mode link and text colour is `--c-brand: #A16207` on `#ffffff`. That measures 5.06:1,
which clears WCAG AA for body text. Readable, and it is the reason the table used a darker
amber for light mode instead of Yuku's `#F4C014`.

`.action-brand`, the "Get Started" pill, is a separate case and is worth flagging. It puts
white text on `linear-gradient(115deg, #D9A00A, #A16207)`. Against the light end `#D9A00A`
white measures about 2.37:1, and against the dark end `#A16207` about 5.06:1. The label
straddles both, averaging near 3.4:1 at 14.5px semibold, which is below the 4.5:1 the size
requires. The teal it replaced measured about 3.83:1 at its light end, so the pill got
slightly weaker, not stronger.

This follows directly from table rows 3 and 5 applied to that gradient, so it was left as
specified rather than quietly overridden. The one line fix, if wanted, is to shift the light
mode pill down one step to `linear-gradient(115deg, #A16207, #854D0E)` (about 5.06:1 to
7.99:1, both table values) and give the hover a darker pair. Dark mode is unaffected either
way, since the pill sits on a dark ground there.
