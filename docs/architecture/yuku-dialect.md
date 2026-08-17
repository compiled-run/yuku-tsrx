---
title: Zig/Yuku Dialect Core
description: How yuku-tsrx plugs TSRX into Yuku through twenty compile-time extension points instead of forking the parser.
---

# Zig/Yuku Dialect Core

yuku-tsrx is a compile-time **dialect** on
[Yuku](https://github.com/yuku-toolchain/yuku), a JavaScript and TypeScript
toolchain written in Zig. Yuku does all the JavaScript and TypeScript work.
yuku-tsrx owns only the rules that are specific to TSRX.

That is the whole design, and everything on this page is a consequence of it.

## Not a fork

A dialect is a plain struct of optional hook declarations, resolved at compile
time. Yuku never learns the word "tsrx". A Yuku built without a dialect compiles
to exactly what it did before: every hook is comptime-known absent, and the
branch does not exist in the emitted code.

Nothing upstream is copied and nothing is patched. yuku-tsrx does not vendor a
parser, a lexer, a scope resolver, or a printer. When Yuku fixes a TypeScript
edge case, this project gets the fix by rebuilding.

<!-- details:The alternative, and what it costs -->
The other way to add TSRX to an existing engine is to write a parallel one. That
is what the sibling project
[oxc-tsrx](https://github.com/compiled-run/oxc-tsrx) had to do:
[OXC](https://oxc.rs)'s parser has no extension point, so its TSRX support
carries a 17,057-line parser engine that is mostly plain TypeScript parsing done
a second time. It works, and it is a real answer to the problem. The cost is
that the copy has to be maintained against upstream forever. The dialect design
exists to avoid owning that copy, and it is only available because Yuku is
willing to take the seam.
<!-- /details -->

## The twenty extension points

`src/dialect/parser_extension.zig` declares the hooks Yuku calls. There are
twenty, and they are the entire contact surface between the two projects.

| Hook | Where TSRX gets a say |
| --- | --- |
| `statement_at_code_block` | A statement may begin a `@{ }` block |
| `statement_at_control_flow` | A statement may begin a `@if` / `@for` / `@switch` / `@try` directive |
| `expression_at_code_block` | So may an expression |
| `expression_at_control_flow` | So may an expression |
| `jsx_child_at_code_block` | So may a JSX child |
| `jsx_child_at_control_flow` | So may a JSX child |
| `function_body_starts` | A function body may be a `@{ }` block rather than a brace block |
| `function_body` | Parse that body |
| `lazy_assignment_pattern` | `&{ }` and `&[ ]` in assignment position |
| `binding_pattern` | `&{ }` and `&[ ]` in binding position |
| `can_start_binding` | Whether a token can start one |
| `for_of_tail` | The `; index` and `; key` clauses after a for-of head |
| `module_specifier` | `import { x } from server`, a specifier that is not a string |
| `jsx_element_name` | A tag name written `<{expr}>` |
| `validate_jsx_element_name` | Whether that expression can name an element |
| `jsx_names_match` | Whether an opening and closing dynamic tag are the same |
| `jsx_element_after_open` | `<style>` is a raw-text element, so its body is not JSX |
| `jsx_fragment_after_open` | The same decision for a fragment |
| `jsx_text_boundary` | Text stops at `@` |
| `jsx_text_value` | Entity decoding for the text it produced |

Each hook returns a `Decision`, which is `unhandled` or `handled` with a result.
`unhandled` means "this is not TSRX, carry on", and Yuku proceeds exactly as it
would have. That is what keeps the seam narrow: the dialect declines far more
often than it acts.

The types those decisions are built from live in `src/dialect/abi.zig`, which is
the one file both sides have to agree on.

## The file map

Eighteen files in `src/dialect/`, split by concern.

| File | Owns |
| --- | --- |
| `abi.zig` | The hook enum, `Decision`, and the field roles a dialect record can use |
| `parser_extension.zig` | The twenty hook declarations and the store that holds dialect data |
| `schema.zig` | The record and overlay types: `JSXCodeBlock`, `JSXStyleElement`, the for-of overlay, and the rest |
| `code_block.zig` | `@{ }` in statement, expression, JSX-child, and function-body position |
| `control_flow.zig` | `@if`, `@for`, `@switch`, `@try` and their clauses, plus the checks that reject `break` and `return` where they do not belong |
| `jsx.zig` | Dynamic tags: parsing the name expression and validating that it can be one |
| `style.zig` | `<style>` elements and the raw CSS inside them |
| `patterns.zig` | `&`-marked lazy destructuring |
| `modules.zig` | Submodule import specifiers |
| `text.zig` | The `@` text boundary and entity decoding |
| `root.zig` | The parse entry point and its `Options` |
| `semantic.zig` | Handing the dialect tree to Yuku's analyzer |
| `semantic_transfer.zig` | Packing scopes, symbols, and references into the wire buffer |
| `diagnostics.zig` | Which early errors are fatal and which are lowered to warnings |
| `transfer.zig` | The AST wire format, both directions |
| `codegen.zig` | Printing a tree back to source |
| `traverser.zig` | Store-first identity lookup for downstream surfaces |
| `projection.zig` | The ordinary Yuku tree, which stays the projection |

## Dialect nodes without changing Yuku's node

TSRX needs node kinds Yuku does not have. Adding them to Yuku's `Kind` enum
would change the enum's ABI, and therefore the wire format, for everyone.

The dialect keeps them out of the host tree instead. `schema.zig` defines two
kinds of dialect data:

- **Records** are standalone TSRX nodes: `JSXCodeBlock`, `JSXIfExpression`,
  `JSXForExpression`, `JSXSwitchExpression`, `JSXTryExpression`,
  `JSXStyleElement`, `StyleSheet`, `TSRXExpression`. They live in a
  dialect-owned side table, anchored to a host node.
- **Overlays** are extra fields on a node Yuku already has: `index` and `key` on
  `ForOfStatement`, the reset parameter on `CatchClause`, the lazy marking on
  `ArrayPattern` and `ObjectPattern`. The host node keeps its own identity and
  the dialect hangs the additional fields off it.

That is why `ForOfStatement` in `index.d.ts` gains two fields rather than
becoming a new type, and why a lazy pattern is still an `ObjectPattern`.

`projection.zig` states the consequence in one line: the ordinary Yuku tree
remains the projection. Standalone TSRX records use anchor nodes, overlays
retain their ordinary host nodes, so anything that walks the tree without
knowing about the dialect still sees a valid tree.

## The transfer buffer and the generated decoders

The native addon does not build JavaScript objects. It writes one buffer and
returns it as an `ArrayBuffer`.

`src/dialect/transfer.zig` is that format. It is the single wire format used in
both directions across the FFI boundary:

- **Zig to JavaScript.** `serializeInto` writes a tree into a buffer that the
  native binding returns to JavaScript. Decoders walk the buffer to build AST
  objects without copying the underlying bytes.
- **JavaScript to Zig.** `deserializeFromBuf` reconstructs a tree from the same
  buffer. It is the exact inverse of the encoder for every section except
  diagnostics, which it skips, because the codegen path that consumes it does
  not need them.

All multi-byte integers are little endian, and the format carries no version
byte: producer and consumer are built from the same file and must match.

The JavaScript half is generated, not hand-written. `decode.js`,
`decode-analyzer.js`, and `encode.js` in the npm package each open with
`generated by tools/estree/decoder.zig, do not edit`, and they carry a
`DIALECT_RECORDS` table describing every dialect record and overlay by tag,
type, and field. So a dialect that adds a node type gets a decoder for it,
without the dialect-free wire format changing.

`semantic_transfer.zig` appends the analyzer's output to the same buffer, after
the tree, which is why [`analyze`](/guide/analyzer) is one call across the
boundary rather than two.

## How the dependency is declared

`build.zig.zon` names Yuku by path:

```zig
.{
    .name = .yuku_tsrx,
    .version = "0.0.0",
    .dependencies = .{
        .yuku = .{ .path = "../yuku-minimal-seam" },
        // ...
    },
    .minimum_zig_version = "0.16.0",
}
```

A path dependency, not a URL with a hash, because the extension points are still
an open pull request. That is a deliberate development shape rather than an
oversight, and it is what [Getting Started](/guide/getting-started) has you set
up. [Upstreaming to Yuku](/architecture/upstreaming-to-yuku) covers what changes
when the pull request merges.
