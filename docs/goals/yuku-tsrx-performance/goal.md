# yuku-tsrx End-to-End Performance

## Objective

Measure and improve the end-to-end `yuku-tsrx` package where this repository owns the cost: native binding lifetime, wire transfer, generated JavaScript decoding, package loading, and measurement design. Preserve the current approximately 3x parse-speed advantage over `@tsrx/core` while materially reducing peak memory. Upstream Yuku is expert-owned and strictly read-only.

## Original Request

“Look at upstream Yuku for performance improvements and memory improvements,” followed by the binding constraint: “do NOT make more changes to upstream. They are the experts, we only needed our minimal changes to get this to work.”

## Intake Summary

- Input shape: `vague`
- Audience: `yuku-tsrx` and Markless consumers
- Authority: `requested`
- Proof type: `metric`, `test`, `artifact`, and `review`
- Completion proof: a stable same-machine, same-corpus before/after campaign proves a material peak-RSS reduction against a frozen current `yuku-tsrx` baseline, preserves approximately 3x speed over `@tsrx/core`, and passes every parser, analyzer, codegen, wire, package, and Markless compatibility gate.
- Goal oracle: under a frozen valid protocol, optimized `yuku-tsrx` has median parse-time and throughput-cost ratios no worse than `0.34` versus `@tsrx/core`, reduces median peak RSS by at least 10% versus the frozen current `yuku-tsrx` baseline, does not regress peak-RSS p95, and retains full behavior compatibility.
- Likely misfire: modifying upstream Yuku; copying the article into speculative rewrites; optimizing a synthetic inner loop that does not move the public package; trading away the speed advantage; weakening AST, spans, diagnostics, wire format, or generated types; or claiming a memory win from noisy process-wide RSS.
- Blind spots considered: RSS may be dominated by module startup, duplicate native/JS representations, decoder object materialization, buffer lifetime, allocator retention, or the harness; process-level memory needs attribution controls; V8 GC makes sequential in-process comparisons misleading; existing benchmark artifacts include a deliberately non-blocking noisy historical campaign.
- Existing plan facts: use end-to-end package performance as the target; treat the supplied data-oriented-design article as testable hypotheses; keep upstream Yuku read-only; preserve the production toolchain and Markless migration behavior; use the previously measured `0.3116` duration ratio and `1.3134` RSS ratio only as prior evidence until a fresh baseline is frozen.

## Goal Oracle

The binding oracle is one reproducible, independently audited evidence package containing:

1. A frozen baseline and optimized measurement produced on the same machine, corpus, runtime, package artifacts, warmup/sample counts, process-isolation scheme, locale, and parser options.
2. Valid noise gates and retained raw samples for latency, throughput, and peak RSS; no comparison may mix process startup, warm state, or corpus bytes asymmetrically.
3. Optimized median `ns/parse` and throughput-cost ratios at or below `0.34` versus `@tsrx/core`, preserving approximately a 3x advantage.
4. At least a 10% reduction in optimized median peak RSS versus the frozen current `yuku-tsrx` baseline, with optimized peak-RSS p95 no worse than that baseline. Reaching parity with `@tsrx/core` is desirable but not required.
5. Attribution evidence showing which locally owned layers changed and why the measured reduction follows from those changes. Upstream Yuku source and Git state remain byte-identical.
6. Green parser, analyzer, codegen, strict/loose diagnostic, generated artifact, native wire, package/type, and Markless compatibility gates, with no AST, span, comment, diagnostic, or public-API weakening.

The PM must keep comparing receipts to this oracle. Profiling, a promising microbenchmark, one green optimization, or a noisy campaign is not completion. A final Judge must map current receipts to all six items and record `full_outcome_complete: true`.

## Goal Kind

`open_ended`

## Current Tranche

Discover enough evidence to locate the dominant locally owned latency and memory costs; freeze a fair baseline; select the largest safe reversible optimization package; implement and verify it; then continue through further high-confidence owned improvements until the full oracle passes or direct evidence proves that the threshold cannot be reached without violating the upstream-write prohibition or another non-negotiable constraint.

## Non-Negotiable Constraints

- Do not modify, format, stage, commit, branch, rebase, merge, push, publish, or open/update a PR in upstream Yuku or its checkout.
- Do not request upstream Yuku changes as part of this goal. Read-only inspection and citation are allowed solely to avoid duplicating work and to attribute costs correctly.
- Product writes are limited to the `yuku-tsrx` repository. Markless is a read-only corpus and compatibility consumer unless the owner separately expands scope.
- Preserve the unified public API: `parse`, `parseModule`, `analyze`, and `generate`.
- Preserve exact AST structure, source spans, comments, diagnostics, strict failure behavior, loose editor recovery, generated artifacts, and dialect-free controls.
- Do not optimize by weakening correctness, dropping fields, lazily omitting public data, changing benchmark corpora, relaxing noise gates, hiding startup costs, forcing GC asymmetrically, or measuring unequal package states.
- Prefer changes with direct layer attribution and reversible diffs. Avoid speculative parser rewrites and do not duplicate optimizations already owned by Yuku.
- Do not commit, push, publish, or update the existing draft PRs without separate explicit owner authority.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete, or when a Judge proves with direct measurements that no locally owned safe change can satisfy the binding oracle without violating a non-negotiable constraint and records the exact owner decision required.

Do not stop after discovery, baseline capture, attribution, or the first optimization while safe high-confidence local work remains.

Do not create one Worker/Judge pair per helper or benchmark field. Group one coherent optimization and its verification into the largest safe useful package.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

The preferred first vertical slice is: freeze the trustworthy package baseline, attribute peak RSS across process startup/native parse/wire/JS decode/retention, and return one evidence-backed optimization package. Later Workers should own complete changes such as buffer-lifetime elimination or decoder allocation reduction, including tests and measurement, rather than isolated helpers.

## Board Health

Machine truth lives in `docs/goals/yuku-tsrx-performance/state.yaml`. If the board looks stale or inconsistent, run:

```bash
node /Users/jacksm5pro/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/yuku-tsrx-performance
```

## Canonical Board

`docs/goals/yuku-tsrx-performance/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/yuku-tsrx-performance/goal.md.
Claude Code: /goalbuddy Follow docs/goals/yuku-tsrx-performance/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter and the GoalBuddy execution contract.
2. Read `state.yaml`; work only on the active task.
3. Keep the upstream-Yuku no-write rule visible in every Scout, Judge, and Worker package.
4. Freeze identities and benchmark inputs before measurements or edits.
5. Prefer evidence-backed owned-layer work; reject speculative rewrites.
6. Record a compact durable receipt and update the board after each task.
7. Continue to the next largest safe package while the full oracle remains unmet.
8. Before stopping, run the GoalBuddy stop checker and require a final full-outcome audit or a valid terminal owner-decision boundary.

