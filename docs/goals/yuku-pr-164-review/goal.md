# Yuku PR #164 Review

## Objective

Produce one complete, evidence-backed code review of https://github.com/yuku-toolchain/yuku/pull/164, grounded in the yuku repo itself (local clone at `/Users/jacksm5pro/dev/open-source/yuku`), delivered as a ranked findings report in `notes/`.

## Original Request

"Do a 15m /loop using goal prep skill with fable opus cockpit. I want you to do a PR review on https://github.com/yuku-toolchain/yuku/pull/164 in relation to the yuku repo"

## Intake Summary

- Input shape: `audit`
- Audience: Jack Shelton (yuku toolchain maintainer)
- Authority: `requested` (review is read-only; posting anything to GitHub needs explicit approval)
- Proof type: `review`
- Completion proof: final ranked review report in `notes/` covering the whole PR diff, each finding backed by diff-line and repo-file evidence, passed by Judge audit
- Goal oracle: the review report whose findings each cite specific PR #164 diff hunks and corroborating yuku repo files, with coverage spanning the entire diff
- Likely misfire: reviewing the raw diff without repo context, drifting into fixing the PR, or posting to GitHub without approval
- Blind spots considered: delivery target (assumed local report, not a GitHub review); unknown PR size/risk until Scout maps it; depth priority is correctness > design > perf/tests > style
- Existing plan facts: worker-shaped review packets must be dispatched through the **fable-opus-cockpit** packet gate; a 15m `/loop` (cron job `fc1c048f`) re-enters this goal each iteration

## Goal Oracle

The oracle for this goal is:

`notes/T004-review-report.md: a severity-ranked review where every finding cites exact PR #164 diff hunks plus yuku repo evidence, with a coverage statement proving the whole diff was reviewed.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`audit`

## Current Tranche

One full review pass: Scout maps the PR and repo context, Judge partitions the diff into the largest safe review packets, Worker executes those packets through the fable-opus cockpit writing findings to `notes/`, PM synthesizes the ranked report, Judge audits coverage and evidence. The tranche ends at the audited report — no code fixes, no GitHub posting.

## Non-Negotiable Constraints

- Read-only with respect to yuku and yuku-tsrx implementation files; the only writes are GoalBuddy control files and `notes/`.
- Worker-shaped review packets are dispatched through the fable-opus-cockpit skill's packet gate (opus-worker subagents), per the user's instruction.
- Nothing is posted to the GitHub PR (comments, reviews, labels) without explicit user approval.
- Findings must cite both the diff location and the supporting yuku repo context — no vibes-only review.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after Scout mapping or Judge packet selection; continue into packet execution and synthesis. Do not mark complete while any queued review packet or the synthesis task remains. If posting the review to GitHub is desired, that is a new user-approved tranche, not part of this one.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny. Prefer few large review packets that each cover a coherent slice of the diff over many per-file micro-tasks. A packet worker completes its whole slice; the Judge audits the whole report.

## Board Health

If the board looks stale or inconsistent, run:

```bash
node /Users/jacksm5pro/.claude-swap-backup/sessions/1-me_jackshelton.com/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/yuku-pr-164-review
```

## Canonical Board

Machine truth lives at:

`docs/goals/yuku-pr-164-review/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/yuku-pr-164-review/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter, and follow the GoalBuddy execution contract (`references/goal-execution.md` in the goal-prep skill) when available.
2. Read `state.yaml`.
3. Run the bundled GoalBuddy update checker when available and mention a newer version without blocking.
4. Re-check the intake: original request, input shape, authority, proof, blind spots, existing plan facts, and likely misfire.
5. Work only on the active board task.
6. Assign Scout, Judge, Worker, or PM according to the task. Before dispatching any worker-shaped packet, load the `fable-opus-cockpit` skill and go through its packet gate.
7. Write a compact task receipt.
8. Update the board.
9. If safe local work remains, choose the next largest reversible package and continue unless blocked.
10. Review at phase, risk, rejected-verification, ambiguity, or final-completion boundaries.
11. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.
