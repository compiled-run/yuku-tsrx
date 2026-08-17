---
title: Parser
description: Parse .tsrx and ordinary JS/TS with yuku-tsrx, the options that shape a parse, what comes back, and how diagnostics work.
---

# Parser

The parser is the entry point to everything else. It takes source text, hands it
to the native addon, and gives you back a TSRX syntax tree, its comments, and its
diagnostics.

Reach for it when you are building something that has to understand `.tsrx`
source: a framework's TSRX plugin, a codemod, a bundler plugin, an analysis
tool.

## Two entry points

`parse` is the general one. It takes source and options, and returns everything
the parse produced.

```ts
parse(source: string | Uint8Array, options?: ParseOptions): ParseResult
```

```js
import { parse } from "yuku-tsrx";

const result = parse(source, { lang: "tsx" });
result.program;     // the AST
result.comments;    // every comment
result.diagnostics; // everything wrong with the code you parsed
```

`parseModule` is the module-shaped one. It takes a filename as well, returns the
`Program` directly, and throws on a fatal problem instead of handing you a
broken tree.

```ts
parseModule(
  source: string | Uint8Array,
  filename: string,
  options?: ParseModuleOptions,
): Program
```

```js
import { parseModule } from "yuku-tsrx";

const program = parseModule(source, "Cart.tsrx");
```

It is shaped as a drop-in for `@tsrx/core`'s `parseModule`, which is the
interface Markless already calls.

`parseModule` makes three decisions for you, all of them visible in
`npm/yuku-tsrx/index.js`:

- **The language comes from the filename.** `.tsrx` and `.tsx` give `tsx`,
  `.jsx` gives `jsx`, `.d.ts` gives `dts`, `.ts` gives `ts`, and anything else
  gives `js`. A query string or hash on the name is ignored. Pass `lang`
  explicitly to override it.
- **`sourceType` is `"module"`.** Not overridable; that is what makes it a
  module parse. `ParseModuleOptions` omits the option for that reason.
- **`semanticErrors` is on.** Everywhere else it is opt-in.

<!-- details:Why parseModule turns semanticErrors on by default -->
The reason is written out in `npm/yuku-tsrx/index.js`: a module boundary owes
its caller the scope-dependent early errors, not just the grammar ones. Without
them an undeclared export slips through, and a bundler that reads a parse throw
as "this chunk still has live exports" will strip a body while keeping its
exports.
<!-- /details -->

## `ParseOptions`

```ts
export interface ParseOptions {
  lang?: SourceLang;
  sourceType?: SourceType;
  preserveParens?: boolean;
  semanticErrors?: boolean;
  attachComments?: boolean;
  loose?: boolean;
}

export type SourceLang = "js" | "jsx" | "ts" | "tsx" | "dts";
export type SourceType = "script" | "module" | "commonjs";
```

| Option | What it does |
| --- | --- |
| `lang` | Which grammar to parse with. TSRX constructs are available under `tsx`. |
| `sourceType` | `script`, `module`, or `commonjs`. |
| `preserveParens` | Keep parentheses in the tree instead of dropping them. |
| `semanticErrors` | Also run the scope-dependent early error checks and report them as diagnostics. |
| `attachComments` | Attach comments to nodes as well as collecting them flat. |
| `loose` | Recover from an unclosed JSX element by matching an ancestor closing tag, instead of stopping. |

The Zig-side defaults are the ones in `src/dialect/root.zig`:
`source_type = .module`, `lang = .js`, `preserve_parens = true`,
`comments = .flat`, `loose = false`.

`loose` is a recovery mode, not a permissive mode. Its one job in the dialect is
`parseLooseAncestorClose` in `src/dialect/parser_extension.zig`: when an element
is left open and the next `</` in the source belongs to an ancestor, the parser
recovers there rather than failing at the end of the file. That is the shape a
mid-edit file has in an editor.

## `ParseModuleOptions`

```ts
export interface ParseModuleOptions extends Omit<ParseOptions, "sourceType"> {
  collect?: boolean;
  errors?: Diagnostic[];
  comments?: Comment[];
}
```

Three additions, and one removal.

- `collect` switches `parseModule` from throwing to collecting. With `collect`
  (or `loose`) set, a fatal diagnostic is pushed into the `errors` array you
  passed and the partial `Program` is returned anyway.
- `errors` is that array. You own it; `parseModule` pushes into it.
- `comments` is an array to receive the parsed comments. Passing it also turns
  `attachComments` on by default, and the comments are pushed into it when
  `collect` or `loose` is set.
- `sourceType` is removed, because `parseModule` always parses a module.

```js
const errors = [];
const comments = [];
const program = parseModule(source, "Cart.tsrx", { collect: true, errors, comments });
// program is always a Program here; errors holds what went wrong.
```

## What comes back

```ts
export interface ParseResult {
  program: Program;
  comments: BaseNode[];
  diagnostics: Diagnostic[];
}
```

Every node carries `type`, `start`, and `end`. `start` and `end` are offsets into
the source you passed in, so `source.slice(node.start, node.end)` gives back the
exact text of a node.

Hover a node in the tree below to see the exact text its `start` and `end`
cover, or hover the source to find the innermost node that covers a character.

<!-- ast-explorer -->
```tsrx
export function Cart({ items }) {
  @{ const total = items.length; }
  return (
    <ul class="cart">
      @if (total === 0) {
        <li>Nothing here yet</li>
      }
      @for (const item of items; key item.id) {
        <li>{item.label}</li>
      }
    </ul>
  );
}
```

`Program` has `body`, `sourceType` (`"script"` or `"module"`), and an optional
`hashbang`. Its `body` is typed as
`Array<Statement | TSRXExpression | TSRXJSXElement | TSRXJSXFragment>`, because a
TSRX file can have markup at the top level and not only statements.

## Diagnostics

```ts
export interface Diagnostic {
  severity: "error" | "warning" | "hint" | "info";
  message: string;
  start: number;
  end: number;
  help: string | null;
  labels: DiagnosticLabel[];
}
```

`parse` never throws for bad source. It returns the diagnostics and whatever
tree it managed to build. `parseModule` is the one that throws, and only on
`severity: "error"`: it takes the first fatal diagnostic and raises a
`SyntaxError` with the message and the offsets.

The split between `"error"` and `"warning"` is deliberate and is documented in
`src/dialect/diagnostics.zig`. Yuku's checker reports every early error at error
severity; the native boundary lowers the ones a mid-edit file still recovers
from, the redeclaration family, to `"warning"`. Those stay visible on `parse()`
without failing the module in `parseModule`. The reference for the split is
`@tsrx/core`, whose acorn fork raises the redeclaration family recoverably and
everything else fatally.

## The TSRX node types, and why the names are exact

The parser produces TSRX node names rather than lowering TSRX to TSX.

| Node | Fields beyond `type`, `start`, `end` |
| --- | --- |
| `JSXCodeBlock` | `body: Statement[]`, `render: Expression \| TSRXExpression \| null` |
| `JSXIfExpression` | `test`, `consequent: BlockStatement`, `alternate: JSXIfExpression \| BlockStatement \| null` |
| `JSXForExpression` | `statement: ForOfStatement \| ForStatement`, `empty: BlockStatement \| null` |
| `JSXSwitchExpression` | `statement: SwitchStatement` |
| `JSXTryExpression` | `statement: TryStatement`, `pending: BlockStatement \| null` |
| `TSRXExpression` | `expression: Expression` |
| `JSXStyleElement` | `openingElement`, `children: StyleSheet[]`, `closingElement`, `css: string` |
| `StyleSheet` | `source: string` |

Two ordinary nodes gain TSRX fields rather than being replaced. `ForOfStatement`
gains `index` and `key`, both `Expression | undefined`, for the `; index` and
`; key` tail clauses. A lazy destructuring pattern keeps its `ObjectPattern` or
`ArrayPattern` identity.

The names matter because consumers pattern-match on them. In Markless, a
function is a component if and only if its body is a `JSXCodeBlock`. A parser
that lowered `@{ }` to a plain expression would parse the file and destroy the
answer at the same time. That is why `TSRXJSXElement` and `TSRXJSXFragment` in
`index.d.ts` still carry `type: "JSXElement"` and `type: "JSXFragment"`: they
are the ordinary JSX nodes, typed to admit TSRX children, not new kinds.

## Walking the tree

`walk` is a plain recursive visitor over the object graph.

```ts
walk<T extends BaseNode>(root: T, visitors: Visitors, state?: unknown): T
```

```js
import { parseModule, walk } from "yuku-tsrx";

const program = parseModule(source, "Cart.tsrx");
const blocks = [];

walk(program, {
  JSXCodeBlock(node, { parent, state }) {
    blocks.push(node);
  },
});
```

A visitor is keyed by node `type`, and its value is either a function (which
runs on enter) or an object with `enter` and `leave`. The top-level `enter` and
`leave` keys run for every node. Each visitor is called with the node and a
context of `{ parent, state }`, where `state` is the third argument you passed
to `walk`. `walk` returns the root you gave it. It descends into every property
except `comments`.

## The wire format underneath

The native addon does not return objects. It returns a buffer, and JavaScript
decodes it.

```ts
parseWire(source: string | Uint8Array, options?: ParseOptions): ArrayBuffer
decode(buffer: ArrayBuffer, source: string): ParseResult
encode(program: Program): ArrayBuffer
```

`parse` is `decode(parseWire(source, options), text)`, where `text` is the source
as a string. The three are exported separately so you can hold the buffer, pass
it somewhere, and decode it later, or not at all.

`encode` goes the other way, turning a `Program` back into a buffer. That is
what [`generate`](/guide/codegen) does with the tree you hand it. The format is
documented in `src/dialect/transfer.zig`.

<!-- details:What the decoders cost you -->
`decode.js` and `decode-analyzer.js` are generated, not hand-written, and they
build AST objects lazily from the buffer rather than eagerly. A tool that reads
only `result.diagnostics` does not pay for building the program. This is why the
three functions are separate exports rather than an implementation detail.
<!-- /details -->
