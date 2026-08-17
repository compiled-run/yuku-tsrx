# Minimal upstream Yuku seam

## Objective

Replace the closed broad upstream Yuku seam with the smallest verified generic compile-time extension required by yuku-tsrx, keeping all TSRX-specific grammar, analysis, codegen, compatibility, and product integration in yuku-tsrx while preserving Yuku's data-oriented design and zero-cost common path.

## Original Request

"Minimal changes needed only NOW. Like make a function public type minimal," followed by: "Yes very tiny upstream that meets the needs for us and still follows all the yuku philosophy."

## Intake Summary

- Input shape: `recovery`
- Audience: yuku-tsrx, upstream Yuku maintainers, and Markless consumers
- Authority: `approved`
- Proof type: `test`
- Completion proof: a fresh patch from the authoritative clean upstream base adds only the minimum generic compile-time interception/accessibility required by yuku-tsrx, stays within the binding size budget, adds zero disabled-path runtime or representation cost, and passes complete upstream plus yuku-tsrx/Markless compatibility verification without the closed broad seam.
- Goal oracle: every upstream changed line maps to a demonstrated yuku-tsrx need and matches Yuku's philosophy: flat/indexed data remains unchanged, no per-node allocation or pointer graph is introduced, the normal parser path stays compile-time-specialized and branch-free, node/token/wire sizes do not grow, source strings remain offset-based, and invariants remain compile-time enforced.
- Likely misfire: trimming the old 2.3k-line branch, recreating a dialect framework under a smaller name, adding runtime callbacks/vtables/branches, bloating AST or wire records, or moving TSRX behavior upstream.
- Blind spots considered: a truly minimal extension may be a tiny compile-time hook rather than only `pub`; extension-disabled code must compile to the unchanged path; the hook must support recursive interception without becoming a framework; authoritative upstream base may have advanced; the old closed branch and PR must not be updated or reused.
- Existing plan facts: start fresh; prefer public exposure first; one generic compile-time extension with point-specific calls is explicitly authorized; keep the 75-added-production-line and 150-total-changed-line ceilings; the exact clean-base distribution is eleven production paths (nine demonstrated consumers, one existing-type public export, and one build-time selector); follow Yuku's data-oriented, allocation-conscious, compile-time-invariant philosophy; keep all TSRX vocabulary and behavior local.

## Goal Oracle

The oracle for this goal is:

`From clean Yuku base 728c16d4, the upstream production patch changes at most eleven source files and adds at most 75 production lines; the eleven paths are limited to nine demonstrated consumer files, one public re-export of the existing Parser type, and one build-time selector; it introduces exactly one narrowly scoped generic compile-time extension type with point-specific calls only at demonstrated current consumers; disabled/default Yuku compiles to unchanged parser behavior with no runtime dispatch, allocation, node/token/wire-size growth, or common-path branch; no TSRX identifier or broad framework exists; yuku-tsrx owns all dialect behavior and its parser/analyzer/codegen/package/Markless gates pass.`

The final Judge must map every upstream changed line to a required yuku-tsrx use. Any line without direct necessity fails the oracle. Focused proof must live in those same eleven changed paths so the complete upstream patch—including tests—remains reviewably small; any proposed expansion beyond 150 changed lines or eleven upstream paths requires explicit owner approval and cannot be inferred.

## Goal Kind

`recovery`

## Current Tranche

Design the smallest clean-base generic compile-time interception point consistent with Yuku's architecture, prove every proposed line and disabled-path invariant before writes, implement it in a fresh isolated worktree/branch without touching the closed PR branch, keep all dialect behavior local to yuku-tsrx, and run the complete compatibility oracle. Do not push, publish, or open/update a PR in this tranche.

## Non-Negotiable Constraints

- The closed `seam/dialect` branch is read-only evidence. Do not commit to it, force it, update its remote branch, reopen its PR, or cherry-pick its commits.
- Start the replacement from the current authoritative clean upstream base selected by the Judge after Scout evidence.
- Prefer visibility/export/accessibility of existing capabilities. When visibility alone is insufficient, one tiny generic compile-time interception primitive is authorized; it must be independently designed from the clean base and cannot recreate the closed seam.
- Upstream production ceiling: at most eleven source files and at most 75 added production lines. The only permitted paths are the nine demonstrated consumer files, the existing Parser public-export path, and the build-time selector path. Fewer remains preferable; no exception without a new explicit owner instruction.
- Complete upstream patch ceiling: at most eleven paths and 150 changed lines including focused tests, which must be embedded in those paths. If that cannot satisfy behavior, stop and report the exact missing capability.
- Exactly one generic compile-time extension type, with point-specific compile-time calls only at the 19 independently demonstrated current consumers. No broad hook framework, runtime callback/vtable, dispatch table, new grammar/AST representation, traversal, semantic-analysis or codegen framework, wire-layout change, allocator change, or TSRX-specific name.
- A specialized-only state channel is permitted only if the default specialization preserves layout, allocation behavior, control flow, optimized machine code, and serialized output. It may not add any default-path retained state, lookup, pointer chase, or branch.
- The default/disabled Yuku specialization must compile to the pre-change control flow: no extra runtime branch, indirect call, allocation, pointer chase, source copy, or retained state.
- Preserve `Node`, `NodeData`, token, packed-wire, extras, string-pool, arena, and flat-index representation sizes/layouts unless the pre-change compiler already derives them identically; compile-time size/layout assertions must remain green.
- Preserve bottom-up indexed construction, scratch-buffer reuse, source-offset strings, common-case ASCII fast paths, exact wire compatibility, and one-arena teardown.
- Any generic API must be compile-time typed, statically dispatched, and validated at compile time; it must not make ordinary Yuku consumers pay for yuku-tsrx flexibility.
- Put TSRX-specific behavior and complexity in yuku-tsrx, even if that requires a larger local refactor.
- Preserve upstream non-TSRX behavior byte-for-byte at the public AST/diagnostic level and keep upstream tests green.
- Preserve yuku-tsrx parser, analyzer, codegen, wire, package, strict/loose, string/byte input, and Markless behavior.
- Preserve all unrelated dirty work in yuku-tsrx. Do not overwrite or reformat performance-goal evidence.
- No commit, stage, push, publish, release, remote mutation, or PR creation/update unless the owner separately authorizes it.

## Stop Rule

Stop only when a final audit proves the tiny clean-base extension and local yuku-tsrx integration satisfy the full oracle—including Yuku's zero-cost data-oriented invariants—or when the authorized 75-line/eleven-source-file production ceiling is proven insufficient and the board records the exact owner decision required.

## Canonical Board

Machine truth lives at:

`docs/goals/yuku-minimal-seam/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/yuku-minimal-seam/goal.md.
Claude Code: /goalbuddy Follow docs/goals/yuku-minimal-seam/goal.md.
```
