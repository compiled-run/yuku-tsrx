---
title: Platform Support
description: The twelve platforms yuku-tsrx builds a native addon for, none of them published, and how the addon is found at runtime.
---

# Platform Support

yuku-tsrx is a native addon with a JavaScript wrapper, so every platform needs
its own compiled artifact. `npm/yuku-tsrx/package.json` names twelve of them as
optional dependencies.

Read this page as a list of build targets. It is not a list of tested platforms
and not a list of published packages, because there are none of the latter.

## Nothing is published

All twelve packages are at version `0.0.0` and none of them exists on npm.
Neither does `yuku-tsrx` itself. There is no install to run. The way to get a
working addon today is to build it, which
[Getting Started](/guide/getting-started) covers.

That is why this page has no tiers, no "guaranteed to work" column, and no
per-platform test claims. Publishing a platform is a weaker promise than testing
one, and this project has not made the weaker promise yet.

## The twelve targets

| Package | Platform |
| --- | --- |
| `@yuku-tsrx/binding-darwin-arm64` | macOS, arm64 |
| `@yuku-tsrx/binding-darwin-x64` | macOS, x64 |
| `@yuku-tsrx/binding-linux-x64-gnu` | Linux, x64, glibc |
| `@yuku-tsrx/binding-linux-x64-musl` | Linux, x64, musl |
| `@yuku-tsrx/binding-linux-arm64-gnu` | Linux, arm64, glibc |
| `@yuku-tsrx/binding-linux-arm64-musl` | Linux, arm64, musl |
| `@yuku-tsrx/binding-linux-arm-gnu` | Linux, arm, glibc |
| `@yuku-tsrx/binding-linux-arm-musl` | Linux, arm, musl |
| `@yuku-tsrx/binding-win32-x64` | Windows, x64 |
| `@yuku-tsrx/binding-win32-arm64` | Windows, arm64 |
| `@yuku-tsrx/binding-android-arm64` | Android, arm64 |
| `@yuku-tsrx/binding-freebsd-x64` | FreeBSD, x64 |

The only one this project has run on is the one the benchmark ran on: darwin
arm64, an Apple M5 Pro. See [Benchmarks](/reference/benchmarks#provenance).

## How the addon is loaded

The wrapper never names a platform. `npm/yuku-tsrx/index.js` imports a default
export from `binding.js`, and `binding.js` is the file that resolves the addon
for the machine it is running on.

It builds a suffix from `process.platform` and `process.arch`. On Linux it adds
`-gnu` or `-musl`, decided by reading the running process's own report for a
glibc runtime version rather than by guessing from the distribution. That suffix
is exactly the part after `binding-` in the package names above.

With the suffix in hand it tries two locations, in order:

1. `./@yuku-tsrx/binding-<suffix>/yuku-tsrx.node`, next to the package. This is
   the local build, which is what `zig build` writes into
   `zig-out/npm/yuku-tsrx/`.
2. `@yuku-tsrx/binding-<suffix>/yuku-tsrx.node`, resolved as a package. This is
   the path a published install would take.

If both fail it throws
`Failed to load @yuku-tsrx native binding for <suffix>`, with both underlying
errors attached as the cause. There is no fallback: no JavaScript
implementation, no WebAssembly build, nothing that quietly does something else.

Because the optional dependencies do not resolve to anything today, only the
first location works, and only after `zig build`.

## Node version

The package is ESM and the loader uses `node:module` and `node:url`. The
repository pins `pnpm@10.33.2` and ran its benchmark on Node v24.15.0. No
minimum Node version is declared anywhere in the package, so treat "the Node the
project builds and tests with" as the only version known to work.
