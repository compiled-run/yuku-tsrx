# yuku-tsrx

A `.tsrx` file is TypeScript with HTML-like markup in it, plus blocks like `@if`
and `@for` for showing something only sometimes, or once per item in a list.
yuku-tsrx reads those files. It is a parser, an analyzer, and a code generator
for `.tsrx`, written in Zig, with a JavaScript API on top of a native addon.

It is built as a compile-time **dialect** on
[Yuku](https://github.com/yuku-toolchain/yuku), a JavaScript and TypeScript
toolchain written in Zig. Not a fork, and not a second parser engine beside it.
Yuku does all the JavaScript and TypeScript work; yuku-tsrx owns only the rules
that are specific to TSRX, and reaches Yuku through 20 compile-time extension
points. A Yuku built without a dialect compiles to exactly what it did before.

The other way to get here is to write a parallel engine, which is what the
sibling project [oxc-tsrx](https://github.com/compiled-run/oxc-tsrx) had to do:
[OXC](https://oxc.rs)'s parser has no extension point, so its TSRX support
carries a 17,057-line parser engine that is mostly plain TypeScript parsing done
a second time. The dialect design exists to avoid owning that copy.

## Install

There is no npm package yet. The package name is `yuku-tsrx` and the version in
`npm/yuku-tsrx/package.json` is `0.0.0`; nothing has been published.

The extension points yuku-tsrx builds against live in
[yuku-toolchain/yuku#164](https://github.com/yuku-toolchain/yuku/pull/164), which
is open. Until it merges, building needs a Yuku checkout of that branch in a
sibling directory, because `build.zig.zon` declares the dependency by path:

```zig
.yuku = .{ .path = "../yuku-minimal-seam" },
```

So the layout is two folders side by side, `yuku-tsrx/` and
`yuku-minimal-seam/`. You need Zig 0.16 (the `minimum_zig_version` in
`build.zig.zon`) and, for the JavaScript side, pnpm.

```sh
zig build            # builds the addon and writes the package to zig-out/npm/yuku-tsrx/
zig build test       # the Zig test suite
pnpm test            # the JavaScript test suite
```

## Usage

The JavaScript API is ESM, and the native addon comes from an optional
`@yuku-tsrx/binding-<platform>` dependency picked for your machine.

```js
import { parseModule, walk } from "yuku-tsrx";

const program = parseModule(source, "Cart.tsrx");

walk(program, {
  JSXCodeBlock(node) {
    // every TSRX code block in the file
  },
});
```

`parseModule(source, filename, options)` is the drop-in for `@tsrx/core`'s
`parseModule`, and it returns a `Program`. The rest of the surface is `parse`,
`analyze`, `generate`, `parseWire`, `walk`, `decode`, `decodeAnalyzer`, `encode`,
`isEventAttribute`, and `normalizeEventName`. Exact signatures and the node
types are in [`npm/yuku-tsrx/index.d.ts`](./npm/yuku-tsrx/index.d.ts).

Here is a file it parses, in the shape the fixtures in
[`test/parser/misc/tsrx/`](./test/parser/misc/tsrx/) use:

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

The parser covers `@{ }` code blocks in statement, expression, and function-body
position, `@if` / `@else if` / `@else`, `@for` with its `; index` and `; key`
clauses and `@empty`, `@switch` / `@case` / `@default`, `@try` / `@pending` /
`@catch`, dynamic tags written `<{expr}>`, `<style>` elements holding raw CSS,
`&`-marked lazy destructuring patterns, submodule imports
(`import { x } from server`), and text entities. Each of those has a fixture in
`test/parser/misc/tsrx/`.

The output is a real TSRX AST. Consumers pattern-match on the node type names
directly, `JSXCodeBlock`, `TSRXExpression`, `JSXStyleElement`,
`JSXForExpression`, and so on, so the parser produces those exact names rather
than lowering TSRX to TSX. In
[Markless](https://github.com/compiled-run/markless), a function is a component
if and only if its body is a `JSXCodeBlock`.

Markless parses `.tsrx` today through `@tsrx/core`, about 976K of pure
JavaScript. yuku-tsrx replaces that under the interface Markless already uses. On
2026-08-17, against the head of PR #164, Markless's node test suite (229 files,
1832 tests) passed with yuku-tsrx swapped in for `@tsrx/core` and no test edits,
and its typescript-plugin completion matrix was 47/47.

One benchmark, on one corpus, on one machine
([`benchmarks/m6-baseline.json`](./benchmarks/m6-baseline.json), 25 iterations,
alternating run order, a 214,751-byte input): median 29.7 microseconds per parse
for yuku-tsrx against 103.1 for `@tsrx/core`, a ratio of 0.288, and peak resident
memory 0.85 times `@tsrx/core`'s. Treat that as one measurement, not a general
claim.

What does not exist: no npm publish, no linter, no formatter, no editor
integration, no docs site. This is a library, consumed by a framework's TSRX
plugin. It compiles nothing to a browser on its own.

## Documentation

- [`goal.md`](./goal.md): the design document. The consumer evidence, what Yuku
  exposes and withholds, where the seam already exists in prior art, the open
  design problems, and the oracle that defines done.
- [`npm/yuku-tsrx/index.d.ts`](./npm/yuku-tsrx/index.d.ts): the public API and
  every node type it can hand back.
- [`test/parser/misc/tsrx/`](./test/parser/misc/tsrx/): one fixture per piece of
  TSRX syntax, with snapshots.
- [`src/dialect/`](./src/dialect/): the dialect itself, split by concern
  (control flow, code blocks, JSX, style, patterns, modules, codegen).

## Contributing

Issues and pull requests are welcome. Before changing the dialect, read
`goal.md` for the boundary it keeps: anything that is plain JavaScript or
TypeScript belongs to Yuku, and yuku-tsrx should stay the TSRX-specific part.
Run `zig build test` and `pnpm test` before opening a pull request.
