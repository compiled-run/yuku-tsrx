# T020 orange rebrand

## Verdict

Yes. The band now reads as a deep, saturated orange and the dark code panel sits
on it the way it did on the original violet band, instead of floating on a
bright field.

The `#base` gradient runs `#C2410C` at the top, `#EA580C` through the middle,
`#7C2D12` at the bottom, so the band is dark enough that the near-black panel
reads as a raised object with real depth rather than a hole punched in a bright
sheet. The streaks were dialled back at the same time (warm `#FFEDD5` at base
opacity 0.09 plus `rand()*0.10`, cool `#BAE6FD` minority at base 0.10), so the
rays now read as light texture in the field rather than white bars crossing the
panel. Geometry is unchanged: 120 streaks, seed 20260716.

The band verdict holds in both themes. Light and dark render the band
identically, which is intended, since the band is its own surface. In dark the
hero above it is near-black with a warm orange bloom, so the page steps
black to deep orange to black panel, and the panel still separates cleanly.

## What changed

- `docs/generate-assets.mjs`: `#base` and `#glow` gradients, streak colours and
  opacities, `GRAD` logo gradient (`#F97316` / `#EA580C` / `#9A3412`), comments.
- `docs/generate-social-card.mjs`: card background `#140A05`, glow and grid
  rgba triples, token colour `#FB923C`, title gradient
  `linear-gradient(115deg, #FDBA74 15%, #FFEDD5 50%, #FB923C 90%)`, tagline
  neutral warmed from `#b5b5ad` to `#b5aba8`.
- `docs/assets/style.css`: full substitution table applied, brand light
  `#C2410C` (5.3:1 on white), brand dark `#FB923C`, `.band` base colour
  `#C2410C`, `.action-brand` gradient
  `linear-gradient(115deg, #FDBA74 0%, #F97316 55%, #EA580C 100%)` with dark
  text `#431407` on light and `#2A1207` on dark, hover
  `#FB923C, #EA580C, #C2410C`.
- Regenerated `logo.svg`, `hero-rays.svg`, `social-card.png` (1200x630) and
  `.github/assets/readme-hero.png`.

## Sweep notes

Beyond the numbered table, these gold-family values were found and converted:

- `rgba(254, 243, 199, a)` (the old `#FEF3C7` as a triple, used for band text,
  rules and borders) to `rgba(255, 237, 213, a)`.
- `rgba(252, 211, 77, a)` (old `#FCD34D`) to `rgba(251, 146, 60, a)`, in both
  the CSS and the social card grid lines.
- `rgba(217, 160, 10, a)` to `rgba(234, 88, 12, a)` and `rgba(133, 77, 14, a)`
  to `rgba(154, 52, 18, a)` in the social card glow.
- `.matrix-badge-adapt` foreground `#92400e` to `#9A3412`.
- `--c-mark` (text highlight) `#fff3b8` to `#FFDCC0` light, `#5c4d00` to
  `#5C2A0E` dark. `#FFEDD5` was too pale to read as a highlight on white, so the
  light value is one step deeper in the same family.

Deliberately left alone, because they are functional palettes rather than brand:

- `--c-warn` (`#9a6700` light, `#d29922` dark), `#e3b341` and
  `rgba(210, 153, 34, a)`. These are the terminal and diagnostic warning
  colours. Turning them orange would make a warning indistinguishable from the
  brand accent.
- The perf gate flame ramp (`#ffc400`, `#ffe066`, `#ffa726`, `#ff7a1a`, and the
  red end). It is a sequential heat scale whose whole point is a yellow start
  running into ember; recolouring the start would flatten it. The one remaining
  comment mentioning gold describes that ramp and is still accurate.

## Deployment

- Deployment id: `dpl_5BZtBGJp424yL7ZrhSJDcrsKWM18`
- URL: https://yuku-tsrx-docs-b54qixc6a-jack-shelton.vercel.app
- Alias: https://yuku-tsrx-docs.vercel.app/yuku-tsrx
- Screenshots: `T020-light.png` (default) and `T020-dark.png`
  (`--force-dark-mode`), both 1440x1300 headless Chrome against the live alias.
