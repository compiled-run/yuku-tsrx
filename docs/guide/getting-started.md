---
title: Getting Started
description: Build yuku-tsrx from source against a sibling Yuku checkout, and consume the built package from another project.
---

# Getting Started

There is no npm package yet. The package name is `yuku-tsrx` and the version in
`npm/yuku-tsrx/package.json` is `0.0.0`; nothing has been published, and neither
are the twelve `@yuku-tsrx/binding-*` packages that carry the native addon. So
getting started means building from source.

## What you need

- **Zig 0.16.** `build.zig.zon` sets `.minimum_zig_version = "0.16.0"`.
- **pnpm**, for the JavaScript side.
- **A Yuku checkout of the branch in [yuku-toolchain/yuku#164](https://github.com/yuku-toolchain/yuku/pull/164)**,
  in a sibling directory named `yuku-minimal-seam`.

That last one is the part that is not optional. The compile-time extension
points yuku-tsrx builds against are the subject of that pull request, which is
open, and `build.zig.zon` declares the dependency by path:

```zig
.yuku = .{ .path = "../yuku-minimal-seam" },
```

A path dependency resolves relative to this repository, so the two folders sit
side by side:

```
dev/
  yuku-minimal-seam/     the Yuku branch from PR #164
  yuku-tsrx/             this repository
```

<!-- details:Why a path dependency rather than a pinned URL -->
The owner ruling recorded in `goal.md` is "Local link first, PR last": build
against the local path the whole way, keep the Yuku-side diff under pressure to
shrink, and open the upstream pull request only once the whole system is green.
A path dependency is what makes that loop fast, and it is why the checkout is a
prerequisite rather than something the build fetches for you. When PR #164
merges, the path dependency becomes a normal versioned one. See
[Upstreaming to Yuku](/architecture/upstreaming-to-yuku).
<!-- /details -->

## Build

```sh
zig build            # builds the addon and writes the package to zig-out/npm/yuku-tsrx/
zig build test       # the Zig test suite
pnpm test            # the JavaScript test suite
```

`zig build` is the one that produces something you can import. It writes a
complete npm package layout into `zig-out/npm/yuku-tsrx/`: `index.js`,
`index.d.ts`, `package.json`, the generated decoders (`decode.js`,
`decode-analyzer.js`, `encode.js`), `walk.js`, and a `binding.js` that loads the
native addon built for your machine.

Run the two test suites before you trust the result. `zig build test` covers the
dialect itself; `pnpm test` covers the JavaScript surface, including the fixtures
in `test/parser/misc/tsrx/`.

## Use the built package from another project

`zig-out/npm/yuku-tsrx/` is a real package directory, so a consuming project
points at it with a `link:` dependency:

```json
{
  "dependencies": {
    "yuku-tsrx": "link:../yuku-tsrx/zig-out/npm/yuku-tsrx"
  }
}
```

Then import it the way you would any ESM package:

```js
import { parseModule, walk } from "yuku-tsrx";

const program = parseModule(source, "Cart.tsrx");

walk(program, {
  JSXCodeBlock(node) {
    // every TSRX code block in the file
  },
});
```

That is how Markless consumes it. Markless parses `.tsrx` today through
`@tsrx/core`, and `parseModule(source, filename, options)` is shaped as a
drop-in for `@tsrx/core`'s `parseModule`, so the link is the only change at the
call site. On 2026-08-17, against the head of PR #164, Markless's node test
suite (229 files, 1832 tests) passed with yuku-tsrx swapped in for `@tsrx/core`
and no test edits, and its typescript-plugin completion matrix was 47/47.

Rebuild with `zig build` after any change to the dialect or to the sibling Yuku
checkout. A `link:` dependency reads the directory on disk, so the consuming
project picks the new build up without reinstalling.

## Where to go next

- [TSRX Syntax Support](/guide/tsrx-syntax) for what the parser accepts and what
  it rejects.
- [Parser](/guide/parser) for `parse`, `parseModule`, options, and diagnostics.
- [API](/reference/api) for every export with its signature.
- [Limitations](/reference/limitations) for what this library deliberately does
  not do.
