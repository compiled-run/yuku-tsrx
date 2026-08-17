---
title: Analyzer
description: analyze adds a SemanticView of references, scopes, and symbols to a parse result, resolved across TSRX scopes.
---

# Analyzer

`analyze` is `parse` plus semantic analysis. You get the same program,
comments, and diagnostics, and one field more: a `SemanticView` over the
references, scopes, and symbols the analyzer resolved.

```ts
analyze(source: string | Uint8Array, options?: ParseOptions): AnalyzeResult
```

```js
import { analyze } from "yuku-tsrx";

const result = analyze(source, { lang: "tsx" });

for (let i = 0; i < result.semantic.reference.count; i++) {
  const name = result.semantic.reference.name(i);
  const symbol = result.semantic.reference.symbolId(i);
  // symbol === null means this reference resolved to nothing in the file
}
```

It takes the same `ParseOptions` as [`parse`](/guide/parser).

## `AnalyzeResult`

```ts
export interface AnalyzeResult extends ParseResult {
  readonly semantic: SemanticView;
}
```

`semantic` is `readonly` and is built the first time you read it, so a caller
that only wants the diagnostics or the program does not pay for it.

## `SemanticView`

```ts
export interface SemanticView {
  reference: { count: number; name(index: number): string; symbolId(index: number): number | null };
  scope: { count: number; kind(index: number): string };
  symbol: { count: number; name(index: number): string };
}
```

Three collections, each an index-addressed accessor rather than an array of
objects. You read `count`, then call the accessors with an index from `0` to
`count - 1`. Nothing is materialized until you ask for it, which is what keeps
the analyzer cheap for a tool that only needs one of the three.

| Collection | Read it for |
| --- | --- |
| `reference` | Every identifier use. `name(i)` is the text, `symbolId(i)` is the symbol it resolved to, or `null` if it resolved to nothing declared in this file. |
| `scope` | Every scope the analyzer created. `kind(i)` names it. |
| `symbol` | Every declared binding. `name(i)` is its text. |

An unresolved reference is `symbolId(i) === null`. That is the normal answer for
a name this file never declares, a global for instance, and not an error.

## Why the analyzer is dialect work

Semantic analysis is Yuku's job, not yuku-tsrx's. The dialect's part is making
sure Yuku's analyzer sees the right tree.

TSRX puts bindings in places plain JavaScript does not have: a `const` declared
in a `@{ }` code block, the loop variable of a `@for`, the `error` and `reset`
parameters of a `@catch`. Each of those has to become a real scope with real
symbols, or a reference to it resolves to nothing and every downstream tool that
asks "where is this defined" gets the wrong answer.

Click a symbol below to light its declaration and every reference the analyzer
resolved to it, and hover a scope to outline the span it covers. The status
line counts what did not resolve too. In this sample exactly one reference is
unresolved: `reset`. The analyzer creates a symbol for the first `@catch`
parameter (`error`) but not yet for the second, so the `onClick={reset}`
reference has nothing to point at, and the figure shows that rather than hiding
it. A `const` declared in a `@{ }` block is block scoped, so the sample reads
`total` inside that block.

<!-- symbol-explorer -->
```tsrx
export function Cart({ items }) {
  @{
    const total = items.length;
    const label = total === 1 ? "item" : "items";
  }
  return (
    <ul class="cart">
      @try {
        @for (const item of items; index i; key item.id) {
          <li>{item.label}</li>
        }
      } @catch (error, reset) {
        <li><button onClick={reset}>{error.message}</button></li>
      }
    </ul>
  );
}
```

Two files own that:

- **`src/dialect/semantic.zig`** hands the dialect's tree to Yuku's analyzer.
  TSRX records are attached to host nodes, so before the analysis runs it swaps
  in the node data the analyzer expects for each associated node and restores it
  afterwards. The result is that Yuku's scope and symbol resolution walks TSRX
  constructs as the ordinary constructs they stand for, with no TSRX-specific
  code in Yuku.
- **`src/dialect/semantic_transfer.zig`** is the wire format for the result. It
  packs scopes, symbols, references, imports, and exports into the same buffer
  the parse result travels in, appended after the tree, so one call across the
  native boundary carries both.

The consequence worth knowing: the contents of a `<style>` element are not
JavaScript, so the CSS text inside it produces no references and no symbols.
Selector and property names never show up in `reference`.

## `semanticErrors` is a separate thing

Do not confuse `analyze` with the `semanticErrors` parse option. They are not
the same switch.

- **`analyze`** gives you the semantic *view*: what resolved to what.
- **`semanticErrors`** adds the scope-dependent early *errors* to
  `diagnostics`: the ones a grammar check alone cannot find, like an export of
  a binding that was never declared.

`semanticErrors` is opt-in on `parse` and on by default in `parseModule`, for
the reason spelled out in [Parser](/guide/parser#parsemoduleoptions). Which of
those errors are fatal and which are lowered to warnings is decided in
`src/dialect/diagnostics.zig`.

## Reading the buffer yourself

```ts
decodeAnalyzer(buffer: ArrayBuffer, source: string): unknown
```

`decodeAnalyzer` is the decoder `analyze` uses internally, exported so you can
decode an analyzer buffer you obtained some other way. It is typed `unknown` in
`index.d.ts` because the analyzer buffer carries more than the typed
`SemanticView` promises; treat `AnalyzeResult` as the supported shape and
anything beyond it as subject to change.
