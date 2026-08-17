# Review: yuku PR #164 — "add minimal parser extension points"

- **PR**: https://github.com/yuku-toolchain/yuku/pull/164 (`main` ← `agent/minimal-parser-extension`)
- **Head reviewed**: `1ec1871c` (single commit on `3bef742b` / 0.8.7), fetched locally as `pr-164` in `/Users/jacksm5pro/dev/open-source/yuku`
- **Shape**: 11 files, +76/−3. Adds an empty-by-default `parser_extension` build module and 19 `@hasDecl`-gated comptime extension points across the lexer and 9 parser files; re-exports `Parser`; rewrites `canStartLetBinding` (the PR's only textual behavior change).
- **Method**: four independent review packets (build/API, JSX+lexer, statement/expression/module, binding/function), each read the diff plus the surrounding yuku code at `pr-164`, executed as isolated fable-opus workers. Full packet findings: `T003-P1..P4-findings.md`. This report deduplicates and ranks them.

## Verdict: request changes

The mechanical core of the PR is sound — with no extension present, all 19 sites provably compile away and parser behavior is unchanged (independently verified, including a 159-token exhaustive equivalence proof of the `canStartLetBinding` rewrite). But the PR does not achieve its own stated purpose: **as merged, no downstream consumer can actually supply an extension**, so all 19 call sites are dead code for every user of the published package. Combined with zero tests, zero docs, and no CI run on the head, the extension-present half of the PR — its entire value proposition — is unverified and unverifiable. The extension-present semantics also contain several traps (silent misparses, a ReleaseFast OOB, silent statement drops) that should be closed or documented before the seam invites third-party code into the hot parser path.

---

## Blocker

### B1. The validation claims cannot be reproduced; no CI ran on this head, and the claimed 19-point proof is not in the diff
*(P1-F6; corroborated by P2-F11, P3-F11, P4-F14)*

The PR body claims `zig build test` (Debug + ReleaseFast), an "isolated specialized-extension proof covering all 19 points", a minimality audit, and a merge-tree check. The only status check on `1ec1871c` is a Vercel fork-authorization **FAILURE** (docs-site deploy, unrelated to code). `ci.yml` would run `zig build test` plus four conformance suites on any PR, but no run is recorded — consistent with a fork PR awaiting workflow approval. The diff adds **zero** test files; the "19-point proof" exists only in the author's local tree and (per M1 below) cannot even be wired up from this repo. The minimality and merge-tree claims *were* independently reproduced and check out — the credibility gap is specifically the test claims.

**Ask**: (a) maintainer approves the fork CI run; do not merge before it is green on this head; (b) the 19-point proof lands in-repo (see M2), which is the same fix that makes the seam real.

## Major — structural

### M1. The seam does not exist: nothing can supply a non-empty `parser_extension`
*(P1-F2; independently rediscovered by P3-F12)*

`build.zig:22` binds `parser_extension` to an empty `b.addOptions().createModule()` as a build-local `const` — no `b.option`, no named-module registration, no dependency hook. A downstream gets `dep.module("parser")` with the empty module already bound. The only workarounds are forking `build.zig` (at which point the 19 in-tree sites buy the fork nothing) or mutating the shared module's import table in place — a graph-global side effect that hits all 14 consumers of `parser_module`, still misses `fuzz_parser`, and prevents two dependents from using different extensions in one graph. The PR body does not mention any activation path.

**Ask**: make the seam a first-class build input — e.g. `b.option([]const u8, "parser-extension", …)` resolving to a user-supplied root file, falling back to the empty module — and document the supported wiring in the PR body.

### M2. The 19-point contract is pinned by nothing; a typo'd or non-`pub` hook is a silent no-op (empirically verified)
*(P1-F7; P2-F11, P3-F10, P4-F11/F12 — verified against Zig 0.16 with a mirror build)*

Every hook name appears exactly twice (once in `@hasDecl`, once in the call); there is no doc, no reference extension, no test, no comptime signature check. Verified failure modes: a one-character typo or missing `pub` **compiles clean and the hook is silently never called**; a wrong return shape errors *inside yuku's internals* naming neither the decl nor the expected signature; and the nastiest case — declaring `Error!?NodeIndex` (single optional) where `Error!??NodeIndex` is expected — **compiles and silently collapses "handled-and-failed" into "declined"**. yuku can also rename or delete a point and every downstream extension keeps compiling while quietly losing behavior.

**Ask**: an in-repo reference extension implementing all 19 points, wired to a `zig build test-extension` step (this also discharges B1 and forces M1), plus a comptime registry check that rejects unknown decl names in `parser_extension` and validates each present decl's type, so typos and shape mismatches fail loudly with the expected signature in the message.

### M3. Decline paths assume zero token consumption; nothing states or asserts it, and `for_of_tail` needs the opposite contract
*(P3-F2/F3/F4; P2-F7 for the JSX twins)*

Five handle-or-decline sites resume on whatever token the hook left behind. If a hook inspects tokens and then declines: `parsePrefix` re-dispatches on the wrong token and produces a structurally wrong AST **with no diagnostic**; both `.at` sites build an empty-decorator "decorated" class with a stale span (`parseDecorators` returns an empty range, not null); `module_specifier` reports at the wrong span; the JSX `{`-child twins dispatch `.spread`/`.right_brace` on a consumed token. `Parser.checkpoint()/rewind()` exists but is used at none of these sites — and `rewind` does not restore the five scratch buffers, so extension-side rewinding can leave dangling `NodeIndex` values. Meanwhile `for_of_tail`'s "handle" path is unimplementable (an extension cannot reach `parseStatement` or construct a `for_of_statement`; `ast.NodeData` is a closed union — P3-F7), so its only workable use is consume-then-decline — the exact inverse of the invariant every other site needs, under the same signature.

**Ask**: wrap decline-capable hooks in checkpoint/rewind (or assert cursor stability after decline, e.g. re-assert `.at` after the decorator hooks); either give `for_of_tail` a `void`/`bool` tail-clause contract or export what a real handler needs; extend `Checkpoint` to cover scratch lengths or document the hazard.

*Addendum (post-audit)*: **P2-F2** belongs in this family as its own major — a `jsx_text_boundary` that stops on a byte outside `<`/`{`/`>`/`}` silently truncates the JSX child list and surfaces as a misleading "Expected '</'" diagnostic (zero-width tokens included). The implicit contract "only stop at bytes `parseJsxChildren` can dispatch on" is unstated and unenforced; see `T003-P2-findings.md` Finding 2.

### M4. An extension's only failure channel routes into panic-mode recovery and can silently drop code
*(P2-F6; P3-F9)*

`Error` is `error{OutOfMemory}` only, so `some(null)` is the sole way for an `Error!??NodeIndex` hook to fail — and the parser-wide convention "`null` implies a diagnostic was already reported" is stated nowhere at the seam. An extension returning `some(null)` without reporting yields a tree missing an arbitrary span of the program while `diagnostics` stays empty: a parse that claims success and silently ate code. The natural-looking `return null` in a `??NodeIndex` context means *decline*, not *fail* — both compile.

**Ask**: document the four-way return table once at the seam, and add a debug assertion that a `some(null)` return grew `diagnostics`.

### M5. `pub const Parser` is an unrelated, permanent API widening the mechanism doesn't need
*(P1-F5)*

The seam's own idiom (return type passed as `comptime R`, `parser: anytype`, an unnameable anonymous struct for `for_of_tail`) exists precisely so extensions import nothing — and the extension module *cannot* import `parser` anyway (import cycle). The export publishes all ~20 fields of `Parser` — lexer, scratch buffers, `ParserState` — on a 0.x library, inside a PR whose stated virtue is minimality. After this, any internal refactor of parser state is a downstream-visible break.

**Ask**: drop the line from this PR; if incremental parsing needs `Parser`, land it separately with a stated stable-field contract.

## Major — semantics when an extension is present

### M6. `can_start_binding` silently acquires authority over `let` disambiguation (accidental coupling)
*(P4-F2; the Scout's open question, answered: the coupling is accidental in effect even if intended in mechanism)*

Before the PR, the two `let` sites used `canStartBindingIdentifier` and were unreachable from any hook; the rewrite routes them through the hooked `canStartBinding`. The hook is context-free (`TokenTag` only), so one declaration now answers four different grammar questions: `let` at statement position, `for (let …)`, and two TS ambient sites — with no way to decline selectively. `true` for `.assign` turns sloppy-mode `let = 1` into a malformed declaration (a spec-visible ASI rule handed to an extension); `false` for `.left_brace` makes `let {a} = o` parse as identifier-plus-block, silently. The widening is also asymmetric: `!isUnconditionallyReserved` applies *after* the hook at the `let` sites but not the TS sites. Related coverage gap: `using`/`await using` consult the un-hooked `canStartBindingIdentifier`, so extension bindings work for `let` but not `using` (P4-F3).

**Ask**: keep `canStartLetBinding` on its explicit pre-PR form so the `let` cover-grammar rule stays closed, and let the hook affect only the sites it was cut for; if `let` must be extensible, give it its own named hook with `*Parser` access. (The rewrite itself is behavior-preserving today — see V1 — this is about what the hook can reach.)

### M7. `function_body_starts` can mint impossible ASTs, and the case it looks built for is unreachable
*(P4-F4/F5)*

Forcing `false` with `{` on the next line makes ASI succeed silently: the body becomes a sibling `BlockStatement`, and `function_type` becomes `.ts_declare_function` — **emitted into a JavaScript tree** when `is_ts` is false; for a function expression it mints a `FunctionExpression` with `body == .null`, violating the invariant stated eleven lines above the hook. Forcing `true` yields spurious "Expected '{'" on valid ambient/overload TS. And the hook sits *after* the ambient-with-brace guard that `return null`s — the most plausible reason to use a hook of this name is the one case it cannot influence.

**Ask**: constrain the hook (narrow-only or ambiguous-cases-only), assert `!(is_function_expression and !has_body)` after it, and either move it above the ambient guard or rename it.

### M8. `jsx_text_value` hands the seam an unvalidated `String` handle; a bad handle is OOB in release builds
*(P2-F4)*

`String` is a `{start,end}` handle resolved by `ASTStringPool.get` branching on `start < source.len`; the guarding asserts are **erased in ReleaseFast/ReleaseSmall**, so a hand-built handle with `end > source.len` becomes an out-of-bounds slice of source. The node also keeps the original token span while the value changes, so span-driven consumers (source maps) and value-driven consumers (codegen) silently diverge.

**Ask**: document that the hook must return a handle from `tree.addString`/`tree.sourceSlice`, add a debug-mode bounds validation at the call site, and spell the return type as `ast.String` rather than `@TypeOf(text_value)`.

### M9. `jsx_names_match` overrides reach the binder; accepted mismatches emit references to names the user never wrote
*(P2-F5)*

The binder walks opening *and* closing element names, so an override accepting `<Foo>…</Bar>` produces a symbol reference to `Bar` (unresolved-symbol / unused-import consequences follow), and the printer round-trips the mismatch. Forcing `false` on identical names yields the self-contradictory "Expected closing tag for '<Foo>' but found '</Foo>'". The hook takes `*const Parser`, so it cannot report a rule-appropriate diagnostic.

**Ask**: pass `*Parser`, let the hook distinguish "mismatch, already reported"; document the binder consequence.

### M10. `binding_pattern` fires inside speculative lookahead and its returned node kinds silently lose TS semantics
*(P4-F7/F8)*

`isFunctionTypeAfterPattern` invokes `parseBindingPattern` under `checkpoint()/rewind()` purely as lookahead — hook side effects fire on text that is re-parsed down a different path, and node indices the hook minted are freed and **reissued**. Separately, the three `predicate.zig` helpers no-op on unrecognized node kinds, so a custom pattern node silently loses its `: T` annotation, `?` marker, and decorators, and `isDestructuringPattern` returning false switches off two checker rules.

**Ask**: document the speculative-invocation constraint (or pass a `speculative` flag); require/assert one of the four recognized pattern kinds, or add a loud arm to the `predicate.zig` helpers.

### M11. Hook placement/context gaps make several points hard to implement correctly
*(P3-F1/F5; P2-F1/F8/F9)*

`lazy_assignment_pattern` receives neither `precedence` nor `opts` — the two inputs that decide whether an assignment-level production is legal at the point it heads. The `.at` hooks fire for every `@` in the program in three indistinguishable syntactic positions, while class-member decorators are not hooked at all. `jsx_element_after_open` observes four different parser states depending on `self_closing`×`context` and receives a non-`pub` enum it can't name; `jsx_element_name` fires for opening and closing tags with no discriminator. `jsx_text_boundary` gets `(source, cursor)` with no `start` and no lexer state, so any context-dependent boundary rule is O(n²) per text run — in the hottest JSX loop (per-byte hook cost is already 2–3× and defeats vectorization when an extension is present; zero-cost when absent).

**Ask**: forward the context each hook needs (position discriminants, `opts`/`precedence`, `start`), make `JsxElementContext` `pub`, and consider a chunked boundary hook consulted once per text run.

## Verified sound (no action needed)

- **V1. `canStartLetBinding` rewrite is behavior-preserving** — proved exhaustively over all 159 `TokenTag`s (old `B or (IL and !UR)` vs new `(IL or B) and !UR` differ only if `[`/`{` were reserved; they aren't; also `UR ⊆ IL` holds). Suggested hardening: a one-line comptime assert or table-driven test pinning the property (P4-F1).
- **V2. Comptime erasure is real** — every hook hunk is a pure insertion; with the empty default module all 19 `@hasDecl`s fold to false; default-build codegen is byte-identical (P2-F1, P3-F12, P4 context).
- **V3. Build-graph import coverage is complete** — all consumers route through `parser_module`/`fuzz_parser`, both patched; no orphan compilation unit (P1-F1; hand-maintained duplication noted as minor).
- **V4. `b.addOptions().createModule()` is a sound empty-module idiom** on Zig 0.16, with a namespace-collision caveat between build options and hook names (P1-F3); sharing one instance across the main and fuzz graphs is correct, not an oversight (P1-F4).
- **V5. `module_specifier` is the one correctly-guarded hook** — inside the failure branch, disjoint from `parseModuleExportName`; two narrow caveats about identifier-like specifiers vs `export * as X` and `with`/`assert` absorption (P3-F8).
- **V6. Error propagation is unwind-safe** — `defer`-based scratch discipline and arena allocation survive OOM (P3-F9).

## Minor / nit (see packet files for detail)

`?bool` tri-state undocumented and the natural `return tag == .my_token` mistake disables declarations (P4-F10, promotable to major if the hooks ship as-is) · four `*_at_code_block/control_flow` names where two would do, precedence by line order (P3-F6, P2-F7) · `function_body_starts` vs `function_body` reach asymmetry, concise arrows invisible to both (P4-F6) · `function_body_starts` can't report or allocate (P4-F13) · `validate_jsx_element_name` can't reject recoverably — `Error!void` with `Error = OOM` makes it advisory-only in disguise (P2-F10) · `jsx_text_boundary` `?bool` where `bool` suffices (P2-F3) · overshoot past `)` in `for_of_tail` yields a maximally confusing diagnostic; guard it like `module_specifier` (P3-F4) · hand-maintained duplicate import lists in `build.zig` (P1-F1) · closed `ast.NodeData` union bounds what "extension" can mean; state it or add an opaque variant (P3-F7).

## Coverage

All 11 changed files were reviewed by exactly one packet each: P1 `build.zig`, `src/parser/root.zig` · P2 `src/parser/lexer.zig`, `src/parser/syntax/jsx/root.zig` · P3 `src/parser/syntax/{expressions,statements,for_loop,modules}.zig` · P4 `src/parser/syntax/{variables,patterns,functions}.zig`. Each packet file ends with a per-hunk coverage table (every hunk of the +76/−3 diff examined) and the inferred decl signatures for its extension points — together these constitute the only written form of the 19-point contract that currently exists. Nothing was posted to GitHub; the yuku clone was left clean throughout.

## Suggested merge path

1. Approve the fork CI run; require green `zig build test` + conformance suites on `1ec1871c` (B1).
2. Add the build-level seam (`b.option` or named module) + in-repo reference extension + `test-extension` build step + comptime decl-registry validation (M1, M2 — one coherent change that also converts the author's private proof into CI).
3. Drop `pub const Parser` from this PR (M5).
4. Decide the decline-path contract and assert it; fix or re-contract `for_of_tail` (M3); document the return conventions (M4).
5. Decouple `canStartLetBinding` from the hook or make the coupling explicit and tested (M6).
6. The remaining extension-present semantics (M7–M11) can land as follow-ups if the seam ships disabled-by-default, but each needs at least the one-line doc/assert called out above before third-party extensions are invited.
