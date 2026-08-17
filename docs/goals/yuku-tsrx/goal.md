# yuku-tsrx production toolchain

## Objective

Execute the repository-root [`goal.md`](../../../goal.md) continuously until `.tsrx` has a
production Zig parser, analyzer, code generator, and generated TypeScript consumption surface built
as a dialect adapter over path-linked Yuku, with every binding item in its owner-amended Goal Oracle
proven.

## Original Request

> Follow goal.md

The root charter preserves the owner's earlier request, rulings, reconnaissance, architecture,
toolchain pins, milestones M0 through M5, non-negotiable constraints, and completion oracle. It is a
binding input to every task on this board.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Markless, Frameless, and future Versionless and Guessless consumers
- Authority: `requested`
- Proof type: `test`, `artifact`, and `metric`
- Completion proof: all eight binding root-charter oracle items have current command-backed evidence,
  including
  an unmodified Markless drop-in test run and a minimal, review-ready Yuku dialect-seam branch.
- Goal oracle: the owner-amended eight-item binding set in the root `goal.md`, retaining historical
  numbering 1–3 and 5–9; item 4 is explicitly non-blocking.
- Likely misfire: shipping a second parser, a fork, a text projection, a hand-written decoder, or a
  parser-only milestone while calling the broader production toolchain complete.
- Blind spots considered: the recorded Yuku commit identities may have moved since intake; Zig 0.16
  availability, native packaging, memory measurement, cross-repository write authority, and later PR
  authority must be proved rather than inferred.
- Existing plan facts: preserve owner rulings; execute M0 through M5 in order; develop through a local
  path-linked Yuku checkout; keep downstream repositories read-only; do not open or publish the Yuku
  PR without separate approval after all binding pre-publication items are green.

## Goal Oracle

The oracle is the eight-item binding checklist under `## Goal Oracle` in the root
[`goal.md`](../../../goal.md), with historical numbering 1–3 and 5–9: behaviour parity, no TSRX
knowledge in Yuku, a free absent seam, parser/analyzer/codegen, generated zero-copy TypeScript
consumption, the Markless integration proof, measured `@tsrx/core` performance, and a minimal PR-ready
Yuku branch. Historical item 4 is retained as provenance only and does not gate completion.

The PM must map every final claim to current receipts and command output. Planning, scaffold health,
fixture parity alone, or one green milestone is not completion.

## Goal Kind

`existing_plan`

## Current Tranche

Continuous execution of the full owner outcome. Start by validating current environment reality and
standing up M0. After each verified milestone, immediately select the largest safe next package toward
M1 through M5. Stop only at a true approval/authority boundary with no safe local work remaining or
after a final audit proves the complete eight-item binding oracle.

## Non-Negotiable Constraints

- The root `goal.md` is binding in full.
- Yuku remains the JS/TS engine. Never fork, vendor, or build a parallel engine.
- All TSRX knowledge lives in this repository; Yuku changes must be dialect-generic.
- Work against the path-linked local Yuku checkout; follow its `AGENTS.md` for Zig in both repos.
- Preserve dialect-free `Node` size and wire format, and prove zero-cost claims by measurement.
- Generate decoder/encoder artifacts from Zig declarations; never hand-maintain them.
- Keep Markless, Frameless, Versionless, Guessless, and oxc-tsrx read-only.
- Do not push, publish, create repositories, or open PRs without explicit authority at that time.
- Precede implementation slices with failing behavioural tests and retain positive and negative cases.

## Canonical Board

Machine truth lives at [`state.yaml`](./state.yaml). If this charter and `state.yaml` disagree on task
status, receipts, active work, or completion, `state.yaml` wins.

## Stop Rule

Stop only when a final Judge or PM audit records `full_outcome_complete: true` against every root-charter
oracle item, or when the board records the exact terminal human-approval wait shape and no safe local
work remains.
