# yuku-tsrx docs site and logo, cloned from oxc-tsrx, deployed to Vercel

## Objective

Give yuku-tsrx the same public face oxc-tsrx has: a docs site with the same
structure, components, and styling, a logo that is visibly the same family but
re-colored (new gradient, adjusted accents) with a `yuku-tsrx` wordmark, content
about the parser, analyzer, and code generator instead of linting and
formatting, a much shorter README, and a live production deployment on Vercel.

## Original Request

"Make it way less wording in the readme. Copy the logo behind oxc-tsrx, as well
as the docs site as oxc-tsrx, but change the color gradient on the logo, change
up the colors a little bit, then stick yuku-tsrx. Follow the same docs style and
components as oxc-tsrx, then do a full deploy. The big difference is you won't
focus on linting and formatting; instead you will focus on the parser, analyzer,
and codegen. Use goal prep with fable opus cockpit, and 15m /loop. When done,
deploy to Vercel. Docs site wise, just copy most of the oxc-tsrx docs site."

## Intake Summary

- Input shape: `specific` (with existing-plan facts: copy oxc-tsrx)
- Audience: developers evaluating or integrating yuku-tsrx (Markless/Frameless authors, Yuku maintainers)
- Authority: `requested`
- Proof type: `artifact`
- Completion proof: production Vercel URL live, local docs build green, README trimmed, Judge visual and content audit passed
- Goal oracle: see below
- Likely misfire: copying oxc-tsrx so faithfully the site advertises lint/format/editor features yuku-tsrx lacks; inventing facts to fill pages; shipping a preview instead of production; a logo re-skinned so lightly it still reads as the oxc-tsrx mark
- Blind spots considered: compiled.run path vs `*.vercel.app` (owner call, default `*.vercel.app` with the domain step recorded); Install page must say npm is unpublished and the seam is yuku PR #164; oxc-tsrx's playground runs a wasm engine yuku-tsrx does not have (drop or replace, never copy broken); `docs/goals/` already lives under `docs/` and must not be swallowed by site tooling; no em dashes and no AI attribution in shipped prose
- Existing plan facts: copy oxc-tsrx `docs/` tooling, components, layout, styles; copy the logo pipeline and change gradient and colors; content = parser, analyzer, codegen; README same facts, far fewer words; Vercel production deploy; execution through the fable-opus cockpit under a 15-minute `/loop`

## Goal Oracle

The oracle for this goal is:

`A production Vercel URL serves a yuku-tsrx docs site that structurally matches compiled.run/oxc-tsrx (same components, layout, and styling), with a re-colored logo bearing the yuku-tsrx wordmark, whose guides cover parser, analyzer, and codegen and never claim lint/format/editor support, and whose every stated fact is checkable in this repo; the local build passes; README.md is under 90 lines with the same facts and no em dashes.`

The PM must keep comparing task receipts to this oracle. Planning, a scaffold
that builds, or a pretty logo alone is not enough. The goal finishes only when a
final Judge/PM audit maps receipts and verification back to this oracle and
records `full_outcome_complete: true`.

## Goal Kind

`specific`

## Current Tranche

Continuous: Scout maps both repos, Judge specs the packages, then Workers
scaffold the site from oxc-tsrx, re-skin the logo and assets, write the
parser/analyzer/codegen content, trim the README, deploy to Vercel production,
and a Judge audits the live site against oxc-tsrx. Advance package to package
without pausing between them unless a stop condition fires.

## Non-Negotiable Constraints

- Source of truth for style is `~/dev/open-source/oxc-tsrx/docs` (and its
  `.github/assets`). Copy its tooling, components, and styles rather than
  inventing a new design. Both projects belong to the owner; copying is allowed.
- Content is about parsing, semantic analysis, and code generation. No page may
  advertise a linter, formatter, LSP, or editor extension for yuku-tsrx.
- Every fact on the site must be checkable in this repo: `npm/yuku-tsrx/index.d.ts`,
  `src/dialect/`, `test/parser/misc/tsrx/`, `benchmarks/m6-baseline.json`,
  `README.md`, `goal.md`. No invented numbers, versions, URLs, or API names.
- Say plainly that the npm package is unpublished and that building needs the
  Yuku branch from https://github.com/yuku-toolchain/yuku/pull/164.
- No em dashes anywhere in shipped prose. No "Generated with Claude" or any AI
  attribution in files, commits, or deploy metadata.
- Do not modify `src/`, `build.zig`, `npm/yuku-tsrx/`, or `test/` (product code)
  for this goal. The site reads from them; it does not change them.
- Do not touch `docs/goals/**` from Worker packages except this board's own
  `state.yaml` and `notes/` via the PM.
- Deploy is production, not preview. Never deploy into an existing unrelated
  Vercel project. If the CLI session lacks authorization, record the exact
  prompt in a blocked receipt and continue other local work.
- Worker execution goes through the fable-opus cockpit: the `/goal` PM composes
  a packet per Worker task (`Fable-Opus-Unit: yuku-tsrx-docs-site/<task-id>`),
  dispatches `opus-worker`, reviews the diff (not the summary), and only then
  writes the receipt and commits. Scout and Judge tasks use the goal-scout and
  goal-judge agents directly.
- Commits use `--no-verify` only if the repo pre-commit hook fails on files
  outside the change (known: `zig fmt --check .` walks fetched `zig-pkg/`; m1
  controls are stale). Run the equivalent checks on changed files first.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if the user asked for working software or automation and a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

Do not create one Worker/Judge pair per repeated file, table, route, or helper. Put repeated same-shape work into one Worker package and review the package as a whole.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

A good task is the largest safe useful slice.

Small is not the goal. Useful is the goal.

A Worker should finish the whole assigned slice. A Judge should judge the whole assigned slice. A PM should reorient the board when tasks are safe but not moving the outcome.

Tiny tasks are allowed when the failure is isolated, the risk is high, the scope is unknown, or the tiny task unlocks a larger slice. Tiny tasks are bad when they keep happening, do not change behavior, only add wrappers/contracts/proof files, or avoid the real milestone.

Do not stop because a slice needs owner input, credentials, production access, destructive operations, or policy decisions. Mark that exact slice blocked with a receipt, create the smallest safe follow-up or workaround task, and continue all local, non-destructive work that can still move the goal toward the full outcome.

If an exact human approval phrase is the only remaining blocker and no safe local work remains, ask once and stop. Preserve the exact phrase in the blocked receipt as `required_reply`, set `waiting_for_user_approval: true`, set `goal.status: blocked`, and set `active_task: null`. Do not keep posting approval prompts until the user replies.

## Board Health

The PM owns board health. If the board looks stale, misleading, offline, or inconsistent, run the bundled checker:

```bash
node /Users/jacksm5pro/.claude/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/yuku-tsrx-docs-site
```

If the local board is running, compare `state.yaml` to the live board API. Repair only GoalBuddy control files unless an active Worker or PM task explicitly allows product-file edits.

## Canonical Board

Machine truth lives at:

`docs/goals/yuku-tsrx-docs-site/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/yuku-tsrx-docs-site/goal.md.
```

Owner-requested cadence: `/loop 15m /goal Follow docs/goals/yuku-tsrx-docs-site/goal.md.`

## PM Loop

On every `/goal` continuation:

1. Read this charter, and follow the GoalBuddy execution contract (`references/goal-execution.md` in the goal-prep skill) when available.
2. Read `state.yaml`.
3. Run the bundled GoalBuddy update checker when available and mention a newer version without blocking.
4. Re-check the intake: original request, input shape, authority, proof, blind spots, existing plan facts, and likely misfire.
5. Work only on the active board task.
6. Assign Scout, Judge, Worker, or PM according to the task. Worker tasks dispatch through the fable-opus cockpit.
7. Write a compact task receipt.
8. Update the board.
9. If safe local work remains, choose the next largest reversible Worker package and continue unless blocked.
10. If a problem, suggestion, or follow-up should become a repo artifact, create an approved issue/PR or ask the operator whether to create one.
11. Review at phase, risk, rejected-verification, ambiguity, or final-completion boundaries; do not review every small Worker by habit.
12. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.

Issue and PR handoffs are supporting artifacts. `state.yaml` remains authoritative, and every external artifact decision must be recorded in a task receipt.
