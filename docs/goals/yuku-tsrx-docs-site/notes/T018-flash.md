# T018 flash pass: brighter hero band and gradient button

Owner note on the gold pass: the yellow looked off, the band read mustard, and
the dark hero was a muddy brown. The logo mark was fine and is untouched.

## What changed

`docs/generate-assets.mjs` (hero band SVG)

- `#base` linear gradient is now a saturated gold field: `#F59E0B` at the top,
  `#F4C014` at mid, `#B45309` at the bottom. It was `#78350F` / `#854D0E` /
  `#451A03`, which is what made the band read as mud.
- `#glow` radial is warmer and stronger: `#FFF5DC` at 0.55, `#FDE68A` at 0.28,
  `#F4C014` fading to 0.
- Streaks: warm rays are `#FFFBEB` (was `#FEF3C7`) at base opacity 0.14 plus
  `rand() * 0.14`; the cool minority stays `#BAE6FD` at base 0.12. Count went
  88 to 120 and max stroke width 2.1 to 2.6 so the rays carry from a distance.
- Seed stays `20260716`. `logo.svg` regenerates byte-identical:
  `git diff --stat docs/assets/logo.svg` is empty.

`docs/assets/style.css`

- `.band` base color `#78350F` to `#D97706`, so the color behind the SVG matches
  the new field instead of darkening it.
- `.hero::before` glows are larger and roughly 2x stronger in light, and the dark
  variant swaps the brown `rgba(133, 77, 14, 0.22)` lobe for
  `rgba(217, 119, 6, 0.30)`.
- The dark hero base needed no change: the dark page background is the neutral
  `--c-bg: #1b1b1f`, not a brown, so the gold glows already sit on near-black.
  No `html.dark .hero` or `html.dark body` brown existed to override, and the
  global `--c-bg` token was left alone.
- `.action-brand` is now a bright gold gradient
  (`#FDE047` / `#F4C014` / `#F59E0B`) with `#1F1502` text, hover
  (`#FACC15` / `#F59E0B` / `#D97706`). Added `html.dark .action-brand` and its
  hover with the same gradients and `#1A1508` text. Dark ink on bright gold is
  above 10:1, so the dark theme no longer needs the dark-amber compromise.
- `.hero-logo` drop shadow is `rgba(244, 192, 20, 0.55)` at 28px blur, so the
  mark glows without changing the mark.
- `.hero-name` light gradient is `#D9A00A` / `#F4C014` / `#B45309`; the dark
  gradient is unchanged.

## Screenshots

Both captured against the live production URL with headless Chrome at
1440x1300. Light is the default render of
`https://yuku-tsrx-docs.vercel.app/yuku-tsrx`. For dark, `--force-dark-mode`
was enough: the inline theme script in `docs/build.mjs` falls back to
`matchMedia('(prefers-color-scheme: dark)')` when no `yuku-tsrx-theme` key is
in `localStorage`, which is exactly the state of a fresh headless profile. No
HTML injection was needed.

- `notes/T018-light.png`: vivid, not muddy. The band is a bright saturated gold
  at the top deepening to burnt amber at the bottom, with the ray streaks
  clearly legible across the full width. The Get Started button is an obvious
  yellow-to-amber gradient with near-black text. The hero above the band is a
  soft cream wash on white, which reads clean rather than washed out.
- `notes/T018-dark.png`: vivid, not muddy. The hero sits on the neutral
  near-black page with a warm amber bloom behind the logo and headline, so there
  is no brown cast anywhere. The band below is the same bright gold as light
  mode and is the strongest element on the page. The button gradient and dark
  text are identical to light mode and remain high contrast.

## Deployment

- Deployment id: `dpl_8yHBuZHgS5DHCdHesXzLxCZeVU9H`
- URL: `https://yuku-tsrx-docs-1vf3xhb40-jack-shelton.vercel.app`
- Aliases: `https://yuku-tsrx-docs.vercel.app`,
  `https://yuku-tsrx-docs-jack-shelton.vercel.app`
- Project `yuku-tsrx-docs`, scope `jack-shelton`, deployed from `docs/dist`.

The verification step re-runs the build and deploy, so a later deployment id for
identical content is expected. The screenshots above were taken from the
deployment listed here.
