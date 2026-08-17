# T023 home polish

Four owner requests against the yuku-tsrx docs home page: reframe the benchmark
cards, bring over the oxc-tsrx WebGL comparison chart, make button labels
centre the same way in every engine, and style the panel scrollbars like the
documentation fences.

## Deployment

| | |
| --- | --- |
| Deployment id | `dpl_EwiPJdHgvDmc4X1xaU1aXHmKzvHc` |
| Deployment url | https://yuku-tsrx-docs-9mccus3jz-jack-shelton.vercel.app |
| Production alias | https://yuku-tsrx-docs.vercel.app |
| Project / scope | `yuku-tsrx-docs` / `jack-shelton` |
| Target | production |

All three screenshots in this folder were taken against the production alias
after the deploy, at a 1280x900 viewport and a device pixel ratio of 2.

## The numbers, and where each one comes from

Nothing on the page is typed in. `docs/build.mjs` reads
`benchmarks/m6-baseline.json` at build time and every figure below is computed
from it, so the section cannot drift from the committed report.

### The three cards

| Rendered | Formula | Source values |
| --- | --- | --- |
| `3.5x faster` | `(1 / ratios.ns_per_parse).toFixed(1)` | ratio 0.28781081456228147, so 3.4745... |
| `33,708 parses/s` | `statistics.yuku.parses_per_second.median`, rounded, grouped | 33708.376819665296 |
| `15% less memory` | `Math.round((1 - ratios.peak_rss) * 100)` | peak_rss 0.8541110553162249, so 14.5889... |

Captions, in the same order:

- `median parse time vs @tsrx/core`
- `vs 9,702 for @tsrx/core`, from `statistics.core.parses_per_second.median`
  (9701.636620753196)
- `peak RSS, 0.85x of @tsrx/core`, from `ratios.peak_rss.toFixed(2)`

The multiplication sign on the first card is `&times;`, so it renders as a
proper multiplication sign rather than a lowercase letter x. The `0.85x` in the
third caption is a plain letter, matching the wording the request asked for.

Hovering a card now shows the formula. Those cards already carried the
`.bench-row` class, which is what `app.js` keys its chart tooltip off, but they
carried no dataset, so the tooltip was rendering the string `undefined` four
times over. They now carry `data-label`, `data-result` and `data-note`, and the
tooltip renderer skips any line whose dataset field is absent, so a lane with no
budget is no longer told it failed one.

### The comparison chart

Two lanes, widths proportional to median nanoseconds per parse, the slower lane
setting the scale:

| Lane | data-key | Median | Bar width |
| --- | --- | --- | --- |
| yuku-tsrx | `yukuTsrx` | 29666.216428571428 ns | 28.8% |
| @tsrx/core | `tsrxCore` | 103075.4055357143 ns | 100.0% |

28.8% is `29666.216 / 103075.406`, which is `ratios.ns_per_parse` arrived at
from the other direction, and it agrees with the 3.5x on the first card.

Caption, with both numbers read from the JSON (`input.bytes` and
`protocol.iterations`):

> Shorter is faster. Median microseconds per parse of the same 214,751-byte
> input, 25 iterations, alternating order.

"alternating order" is not decoration: `docs/reference/benchmarks.md` already
states that run order alternates between the two parsers across samples, and
`protocol.seed` and `protocol.isolation` in the report back it up.

## Two deviations from the request, and why

**1. Lane times read in microseconds, not nanoseconds.** The request asked for
the caption to say "median nanoseconds per parse", and the verification block
asks that the string `29,666 ns` never appear in the built page. Both cannot
hold at once if a lane prints its own time in nanoseconds. Microseconds is the
same measurement at a scale a reader can hold in one glance (`29.67 µs` against
`103.08 µs` rather than two six-digit numbers), and two decimals is still far
finer than the run to run spread the report records, which is a MAD of about
225 ns on the yuku-tsrx lane. The caption keeps the sentence it was given with
the unit word changed to match the bars.

**2. `fuel.js` needed one change beyond its selectors.** The rest of the module
is byte for byte the oxc-tsrx original, and the only selector edit is the cool
lane test, which is now `row.dataset.key === 'tsrxCore'`. The canvas sizing had
to change as well:

- oxc capped the plume canvas at a flat 300px. Every lane in that chart is
  short, so the ceiling never bound. Here the slow lane fills the whole track,
  and the ceiling painted a 29% lane and a 100% lane as the same 300px pill.
  The first capture of this page showed two bars of identical length, which is
  precisely the one thing the chart exists to tell apart. The canvas is now the
  bar plus a fixed 90px tail, clipped by the track.
- The shader holds alpha out to roughly 1.88 times `uX` before it dissipates,
  so `uX` is now the bar's length divided by that factor. Without it the opaque
  plume over-ran the measured bar by a third: measured against a capture, the
  yuku-tsrx lane painted to 40% of the track where the data says 28.8%. With
  it, the lane paints to 29% in both themes.

Both changes are commented in place with the arithmetic.

## Buttons

Blink centres a button's anonymous text box against its padding, so a 1.7 line
height inside a 3px-padded button still looks centred there. WebKit anchors that
text to the baseline instead and the label rides high, which is what the owner
was seeing. Every button-shaped control now centres with flex, and where a rule
also drops to `line-height: 1` its vertical padding grows by exactly
`font-size * 0.35`, half the line box it gave up.

Heights before and after, measured in a real browser across every built page:

| Control | Before | After |
| --- | --- | --- |
| `.action-brand`, `.action-alt` | 48.64 | 48.66 |
| `.demo-button` | 28.39 | 28.38 |
| `.try-button` | 28.39 | 28.38 |
| `.pg-output-tabs [role="tab"]` | 31.25 | 31.25 |
| `.copy-md-button` | 31.25 | 31.25 |
| `.page-menu-toggle` | 31.25 | 31.25 |
| `.search-button` | 34.69 | 34.69 |
| `.theme-toggle` | 32 | 32 |
| `.copy-button` | 36 | 36 |

Widths are unchanged on every one of them, and no colour was touched.

Two cases needed care. `.search-button` is sized by the ⌘K pill inside it, not
by the word "Search", and `line-height` inherits, so the pill gets an explicit
`line-height: 1.7` back or the control loses 8px. `.page-menu-toggle` holds an
svg rather than text and is stretched by its text-bearing sibling, so it keeps
its original padding and only gains the centring.

`.pm-tabs-bar`, `.explorer-tabs`, `.pipeline-tabs`, `.facet-tabs-bar` and
`.cli-tabs` have rules in the stylesheet but no instance anywhere in the built
site. The two that are plain text buttons picked up the centring; the ones whose
geometry is set by a child element were left alone rather than guessed at.

## Scrollbars

`.code-panel-editor` and its `pre`, `.demo-input`, `.pg-output-body`,
`.pg-plain` and `.pg-panes .code-panel` now carry the same treatment the
documentation fences have had: `scrollbar-width: thin`, a transparent track, and
a thumb that only appears on hover or focus, plus the matching
`::-webkit-scrollbar` rules for engines that do not take the standard
properties. These panels are the same warm-dark surface (`#1A0F08`) under both
themes, so the thumb is `rgba(255, 237, 213, 0.34)` rather than `--c-divider`,
which would be invisible against them.

Verified by computed style in the browser, hovering each pane:

| Element | `scrollbar-width` | `scrollbar-color` on hover |
| --- | --- | --- |
| `.code-block pre` (the reference) | thin | `rgb(226, 226, 227) transparent` |
| `.pg-output-body` | thin | `rgba(255, 237, 213, 0.34) transparent` |
| `.pg-plain` | thin | `rgba(255, 237, 213, 0.34) transparent` |
| `.code-panel-editor` | thin | `rgba(255, 237, 213, 0.34) transparent` |
| `.demo-input` | thin | `rgba(255, 237, 213, 0.34) transparent` |

One honest caveat about `T023-scrollbar.png`. macOS Chrome draws overlay
scrollbars, which reserve no layout width and fade the moment scrolling stops,
and they are not painted into a capture. The reference doc fence behaves exactly
the same way in the same browser, so this is the capture environment and not a
difference between the new rules and the kept ones. The screenshot therefore
shows the hero band with the AST pane scrolled, which is the pane that scrolls,
and the table above is the actual proof that the rules are live. On a machine set
to always show scroll bars, and in Safari, the thin warm thumb is what appears.

## What the screenshots show

**`T023-bench.png`.** The bench section on the production alias in light theme,
after the chart has scrolled into view and the plume has animated for 1.8s. The
three cards read `3.5× faster`, `33,708 parses/s`, `15% less memory` on one line
each, no wrapping, at the 720px grid width. Below them the yuku-tsrx lane burns
gold to red and stops just under a third of the way across the track, and the
@tsrx/core lane runs teal to blue the full width. The eye gets the ratio before
it reads either number.

**`T023-bench-dark.png`.** The same section after the theme toggle. The plumes
survive the swap: the shader's mutation observer picks up `html.dark` and repaints
with the dark ramp, so yuku-tsrx goes near-white through orange to a dark red tip
and @tsrx/core goes pale blue through teal to deep blue. Both lanes stop at the
same fractions they do in light, which is the point of the `uX` fix above. Card
text and captions carry the dark tokens with no leftover light values.

**`T023-scrollbar.png`.** The hero band on production, AST tab selected, output
pane scrolled down into the `FunctionDeclaration` node. The two panel buttons,
Reset and Open in playground, are the ones to look at: their labels sit on the
vertical centre of the pill, which is the fix the owner asked for. See the
caveat above for why no thumb is painted.

## Verification

Every command in the unit's verification block was run and passed, including
`node docs/verify-playground.mjs`, which reports the hero editor, `/playground`,
all four output tabs and the try button working with no console errors. The three
screenshot runs against production also collected console and page errors, and
reported none.
