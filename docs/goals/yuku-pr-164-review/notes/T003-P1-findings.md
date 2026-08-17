# T003-P1 — yuku PR #164 review: build-graph wiring, public API, and PR-level meta

Subject: <https://github.com/yuku-toolchain/yuku/pull/164> — "feat(parser): add minimal compile-time extension points"
Head: `pr-164` = `1ec1871c9eb83a27e5dfab6f2ee865596cbf6436`, single commit on `3bef742b`. Diff: 11 files, +76/-3.
Slice owned by this packet: `build.zig` (3 hunks) and `src/parser/root.zig` (1 hunk), plus the two consolidated PR-level findings (F6, F7).

Read-only review. Nothing in `/Users/jacksm5pro/dev/open-source/yuku` was modified.

---

## F1 — Extension-import coverage is complete, but it is maintained by hand in two places

- **Severity: minor**
- **Diff location:** `build.zig` `@@ -28,6 +29,7 @@ pub fn build(b: *std.Build) void {` (`parser_module.addImport("parser_extension", parser_extension);`) and `build.zig` `@@ -84,6 +86,7 @@ pub fn build(b: *std.Build) void {` (`fuzz_parser.addImport("parser_extension", parser_extension);`)
- **Repo evidence:**
  - `pr-164:build.zig:24-32` — `parser_module` (`b.addModule("parser", …)`, root `src/parser/root.zig`) gets the import at L32.
  - `pr-164:build.zig:82-89` — `fuzz_parser` (`b.createModule`, *same* root `src/parser/root.zig`, host target, `.ReleaseSafe`) gets it at L89.
  - Every other consumer reaches parser sources only through one of those two modules, never by relative import, so they inherit the import:
    - `pr-164:build.zig:63-64` — `b.addTest(.{ .root_module = parser_module })` (the `test` step).
    - `pr-164:build.zig:66-75` — `zig_tests_module` (`src/parser/testing/root.zig`) → `addImport("parser", parser_module)`.
    - `pr-164:build.zig:104-156` — three `napi_zig.addLib` calls (`yuku-parser`, `yuku-codegen`, `yuku-analyzer`), roots `src/parser/ffi/{parser,codegen,analyzer}.zig`, `.imports = &.{ .{ .name = "parser", .module = parser_module } }`.
    - `pr-164:build.zig:170-195` — `wasm_transfer_module` + the three wasm modules, all `addImport("parser", parser_module)`.
    - `pr-164:build.zig:197-205` — `main_module` (`src/main.zig`).
    - `pr-164:build.zig:211-267` — `ast_transfer_module` and the four `tools/gen_*.zig` generator modules.
    - `pr-164:build.zig:90-96` — `fuzz_driver` → `addImport("parser", fuzz_parser)`.
  - Verified there is no back-door: `git grep -n '@import("\.\.|@import("\./|@import("[a-z_]*\.zig"' pr-164 -- src/parser/ffi src/parser/testing src/main.zig tools` returns only intra-directory imports (`transfer/root.zig`, `../helpers.zig`, `estree/decoder.zig`, …). No consumer root pulls `src/parser/lexer.zig` or `src/parser/syntax/*.zig` in by relative path, so those files belong to exactly two modules, and both are wired.
- **Explanation:** the answer to "does every compilation unit that compiles parser sources receive the import" is **yes**, and this is the one thing in the PR that is verifiably correct by inspection. The problem is durability, not correctness. `fuzz_parser` is a hand-copied duplicate of `parser_module`'s construction (same root file, different target/optimize, its own three-line import list). This PR grows that duplicated list from two entries to three. The failure mode is silent-until-fatal: the next person who adds a fourth parser-rooted module — or who forgets the third line when adding one — gets a hard compile error inside `src/parser/lexer.zig:9` (`@import("parser_extension")`) with no hint that build.zig is the cause. `codegen_options` already demonstrates the same drift risk one line above.
- **Suggested direction:** factor the duplication into a local helper so the import list exists once, e.g.

  ```zig
  fn parserModule(b: *std.Build, opts: struct { … }) *std.Build.Module { … }
  ```

  and build both `parser_module` and `fuzz_parser` from it. Not a merge blocker; a cheap, mechanical hardening that makes "every parser module has every parser import" true by construction rather than by review.

---

## F2 — There is no seam: nothing in the build graph can supply a non-empty `parser_extension`

- **Severity: major**
- **Diff location:** `build.zig` `@@ -19,6 +19,7 @@ pub fn build(b: *std.Build) void {` (`const parser_extension = b.addOptions().createModule();`)
- **Repo evidence:**
  - `pr-164:build.zig:22` — `parser_extension` is a build-local `const`, bound unconditionally to a freshly created empty options module. There is no `b.option(…)` guarding it, no `b.lazyDependency`, no `b.addModule("parser_extension", …)` registration, and no `b.dependency` hook.
  - Contrast `pr-164:build.zig:14-18`, where the adjacent `codegen-source-maps` knob *is* exposed as a `b.option`, and `pr-164:build.zig:24` where `parser_module` *is* registered publicly via `b.addModule`.
  - `pr-164:build.zig.zon:11-15` — `.paths = .{ "build.zig", "build.zig.zon", "src" }`, so downstream packages consume this exact `build.zig`.
- **Explanation:** the PR's stated purpose is "downstream parsers need narrowly scoped interception points." As merged, no downstream can reach them. A dependent's `build.zig` gets `dep.module("parser")` with `parser_extension` already bound to the empty module. The only ways to actually supply an extension are:
  1. **Fork/patch `build.zig`.** Then the 19 in-tree call sites buy the fork nothing that a fork could not have added itself — the whole PR reduces to a rebase convenience.
  2. **Mutate the dependency's module in place**: `dep.module("parser").addImport("parser_extension", my_ext);`. `Module.addImport` writes into the shared module's import table, so this is a *global* side effect: every other consumer of `dep.module("parser")` in the same build graph — the three napi libs, the three wasm modules, the four generators, `src/main.zig`, the zig test step — silently picks up the same extension. It also does not reach `fuzz_parser`, which is a distinct module. Two independent dependents each wanting their own extension cannot coexist in one graph at all.

  So the seam that this PR exists to create is not, in fact, created. The 19 call sites are, for every consumer of the published package, unconditionally-erased dead code. That is the single most important build-level fact about this PR, and it is not mentioned in the PR body.
- **Suggested direction:** make the seam an explicit, first-class build input, and say so in the PR. Concretely, one of:
  - Accept an extension root path as a build option, e.g. `const ext_path = b.option([]const u8, "parser-extension", "Zig source file providing parser extension points");` and bind `parser_extension` to `b.createModule(.{ .root_source_file = b.path(ext_path) })` when present, falling back to the empty module otherwise. Works for vendored/submodule consumers.
  - Or expose a documented named module (`b.addModule("parser_extension", …)`) plus a short "how to supply an extension" note stating the mutation is intentional and graph-global.
  - Either way, add one line to the PR body describing the supported wiring, because "how does a downstream actually use this" currently has no answer in the repo.

---

## F3 — `b.addOptions().createModule()` is a sound but overloaded way to spell "empty namespace"

- **Severity: minor**
- **Diff location:** `build.zig` `@@ -19,6 +19,7 @@ pub fn build(b: *std.Build) void {`
- **Repo evidence:**
  - Zig 0.16.0 `lib/std/Build/Step/Options.zig:428-432` — `createModule` is `options.step.owner.createModule(.{ .root_source_file = options.getOutput() })`; it returns a **new module each call**, rooted at the step's generated file.
  - Same file `:16,:30` — `contents: std.ArrayList(u8)` initialized `.empty`; `:487` writes `options.contents.items` verbatim. With zero `addOption` calls the generated `options.zig` is a zero-byte file.
  - Same file `:436-438` — `getOutput()` is a `.generated` `LazyPath`, so importing the module makes each consuming `Compile` depend on the `Options` step.
  - `pr-164:build.zig.zon:13` — `minimum_zig_version = "0.16.0"`, matching the std source inspected above.
- **Explanation:** the core claim holds — a zero-byte root file is a struct namespace with no declarations, so `@hasDecl(parser_extension, X)` is comptime-`false` for every `X` (`pr-164:src/parser/lexer.zig:457`, `…/expressions.zig:111`, and the other 17 sites), and every gated branch is erased. No ordering hazard: the `Options` step is an ordinary dependency and resolves before the compilations that import it. No caching hazard: the output path is content-hashed (`Options.zig:461-469`), and an empty body hashes stably.

  The pitfalls are about fit, not soundness:
  1. **A build step for a file that is always empty.** This adds an `Options` step and a generated-file dependency edge to two compile graphs in order to produce nothing. A checked-in `src/parser/extension/none.zig` (empty, or better: empty plus a doc-comment block) via `b.createModule(.{ .root_source_file = b.path(…) })` costs no step, is greppable from the source tree, and gives the 19 signatures an obvious home (see F7).
  2. **Namespace collision between build options and hook names.** `parser_extension` is an `Options` object. Build options are conventionally snake_case; so are all 19 hook names (`can_start_binding`, `jsx_text_value`, …). If anyone ever calls `parser_extension.addOption(bool, "can_start_binding", …)` — a perfectly natural thing to do to an object named like `codegen_options` two lines above — `@hasDecl` flips to `true` and `src/parser/syntax/variables.zig:205` tries to call a `bool`. Duck typing against a *compiler-generated* namespace is the one place where you have least control over what decls appear.
  3. **Naming asymmetry.** `codegen_options` (L20) is a `*Step.Options`; `parser_extension` (L22) is a `*Module`. Two adjacent `const`s with parallel-looking names now hold different types, and only one of them is ever `.createModule()`-ed at the use site. Minor readability tax.
- **Suggested direction:** replace with a checked-in empty (or doc-only) source file used as the default extension root. It removes the step, removes the options/hooks namespace overlap, and directly enables the fix in F7. If `addOptions` is kept, at minimum do not reuse the same `Options` object for anything else, and add a comment stating that the module is intentionally empty and why.

---

## F4 — Sharing one `parser_extension` module across both graphs departs from this file's fuzz-graph convention (but is correct)

- **Severity: question**
- **Diff location:** `build.zig` `@@ -84,6 +86,7 @@ pub fn build(b: *std.Build) void {`
- **Repo evidence:**
  - `pr-164:build.zig:22,32,89` — one `parser_extension` module object is created once and imported into **both** `parser_module` (CLI `target`/`optimize`) and `fuzz_parser` (`b.graph.host`, `.ReleaseSafe`).
  - `pr-164:build.zig:77-88` — the established convention for the fuzz graph is a *fresh* instance per module: `fuzz_util` duplicates `util_module`, `fuzz_parser` duplicates `parser_module`, and `codegen_options.createModule()` is called a **second** time at L88 rather than reusing the module created at L31.
- **Explanation:** the new line is the only place in the fuzz graph that reuses a module object from the main graph, so it reads as an oversight. It is not one, and the reason is worth recording so a reviewer does not "fix" it: `util_module` (L8-12) and `parser_module` (L24-28) pin `.target`/`.optimize` explicitly, which is precisely why they cannot be reused for a host/`ReleaseSafe` graph and why `fuzz_util`/`fuzz_parser` exist. `Options.createModule()` (std `Options.zig:428-431`) pins neither, so the resulting module inherits target and optimize mode from whichever compilation roots it. Sharing it is therefore legal and produces the correct code in both graphs.

  The corollary is that the *existing* double `codegen_options.createModule()` at L31 and L88 is redundant, not load-bearing — the PR's new single-instance line is arguably the better idiom and the two-year-old lines are the odd ones out.

  One behavioural consequence to note: because the object is shared, the main graph and the fuzz graph can never be given *different* extensions. Combined with F2 this is currently moot (neither can be given any), but it is the shape a future seam has to live with.
- **Suggested direction:** no change required. Either add a one-line comment at L22 (`// no target/optimize pinned, so this module is safe to share across the host fuzz graph`), or, if consistency is preferred over minimality, mirror the local convention with a second `.createModule()` for `fuzz_parser`. Please do not "fix" this by pinning a target on the extension module — that would break the sharing that currently works.

---

## F5 — `pub const Parser` expands the public API permanently and is not required by the extension mechanism

- **Severity: major**
- **Diff location:** `src/parser/root.zig` `@@ -1,6 +1,7 @@` (`pub const Parser = parser.Parser;`)
- **Repo evidence:**
  - `pr-164:src/parser/root.zig:1-12` — before this PR the module's value surface was exactly `parse`, `Options`, `CommentMode`, plus the `ast` / `traverser` / `semantic` / `codegen` namespaces. The new line adds a fifth top-level value export.
  - `pr-164:src/parser/parser.zig:93-127` — `Parser` is a ~20-field mutable struct. Zig struct fields have no privacy, so re-exporting the type publishes all of: `tree`, `source`, `source_type`, `lang`, `preserve_parens`, `comment_mode`, `lexer`, `diagnostics`, `current_token`, `prev_token_end`, `scratch_statements`, `scratch_cover`, `scratch_decorators`, `scratch_a`, `scratch_b`, `context`, `ts_context`, `state` — i.e. the parser's entire internal working state, including scratch buffers and the lexer.
  - `pr-164:src/parser/parser.zig:128-215` — plus every `pub fn` on it: `init`, `allocator`, `parse`, `parseBody`, and the rest.
  - `pr-164:build.zig.zon:3` — `version = "0.3.0"`.
  - The seam is designed **not** to need the type. The tell is the `comptime R: type` first parameter, which appears exactly where the return type names parser-owned types and is absent everywhere else:
    - needs it: `parser_extension.lazy_assignment_pattern(Error!??ast.NodeIndex, parser)` (`expressions.zig:112`), `validate_jsx_element_name(Error!void, parser, opening_data.name)` (`jsx/root.zig:61`), `jsx_text_value(Error!?@TypeOf(text_value), parser, text_token.span)` (`jsx/root.zig:330-333`), `for_of_tail(Error!??ast.NodeIndex, parser, .{ … })` (`for_loop.zig:351-355`).
    - does not need it: `function_body_starts(parser)` (`functions.zig:136`), `jsx_names_match(parser, a, b)` (`jsx/root.zig:298`), `can_start_binding(tag)` (`variables.zig:205`) — all returning `?bool`, a universally nameable type.
  - `for_loop.zig:351-355` passes an **anonymous struct literal** as the third argument, a type the extension cannot name at all and must receive as `anytype`.
- **Explanation:** the return-type-as-comptime-parameter idiom exists precisely so an extension can be written with `parser: anytype` and never import anything from the parser module. If the extension had to name `*Parser`, it would also be able to name `Error` and `ast.NodeIndex`, and the `R` parameter would be pointless. So the mechanism argues *against* this export rather than for it. Nor could an in-graph extension use it: `parser_extension` is an options module created inside `build.zig` (F2/F3) with no import table, so it cannot `@import("parser")` even if it wanted to.

  What remains is an unrelated, permanent, hard-to-reverse widening of a 0.x library's public surface, landed inside a PR whose stated virtue is minimality ("the net production change is +73 lines"). After this, any refactor of parser scratch buffers, lexer embedding, or `ParserState` is a downstream-visible breaking change to `@import("parser").Parser`.
- **Suggested direction:** drop the line from this PR. If some consumer genuinely needs incremental parsing via `Parser.init` / `parseBody`, land it as its own PR with its own justification and a doc comment stating which fields are stable API and which are internal — that is a real API decision and deserves to be reviewed as one, not carried in as a one-line rider on an extension-seam change.

---

## F6 — CONSOLIDATED: the PR's validation claims cannot be reproduced by anyone but the author

- **Severity: blocker** (for merge; the underlying change may well be fine — the point is that no one can currently tell)
- **Diff location:** PR-level. Applies to the whole diff; the "Validation" section of the PR body.
- **Repo evidence:**
  - PR body claims five validations: `zig build test`, `zig build test -Doptimize=ReleaseFast`, "isolated specialized-extension proof covering all 19 points", an "exact 11-file / 76-addition / 3-deletion minimality audit", and "conflict-free merge-tree verification against `upstream/main` at `3bef742b`".
  - `gh pr view 164 --repo yuku-toolchain/yuku --json statusCheckRollup` returns **exactly one** check: `{"context":"Vercel","state":"FAILURE","targetUrl":"https://vercel.com/git/authorize?team=Arshad%20Pro&…&prId=164"}`. That is a fork-authorization redirect for a *docs-site* deployment; it has nothing to do with the parser and cannot pass from a fork.
  - `pr-164:.github/workflows/ci.yml:3-6` — CI triggers on `pull_request:` with **no** path or branch filter, and `:96-117` runs `zig build`, wasm build, `zig build test`, and four conformance suites (parser, codegen, analyzer, sourcemap) on `ZIG_VERSION: 0.16.0`. None of these appear in the rollup for head `1ec1871c`, which is consistent with a fork PR whose workflow runs are pending maintainer approval.
  - `gh pr view … --json files`: all 11 entries are `"changeType":"MODIFIED"`. **Zero** files added; nothing under `src/parser/testing/`, nothing under `test/`.
  - The "proof covering all 19 points" is not in the diff and, per F2, cannot even be wired up from this repo — it exists only in the author's local tree.
- **Explanation:** what the existing suite *does* cover, for free, is the empty-extension path: the parser still compiles and every conformance test still passes, which is exactly the "adds nothing when unused" claim. That is real, and it is the easy half. What has **zero** coverage, in this repo or in CI, is every path where a decl actually exists — which is the entire value proposition of the PR and the only place bugs can live. A reviewer is being asked to take on 19 permanent call sites in the hot parser path on the strength of an assertion.

  Two separable problems, worth separating in the review comment so the author is not blamed for the first:
  1. **Not the author's fault:** no CI ran at all. A maintainer needs to approve the workflow run so that `zig build test` and the four conformance suites are green on `1ec1871c`. Until then even the *unchanged-default* claim is unverified on this head.
  2. **The author's to fix:** the extension-enabled path has no in-repo test, so approving CI would still not exercise it.
- **Suggested direction:** (a) maintainer approves the fork workflow run and the PR is not merged until CI is green on this head — this is cheap and non-negotiable for a change touching the lexer and nine syntax files; (b) the private "19-point proof" is landed in-repo as a build step, which is the same fix F7 asks for and which also forces F2's seam to become real. Also: the PR body's minimality audit and merge-tree check are trivially reproducible and did check out (`git diff --stat pr-164^ pr-164` = 11 files, +76/-3; `pr-164^` = `3bef742b`), so the credibility gap is specifically about the test claims, not the whole body.

---

## F7 — CONSOLIDATED: the 19-point contract is pinned by nothing — a typo is a silent no-op

- **Severity: major**
- **Diff location:** PR-level. The `@hasDecl` + call pattern across all 9 modified parser files.
- **Repo evidence:** the complete contract, recovered by reading call sites (`git grep -n parser_extension pr-164`):

  | # | Point | Call site |
  |---|---|---|
  | 1 | `jsx_text_boundary` | `src/parser/lexer.zig:457-458` |
  | 2 | `lazy_assignment_pattern` | `src/parser/syntax/expressions.zig:111-112` |
  | 3 | `expression_at_code_block` | `…/expressions.zig:254-255` |
  | 4 | `expression_at_control_flow` | `…/expressions.zig:256-257` |
  | 5 | `for_of_tail` | `…/for_loop.zig:350-355` |
  | 6 | `function_body_starts` | `…/functions.zig:135-139` |
  | 7 | `function_body` | `…/functions.zig:196-197` |
  | 8 | `jsx_element_after_open` | `…/jsx/root.zig:53-59` |
  | 9 | `validate_jsx_element_name` | `…/jsx/root.zig:60-61` |
  | 10 | `jsx_names_match` | `…/jsx/root.zig:297-298` |
  | 11 | `jsx_text_value` | `…/jsx/root.zig:329-336` |
  | 12 | `jsx_child_at_code_block` | `…/jsx/root.zig:392-393` |
  | 13 | `jsx_child_at_control_flow` | `…/jsx/root.zig:394-395` |
  | 14 | `jsx_element_name` | `…/jsx/root.zig:648-649` |
  | 15 | `module_specifier` | `…/modules.zig:949-950` |
  | 16 | `binding_pattern` | `…/patterns.zig:15-16` |
  | 17 | `statement_at_code_block` | `…/statements.zig:80-81` |
  | 18 | `statement_at_control_flow` | `…/statements.zig:82-83` |
  | 19 | `can_start_binding` | `…/variables.zig:204-205` |

  Nothing else in `pr-164` mentions any of these names. There is no doc, no reference implementation, no test, no `comptime` signature assertion — the strings appear exactly twice each (once in `@hasDecl`, once in the call) and nowhere else in the tree.
- **Explanation:** two distinct failure modes, and the first is the dangerous one.
  1. **Wrong name → silent no-op.** `@hasDecl(parser_extension, "jsx_text_boundry")` is simply `false`. No compile error, no warning, no runtime signal. The extension author gets a parser that behaves like stock yuku and has to debug backwards from "my syntax isn't parsing" to a typo in a string that no tool checks. Duck typing on an opt-in `@hasDecl` gate converts every naming mistake into silence. This also means yuku can *rename or delete* a point and every downstream extension keeps compiling while quietly losing behaviour.
  2. **Right name, wrong signature → bad error.** The failure surfaces as a type error deep in `src/parser/syntax/jsx/root.zig` referencing yuku's internals, with no message tying it to a documented contract, and the argument types are unconstrained (`anytype`, plus an anonymous struct at `for_loop.zig:351-355`) so there is nothing to compare against.

  Both are direct consequences of the contract living only in call-site source. The PR asks the repo to maintain 19 permanent extension points across the lexer and nine syntax files while giving maintainers no artifact that tells them what a point's shape is, and no test that fails if they change it.
- **Suggested direction:** pin the contract executably. In descending order of value:
  1. **In-repo reference extension + build step (preferred).** Add `src/parser/testing/extension/reference.zig` implementing all 19 points with the intended signatures, and a `zig build test-extension` step that builds a third parser module with `parser_extension` bound to it and asserts each hook is reached (e.g. each returns a sentinel the assertion observes). This makes the contract compile-checked, keeps it honest under refactors, converts the author's private "19-point proof" (F6) into CI, and — critically — cannot be written without first building the real build-level seam (F2), so it fixes the PR's central defect as a side effect. Cost is one test module and a handful of build.zig lines.
  2. **Documented default module.** Replace the `addOptions` default (F3) with a checked-in `src/parser/extension/none.zig` whose header doc-comments the 19 signatures, and route calls through a small `comptime` helper that validates the decl's type against the expected signature and emits `@compileError("parser_extension." ++ name ++ " must be fn(…) …")` on mismatch. Fixes failure mode 2 and gives failure mode 1 a place to be documented, but still cannot catch a typo.
  3. **Minimum acceptable.** A `docs/` table listing each point: name, signature, where it fires, what returning `null` means, and what the parser does with a non-`null` result. Better than nothing; rots immediately.

  Separately, adopt a removal policy: because removal is invisible downstream, a retired point should leave a tombstone (`pub const jsx_text_value = @compileError("removed in 0.x; see …")` in the reference module, or an equivalent note) rather than just vanishing.

---

## Coverage

Every hunk in this packet's scope was examined against `pr-164` and its surrounding context in the full file at `pr-164`.

| File | Hunk header | Change | Examined | Findings |
|---|---|---|---|---|
| `build.zig` | `@@ -19,6 +19,7 @@ pub fn build(b: *std.Build) void {` | `+ const parser_extension = b.addOptions().createModule();` | yes — read against `pr-164:build.zig:14-32` and Zig 0.16.0 `std/Build/Step/Options.zig:16,30,428-438` | F2, F3 |
| `build.zig` | `@@ -28,6 +29,7 @@ pub fn build(b: *std.Build) void {` | `+ parser_module.addImport("parser_extension", parser_extension);` | yes — read against the entire `pr-164:build.zig` module graph (all 14 consumers of `parser_module` enumerated in F1) | F1 |
| `build.zig` | `@@ -84,6 +86,7 @@ pub fn build(b: *std.Build) void {` | `+ fuzz_parser.addImport("parser_extension", parser_extension);` | yes — read against `pr-164:build.zig:77-100` (fuzz graph) and compared with the `fuzz_util` / duplicated-`codegen_options` convention | F1, F4 |
| `src/parser/root.zig` | `@@ -1,6 +1,7 @@` | `+ pub const Parser = parser.Parser;` | yes — read against `pr-164:src/parser/root.zig:1-16` and the `Parser` type at `pr-164:src/parser/parser.zig:93-215` | F5 |

PR-level consolidated findings owned by this packet: **F6** (test/CI evidence gap) and **F7** (unpinned 19-point contract). Both are cross-cutting and are deliberately *not* filed against any individual hunk, to avoid duplicating the per-file packets.

Out of scope for this packet and not reviewed here: `src/parser/lexer.zig`, `src/parser/syntax/expressions.zig`, `src/parser/syntax/for_loop.zig`, `src/parser/syntax/functions.zig`, `src/parser/syntax/jsx/root.zig`, `src/parser/syntax/modules.zig`, `src/parser/syntax/patterns.zig`, `src/parser/syntax/statements.zig`, `src/parser/syntax/variables.zig`. Those files were *read* as evidence for F5 and F7 (call-site shapes), but no findings are filed against them.

### Inferred decl signature for this slice

This slice touches no individual extension point, so the contract it pins is the **shape of the `parser_extension` module import itself**. Consumers of `build.zig` are committed to supplying a module named exactly `parser_extension` that satisfies all of:

- **Resolvable as a Zig module root from every file in the parser module.** `@import("parser_extension")` appears at `lexer.zig:9`, `expressions.zig:26`, `for_loop.zig:11`, `functions.zig:11`, `jsx/root.zig:10`, `modules.zig:18`, `patterns.zig:12`, `statements.zig:19`, `variables.zig:10`. Any parser-rooted compilation unit lacking the import fails to compile outright.
- **A plain struct namespace whose decl set is drawn from the fixed 19-name vocabulary in F7.** Membership is queried only by `comptime @hasDecl`; absent names are erased, and unknown extra names are ignored entirely (no error, no warning).
- **Every present decl must be callable at comptime and must have no runtime identity of its own** — no allocator, no vtable, no retained state. The hooks receive parser state exclusively through their arguments.
- **Argument types are unconstrained (`anytype`) by design.** The `comptime R: type` first parameter carried by the 4 hooks whose result names parser-owned types exists so that the extension never imports from `parser`; one hook (`for_of_tail`) is passed an anonymous struct literal that has no nameable type at all.
- **Target-agnostic.** The module must pin neither `target` nor `optimize`, because the single instance created at `build.zig:22` is compiled into both the CLI-target graph (`parser_module`) and the host/`ReleaseSafe` fuzz graph (`fuzz_parser`). Pinning either would break `zig build fuzz`.
- **Default binding is the empty case.** `b.addOptions()` with no options yields a zero-byte root, so all 19 `@hasDecl` queries are `false` and every gated branch is erased — the "no runtime cost when unused" claim in the PR body is sound at the build level. As merged, this is also the *only* reachable binding for any consumer of the published package (F2).
