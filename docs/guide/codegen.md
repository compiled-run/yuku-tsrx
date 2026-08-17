---
title: Code Generator
description: generate turns a Program back into source text, with options for stripping types, minifying, indentation, quotes, and comments.
---

# Code Generator

`generate` is the parser run backwards. Give it a `Program` and it gives you
source text.

```ts
generate(program: Program, options?: GenerateOptions): GenerateResult
```

```js
import { generate, parse } from "yuku-tsrx";

const { program } = parse(source, { lang: "tsx" });
const { code, errors, map } = generate(program);
```

The tree does not have to be the one you just parsed. You can walk it, change
it, and print the result, which is what a codemod does.

## What it accepts

The first argument has to be a `Program` node from this parser. `generate`
checks that before doing anything and throws a `TypeError` reading
`Expected a Program node from yuku-tsrx` otherwise. It is not a printer for
arbitrary ESTree.

Internally the tree goes back across the native boundary the same way it came:
`generate` calls [`encode`](/guide/parser#the-wire-format-underneath) on the
program and hands the buffer to the addon. The generator itself is
`src/dialect/codegen.zig`.

## `GenerateOptions`

```ts
export interface GenerateOptions {
  strip?: boolean;
  minify?: boolean | { whitespace?: boolean; syntax?: boolean; quotes?: boolean };
  format?: "pretty" | "compact";
  indent?: number;
  quotes?: "preserve" | "double" | "single" | "shortest";
  comments?: boolean | "all" | "some" | "none" | "line" | "block";
}
```

| Option | What it does |
| --- | --- |
| `strip` | Emit without the TypeScript-only syntax. |
| `minify` | Size-reducing output. `true` means all three modes; an object turns them on one at a time. |
| `format` | `pretty` is indented, with spaces around operators and after commas. `compact` emits no discretionary whitespace, only what the grammar requires. |
| `indent` | Spaces per indentation level. Used only when `format` is `pretty`. |
| `quotes` | `preserve` keeps each literal's original quote style, `double` and `single` force one, `shortest` picks the one that needs fewer escapes. |
| `comments` | Which comments survive. |

One current limitation: `quotes: "shortest"` and `minify: true` are declared in
`npm/yuku-tsrx/index.d.ts` but fail at the native boundary today, because the
`Quotes` enum in `src/dialect/codegen.zig` has only `preserve`, `double`, and
`single`, so the addon rejects the request with
`invalid enum value for codegen.Quotes: 'shortest'`. `minify: true` hits the
same wall because its `quotes` mode sets `shortest`. Until the enum gains the
value, use `preserve`, `double`, or `single`, and ask for
`minify: { whitespace: true, syntax: true }` instead of `minify: true`.

### `comments`

`none` drops all comments, `all` emits every one, `line` emits only `// ...`,
`block` emits only `/* ... */`, and `some` emits legal headers, JSDoc, and
tree-shaking annotations such as `__PURE__` and `__NO_SIDE_EFFECTS__`. A boolean
is accepted as a shorthand: `true` becomes `all` and `false` becomes `none`.
Without the option, the generator's own default applies, which is `some`.

### `minify` is three switches, not one

`minify: true` is shorthand for `{ whitespace: true, syntax: true, quotes: true }`,
and `npm/yuku-tsrx/index.js` expands each of the three into the option it
actually controls:

| Mode | Effect |
| --- | --- |
| `syntax` | Turns on the print-time size-reducing substitutions. |
| `whitespace` | Sets `format` to `compact`. |
| `quotes` | Sets `quotes` to `shortest`. |

So `{ minify: { whitespace: true } }` gives you compact output with ordinary
syntax and ordinary quotes, and `{ minify: true }` gives you all three. Setting
`format` or `quotes` yourself alongside a `minify` mode that also sets them
means the mode wins.

## `GenerateResult`

```ts
export interface GenerateResult {
  code: string;
  errors: Array<{ message: string; start: number; end: number }>;
  map: unknown | null;
}
```

`code` is the source text. `errors` is empty when codegen ran cleanly; an entry
is a problem the generator found in the tree you handed it, with the offsets of
the node it found it on. `map` is a Source Map V3 object, and it is `null`
unless source maps were requested.

## Round-tripping

Printing a parsed tree and parsing the result again should give you the same
structure back. That is the property the repository's own tests hold the
generator to, across every valid fixture in `test/parser/misc/tsrx/`:

```js
import { analyze, generate, parse } from "yuku-tsrx";

const analysis = analyze(source, { lang: "tsx" });
const generated = generate(analysis.program);
const reparsed = parse(generated.code, { lang: "tsx" });
// reparsed.diagnostics is empty, and the structure matches
```

This is the check that keeps TSRX from quietly degrading on the way out. A
generator that printed a `JSXCodeBlock` as an ordinary expression would produce
text that still parses, just not into the same tree, so "it parses" is not the
bar. See [TSRX Syntax Support](/guide/tsrx-syntax) for the constructs that have
to survive the trip.
