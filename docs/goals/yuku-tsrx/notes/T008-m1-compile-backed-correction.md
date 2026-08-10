# T008 — M1 compile-backed correction

## Outcome

The scratch prototype compiled the proposed dependency-free dialect ABI, disabled and external
sentinel dialect modules, parser import, and static `anytype` host facade as an acyclic Zig module
graph. A reflected schema round-tripped one sentinel node and four host overlays through a
`PackedNode`-compatible representation, emitted decoder and encoder descriptions, and rejected
malformed tags and capacity overflow.

The corrected storage recommendation replaces T006's dense `u32` overlay index on every node with
sorted sparse `{ host_node: u32, record_index: u32 }` pairs. Binary lookup occurs only for
overlay-capable host kinds. This removes the universal four-byte node cost and is more memory
efficient below 50% overlay density.

## Command-backed scratch evidence

- `zig build test` in `/private/tmp/t008-probe`, with dedicated caches, compiled and executed the
  dependency-free ABI, disabled dialect, external sentinel dialect, parser import, and static
  declaration-based `anytype` host facade. The disabled build returned `Disabled` without invoking
  a hook.
- The same tests reflectively packed and unpacked a sentinel node and `ForOf`, `CatchClause`,
  `ArrayPattern`, and `ObjectPattern` overlay records. All five deep-equality round trips passed.
- `zig build generate` emitted reflected tags `172` through `176`, every schema field, and the
  encoder inverse without per-record handwritten mappings.
- Tags `171` and `177` were rejected as malformed. Representative eight-`u32` and seventeen-boolean
  payloads failed the layout predicate.
- Upstream `eb2adcb4` contains 172 `NodeData` variants, leaving 84 values in an eight-bit tag. Its
  `PackedNode` has seven `u32` slots and sixteen flag bits. The Scout could not measure actual
  maximum current slot/flag consumption because the archived scratch tree attempted restricted
  dependency resolution; this remains an explicit Worker pre-gate if the Judge authorizes work.
- A bounded Node benchmark used 100,000 hosts and 1,000,000 lookups. At 1%, 10%, and 50% overlay
  density, dense storage used 400,000 bytes while sparse pairs used 8,000, 80,000, and 400,000
  bytes. Dense lookup measured 24.28–25.35 ns; sparse binary lookup measured 70.54–111.77 ns.
- Dense memory is `4N`; sparse pairs are `8K`; break-even is `K/N = 50%`. The proposed hard
  dialect-build threshold is sparse-index bytes no more than 2% of base AST node bytes:
  `8K <= 0.02 * 52N`, so overlay density must not exceed 13% on the acceptance corpus or reported
  Markless sample.
- The current M0 runner always extracts the control archive into `temporaryRoot/yuku`. Once
  `build.zig.zon` points to `../yuku-dialect`, it must instead read the dependency `.path` from the
  copied manifest, validate one safe allowed sibling basename, and extract exact `eb2adcb4` there.
  The existing `--yuku` archive source, `--ref`, temporary sibling layout, cleanup behavior, and
  baseline command strings remain unchanged.
- The Scout removed `t008-probe`, both probe caches, archived `t008-yuku`, capacity caches, and the
  failed capacity probe from `/private/tmp`.

## Corrected design

1. Append one generic `dialect_node` carrying a side-record index. Preserve existing tags and assert
   `@sizeOf(NodeData) == 44` and `@sizeOf(Node) == 52`.
2. Store host overlays as sorted sparse `{ host_node, record_index }` pairs. Do not add a universal
   per-node column. Binary-search only for host kinds that can carry an overlay.
3. Keep one selected schema module shared by parser, transfer, decoder generator, and encoder
   generator. A disabled schema generates no entries.
4. Module DAG:
   - `dialect_abi` imports only `std`.
   - disabled `none` imports only `dialect_abi`.
   - the external sentinel imports only `dialect_abi`.
   - parser imports `dialect_abi` and the selected dialect.
   - site-local `Host` types wrap parser-local helpers as declarations, with no function-pointer
     fields.
   - transfer and generators import parser plus the same selected schema.
5. Require sparse index bytes to remain at or below 2% of base node bytes, which corresponds to at
   most 13% overlay density. Report both acceptance-corpus and Markless sample density.

## M0 dependency-runner transition

- Change `.yuku.path` in `build.zig.zon` from `../yuku` to `../yuku-dialect`.
- Change `tools/m0-control.ts` to read the copied manifest, resolve and validate its Yuku dependency
  as one safe sibling basename, and extract the exact `--yuku`/`--ref` archive into that basename.
- Keep `/Users/jacksm5pro/dev/open-source/yuku` at clean `bf03e146` as the immutable archive source.
- Retain the existing CLI and baseline command strings.
- Extend `test/m0.test.ts` to prove manifest-derived naming, reject absolute paths, traversal,
  multiple separators, and unexpected dependency names, and retain `finally` cleanup behavior.

## Proposed Worker package for Judge review

### Objective

Create an isolated `/Users/jacksm5pro/dev/open-source/yuku-dialect` worktree on local unpushed
`seam/dialect` at exact `eb2adcb4`. First retain and run the minimal module-cycle compile test. Only
if it passes, implement the generic disabled/sentinel dialect injection, appended `dialect_node`,
typed side records, sorted sparse overlays, reflected transfer/generation, nineteen hook sites plus
the lexer boundary, and corrected M0 dependency runner. Do not implement TSRX grammar. On any stop
condition, cease writes without deleting, switching, resetting, or cleaning the isolated worktree,
so evidence remains inspectable.

### Allowed files

In `yuku-tsrx`:

- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/.github/workflows/ci.yml`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/build.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/build.zig.zon`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/tools/m0-control.ts`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/test/m0.test.ts`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/baselines/m0.json`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/src/dialect/root.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/src/dialect/schema.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/src/testing/dialect.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/tools/m1-control.ts`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/test/m1.test.ts`
- `/Users/jacksm5pro/dev/open-source/yuku-tsrx/baselines/m1.json`

In the future isolated `yuku-dialect` worktree:

- `/Users/jacksm5pro/dev/open-source/yuku-dialect/build.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/root.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/parser.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/ast.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/lexer.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/dialect/abi.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/dialect/none.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/ffi/transfer/root.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/statements.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/expressions.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/functions.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/for_loop.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/patterns.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/modules.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/variables.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/jsx/root.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/codegen/printer.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/comments.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/ecmascript.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/grammar.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/semantic/binder.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/semantic/checker.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/semantic/module_record.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/semantic/scope.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/array.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/class.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/object.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/ts/expressions.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/ts/statements.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/ts/types/core.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/ts/types/generics.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/syntax/ts/types/object.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/traverser/basic.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/traverser/scoped.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/traverser/semantic.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/traverser/transform.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/traverser/walk.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/testing/dialect.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/testing/helpers.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/testing/cases/walk.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/src/parser/testing/cases/walk_order.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/tools/estree/meta.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/tools/estree/decoder.zig`
- `/Users/jacksm5pro/dev/open-source/yuku-dialect/tools/estree/encoder.zig`

### Preconditions and creation

```sh
test ! -e /Users/jacksm5pro/dev/open-source/yuku-dialect
test "$(git -C /Users/jacksm5pro/dev/open-source/yuku rev-parse HEAD)" = bf03e146d97ae2f0c2d4c4ec90456e1e544d2760
test -z "$(git -C /Users/jacksm5pro/dev/open-source/yuku status --porcelain=v1)"
test "$(git -C /Users/jacksm5pro/dev/open-source/yuku rev-parse refs/remotes/upstream/main)" = eb2adcb4c17da16e7ade1a0517192d81d469e67f
test "$(git -C /Users/jacksm5pro/dev/open-source/yuku branch --list seam/dialect)" = ""
git -C /Users/jacksm5pro/dev/open-source/yuku worktree list --porcelain | rg -q '/Users/jacksm5pro/dev/open-source/yuku-dialect' && exit 1 || true
git -C /Users/jacksm5pro/dev/open-source/yuku worktree add -b seam/dialect /Users/jacksm5pro/dev/open-source/yuku-dialect eb2adcb4c17da16e7ade1a0517192d81d469e67f
```

The first gate adds only the dialect ABI/none modules, external sentinel, parser import, and retained
module-cycle test, then runs that test before editing broad hook, transfer, traversal, semantic,
codegen, or generator files.

### Verification

- Confirm the worktree branch is `seam/dialect`, `HEAD` is exact `eb2adcb4`, and
  `merge-base HEAD eb2adcb4` is exact `eb2adcb4`.
- Confirm all changed Yuku paths are within the allowed list and `/Users/jacksm5pro/dev/open-source/yuku`
  remains clean at `bf03e146`.
- Reject case-insensitive `tsrx` under `yuku-dialect/src` and `yuku-dialect/tools`.
- Run Zig format checks on both worktrees, Yuku tests, bounded fuzz, and all pnpm/vite-plus gates.
- Rerun the three retained M0 control commands against the exact archive.
- Run `tools/m1-control.ts --mode none` to compare node/tree sizes, tags, serialized-wire SHA-256,
  stripped binary SHA-256, generated decoder/encoder bytes, and allocations to `eb2adcb4`/M0.
- Run `tools/m1-control.ts --mode sentinel` to exercise module-cycle, every hook, layout, reflected
  round trip, generated decoder/encoder, malformed and overflow rejection, overlay cost, and
  positive/negative cases.
- Run `git diff --check` and print the sorted changed path set relative to `eb2adcb4`.

### Postconditions

- `seam/dialect` remains local and unpushed; `HEAD` remains `eb2adcb4` unless separate commit
  authority is granted, and its merge base is exact `eb2adcb4`.
- No remote branch, PR, publication, worktree removal, reset, cleanup, or active prior-art checkout
  mutation occurs.
- On failure, leave the isolated worktree mounted and unchanged for Judge inspection.

### Stop conditions

- The retained module-cycle compile test fails twice; stop before broad edits.
- Any worktree path, branch, `HEAD`, merge base, or prior-art cleanliness precondition differs.
- Any edit is required outside allowed files, in the active `../yuku`, in a downstream repository,
  or in Git remotes/published artifacts.
- Disabled `NodeData` is not 44 bytes, `Node` is not 52 bytes, `Tree` changes size, a no-op
  allocation occurs, or an existing tag changes.
- Dialect-free parser/analyzer/codegen decoder or encoder bytes, serialized buffers, or preferred
  stripped binary hash differ from control. If binary identity alone fails, stop unless ten
  interleaved samples show no more than 2% median regression, node/tree sizes are unchanged,
  allocations remain zero, and disassembly proves no hook branch/runtime call.
- Sparse index bytes exceed 2% of base node bytes or overlay density exceeds 13% on either measured
  corpus.
- Any payload exceeds seven `u32` slots or sixteen flags, total tags exceed 255, malformed tags
  decode, or record/schema identities differ.
- Any hook uses runtime pointers, `anyopaque`, registry/composition, a parser import from dialect,
  full-tree linear search, or a second parser.
- Generated output needs handwritten dialect node/field mappings or disabled entries appear in
  no-dialect artifacts.
- Hosted CI cannot represent the unpushed cross-repository seam without vendoring, a patch queue,
  or publishing. Return that authority/infrastructure conflict rather than weakening CI.
- TSRX grammar or identifiers appear in Yuku, or work advances beyond the disabled/sentinel M1 seam.

## Contradictions and decisions required from T009 Judge

1. Approve or reject the sparse overlay correction and its <=13% density / <=2% base-node-byte
   thresholds.
2. Resolve the hosted-CI versus unpushed local-worktree conflict. A local Worker cannot make a
   GitHub-hosted job retrieve unpublished Yuku seam code without prohibited duplication or
   publication.
3. Decide whether actual maximum current `PackedNode` slot/flag consumption must be measured in a
   smaller preflight task, or may be the first read/compile gate of an approved Worker package.
