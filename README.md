<p align="center">
  <a href="https://yuku-tsrx-docs.vercel.app/yuku-tsrx"><img alt="yuku-tsrx" width="600" src=".github/assets/readme-hero.png"></a>
</p>

<p align="center">
  <a href="https://yuku-tsrx-docs.vercel.app/yuku-tsrx"><b>Docs</b></a> &nbsp;·&nbsp; <a href="https://yuku-tsrx-docs.vercel.app/yuku-tsrx/guide/getting-started"><b>Getting started</b></a> &nbsp;·&nbsp; <a href="https://yuku-tsrx-docs.vercel.app/yuku-tsrx/reference/api"><b>API</b></a>
</p>

A `.tsrx` file is TypeScript with HTML-like markup in it, plus blocks like `@if` and `@for` for showing
something only sometimes, or once per item in a list. yuku-tsrx is a parser, an analyzer, and a code
generator for it, written in Zig, with a JavaScript API on a native addon.

It is a compile-time **dialect** on [Yuku](https://github.com/yuku-toolchain/yuku), not a fork. Yuku does
all the JavaScript and TypeScript work; yuku-tsrx owns only the TSRX-specific rules and reaches Yuku
through 20 compile-time extension points. A Yuku built without a dialect compiles to what it did before.

## Install

There is no npm package yet: the name is `yuku-tsrx`, the version is `0.0.0`, nothing has been published.
Building needs a checkout of the Yuku branch in
[yuku-toolchain/yuku#164](https://github.com/yuku-toolchain/yuku/pull/164) in a sibling directory named
`yuku-minimal-seam`, plus Zig 0.16 and pnpm. [Getting
started](https://yuku-tsrx-docs.vercel.app/yuku-tsrx/guide/getting-started) has the rest.

```sh
zig build            # writes the package to zig-out/npm/yuku-tsrx/
zig build test       # the Zig test suite
pnpm test            # the JavaScript test suite
```

## Usage

```js
import { parseModule, walk } from "yuku-tsrx";
const program = parseModule(source, "Cart.tsrx");
walk(program, {
  JSXCodeBlock(node) {
    // every TSRX code block in the file
  },
});
```

`parseModule` is the drop-in for `@tsrx/core`'s `parseModule`. Here is a file it parses:

```tsx
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

## What works today

The parser covers `@{ }` code blocks in statement, expression, and function-body position, `@if` /
`@else if` / `@else`, `@for` with its `; index` and `; key` clauses and `@empty`, `@switch` / `@case` /
`@default`, `@try` / `@pending` / `@catch`, dynamic tags written `<{expr}>`, `<style>` elements holding
raw CSS, `&`-marked lazy destructuring patterns, submodule imports, and text entities, each with a fixture
in `test/parser/misc/tsrx/`. On 2026-08-17, against the head of PR #164,
[Markless](https://github.com/compiled-run/markless)'s node test suite (229 files, 1832 tests) passed with
yuku-tsrx swapped in for `@tsrx/core` and no test edits, and its completion matrix was 47/47. One
measurement, on one corpus, on one machine ([`benchmarks/m6-baseline.json`](./benchmarks/m6-baseline.json)):
median 29.7 microseconds per parse against 103.1 for `@tsrx/core`, a ratio of 0.288, and peak resident
memory 0.85 times `@tsrx/core`'s. What does not exist: no npm publish, no linter, no formatter, no editor
integration.

## Documentation

- [Guide](https://yuku-tsrx-docs.vercel.app/yuku-tsrx/guide/introduction): what this is, the supported syntax, and the parser, analyzer, and code generator.
- [Architecture](https://yuku-tsrx-docs.vercel.app/yuku-tsrx/architecture/yuku-dialect): the seam, the 20 extension points, and upstreaming to Yuku.
- [Reference](https://yuku-tsrx-docs.vercel.app/yuku-tsrx/reference/api): every export and node type, plus benchmarks, platform support, and limitations.
- [`goal.md`](./goal.md): the design document, the open design problems, and the oracle that defines done.

## Contributing

Issues and pull requests are welcome. Before changing the dialect, read `goal.md` for the boundary it
keeps: plain JavaScript and TypeScript belong to Yuku. Run `zig build test` and `pnpm test` first.
