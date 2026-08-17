---
title: Upstreaming to Yuku
description: What yuku-tsrx asks of Yuku, why it is one open pull request, and what changes for you when it merges.
---

# Upstreaming to Yuku

yuku-tsrx needs one thing from Yuku: a place to be called from. That is
[yuku-toolchain/yuku#164](https://github.com/yuku-toolchain/yuku/pull/164), and
it is open.

Until it merges, building yuku-tsrx means having a Yuku checkout of that branch
in a sibling directory, because `build.zig.zon` declares the dependency by path:

```zig
.yuku = .{ .path = "../yuku-minimal-seam" },
```

[Getting Started](/guide/getting-started) has the setup.

## What the pull request contains

A compile-time dialect parameter, and the call sites that consult it. A dialect
is a plain struct of optional hook declarations. Yuku checks for each
declaration at compile time and calls it if it is there.

There are twenty such points, listed in
[Zig/Yuku Dialect Core](/architecture/yuku-dialect#the-twenty-extension-points).
They are all in the parser and the lexer: where a statement, an expression, or a
JSX child begins; where a function body starts; where a for-of head ends; where
a JSX tag name and its closing partner are read; where JSX text stops and how it
is decoded; where a binding pattern is recognized; where a module specifier is
read.

Yuku never learns the word "tsrx". The oracle in `goal.md` states it as a
checkable condition: a grep for `tsrx` across the Yuku checkout's `src/` returns
zero hits, and all TSRX knowledge lives in `yuku-tsrx`.

## Zero cost when no dialect is bound

This is the property the pull request has to hold, and the reason the seam is
compile-time rather than a plugin registry.

With no dialect bound, every hook is comptime-known absent and the branch does
not exist in the emitted code. With a dialect bound, hooks are comptime function
pointers, resolved and inlinable: no vtable, no runtime indirection, no
`anyopaque`. A seam that introduced dynamic dispatch into the parse loop would
have failed on its own terms.

`goal.md` makes it a completion condition rather than an assertion: a
dialect-free Yuku build is proven equivalent to pre-seam Yuku, by identical
emitted binary, or by benchmark parity within a stated tolerance on Yuku's own
`profiler/`, measured on one machine, plus the surviving `@sizeOf(Node) == 52`
assertion.

The same technique runs in the other direction inside this repository. The
dialect's own code guards on what the host provides, with `comptime
@hasDecl(Host, ...)` checks in `src/dialect/control_flow.zig`, so a hook body
compiles against the host it is given rather than a host it assumed.

There is one dialect at a time. No composition, no plugin registry, no ordering
semantics. That generality is not needed here and would cost the properties
above.

## Why the pull request comes last

Two owner rulings in `goal.md` set the shape of this project, and both are
binding:

1. **No fork.** Use as much of Yuku as possible without forking it. An adapter
   that then allows extending it.
2. **Local link first, PR last.** Use a local link, and make the pull request
   for the minimal changes Yuku needs only after the entire system is working.

So yuku-tsrx builds against a path-linked local Yuku checkout the whole way, the
Yuku-side changes accumulate on a local branch, and the branch becomes the pull
request only once parser, analyzer, codegen, and the TypeScript surface are all
green end to end.

The reason to work this way is not politeness. Every line in the Yuku-side diff
is a line that has to be defended upstream later, so keeping it under continuous
pressure to shrink while the design is still moving is cheaper than arguing
about a large diff after the fact. Opening the pull request early would freeze
the seam before the three surfaces had tested it.

<!-- details:What "minimal" is measured against -->
The prior art is a working TSRX-in-Yuku commit that did the obvious thing:
edit the parser in place. Counted across that commit, it was nineteen hook sites
in eight files, plus a language-variant gate. Nineteen hardcoded branches naming
one dialect is a dispatch table that has not been extracted yet, and extracting
it is the central engineering act of this project. The pull request is that
extraction, which is why its diff is a seam and not a feature.
<!-- /details -->

## What changes when it merges

For the dialect itself, nothing. The hook declarations in
`src/dialect/parser_extension.zig` are what Yuku calls either way, and the node
types, the wire format, and the JavaScript API are unaffected.

What changes is the build:

| Today | After the merge |
| --- | --- |
| A sibling `../yuku-minimal-seam` checkout of the PR branch is required | Yuku resolves as an ordinary versioned dependency |
| `build.zig.zon` declares `.yuku = .{ .path = "../yuku-minimal-seam" }` | The path dependency becomes a normal one |
| Building means cloning two repositories | Building means cloning one |

Nothing about that is scheduled, and this page will not guess at a date. The
pull request is open, and [Limitations](/reference/limitations) lists it among
the things that do not exist yet rather than among the things that are coming.
