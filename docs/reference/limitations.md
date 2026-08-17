---
title: Limitations
description: What yuku-tsrx does not do, what does not exist yet, and which TSRX constructs it refuses.
---

# Limitations

This is a library, consumed by a framework's TSRX plugin. It compiles nothing to
a browser on its own. The list below is what that means in practice, stated as
plainly as the features are.

## What does not exist

- **No npm publish.** `yuku-tsrx` is at `0.0.0` and has never been published,
  and neither have the twelve `@yuku-tsrx/binding-*` packages. Building from
  source is the only way to use it. See
  [Getting Started](/guide/getting-started) and
  [Platform Support](/reference/platform-support).
- **No linter.** This project has no lint rules, no rule configuration, and no
  rule runner.
- **No formatter.** It has a code generator, which prints a tree back to source
  with the options in [Code Generator](/guide/codegen). That is not a formatter:
  it does not read a style configuration, and printing a file is not the same as
  formatting it.
- **No editor integration.** Nothing in this repository talks to an editor.
- **No WebAssembly build.** `build.zig` has no wasm target. The only artifact is
  a native addon, so there is no browser build and no interactive playground on
  this site.
- **No documentation of the internals beyond this site.** The dialect's own
  design lives in `goal.md` and in the source. There is no separate internals
  manual, no generated Zig API reference, and no architecture decision log.

## The upstream dependency is an open pull request

The extension points yuku-tsrx builds against are
[yuku-toolchain/yuku#164](https://github.com/yuku-toolchain/yuku/pull/164),
which is open. Until it merges, building requires a Yuku checkout of that branch
in a sibling directory, and `build.zig.zon` declares it by path rather than by
version. There is no date for the merge and this site will not invent one. See
[Upstreaming to Yuku](/architecture/upstreaming-to-yuku).

## Syntax it refuses

Three fixtures in `test/parser/misc/tsrx/` exist to hold the cases that must not
parse silently. Each one produces diagnostics rather than a plausible-looking
tree.

| Fixture | Refused |
| --- | --- |
| `template-return-invalid.module.tsrx` | `return` inside a `@{ }` template block. A `@{ }` that is a function body may return; one in child position may not. |
| `control-flow-switch-invalid.module.tsrx` | `break` and `return` inside a `@switch` case. A `break` belonging to a loop written inside the case is fine. |
| `dynamic-tag-invalid.module.tsrx` | A `<{expr}>` tag name that cannot resolve to an element name: a call, a concatenation, a template literal, an object literal, `undefined`, `void 0`. |

Each of these reports with a message and, where one helps, a help line.
[TSRX Syntax Support](/guide/tsrx-syntax#what-is-rejected) has the exact text.

## Behavior worth knowing before you rely on it

- **`parse` does not throw for bad source.** It returns the diagnostics and
  whatever tree it built. If you want a parse that fails loudly on a module,
  call [`parseModule`](/guide/parser), which throws on the first diagnostic of
  severity `"error"`.
- **Not every early error is fatal.** The redeclaration family is lowered from
  error to warning at the native boundary, so those problems are visible on
  `parse()` and do not fail `parseModule`. The reasoning is in
  `src/dialect/diagnostics.zig`.
- **`semanticErrors` is opt-in on `parse`.** Without it you get grammar
  diagnostics only, not the scope-dependent ones. `parseModule` turns it on for
  you.
- **`generate` only accepts a `Program` from this parser.** It throws a
  `TypeError` on anything else. It is not a general ESTree printer.
- **CSS inside a `<style>` element is not parsed as anything.** It comes back as
  raw source on a `StyleSheet` node, and it produces no symbols and no
  references in the analyzer. If you need it structured, parse it yourself.
- **`decodeAnalyzer` is typed `unknown`.** The analyzer buffer carries more than
  the `SemanticView` interface promises. Treat `AnalyzeResult` as the supported
  shape.

## One benchmark is one benchmark

The performance numbers on this site come from a single run, on a single corpus,
on a single machine, on a single day. There is no continuous performance suite
and no release gate. [Benchmarks](/reference/benchmarks#what-this-is-not) says
what that measurement does and does not support.
