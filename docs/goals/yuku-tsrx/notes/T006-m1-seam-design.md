# T006 — M1 comptime dialect-seam design

## Recommendation

Use one appended generic `dialect_node` variant whose payload is a `u32` record index into a typed,
arena-owned dialect side table. Add an O(1) `overlay_by_node` index for dialect-only fields attached to
ordinary host nodes. This is the only evaluated candidate that preserves all existing tags and the
52-byte `Node` while supporting new nodes and overlays through one generated reflection path.

M1 implements a no-op/sentinel seam only. It does not implement TSRX grammar.

## Compile-backed evidence

- Upstream `NodeData` is a concrete `union(enum)` with 172 variants.
- `PackedNode` uses an 8-bit tag, 16 flag bits, and seven `u32` payload slots. Transfer validation and
  ESTree generation derive their layouts from the same AST declarations.
- Prior art needs new nodes plus `ForOfStatement.index/key`, `CatchClause.reset_param`, and
  `ArrayPattern`/`ObjectPattern.lazy` overlays.
- A bounded Zig probe modeled the actual 40-byte maximum payload. Base, appended-side-index, and
  40-byte raw-payload nodes were all 52 bytes, and preceding tags remained equal. An incorrect
  44-byte model grew to 56 bytes, proving the actual ceiling must be asserted.
- The 172 current tags leave 84 unused `u8` values, but the closed Zig union cannot safely materialize
  undeclared high enum values.
- Scratch files and dedicated caches under `/private/tmp` were removed.

## Candidate comparison

### Appended `dialect_node` plus side table — recommend

- One `u32` side index keeps `Node` at 52 bytes; appending a variant keeps existing tags stable.
- The dialect-free store must be zero-sized, allocation-free, and add no per-node column.
- A dialect build pays one `u32` overlay index per AST node, typed records for dialect nodes/overlays,
  and one dependent load only on dialect paths.
- Common traversal is unchanged. Dialect nodes and host overlays resolve in O(1).
- Parser, transfer, and generators receive the same schema module. Serialization remains ordinary
  `PackedNode` entries, not a second wire section.
- Overlay records are `for_of {host,index,key}`, `catch_clause {host,reset_param}`,
  `array_pattern {host,lazy}`, and `object_pattern {host,lazy}`.
- Assert atomic node/overlay growth, duplicate assignment, record limits, shared module identity, tag
  ceiling, and absence of linear lookup.

### Comptime-extensible tagged union — reject for M1

`@Type`-generated unions do not carry `NodeData` methods. This approach would genericize `NodeData`,
`NodeList`, `Tree`, syntax, transfer, traverser, semantic, codegen, and generators. It is a
repository-wide type-identity rewrite.

### Fixed high tag range — reject

The numeric range exists, but the closed union cannot represent it safely. Supporting undeclared tags
requires raw tag/payload storage or invalid enum values, losing exhaustive switches and duplicating
schema or adding unchecked casts.

## Import DAG and ABI

1. Yuku builds dependency-free `dialect_abi` from `src/parser/dialect/abi.zig`.
2. Default parser injects `src/parser/dialect/none.zig`; a configured parser accepts one downstream
   dialect module.
3. Parser, AST, lexer, transfer, and generators import the selected dialect and `dialect_abi`.
4. A dialect imports only `dialect_abi` and `std`, never parser code.
5. `yuku-tsrx` supplies the same dependency-free sentinel module to parser and generators.
6. Site-local `anytype` host facades call local helpers statically. No function pointers,
   `anyopaque`, registry, composition, or runtime dispatch are permitted.

Yuku invokes optional hooks only under a compile-time `dialect.enabled` and `@hasDecl` check. Hook
results use `dialect_abi.Decision(T) = union(enum) { unhandled, handled: T }`.

## Exact hook map

| # | location | hook |
|---|---|---|
| 1 | `syntax/statements.zig`, decorated statement | `statement_at_code_block(host)` |
| 2 | same | `statement_at_control_flow(host)` |
| 3 | `syntax/expressions.zig`, `.at` prefix | `expression_at_code_block(host)` |
| 4 | same | `expression_at_control_flow(host)` |
| 5 | `syntax/expressions.zig`, before unary dispatch | `lazy_assignment_pattern(host)` |
| 6 | `syntax/functions.zig`, body-presence test | `function_body_starts(host)` |
| 7 | `syntax/functions.zig`, before brace expectation | `function_body(host)` |
| 8 | `syntax/for_loop.zig`, after right expression | `for_of_tail(host, context)` |
| 9 | `syntax/patterns.zig`, before ordinary patterns | `binding_pattern(host)` |
| 10 | `syntax/modules.zig`, after string specifier | `module_specifier(host)` |
| 11 | `syntax/variables.zig`, before binding fallback | `can_start_binding(host, token)` |
| 12 | `syntax/jsx/root.zig`, after opening element | `jsx_element_after_open(host, opening, context)` |
| 13 | `syntax/jsx/root.zig`, before name comparison | `jsx_names_match(host, left, right)` |
| 14 | `syntax/jsx/root.zig`, text rescan | `jsx_text_boundary(source, cursor)` |
| 15 | `syntax/jsx/root.zig`, text value | `jsx_text_value(host, span)` |
| 16 | `syntax/jsx/root.zig`, child code block | `jsx_child_at_code_block(host)` |
| 17 | same, control flow | `jsx_child_at_control_flow(host)` |
| 18 | `syntax/jsx/root.zig`, element name | `jsx_element_name(host)` |
| 19 | `syntax/jsx/root.zig`, dynamic validation | `validate_jsx_element_name(host, node)` |

`lexer.zig::reScanJsxText` is a separate boundary and calls the same
`jsx_text_boundary(source, cursor)` declaration.

## Proof matrix

Dialect-free proofs:

- `NodeData == 44`, `Node == 52`, existing tags stable, no-op store zero-sized and allocation-free.
- M0 node count and stripped binary SHA-256 identical.
- Prefer exact binary identity. A binary mismatch may use only a predeclared median profiler delta of
  at most 2% over at least ten interleaved samples, subject to Judge acceptance.
- Parser/analyzer/codegen generated outputs and serialized control buffers byte-identical to
  `eb2adcb4`.

Sentinel proofs:

- Compile every hook through the dependency-free sentinel module.
- Round-trip one new node and all four overlay shapes.
- Generate all dialect fields through schema reflection without handwritten cases.
- Prove tag ceiling and shared seven-slot/16-bit transfer validation.
- Exercise positive/negative mode selection and malformed sentinel syntax.
- Report `Node`/`Tree` size, four-byte-per-node overlay cost, record sizes, and lookup count.

## Proposed Worker package

Create `/Users/jacksm5pro/dev/open-source/yuku-dialect` as a separate worktree and local unpushed
`seam/dialect` branch at exact `eb2adcb4c17da16e7ade1a0517192d81d469e67f`. Implement only the generic
ABI, side-table/overlay representation, 19 hook calls plus lexer boundary, and reflection-aware
transfer/generation. Add retained sentinel tests in `yuku-tsrx`. Do not implement TSRX grammar or
modify `../yuku`.

Allowed files:

```text
/Users/jacksm5pro/dev/open-source/yuku-tsrx/build.zig
/Users/jacksm5pro/dev/open-source/yuku-tsrx/build.zig.zon
/Users/jacksm5pro/dev/open-source/yuku-tsrx/src/dialect/root.zig
/Users/jacksm5pro/dev/open-source/yuku-tsrx/src/dialect/schema.zig
/Users/jacksm5pro/dev/open-source/yuku-tsrx/src/testing/dialect.zig
/Users/jacksm5pro/dev/open-source/yuku-tsrx/tools/m1-control.ts
/Users/jacksm5pro/dev/open-source/yuku-tsrx/test/m1.test.ts
/Users/jacksm5pro/dev/open-source/yuku-tsrx/baselines/m1.json
/Users/jacksm5pro/dev/open-source/yuku-dialect/build.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/root.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/parser.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/ast.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/lexer.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/dialect/abi.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/dialect/none.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/statements.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/expressions.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/functions.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/for_loop.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/patterns.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/modules.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/variables.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/jsx/root.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/ffi/transfer/root.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/tools/estree/meta.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/tools/estree/decoder.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/tools/estree/encoder.zig
/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/testing/dialect.zig
```

Verification:

```text
test "$(git -C /Users/jacksm5pro/dev/open-source/yuku-dialect rev-parse HEAD^)" = eb2adcb4c17da16e7ade1a0517192d81d469e67f && test "$(git -C /Users/jacksm5pro/dev/open-source/yuku rev-parse HEAD)" = bf03e146d97ae2f0c2d4c4ec90456e1e544d2760
rg -ni 'tsrx' /Users/jacksm5pro/dev/open-source/yuku-dialect/src /Users/jacksm5pro/dev/open-source/yuku-dialect/tools && exit 1 || true
zig fmt --check /Users/jacksm5pro/dev/open-source/yuku-dialect /Users/jacksm5pro/dev/open-source/yuku-tsrx
zig build test
zig build fuzz
pnpm vp check && pnpm vp lint && pnpm vp fmt --check && pnpm vp test
node tools/m1-control.ts --mode none --compare-ref eb2adcb4c17da16e7ade1a0517192d81d469e67f --node-size --tree-size --tags --wire-sha256 --binary-sha256 --decoder-bytes --profile
node tools/m1-control.ts --mode sentinel --all-hooks --layout --roundtrip --generated-diff --positive-negative
git -C /Users/jacksm5pro/dev/open-source/yuku status --porcelain=v1
git -C /Users/jacksm5pro/dev/open-source/yuku-dialect diff --check
```

Stop if worktree identity conflicts; Yuku contains a TSRX identifier; node size, existing tags, no-op
wire, decoder, or binary proof fails; the no-op store has cost; a hook needs runtime dispatch or a
parser-to-dialect import; a payload exceeds shared limits; overlays enlarge common payloads or use
linear lookup; generation needs handwritten dialect cases; scope expands; TSRX grammar appears; or a
downstream repository is written.

## T007 decisions

1. Decide whether filtering disabled `dialect_node` from generated output, with unchanged tags and
   buffers, satisfies byte-identical dialect-free generation.
2. Prefer exact binary identity; decide whether the charter's benchmark alternative may be used only
   under the predeclared 2% median tolerance.
3. Require a retained minimal module-cycle compilation test before broad hook edits and immediate stop
   if the dependency-free dialect cannot compile.
