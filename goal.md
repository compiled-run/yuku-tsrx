# yuku-tsrx

## Objective

Give `.tsrx` a production Zig toolchain — parser, analyzer, codegen — built as a
**dialect adapter on top of Yuku**, not a fork of it and not a second engine
beside it. Yuku does all JavaScript and TypeScript work. `yuku-tsrx` owns only
what is specific to TSRX. The seam between them is a compile-time dialect table,
so a Yuku built without a dialect emits the same machine code it does today.

The consumers are `markless` and `frameless` today, `versionless` and `guessless`
next. They already parse `.tsrx` through `@tsrx/core`, a 976K pure-JavaScript
parser. **This project replaces that parser, under the interface they already
use** — so the deliverable is judged by whether their existing compilers accept
its output unmodified, over Yuku's existing zero-copy wire format.

## Original Request

> Make a new project called yuku-tsrx that supports yuku in TSRX including its
> projects like the analyzer, codegen, parser, etc. This will be in Zig, ideally
> we can find a way to easily extend yuku and then be able to consume that in
> TypeScript. Data driven design is the critical difference from oxc-tsrx. The
> end goal is that projects like frameless, versionless, guessless, etc. will be
> able to consume and analyze tsrx.

Owner rulings during intake, binding:

1. **No fork.** "We want to use as much of yuku as possible without forking it,
   so basically an adapter that then allows us to easily extend it."
2. **Local link first, PR last.** "Use link / locally and then make the PR to the
   minimal changes in yuku needed, but only after the entire system is working."

Ruling 2 sets the development shape: `yuku-tsrx` builds against a **path-linked
local Yuku checkout**, the Yuku-side changes accumulate on a local branch, and
the upstream PR to `yuku-toolchain/yuku` is opened only once parser, analyzer,
codegen, and the TypeScript surface are all green end to end. The PR is the last
step, not the first.

## Who consumes this, and what they actually need

This was settled by reading the consumers, not by argument. The finding decides
the architecture, so it is recorded here in full.

**Markless and Frameless already consume a TSRX AST today, from a pure-JS
parser.** `packages/compiler/src/js-ast.ts` in Markless:

```ts
import { parseModule } from '@tsrx/core';
```

`@tsrx/core@0.1.32` is 976K of JavaScript — no `.node`, no `.wasm`. Frameless
depends on it too, alongside a vendored `@markless/compiler` tarball.

**So this project is not adding a capability. It is replacing a pure-JS parser
with a Zig one, beneath an interface two production compilers already depend
on.** That single fact sets every requirement below.

### They pattern-match on TSRX node types directly

Counted across `packages/**/*.ts`:

| repo | TSRX node types matched | refs |
| --- | --- | --- |
| markless | `TSRXExpression`, `JSXCodeBlock`, `JSXStyleElement`, `SpreadAttribute`, and `TSRX{If,ForOf,Try}Statement` (see caveat) | 36 |
| frameless | `TSRXJSXFragment`, `TSRXJSXElement`, `JSXCodeBlock` | 5 |

### The node-name contract, and the good news

The names that matter are the ones `@tsrx/core@0.1.32` actually emits, because
that is what the consumers are written against:

```
JSXCodeBlock      JSXStyleElement    StyleSheet         TSRXExpression
JSXIfExpression   JSXForExpression   JSXSwitchExpression   JSXTryExpression
TSRXJSXElement    TSRXJSXFragment    TSRXJSXOpeningElement  TSRXJSXClosingElement
```

**`bf03e146` already emits exactly this naming.** Its regenerated
`npm/yuku-parser/decode.js` registers `JSXCodeBlock`, `StyleSheet`,
`JSXStyleElement`, `JSXIfExpression`, `JSXForExpression`, `JSXSwitchExpression`,
and `JSXTryExpression` — the same names, not a parallel vocabulary. The prior art
was written against the right contract, which materially de-risks oracle item 7.

**Caveat, to verify rather than assume.** `markless/packages/compiler/src/passes/
public-render/component-definitions.ts` (around lines 221–223) tests for
`TSRXIfStatement`, `TSRXForOfStatement`, and `TSRXTryStatement`. Those three names
appear in **zero** files of `@tsrx/core@0.1.32`, so on that parser those branches
appear unreachable. Do not "fix" this and do not rely on it — confirm whether the
branches are dead, legacy, or fed by another path, and record the finding. It
does not change what `yuku-tsrx` must emit.

### `JSXCodeBlock` is component identity

From `markless/packages/compiler/src/ast/tsrx.ts`:

```ts
if (declaration.type === 'FunctionDeclaration') {
    if ((declaration.body as AnyNode | undefined)?.type !== 'JSXCodeBlock') return null;
    …
// Only TSRX-producing bodies count; plain helper arrows stay helpers.
if ((init.body as AnyNode | undefined)?.type !== 'JSXCodeBlock') return null;
```

A function is a Markless component **iff its body is a `JSXCodeBlock`**. That is
the entry point of the whole compiler, not an edge case.

### Why a TSRX → TSX compiler was rejected

It was seriously considered and ruled out on this evidence:

- Compiling `@{ … }` to TSX makes it an ordinary function body, so Markless can
  no longer distinguish a component from a helper arrow. The compiler's entry
  point stops working.
- **Markless already is the TSRX → JS compiler** — `passes/public-render/` alone
  is 24 files, plus `render-data/`, `state-lowering.ts`, `capture-analysis.ts`,
  `semantic-graph/`. A TSX compiler here would duplicate lowering Markless owns
  while destroying the input it needs.
- `oxc-tsrx` already built a TSX projection (`docs/projection-example.json`) and
  **still** wrote `tsrx_parser_engine` (17,057 lines). The projection is a
  compatibility shim that lets stock oxlint/oxfmt run; it is not an analysis
  substrate. Its output is length-preserved text full of `/*_t0_N0S__*/`
  sentinels plus a side-channel token list, precisely because the projected text
  cannot say what construct it came from.
- Several TSRX constructs have no TSX encoding at all: `@empty` on a `@for`, the
  `index` and `key` clauses, statements as JSX children, raw CSS in `<style>`,
  and `&`-marked lazy patterns in parameter position.

Lowering TSRX → TSX is still valuable, but as an **AST-level** pass on top of a
real parser, never as a text projection standing in for one. It is out of scope
for this goal because Markless already owns it.

### Consequences for this goal, all binding

1. The emitted AST must use the **exact node type names** the consumers already
   match on. `JSXCodeBlock` is not negotiable; nor are the `TSRX*` names above.
2. The strongest available proof is a **drop-in swap**: replace `@tsrx/core`'s
   `parseModule` with `yuku-tsrx` and Markless's existing test suite stays green
   without edits. This is a far better oracle than snapshot reproduction, because
   it is scored by a production compiler rather than by fixtures.
3. `@tsrx/core` being pure JS makes the performance win the point. Baseline it
   before optimizing anything.

## Why this is not oxc-tsrx

`oxc-tsrx` (`~/dev/open-source/oxc-tsrx`) is the sibling project and the thing to
learn from, including its cost. It reached `.tsrx` support in Rust by building a
**parallel engine**:

| crate | lines |
| --- | --- |
| `tsrx_parser_engine` | 17,057 |
| `tsrx_syntax` | 10,474 |
| `tsrx_tape_schema` | 6,908 |
| `oxc_adapter` | 6,303 |
| everything else (lint, format, CLI, NAPI, benches) | ~9,400 |

Roughly 50,000 lines, of which the top two crates are a hand-rolled parser that
exists because **OXC exposes no seam** — that project's own goal doc forbids
vendoring, forking, or patch-queueing OXC, so the only remaining move was to
rebuild the engine. `tsrx_tape_schema`'s 6,908 lines exist to get an AST across
the native/JS boundary.

Yuku's data-oriented design removes both costs:

- **The engine can be shared instead of rebuilt**, because Yuku's AST is
  `std.MultiArrayList(Node)` addressed by `u32` indices. Merging a subtree parsed
  by Yuku into a tree owned by `yuku-tsrx` is a column-wise integer rebase, not a
  pointer-graph rewrite. That operation is only cheap because the representation
  is indices-not-pointers.
- **The wire format already exists.** `src/parser/ffi/transfer/` plus the
  generated decoders in `npm/yuku-parser`, `npm/yuku-analyzer`, `npm/yuku-codegen`
  already ship a position-independent buffer whose JS decoder is derived from the
  Zig declarations. There is no tape schema to write. TSRX extends it; it does
  not reinvent it.

So the target is not "oxc-tsrx in Zig." The target is roughly **two orders of
magnitude less code**, because the host engine is being extended rather than
duplicated. If the implementation starts growing a second parser, that is the
signal the design went wrong.

## Established facts

This intake already did the reconnaissance. Do not re-derive these; verify them
if you doubt them, but they are current as of 2026-08-09.

### Yuku state

- Upstream is `git@github.com:yuku-toolchain/yuku.git`. `upstream/main` is
  `eb2adcb4` (v0.8.4). Local checkout: `~/dev/open-source/yuku`.
- Zig `0.16.0` (`build.zig.zon`: `minimum_zig_version`).
- `build.zig` exports exactly one consumable module: `b.addModule("parser", …)`
  rooted at `src/parser/root.zig`.

### The prior art: `bf03e146`

The local Yuku checkout is on branch `feat/tsrx`, **1 commit ahead of
`upstream/main`**. That commit — `bf03e146`, "Implement TSRX parser support",
authored by the owner on 2026-06-29 — already implements TSRX inside Yuku's tree.
It is the single most valuable input to this goal, and it is also the thing this
goal exists to restructure.

**Treat it as the semantics specification, not as the implementation.** It
answers "what does TSRX mean" for: statement containers `@{ … }`, control flow
`@if` / `@for` / `@switch` / `@try`, dynamic tags, lazy destructuring `&[…]` and
`&{…}`, raw `<style>` elements, submodule imports, and JSX text entity decoding.

Its fixture corpus is the **acceptance corpus**, and it is already shaped to
cover both the positive and the negative space:

| corpus | count | location |
| --- | --- | --- |
| valid `.tsrx`, with snapshot JSON | 12 | `test/parser/misc/tsrx/` |
| invalid `.tsrx`, diagnostics only, no snapshot | 3 | `control-flow-switch-invalid`, `dynamic-tag-invalid`, `template-return-invalid` |
| TSRX syntax in a **non**-`.tsrx` file, must be rejected | 3 | `test/parser/misc/ts/*-outside-tsrx.{ts,tsx}` |
| codegen round-trip assertions | +195 lines | `test/codegen/print.test.ts` |

`yuku-tsrx` must reproduce the 12 snapshots. Reproducing them is how you prove
the adapter is behaviour-identical to the in-tree version it replaces. The three
`*-outside-tsrx` fixtures carry unusual weight for this goal specifically: they
are the proof that the dialect stays **off** when it is not selected, which is
exactly the property a seam must guarantee and an in-tree fork gets for free.

What is wrong with it is only its shape: it edits Yuku's core in place.

### The seam is already visible in that commit

Every core-file edit in `bf03e146` has one of two forms. A guarded early return
at a dispatch point:

```zig
// src/parser/syntax/statements.zig — parseDecoratedStatement, +5 lines total
if (tsrx.isCodeBlockStart(parser)) return parseExpressionStatement(parser);
if (tsrx.isControlFlowDirectiveStart(parser)) return parseExpressionStatement(parser);

// src/parser/syntax/expressions.zig — parsePrefix, the `.at` branch
if (tsrx.isCodeBlockStart(parser)) return tsrx_template.parseCodeBlock(parser);
if (tsrx.isControlFlowDirectiveStart(parser)) return tsrx_template.parseControlFlowExpression(parser);
```

…or a language-variant gate, `parser.tree.isTsrx()`.

Counted across the whole commit, that is **19 hook sites in 8 files**:

| file | sites |
| --- | --- |
| `src/parser/syntax/jsx/root.zig` | 8 |
| `src/parser/syntax/expressions.zig` | 3 |
| `src/parser/syntax/statements.zig` | 2 |
| `src/parser/syntax/functions.zig` | 2 |
| `src/parser/syntax/for_loop.zig` | 1 |
| `src/parser/syntax/patterns.zig` | 1 |
| `src/parser/syntax/modules.zig` | 1 |
| `src/parser/syntax/variables.zig` | 1 |

Nineteen hardcoded branches naming one dialect is a dispatch table that has not
been extracted yet. Extracting it is the central engineering act of this goal.

The lexer is a separate, smaller case: `bf03e146` changed
`Lexer.reScanJsxText(initial_cursor)` to `reScanJsxText(initial_cursor,
stop_at_tsrx_code: bool)` and added an `'@'` case to its scan loop. Note that
`Lexer` already has a re-scan family — `reScanJsxText`, `reScanGreaterThan`,
`reScanLessThan`, `reScanTemplateContinuation`, `reScanAsRegex` — which is
already the shape a dialect needs to extend.

### What Yuku exports, and what it withholds

`src/parser/root.zig` is the entire public surface of the `parser` module:

```zig
pub const parse = parser.parse;
pub const Options = parser.Options;
pub const CommentMode = parser.CommentMode;

pub const ast = @import("ast.zig");
pub const traverser = @import("traverser/root.zig");
pub const semantic = @import("semantic/root.zig");
pub const codegen = @import("codegen/root.zig");
```

`Parser` and `Lexer` are `pub` **inside their own files** but are not re-exported
here, so a downstream Zig package cannot reach them. This matters, because
`Parser` already has precisely the driveable shape an adapter wants —
`init`, `parse`, `parseBody(terminator, kind)`, `checkpoint` / `rewind`,
`expect`, `eatSemicolon`, `report`, `recover`, `flushToExtras` — and `Checkpoint`
/ `rewind` in particular are what a dialect needs for speculative parsing.

What *is* already reachable is enough to start:

- `ast.Tree` is fully public with public fields: `nodes: NodeList`
  (`std.MultiArrayList(Node)`), `extras: std.ArrayList(NodeIndex)`,
  `diagnostics`, `strings: StringPool`, `arena`, `source`, `source_type`, `lang`.
- `ast.Tree.initEmpty()` exists and is documented as *"Creates an empty tree for
  building ASTs programmatically (no source text)."* That is the adapter's
  foundation primitive.
- `parse()` returns an owned `Tree` whose node indices can be rebased.

### The size budget is a hard constraint

`src/parser/ast.zig` ends with compile-time assertions:

```zig
std.debug.assert(@sizeOf(NodeData) == 44);
std.debug.assert(@sizeOf(Node) == 52);
```

`bf03e146` added fields to existing node structs to carry TSRX data — `index`,
`key`, `reset_param` (all `NodeIndex`), and `lazy: bool` on two pattern structs.
**Those additions spend the 52-byte budget on a dialect nobody else uses.** A
dialect must not be able to do that. How TSRX node kinds and TSRX payloads are
represented without growing `Node`, and without a dialect editing `ast.Kind`, is
the hardest open design question in this goal. See below.

### `Lang` today

`upstream/main`'s `ast.Lang` is `{ js, ts, jsx, tsx, dts }`. `bf03e146` adds
`tsrx` to that enum and adds `Tree.isTsrx()`. A dialect seam should make that
unnecessary — Yuku should not need an enum variant per downstream language.

## Architecture

### The comptime dialect seam

Yuku gains a compile-time dialect parameter. A dialect is a plain struct of
optional hook declarations, resolved at compile time. TSRX becomes a table of
hooks that lives **entirely in `yuku-tsrx`**; Yuku never learns the word "tsrx".

The properties that make this acceptable to upstream, and that the implementation
must actually prove rather than assert:

- **Zero cost when absent.** With no dialect, every hook is comptime-known absent
  and the branch does not exist in the emitted code. This must be demonstrated,
  not claimed — see the oracle.
- **Zero cost when present.** Hooks are comptime function pointers, resolved and
  inlinable. No vtable, no runtime indirection, no `anyopaque`. The article this
  design follows is explicit that a query should be "a shift and a mask on a
  value already in a register. No table, no branch, no load"; a seam that
  introduces dynamic dispatch into the parse loop has failed on its own terms.
- **One dialect at a time.** No dialect composition, no plugin registry, no
  ordering semantics. That generality is not needed and would cost the above.

### The two open design problems

These are genuinely unsolved and the implementing agent is expected to design
them, propose them, and defend the choice with measurements.

**1. Dialect node kinds without touching `ast.Kind` or `@sizeOf(Node)`.**
TSRX needs `JSXCodeBlock`, `StyleSheet`, the raw style element, control-flow
containers, dynamic tags, and lazy patterns. Candidate approaches — evaluate,
do not assume:

- A reserved `dialect_node` kind whose payload is an index into a
  dialect-owned side table, keeping `Node` at 52 bytes and dialect data out of
  the hot columns entirely. This is the most data-oriented option and the one to
  beat.
- A comptime-extensible `Kind` enum, where the dialect contributes variants at
  the tail. Cheaper to traverse, but changes the enum's ABI and therefore the
  wire format for everyone.
- Reserving a fixed high range of `Kind` values for dialect use.

Whichever wins must keep `@sizeOf(Node) == 52` for a dialect-free build, and must
state explicitly what it costs a dialect build.

**This is also a code-generation problem, not only a memory-layout one.** Yuku's
decoder generators reflect over the `parser` module's declarations (see *The
generated-decoder pipeline*). A dialect's node types must be visible to
`tools/estree/meta.zig` or no decoder can be generated for them. An opaque side
table that parses perfectly and cannot be reflected over is a dead end. Evaluate
each candidate against **both** halves — layout and reflection — before choosing.

**2. Wire-format extension.**
Yuku's transfer layer derives its layout from Zig declarations and generates the
JS decoder to match. A dialect must be able to extend the wire format and get a
generated decoder, without the dialect-free wire format changing by a single
byte. Existing `npm/yuku-*` consumers must be unaffected.

### Development shape (per owner ruling 2)

```
~/dev/open-source/yuku/           branch: seam/dialect  (local, unpushed)
    minimal seam changes accumulate here

~/dev/open-source/yuku-tsrx/      this repo
    build.zig.zon → path dependency on ../yuku
    src/tsrx/                     the dialect: hook tables + TSRX grammar
    npm/                          TypeScript consumption
```

Build against the local path the entire time. Keep the Yuku-side diff under
continuous pressure to shrink — every line in it is a line you have to defend to
upstream later. When the whole system is green, that branch becomes the PR.

## Toolchain and conventions

This repository straddles two established toolchains and must honour both. Split
by **layer**, not by preference: the Zig layer follows Yuku, the TypeScript layer
follows Markless and Frameless.

### Zig layer — follow Yuku exactly

| concern | convention | source |
| --- | --- | --- |
| Zig version | `0.16.0`, set as `minimum_zig_version` | `yuku/build.zig.zon` |
| manifest | `build.zig` + `build.zig.zon` with `.name`, `.version`, `.fingerprint`, `.paths` | same |
| build steps | mirror Yuku's names: `test`, `test-tools`, `fuzz`, `wasm`, `profile`, `run` | `yuku/build.zig` |
| formatting | `zig fmt`, 4-space indent | `package.json` → `"format"` |
| style law | `yuku/AGENTS.md`, binding | — |
| benchmarks | `codspeed_zig` + `profiler/` | `build.zig.zon` |
| fuzzing | `zig build fuzz`, a `src/**/fuzz/` module | `build.zig` |
| native packaging | `napi-zig`, one binding package per platform (Yuku ships 11) | `npm/yuku-parser/package.json` |

### The generated-decoder pipeline — inherit it, do not reinvent it

This is the mechanism that makes TypeScript consumption work, and it is the part
most likely to be quietly hand-rolled under time pressure. It must not be.

Yuku derives its JavaScript decoders from its Zig declarations. Three generators,
each a thin `main` over a shared reflector:

| step | generator root | output | lands in |
| --- | --- | --- | --- |
| `gen-parser-decoder` | `tools/gen_parser_decoder.zig` | `decode.js` | `npm/yuku-parser/` |
| `gen-analyzer-decoder` | `tools/gen_analyzer_decoder.zig` | `decode-analyzer.js` | `npm/yuku-analyzer/` |
| `gen-codegen-encoder` | `tools/gen_codegen_encoder.zig` | `encode.js` | `npm/yuku-codegen/` |

The reflection lives in `tools/estree/{decoder,encoder,meta}.zig`. Each generator
executable is built with **the parser module and the transfer module imported**:

```zig
generator_module.addImport("parser", parser_module);
generator_module.addImport("transfer", ast_transfer_module);
```

…then run, with stdout captured to the output file. So the decoder is a pure
function of the Zig AST declarations. Adding a node type in `ast.zig` and
re-running the step is the entire workflow.

**Proof this works for TSRX:** `bf03e146`'s `npm/yuku-parser/decode.js` diff is
regenerated output, not hand-editing. The Zig-side field additions surface
directly as decoder registrations:

```js
-_ck("ForOfStatement", ["left", "right", "body"]);
+_ck("ForOfStatement", ["left", "right", "body", "index", "key"]);
-_ck("CatchClause", ["param", "body"]);
+_ck("CatchClause", ["param", "resetParam", "body"]);
+_ck("JSXCodeBlock", ["body", "render"]);
+_ck("JSXStyleElement", ["openingElement", "children", "closingElement"]);
+_ck("JSXIfExpression", ["test", "consequent", "alternate"]);
+_ck("JSXForExpression", ["statement", "empty"]);
```

**What this demands of the dialect seam.** The generators reflect over what the
`parser` module exposes. A dialect's node types must therefore be **visible to
the generator** — which means open design problem 1 is not only a parse-time and
memory-layout question, it is a *code-generation* question too. A design that
hides dialect nodes behind an opaque side table, and cannot present them to
`tools/estree/meta.zig`, will parse correctly and then fail to produce a decoder.
Solve both halves together or the seam is not finished.

**Requirements, all binding:**

- `yuku-tsrx` ships its own `tools/gen_*` generator and `zig build gen-*` step,
  following the same shape: thin root, shared reflector, stdout captured.
- Every decoder and encoder in `npm/**` is generated output. None is edited by
  hand, and none is reformatted after generation.
- A CI check regenerates and fails on any diff, so a stale committed decoder
  cannot ship.
- The dialect-free decoder output must be **byte-identical** to Yuku's today.
  That is the cheapest possible proof that existing consumers are unaffected, and
  it is stronger than a passing test suite.

### TypeScript layer — follow Markless and Frameless

| concern | pin | source |
| --- | --- | --- |
| package manager | `pnpm@10.33.2` | both roots |
| task runner | `vite-plus` `0.1.20` — `vp check`, `vp fmt`, `vp lint`, `vp test`, `vp pack` | both roots |
| vite / vitest | `vite` `8.0.16`, `vitest` `4.1.5` | both roots |
| TypeScript | `5.9.3` | both roots |
| workspace | `pnpm-workspace.yaml` with a `catalogs:` block | both |
| module type | `"type": "module"` | both |
| node | `>=22` | `frameless/package.json` → `engines` |
| formatting | tabs in JSON/TS (Frameless and Markless use tabs; Yuku uses 2 spaces) | both |
| git hooks | `"prepare": "git config core.hooksPath .githooks"` | both |
| agent rules | `"rules": "npx -y @intellectronica/ruler apply"` | both |

Frameless's root `tsconfig.json` is the shape to copy: `strict`, `noEmit`,
`module: ESNext`, `moduleResolution: Bundler`, `allowImportingTsExtensions`,
`target`/`lib` at ES2022.

### The three real conflicts, and how they resolve

These are genuine and the implementing agent will hit all three.

1. **Package manager: Yuku uses Bun, the consumers use pnpm.** Yuku has
   `bun.lock`, `@types/bun`, `bun test`, and npm-style `workspaces`. Markless and
   Frameless use `pnpm@10.33.2` with catalogs. **Resolve toward pnpm.** The
   TypeScript layer's entire job is to be consumed by pnpm workspaces, and oracle
   item 7 runs inside Markless's pnpm workspace, so pnpm is required regardless;
   adding Bun would mean two package managers for no gain. Yuku's `gen:npm` and
   `gen:wasm` scripts are just `zig build … && cp`, so they port to pnpm scripts
   unchanged. Only `bun test` and `@types/bun` need replacing — with `vp test` /
   `vitest 4.1.5`.
2. **TypeScript version: Yuku is on `^6.0.2`, the consumers on `5.9.3`.**
   **Author against 5.9.3, the lower bound.** Published `.d.ts` files must be
   consumable by Markless and Frameless as they exist today. A type that needs
   TS 6 is a defect, not an upgrade prompt.
3. **Indentation: Yuku is 2-space, the consumers are tabs.** Split by file:
   Zig and Yuku-shaped files (`npm/**`, generator output) follow Yuku; the
   TypeScript workspace files follow the consumers. Do not reformat generated
   decoders — they come out of the generator and are copied verbatim.

### Verification commands

Both toolchains must be runnable, and both belong in CI:

```sh
zig build test          # Zig unit + snapshot tests
zig build fuzz          # parser fuzzing
zig fmt --check .       # Zig formatting
pnpm vp check           # TypeScript typecheck
pnpm vp lint            # lint
pnpm vp fmt --check     # TS/JSON formatting
pnpm vp test            # vitest
```

## Goal Oracle

The goal is complete when **all binding items** below hold, each backed by a
command whose output is recorded. Historical numbering is retained for durable
receipts. By owner decision on 2026-08-11, item 4 is removed from the completion
contract; the binding set is items 1–3 and 5–9.

1. **Behaviour parity, both spaces.** `yuku-tsrx` reproduces all 12 snapshot
   JSONs from `bf03e146`; emits equivalent diagnostics for the 3 invalid `.tsrx`
   fixtures; and rejects the 3 `*-outside-tsrx` fixtures, proving the dialect is
   inert when not selected. Where output intentionally differs from `bf03e146`,
   each difference is enumerated with a justification.
2. **No fork.** The Yuku working tree contains no TSRX-specific identifier. A
   grep for `tsrx` across the Yuku checkout's `src/` returns zero hits. All TSRX
   knowledge lives in `yuku-tsrx`.
3. **The seam is free when unused.** A dialect-free Yuku build is proven
   equivalent to pre-seam Yuku — by identical emitted binary, or by benchmark
   parity within a stated tolerance on Yuku's own `profiler/`, measured on one
   machine, plus the surviving `@sizeOf(Node) == 52` assertion.
4. **Removed — non-blocking historical benchmark.** The owner removed the
   TSRX-versus-equivalent-TSX comparison from the completion contract after the
   same-corpus `yuku-tsrx` versus `@tsrx/core` benchmark was completed. Existing
   benchmark artifacts remain provenance only and do not gate completion.
5. **The three surfaces work.** Parser, analyzer (semantic/scope binding over
   TSRX nodes), and codegen (a `.tsrx` round-trip that reparses to an equivalent
   tree) all function through the adapter.
6. **TypeScript consumption is real, over a generated decoder.** A TypeScript
   consumer imports the package, parses a `.tsrx` file, and walks TSRX nodes —
   over the extended wire format, with **generated** decoder and encoder, with no
   JSON serialization of the AST. Three sub-conditions, each checkable:
   - every decoder/encoder in `npm/**` is generator output, and a CI check
     regenerates them and fails on any diff;
   - the **dialect-free decoder is byte-identical** to Yuku's today, proving
     existing `npm/yuku-*` consumers are untouched;
   - emitted node type names match the `@tsrx/core` contract exactly —
     `JSXCodeBlock`, `JSXStyleElement`, `StyleSheet`, `TSRXExpression`,
     `JSX{If,For,Switch,Try}Expression`, `TSRXJSX{Element,Fragment}`.
7. **The drop-in proof — the strongest item here.** Markless's `parseModule`
   import from `@tsrx/core` is redirected to `yuku-tsrx`, and Markless's existing
   test suite passes **unmodified**. No edits to Markless's compiler, no relaxed
   assertions, no skipped tests. This is scored by a production compiler rather
   than by fixtures, and it is the item that actually proves the AST is correct.
   Markless is **read-only**: do the swap in a copy or a temporary workspace.
8. **The performance win is measured.** `yuku-tsrx` versus `@tsrx/core` on the
   same `.tsrx` corpus and machine, parse time and peak memory, reported as a
   ratio. Replacing a pure-JS parser is the point of the project; an unmeasured
   replacement has not made its case.
9. **The PR is ready and minimal.** The Yuku-side diff is a reviewable branch
   whose every hunk is justified as necessary for *any* dialect, not for TSRX
   specifically. It is not opened upstream until all preceding binding items are
   green.

A passing parser, a green fixture run, or a clean-looking board is not
completion. Completion is the oracle above, audited claim by claim.

## Milestones

Ordered. Each ends in something runnable; none is a design document.

- **M0 — Link, scaffold, baseline.** Stand up both toolchains per *Toolchain and
  conventions*: `build.zig` / `build.zig.zon` on Zig 0.16.0, and the pnpm +
  vite-plus workspace on the pinned versions. `yuku-tsrx` builds against
  path-linked `../yuku` at `upstream/main`, and all seven verification commands
  run. Record baseline `profiler/` numbers, the dialect-free binary hash, and an
  `@tsrx/core` parse-time baseline. These are the controls for oracle items 3 and
  8.
- **M1 — Seam.** Design and land the comptime dialect parameter on the local
  Yuku branch, with a trivial no-op dialect proving zero cost. Resolve open
  design problem 1. No TSRX yet.
- **M2 — Parse.** TSRX dialect tables in `yuku-tsrx`; the 12 snapshots reproduce
  and the 6 negative fixtures behave. Oracle items 1 and 2 go green.
- **M3 — Wire and TypeScript.** Resolve open design problem 2. Extend the
  transfer layer, add the `tools/gen_*` generator and its `zig build gen-*` step,
  wire the regenerate-and-diff CI check, and ship the npm surface. Oracle item 6,
  including the byte-identical dialect-free decoder.
- **M4 — Analyzer and codegen.** Semantic/scope binding over TSRX nodes; printer
  round-trip. Oracle item 5.
- **M5 — Drop-in proof and PR.** Swap Markless's `@tsrx/core` `parseModule` for
  `yuku-tsrx` in a copy and get its suite green unmodified; measure the win
  against `@tsrx/core`. Oracle items 7 and 8. Then prepare and open the upstream
  PR — oracle item 9.

## Non-Negotiable Constraints

- **Never fork Yuku.** No vendoring, no copied source, no maintained patch queue,
  no permanent divergence. The local Yuku branch is a staging area for one
  upstream PR and nothing else. If a change cannot be justified to upstream as
  dialect-generic, it does not belong in Yuku — solve it in `yuku-tsrx`.
- **Do not open the upstream PR early.** Owner ruling: only after the entire
  system works. Opening it before M5 is a scope violation.
- **Yuku is the engine, not a reference.** All JavaScript and TypeScript parsing,
  semantic analysis, and code generation is Yuku's. `yuku-tsrx` implements only
  TSRX-specific grammar. A second JS/TS parser appearing in this repository means
  the design failed.
- **Honour both toolchains, split by layer.** The Zig layer follows Yuku's
  conventions and build-step names; the TypeScript layer follows Markless and
  Frameless — `pnpm@10.33.2`, `vite-plus@0.1.20`, `vitest@4.1.5`,
  `typescript@5.9.3`, catalogs, tabs. Versions are pinned, not floors; do not
  upgrade them to suit this repository. See *Toolchain and conventions* for the
  three known conflicts and their resolutions.
- **Generate decoders, never hand-write them.** Extend Yuku's
  `tools/gen_*` + `zig build gen-*` pipeline. A hand-maintained decoder can drift
  from its encoder, which is exactly the failure the generator exists to prevent.
- **Follow `~/dev/open-source/yuku/AGENTS.md`** for all Zig, in both repos. It is
  binding, not advisory. In particular: two assertions per function on average,
  positive *and* negative space; explicitly-sized integers (`u32`, not `usize`,
  outside stdlib seams); arena allocation with defined lifetimes; bounded loops;
  split compound assertions; strictest warning settings treated as errors.
- **Data-oriented design is the mandate, not a preference.** Indices over
  pointers. Struct-of-arrays. Pre-estimated capacity so the allocator stays off
  the hot path. Scratch buffers with checkpoints, reused not reallocated. String
  spans into source, interning only for the exceptional case. Packed flag bits
  over lookup tables. Compile-time size assertions on every new record type.
  Never let the common case pay for the general one.
- **Measure before and after every performance-sensitive change.** Same machine,
  same corpus, same warmup. Yuku's `profiler/` is the instrument. An unmeasured
  performance claim is not a claim.
- **The 52-byte `Node` budget survives.** A dialect-free build keeps
  `@sizeOf(Node) == 52`. Any dialect-build cost is stated explicitly.
- **Existing Yuku consumers are unaffected.** `npm/yuku-parser`,
  `npm/yuku-analyzer`, `npm/yuku-codegen` and their wasm variants keep their
  current behaviour and wire format byte-for-byte for non-dialect input.
- **`bf03e146` is a specification, not code to copy.** Lift its semantics and its
  fixtures. Do not reproduce its in-tree structure.
- **Read-only outside this repo and the linked Yuku checkout.** `frameless`,
  `versionless`, `guessless`, `oxc-tsrx`, and `markless` may be read, copied
  from, and benchmarked, never written to.
- **No publishing without separate authority.** Do not push branches, publish npm
  packages, create GitHub repositories, or open pull requests without explicit
  approval at that time. M5's PR requires its own go.
- **Test-driven.** A failing behavioural test precedes each implementation slice
  and is retained as regression proof. The 18 inherited fixtures are the spine of
  the parser suite; extend the corpus, and keep covering the negative space —
  per `AGENTS.md`, assert what you expect *and* what you do not expect, because
  the boundary between valid and invalid is where the interesting bugs live.

## Reference Map

| what | where |
| --- | --- |
| Yuku checkout, branch `feat/tsrx` | `~/dev/open-source/yuku` |
| Yuku upstream `main` | `eb2adcb4` (v0.8.4) |
| TSRX semantics + fixtures | commit `bf03e146` |
| Acceptance corpus | `test/parser/misc/tsrx/` (15) + `test/parser/misc/ts/*-outside-tsrx.*` (3) |
| Yuku public module surface | `src/parser/root.zig` |
| Driveable parser API | `src/parser/parser.zig` — `Parser`, `Checkpoint` |
| Lexer re-scan family | `src/parser/lexer.zig` — `Lexer.reScan*` |
| AST, `Tree`, size assertions | `src/parser/ast.zig` |
| Wire format | `src/parser/ffi/transfer/`, `src/parser/ffi/wasm/` |
| Generated JS decoders | `npm/yuku-parser/decode.js`, `npm/yuku-codegen/encode.js` |
| Zig style law | `~/dev/open-source/yuku/AGENTS.md` |
| Zig build steps to mirror | `yuku/build.zig` — `test`, `fuzz`, `wasm`, `profile` |
| Decoder generator pattern | `yuku/tools/gen_parser_decoder.zig`, `yuku/package.json` → `gen:npm` |
| Generator reflection core | `yuku/tools/estree/{decoder,encoder,meta}.zig` |
| Generator wiring | `yuku/build.zig` — the `gen-*` step loop |
| Node-name contract | `@tsrx/core@0.1.32` emitted types (see *The node-name contract*) |
| Native packaging pattern | `yuku/npm/yuku-parser/package.json` (napi-zig, 11 bindings) |
| TS toolchain to copy | `frameless/package.json`, `frameless/tsconfig.json`, `frameless/pnpm-workspace.yaml` |
| Design article | <https://www.arshad.fyi/writings/engineering-high-performance-parsers> |
| Sibling project (contrast) | `~/dev/open-source/oxc-tsrx` |
| oxc-tsrx's own goal doc | `~/dev/open-source/oxc-tsrx/docs/goals/oxc-for-tsrx/goal.md` |
| Parser being replaced | `@tsrx/core@0.1.32` — 976K, pure JS |
| Markless's parser seam | `markless/packages/compiler/src/js-ast.ts` |
| Markless's TSRX node matching | `markless/packages/compiler/src/ast/tsrx.ts` |
| Downstream consumers | `~/dev/open-source/{markless,frameless,versionless,guessless}` |
