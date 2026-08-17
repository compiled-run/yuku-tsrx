---
title: Introduction
description: What yuku-tsrx is, what a .tsrx file is, and who the library is for.
---

# Introduction

A `.tsrx` file is TypeScript with HTML-like markup in it, plus blocks like
`@if` and `@for` for showing something only sometimes, or once per item in a
list. yuku-tsrx reads those files.

It is a parser, an analyzer, and a code generator for `.tsrx`, written in Zig,
with a JavaScript API on top of a native addon. You call it from Node, you get
back a real TSRX syntax tree, and you can hand a tree back to it and get source
out again.

```js
import { parseModule, walk } from "yuku-tsrx";

const program = parseModule(source, "Cart.tsrx");

walk(program, {
  JSXCodeBlock(node) {
    // every TSRX code block in the file
  },
});
```

## What a `.tsrx` file looks like

```tsrx
export function Cart({ items }): unknown @{
  const total = items.length;

  <section className="cart">
    @if (total > 0) {
      @for (const item of items; index i; key item.id) {
        <span>{i}:{item.id}</span>
      } @empty {
        <span>empty</span>
      }
    } @else {
      <span>no cart</span>
    }
    <style>.cart { display: grid; }</style>
  </section>
}
```

Three things in that file are not TypeScript and not JSX: the `@{ }` code block
that lets statements and markup sit next to each other, the `@if` / `@for`
directives with their `; index` and `; key` clauses and `@empty` branch, and the
`<style>` element holding raw CSS. [TSRX Syntax Support](/guide/tsrx-syntax) has
each construct with a real example.

## A dialect on Yuku, not a fork

yuku-tsrx is built as a compile-time **dialect** on
[Yuku](https://github.com/yuku-toolchain/yuku), a JavaScript and TypeScript
toolchain written in Zig. It is not a fork of Yuku and not a second parser
engine beside it.

Yuku does all the JavaScript and TypeScript work. yuku-tsrx owns only the rules
that are specific to TSRX, and reaches Yuku through the hook declarations in
`src/dialect/parser_extension.zig`. A dialect is a plain struct of optional hook
declarations resolved at compile time, so a Yuku built without a dialect
compiles to exactly what it did before.

The other way to get here is to write a parallel engine, which is what the
sibling project [oxc-tsrx](https://github.com/compiled-run/oxc-tsrx) had to do:
[OXC](https://oxc.rs)'s parser has no extension point, so its TSRX support
carries a 17,057-line parser engine that is mostly plain TypeScript parsing done
a second time. The dialect design exists to avoid owning that copy.
[Zig/Yuku Dialect Core](/architecture/yuku-dialect) has the mechanism.

Five steps take a `.tsrx` file to the JavaScript API, and the interesting part
of each one is who owns it:

<!-- how-it-works -->

## Who it is for

This is a library for people building tooling that has to understand `.tsrx`
source: a framework's TSRX plugin, a compiler, a bundler plugin, a codemod, an
analysis tool.

The output is a real TSRX AST. Consumers pattern-match on the node type names
directly, `JSXCodeBlock`, `TSRXExpression`, `JSXStyleElement`,
`JSXForExpression`, and so on, so the parser produces those exact names rather
than lowering TSRX to TSX. In
[Markless](https://github.com/compiled-run/markless), a function is a component
if and only if its body is a `JSXCodeBlock`, so a lowering that erased the name
would erase the answer.

`parseModule(source, filename, options)` is shaped as a drop-in for
`@tsrx/core`'s `parseModule`, which is the interface Markless already calls, so
a consumer on that interface can swap engines without changing its call sites.

## Status

Nothing has been published to npm. The package name is `yuku-tsrx` and the
version in `npm/yuku-tsrx/package.json` is `0.0.0`. The extension points it
builds against live in [yuku-toolchain/yuku#164](https://github.com/yuku-toolchain/yuku/pull/164),
which is open, so building today means a Yuku checkout of that branch in a
sibling directory. [Getting Started](/guide/getting-started) has the build, and
[Limitations](/reference/limitations) has the full list of what does not exist.
