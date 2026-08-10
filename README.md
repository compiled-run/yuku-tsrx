# yuku-tsrx

A Zig parser for `.tsrx`, built as a **dialect adapter on
[Yuku](https://github.com/yuku-toolchain/yuku)** — not a fork, and not a second
parser engine beside it.

Markless and Frameless already parse `.tsrx` today, through `@tsrx/core`: 976K of
pure JavaScript. This replaces that parser under the interface they already use.
Their compilers pattern-match on TSRX node types directly — `JSXCodeBlock`,
`TSRXExpression`, `JSXStyleElement`, `TSRXForOfStatement` — so the output has to
be a real TSRX AST, with those exact names. In Markless, a function is a
component *iff* its body is a `JSXCodeBlock`; that check is the entry point of
the whole compiler.

That rules out the tempting shortcut. A TSRX→TSX compiler destroys exactly the
nodes both consumers are built on, and Markless already owns the lowering anyway.
`oxc-tsrx` built such a projection and still needed a 17,057-line parser engine
underneath it.

Yuku does all JavaScript and TypeScript work. `yuku-tsrx` owns only what is
specific to TSRX, and reaches Yuku through a compile-time dialect seam — 19 hook
sites, extracted from prior art into a table. A Yuku built without a dialect
emits the same code it does today.

**Status: not started.** This repository currently contains its charter only.

Read [`goal.md`](./goal.md) first. It carries the completed reconnaissance — the
consumer evidence, what Yuku exposes and withholds, where the seam already exists
in prior art, the two open design problems, and the oracle that defines done. The
strongest item in that oracle: swap Markless's `parseModule` for `yuku-tsrx` and
its existing test suite passes unmodified.
