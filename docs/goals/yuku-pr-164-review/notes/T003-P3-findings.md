# T003-P3 — yuku PR #164 review: statement / expression / for-of / module interception slice

**PR**: https://github.com/yuku-toolchain/yuku/pull/164 — "feat: add minimal parser extension points"
**Head**: `pr-164` = `1ec1871c9eb83a27e5dfab6f2ee865596cbf6436`
**Whole-PR shape**: 11 files, +76/-3 (`git -C /Users/jacksm5pro/dev/open-source/yuku diff --stat pr-164^ pr-164`)
**Slice**: `src/parser/syntax/expressions.zig`, `src/parser/syntax/statements.zig`, `src/parser/syntax/for_loop.zig`, `src/parser/syntax/modules.zig` — 7 hook sites.
**Read-only**: no writes to the yuku clone; all evidence via `git show` / `git diff` against the existing `pr-164` ref.

---

## Shared mechanism (context for every finding below)

All seven in-scope sites use one shape:

```zig
if (comptime @hasDecl(parser_extension, "<name>"))
    if (try parser_extension.<name>(Error!??ast.NodeIndex, parser)) |node| return node;
```

Three facts drive most of the analysis:

- `parser_extension` is bound in `pr-164:build.zig:22` as `b.addOptions().createModule()` — an **empty** options module. Every `@hasDecl` is therefore `false` in-tree today.
- `Error` is `error{OutOfMemory}` and nothing else (`pr-164:src/parser/parser.zig:91`).
- The return type is a **double** optional, `??ast.NodeIndex`, and the outer/inner layers carry different meanings:
  - outer `null` → "I decline, host continues"
  - inner `null` (i.e. `@as(?NodeIndex, null)` wrapped) → "I handled it and the parse failed" — propagates as the host function's own `null` abort
  - `node` → "I handled it, here is the node"

`pr-164:src/parser/root.zig` newly exports `Parser` (and only `Parser` — not `Error`, not `ast`, not `Checkpoint`, not `Token`). The parser type in `Error!??ast.NodeIndex` is passed as a comptime argument precisely because the extension module cannot name those types.

---

## Findings

### F1 — `lazy_assignment_pattern` is denied the one input that decides whether an assignment-level production is legal

- **Severity: major**
- **Diff location**: `src/parser/syntax/expressions.zig`, hunk `@@ -107,6 +108,8 @@ inline fn infixPrecedence(token: Token, is_ts: bool) u8 {`
- **Repo evidence**:
  - `pr-164:src/parser/syntax/expressions.zig:110-113` — `fn parsePrefix(parser: *Parser, opts: ParseExpressionOpts, precedence: u8)`; the hook is called with `(Error!??ast.NodeIndex, parser)` only. Neither `opts` nor `precedence` is forwarded.
  - `pr-164:src/parser/syntax/expressions.zig:48` — the sole caller: `parsePrefix(parser, opts, min_precedence)`.
  - `precedence` is materially load-bearing in the very function the hook heads: line 140 gates `yield` on `precedence < Precedence.Additive`, line 159 gates the TS generic-arrow attempt on `precedence <= Precedence.Assignment`. Both are exactly the "is an assignment-level form allowed here?" question.
  - `opts.in_cover` is consulted downstream at `pr-164:src/parser/syntax/expressions.zig:249-250` (`parseArrayExpression`/`parseObjectExpression`) to distinguish cover-grammar parsing (arrow params) from real expressions.
- **Explanation**: an extension named `lazy_assignment_pattern` exists to recognize an assignment-shaped production. Whether such a production is grammatically admissible at this point depends entirely on `precedence` (it must not fire as the right operand of `a + <here>`, where `precedence > Precedence.Assignment`) and on `opts.in_cover` (inside `( … )` being parsed as a cover for arrow params, the same token run means something different). The hook is handed neither, so it can only ever apply its production unconditionally at every operand position in the program, or not at all. Every other multi-input site in this slice does forward context — `for_of_tail` gets a four-field struct — which makes the omission look accidental rather than deliberate.
- **Suggested direction**: forward the existing parameters — `parser_extension.lazy_assignment_pattern(Error!??ast.NodeIndex, parser, .{ .opts = opts, .precedence = precedence })` — matching the anon-struct convention already used by `for_of_tail`. If the intent really is "context-free", say so in a doc comment at the site, because the name implies otherwise.

---

### F2 — Decline paths assume zero token consumption, but nothing enforces it, and the failure mode is a silent misparse

- **Severity: major**
- **Diff location**: all five "handle-or-decline" hunks —
  `expressions.zig @@ -107,6 +108,8 @@`, `expressions.zig @@ -248,6 +251,10 @@`,
  `statements.zig @@ -76,6 +77,10 @@`, `modules.zig @@ -945,6 +946,8 @@`
- **Repo evidence** — what each site does immediately after an outer-`null` (decline) return:
  - `pr-164:src/parser/syntax/expressions.zig:114` — `const tag = parser.current_token.tag;` then a 12-way `if` ladder. If the hook advanced the lexer, the host re-dispatches on a *different* token, produces a structurally wrong AST, and emits **no diagnostic at all**. This is the worst site: silent wrong parse.
  - `pr-164:src/parser/syntax/expressions.zig:258-259` — `const decorators_start = parser.current_token.span.start;` then `extensions.parseDecorators(parser)`. `parseDecorators` (`pr-164:src/parser/syntax/extensions.zig:9-19`) is `while (parser.current_token.tag == .at) { … }` and returns an **empty `IndexRange`, not `null`**, when the loop never runs. So a hook that consumed the `@` and declined yields `class.parseClassDecorated(parser, …, decorators_start, <empty>)` with `decorators_start` pointing at a token that is no longer `@` — a bogus span on a decorator-less "decorated" class.
  - `pr-164:src/parser/syntax/statements.zig:78-84` — identical, and note the existing `std.debug.assert(parser.current_token.tag == .at)` sits at line 78, **before** the two hooks, so it cannot catch post-hook drift. `parseDecorator`'s own assert (`extensions.zig:22`) is inside the `while` and is likewise skipped.
  - `pr-164:src/parser/syntax/modules.zig:951-953` — `parser.reportExpected(parser.current_token.span, "Expected module specifier", …)`. The span is wherever the hook left the cursor, so the diagnostic points at unrelated source.
- **Explanation**: the invariant "a declining hook must leave `current_token`, `lexer.cursor`, `lexer.state`, `lexer.mode` and `prev_token_end` exactly as it found them" is real, unstated, and unchecked. The parser *does* ship the right primitive — `Parser.checkpoint()` / `Parser.rewind()` at `pr-164:src/parser/parser.zig:396` and `:414`, which restores lexer cursor/state/mode, `current_token`, `prev_token_end`, `tree.nodes.len`, `tree.extras.len`, `diagnostics.len`, `context`, `ts_context`, `state`. But nothing at these sites mentions it, and `rewind` notably does **not** restore the five scratch buffers (`scratch_statements`, `scratch_cover`, `scratch_decorators`, `scratch_a`, `scratch_b`, declared `pr-164:src/parser/parser.zig:109-115`). An extension that appends node indices to a shared scratch and then rewinds leaves indices pointing past the now-shrunk `tree.nodes` — dangling `NodeIndex` values that an enclosing `flushToExtras` will happily copy into the tree. `lazy_assignment_pattern` in particular fires inside array-literal, object-literal and argument-list parsing, i.e. with `scratch_a`/`scratch_cover` checkpoints already open.
- **Suggested direction**: (a) document the decline-path invariant in a comment at each site; (b) add `std.debug.assert` guards after the hook — cheap in ReleaseFast, and they turn a silent misparse into a loud one. At minimum re-assert `parser.current_token.tag == .at` after the two `.at` hook pairs; a generic `assert(parser.lexer.cursor == cursor_before)` under `if (std.debug.runtime_safety)` would cover all five. (c) Extend `Checkpoint` to include the scratch lengths, or document that `rewind` is unsafe while a scratch checkpoint is open.

---

### F3 — `for_of_tail` cannot actually *handle* a for-of; the only workable usage is "consume and decline", which contradicts its `??NodeIndex` return type

- **Severity: major**
- **Diff location**: `src/parser/syntax/for_loop.zig`, hunk `@@ -346,6 +347,13 @@ fn parseForOfStatementRest(`
- **Repo evidence**:
  - `pr-164:src/parser/syntax/for_loop.zig:350-356` — the hook returns `??ast.NodeIndex`; a non-null outer value short-circuits the rest of `parseForOfStatementRest`, i.e. the hook takes responsibility for the `)`, the loop **body**, and the `for_of_statement` node.
  - `pr-164:src/parser/syntax/for_loop.zig:361-364` — the body the hook would have to replace is `statements.parseStatement(parser, .{ .can_be_single_statement_context = true })`. `parseStatement` is `pub` within the parser module but **not** reachable from an extension: `pr-164:src/parser/root.zig` exports only `parse`, `Parser`, `Options`, `CommentMode`. The only body-parsing entry point an extension can reach is `Parser.parseBody` (`pr-164:src/parser/parser.zig:215`), which parses a *block* body, not a single statement, and takes a `BodyKind` the extension cannot name.
  - `pr-164:src/parser/syntax/for_loop.zig:366-373` — building the replacement requires `ast.NodeData{ .for_of_statement = … }`, and `ast.NodeData` (`pr-164:src/parser/ast.zig:4032`) is a closed `union(enum)` with no extension variant (`grep -i extension src/parser/ast.zig` returns only two unrelated "file extension" comments).
- **Explanation**: the handle path is unreachable in practice. The only implementable behavior is: consume the extra tail tokens (e.g. a keyed-repeat clause), stash them in extension-side state, then return outer `null` so the host proceeds to `expect(.right_paren)` at line 357. That means `for_of_tail` is the **one** site in this slice where advancing on the decline path is mandatory — the exact opposite of the invariant F2 establishes for the other five. Two contradictory contracts share one call shape and one return type, with nothing distinguishing them.
- **Suggested direction**: pick one. Either give the hook a `void`/`bool` return and name it `for_of_tail_clause` to make "consume, then host continues" the contract; or keep `??NodeIndex` and export what a handler would actually need (`parseStatement`, or a `Parser.parseSingleStatement` wrapper, plus a way to construct the node). Shipping both meanings under one signature guarantees a wrong first implementation.

---

### F4 — `for_of_tail`'s placement makes the `)` diagnostic point at the wrong token whenever the hook overshoots

- **Severity: minor**
- **Diff location**: `src/parser/syntax/for_loop.zig`, hunk `@@ -346,6 +347,13 @@ fn parseForOfStatementRest(`
- **Repo evidence**:
  - `pr-164:src/parser/syntax/for_loop.zig:357-359` — `if (!try parser.expect(.right_paren, "Expected ')' after for-of expression", null)) return null;`
  - `pr-164:src/parser/parser.zig:469-483` — `expect` reports at `self.current_token.span` and, on mismatch, **does not advance**; it returns `false`.
  - `pr-164:src/parser/parser.zig:595-608` — `Parser.recover` resyncs by skipping to a terminator or to a line-leading keyword.
- **Explanation**: the placement itself (after the right-expression, before the `)`) is the correct spot for a tail clause — it is the only point where the tail is still unconsumed and `left`/`right` already exist as nodes. The problem is the diagnostic on overshoot. If a hook consumes past `)`, `expect` fires at the *following* token with the message "Expected ')' after for-of expression" even though a `)` is sitting just behind the cursor — a maximally confusing error. `parseForOfStatementRest` then returns `null`, the enclosing statement is dropped, and `recover` resyncs at the next line-leading keyword, typically swallowing the loop body as top-level statements and cascading further diagnostics. Note also the hook fires **unconditionally**, including for every well-formed `for (x of y)` in the program where `current_token` is already `)`; contrast `module_specifier`, which is guarded by its failure condition.
- **Suggested direction**: guard the call the way `module_specifier` is guarded — `if (parser.current_token.tag != .right_paren)` — so the hook is only consulted when the host is about to fail anyway. That removes the hot-path call for correct code and makes overshoot detectable (assert `current_token.tag == .right_paren` after a decline).

---

### F5 — The `.at` hooks are unconditionally consulted for every valid `@decorator`, in three different syntactic positions, with no signal which

- **Severity: minor**
- **Diff location**: `src/parser/syntax/expressions.zig` hunk `@@ -248,6 +251,10 @@ pub inline fn parsePrimaryExpression(`; `src/parser/syntax/statements.zig` hunk `@@ -76,6 +77,10 @@`
- **Repo evidence**:
  - `pr-164:src/parser/syntax/expressions.zig:217` — `parsePrimaryExpression` is `pub inline fn`, so the `.at` hook pair is inlined at each of its three callers:
    - `:166` — fallthrough from `parsePrefix` (ordinary expression position)
    - `:682` — inside `parseNewExpression`, at `Precedence.New` (`new @… ` )
    - `:1442` — inside `parseLeftHandSideExpression`, at `Precedence.Call`, which is itself reached from `parseDecorator` (`pr-164:src/parser/syntax/extensions.zig:26`) with `ctx == .decorator` — i.e. **inside** a decorator's own expression.
  - `pr-164:src/parser/syntax/statements.zig:44` — `.at => parseDecoratedStatement(parser)` is the only statement-position entry.
  - Class-member decorators go through `extensions.parseDecorators` directly (`extensions.zig:9`) and are **not** covered by any hook in this PR.
- **Explanation**: ordering is sound in the narrow sense — the hooks run before `extensions.parseDecorators`, so an extension gets first refusal on `@`, and existing valid `@decorator` code is unchanged *provided the extension declines*. But: (a) the hooks are consulted for every `@` in the codebase including `@dec class C {}` and `const C = @dec class {};`, so the burden of not breaking decorators falls entirely on extension-side lookahead; (b) the hooks receive no indication of position, so `expression_at_code_block` cannot tell "expression statement" from "operand of `new`" from "inside a decorator expression", three positions where a block-shaped production has very different validity; (c) the coverage is asymmetric — statement and expression `@` are hooked, class-member `@` is not, so an extension's `@`-syntax will mysteriously fail inside class bodies.
- **Suggested direction**: pass a position discriminant (an enum literal or the existing `LhsContext`) so the extension can decline cheaply and correctly. Decide explicitly whether class-member `@` is in or out of scope and note it.

---

### F6 — Four hook names where two would do; the code/control-flow split is a naming convention with no mechanical meaning

- **Severity: nit**
- **Diff location**: `expressions.zig @@ -248,6 +251,10 @@` and `statements.zig @@ -76,6 +77,10 @@`
- **Repo evidence**: `pr-164:src/parser/syntax/expressions.zig:254-257` and `pr-164:src/parser/syntax/statements.zig:80-83` are byte-for-byte the same pattern with four different names; the same pairing recurs at `pr-164:src/parser/syntax/jsx/root.zig:392-395` (`jsx_child_at_code_block` / `jsx_child_at_control_flow`, out of this slice). All four in-scope calls take identical arguments and are tried in fixed `code_block`-then-`control_flow` order.
- **Explanation**: nothing in the parser distinguishes the two; they are two sequential first-refusal slots at one token. An extension implementing both must duplicate its `@`-lookahead in four places (statement × 2, expression × 2), and the fixed try-order silently makes `*_at_code_block` win any overlap — a precedence rule established by line order alone.
- **Suggested direction**: collapse to one hook per position (`statement_at` / `expression_at`) and let the extension dispatch internally, or document why the split exists and that `code_block` wins ties.

---

### F7 — Extensions can only ever return node kinds that already exist in the closed `ast.NodeData` union

- **Severity: major**
- **Diff location**: all seven in-scope hunks (the `??ast.NodeIndex` return type)
- **Repo evidence**:
  - `pr-164:src/parser/ast.zig:4032` — `pub const NodeData = union(enum) { … }`, closed, no extension/opaque variant.
  - `pr-164:src/parser/codegen/printer.zig:1974` — `try self.emit(d.source);` dispatches on `nodeData`; there is no fallback arm for an unknown kind.
  - `pr-164:src/parser/semantic/module_record.zig:493-500` — `literal()` returns `null` for anything that is not `.string_literal` ("String literal text, or null for anything computed"), so the module graph degrades gracefully; but `pr-164:src/parser/codegen/printer.zig:2987` (`simpleStringKey`) and `pr-164:src/parser/semantic/binder.zig:1094` follow the same "must be `.string_literal`" shape elsewhere.
- **Explanation**: the seams intercept *parsing* but the AST vocabulary is fixed. An extension's only options are to return an existing node kind (repurposing, say, a `template_literal` or `identifier_reference` as a module specifier) or to build nothing and mutate side state. Repurposing propagates into codegen and semantics, which pattern-match on kind. This bounds what "extension point" can mean here far more tightly than the PR title suggests, and it is nowhere stated.
- **Suggested direction**: state the constraint in the PR description or a header comment. If arbitrary extension nodes are the eventual goal, an opaque `extension_node` variant carrying a `u32` tag plus an extras range is the conventional escape hatch and is much cheaper to add now than after downstream consumers assume the union is exhaustive.

---

### F8 — `module_specifier` is correctly guarded and does not disturb `parseModuleExportName`, with two narrow interaction caveats

- **Severity: question**
- **Diff location**: `src/parser/syntax/modules.zig`, hunk `@@ -945,6 +946,8 @@ fn parseModuleExportName(parser: *Parser) Error!?ast.NodeIndex {`
- **Repo evidence**:
  - `pr-164:src/parser/syntax/modules.zig:947-957` — the hook sits **inside** `if (parser.current_token.tag != .string_literal)`, before `reportExpected`. The happy path (`return literals.parseStringLiteral(parser)` at :958) is untouched. This is the only correctly-guarded hook in the slice.
  - `pr-164:src/parser/syntax/modules.zig:921-945` — `parseModuleExportName` is a **separate** function with **no** hook. Its rules are unchanged: `.string_literal` (with the lone-surrogate rejection at :925-932) or `tag.isIdentifierLike()` (:938), else `reportExpected("Expected identifier or string literal")`.
  - The two are never reachable from the same token position. Call sites: `parseModuleSpecifier` at :98, :150 (import), :633 (`export * … from`), :663 (`export { … } from`); `parseModuleExportName` at :335, :351, :384, :398, :413 (specifier parts) and :622 (`export * as <name>`).
  - `pr-164:src/parser/syntax/modules.zig:634` and :664 — immediately after the specifier, `parseWithClause` runs; `pr-164:src/parser/syntax/modules.zig:958-968` shows it triggers on `.with` or `.assert`.
- **Explanation**: on the two questions asked, the answer is clean — the fallback cannot affect valid string specifiers, and it cannot affect export-name parsing, because the grammar positions are disjoint. Two caveats worth confirming with the author rather than asserting as defects: (1) if the extension's specifier form is identifier-like, the same token accepted as a specifier at :633 would also be accepted as an *export name* at :622 in `export * as X from …`, giving `X` and the specifier the same surface syntax with different meanings; (2) if an extension specifier can end on a bare identifier `assert` or `with`, `parseWithClause` at :634/:664 will silently absorb the following braces as import attributes. Also, the hook is not told which of the four call sites invoked it, so it cannot vary by import vs. re-export context.
- **Suggested direction**: confirm the intended specifier surface syntax. If it can be identifier-like, either forward a call-site discriminant or note that `with`/`assert` are reserved as specifier-trailing tokens.

---

### F9 — Error propagation is safe, but the error set is fixed to `error{OutOfMemory}` and the "handled but failed" convention is undocumented

- **Severity: minor**
- **Diff location**: all seven in-scope hunks (the `try` and the `Error!` in the passed type)
- **Repo evidence**:
  - `pr-164:src/parser/parser.zig:91` — `pub const Error = error{OutOfMemory};`
  - `pr-164:src/parser/syntax/extensions.zig:10-11` — `const checkpoint = parser.scratch_decorators.begin(); defer parser.scratch_decorators.reset(checkpoint);` — the enclosing scratch discipline uses `defer`, which runs on error unwinding, so an OOM out of a hook does not desync scratch buffers.
  - `pr-164:src/parser/parser.zig:143-145` — `parse` returns `Error!ast.Tree`; on OOM the whole tree (arena-allocated, `pr-164:src/parser/parser.zig:126`) is discarded, so partial nodes appended before the error are unreachable rather than leaked.
- **Explanation**: propagation is benign. The real consequence is expressive: since the caller dictates `Error!??ast.NodeIndex`, an extension **cannot** surface its own error set — every non-OOM failure must be funnelled through `parser.report`/`parser.reportExpected` plus an inner-`null` return. That convention is the single most important thing about this API and appears nowhere. It is also easy to get wrong in a way that compiles: in a function returning `??NodeIndex`, a bare `return null` yields the **outer** null (decline, host retries the same token, likely producing a second unrelated diagnostic), whereas the intended "handled but failed" requires `return @as(?ast.NodeIndex, null)`. Both compile; only one is correct.
- **Suggested direction**: one doc comment, once, next to the first hook — spelling out outer-null vs inner-null vs node, and that `parser.report` is the only channel for extension diagnostics.

---

### F10 — A non-`pub` extension decl is a silent no-op; other signature mismatches fail inside yuku's source, not the extension's

- **Severity: minor**
- **Diff location**: all seven in-scope hunks (the `@hasDecl` guard)
- **Repo evidence**: `pr-164:src/parser/syntax/expressions.zig:111`, `:254`, `:256`; `pr-164:src/parser/syntax/statements.zig:80`, `:82`; `pr-164:src/parser/syntax/for_loop.zig:350`; `pr-164:src/parser/syntax/modules.zig:949` — all seven are `@hasDecl(parser_extension, "<literal string>")`.
- **Explanation**: `@hasDecl` only sees declarations visible from the calling scope, so a hook written without `pub` yields `false` and the site compiles to nothing — the extension silently never runs, with no error anywhere. The same is true of any typo in the decl name, since the guard string is a literal with no cross-check. Conversely, when the decl *is* found but the signature is wrong, the compile error is reported at the call site inside `expressions.zig`/`statements.zig`/etc., pointing a downstream author at yuku's internals rather than their own file. The most dangerous mismatch compiles cleanly: a hook declared to return `Error!?ast.NodeIndex` (single optional) instead of the passed `R` still satisfies `if (try …) |node| return node;` — `node` binds as `NodeIndex`, coerces to the host's `?NodeIndex`, and the decline/abort distinction collapses into "decline" with no diagnostic.
- **Suggested direction**: since `R` is already passed as a comptime parameter, add a one-line `comptime` assertion per site — or, better, a single `fn call(comptime name, args)` helper in one place that checks `@TypeOf(@field(parser_extension, name))`'s return type against `R` and `@compileError`s with a readable message naming the expected signature. That also collapses seven copies of the guard into one.

---

### F11 — Nothing in-diff or in-repo tests or documents any of these seven points (slice note; P1 owns the PR-level finding)

- **Severity: major**
- **Diff location**: the whole slice
- **Repo evidence**:
  - `git diff --name-only pr-164^ pr-164` — 11 files, **zero** test files, **zero** doc files. The full list is `build.zig`, `src/parser/lexer.zig`, `src/parser/root.zig`, and seven `src/parser/syntax/*` files.
  - `git grep -l parser_extension pr-164 -- docs README.md` — no matches.
  - `pr-164:build.zig:22` — `const parser_extension = b.addOptions().createModule();` is a hardcoded empty module with no build option, flag, or documented override, so no CI configuration exercises any non-empty path.
  - `git log -1 --format=%B pr-164` — the entire commit message is `feat: add minimal parser extension points`.
- **Explanation**: for this slice specifically, every behavior that matters lives on the non-empty path, and the non-empty path is unreachable in-tree and untested. The in-tree path is trivially safe (F12) and equally trivially uninformative. Everything in F1–F10 — decline invariants, the double-optional protocol, hook ordering at `@`, the `for_of_tail` contract inversion — is unverified by construction.
- **Suggested direction**: a single test extension module in `src/parser/testing/` wired to a build option, implementing all seven decls with deliberately hostile behavior (declines after consuming; returns inner null; returns a foreign node kind), plus one snapshot test per site asserting the host's response. That converts the invariants from prose into something CI enforces. See F12 for why the wiring change is needed anyway.

---

### F12 — All seven sites are provably erased with no extension present, and every in-scope hunk is a pure insertion

- **Severity: question**
- **Diff location**: all seven in-scope hunks
- **Repo evidence**:
  - `git diff pr-164^ pr-164 -- src/parser/syntax/{expressions,statements,for_loop,modules}.zig` contains **zero** `-` lines. All three of the PR's deletions land in out-of-scope files. Spot-checking `pr-164^:src/parser/syntax/expressions.zig` lines 236-243 against `pr-164:…:251-266` confirms the `.at` arm's original four statements are byte-identical and merely displaced by four lines; the same holds for `parsePrefix`, `parseDecoratedStatement`, `parseForOfStatementRest`, and `parseModuleSpecifier`.
  - `pr-164:build.zig:22` binds `parser_extension` to `b.addOptions().createModule()` with no options added — an empty namespace, so all seven `@hasDecl` calls fold to `false`.
  - `if (comptime <false>)` leaves the untaken branch unanalyzed in Zig, so the sites emit no code and impose no compile-time cost on the hook bodies.
- **Explanation**: **Q1 answers yes** — with no extension present, control flow in all four in-scope files is identical to `pr-164^`, statement order is preserved, and nothing is reordered. The residual question is the mirror image: `parser_extension` is a `const` local in `build.zig` with no build option and no exported override, and `parser_module` is registered via `b.addModule` (`pr-164:build.zig:24`). A downstream consumer can only supply a real extension by reaching into the dependency's module object (`dep.module("parser").addImport("parser_extension", …)`), which is undocumented, order-sensitive, and not what `addOptions().createModule()` signals. As written, this PR is unreachable machinery for every consumer.
- **Suggested direction**: confirm the intended activation path. A `b.option([]const u8, "parser-extension", …)` resolving to a user-supplied root source file (defaulting to the empty options module) would make the seam usable and testable in one change. Note: `build.zig` is out of this slice — flagged here only because it is the evidence for Q1 and the blocker for F11.

---

## Answers to the review questions

1. **Comptime erasure / order preservation** — Yes, verified. See **F12**: all in-scope hunks are pure insertions with zero deletions, and `build.zig:22` guarantees every `@hasDecl` is `false`.
2. **Consume-then-decline corruption** — Yes, at every site, and unguarded. See **F2** for the per-site consequences (silent misparse in `parsePrefix`; empty-decorator class with a stale span at both `.at` sites; misplaced diagnostic in `module_specifier`) and **F4** for `for_of_tail`. The invariant assumed is "zero net token consumption on decline"; it is stated nowhere and asserted nowhere. `Parser.checkpoint`/`rewind` exists but does not restore scratch buffers.
3. **Decorator shadowing / reordering** — The hooks run strictly *before* `extensions.parseDecorators` at both `.at` sites, so they take first refusal on every `@` in the program. Existing valid `@decorator` code is unaffected **only if the extension declines correctly**; the parser provides no safety net (**F5**), and `code_block` unconditionally beats `control_flow` by line order (**F6**). Class-member decorators are not covered at all.
4. **`for_of_tail` placement** — The position (after right-expr, before the `)` expect) is the right one, and the surrounding `expect`/`recover` machinery is unchanged. On overshoot the user gets "Expected ')' after for-of expression" pointed at the token *after* the `)`, the whole for-statement is dropped, and `recover` resyncs at the next line-leading keyword, usually re-parsing the loop body as top-level statements. See **F4**; the deeper problem is that the handle path is unimplementable (**F3**).
5. **`module_specifier` vs `parseModuleExportName`** — Correct and non-interfering; the two functions occupy disjoint grammar positions and the fallback is properly guarded behind `tag != .string_literal`. Two narrow caveats (identifier-like specifiers colliding with `export * as X`, and `with`/`assert` absorption) in **F8**.
6. **Error-union propagation** — Safe. `Error` is `error{OutOfMemory}` only; `defer`-based scratch discipline survives unwinding; the arena discards partial nodes. The cost is that extensions cannot express their own errors and must use the undocumented inner-`null` + `parser.report` convention (**F9**).
7. **Tests / docs (slice note)** — None, anywhere. See **F11** for evidence and **F13** below for the signature each site implies.

---

## Coverage

### In-scope hunks examined

| # | File | Hunk header | Content | Examined |
|---|---|---|---|---|
| 1 | `src/parser/syntax/expressions.zig` | `@@ -23,6 +23,7 @@` | `const parser_extension = @import("parser_extension");` (line 26) | yes |
| 2 | `src/parser/syntax/expressions.zig` | `@@ -107,6 +108,8 @@ inline fn infixPrecedence(token: Token, is_ts: bool) u8 {` | `lazy_assignment_pattern` at head of `parsePrefix` (lines 111-112) | yes — F1, F2, F9, F10, F12 |
| 3 | `src/parser/syntax/expressions.zig` | `@@ -248,6 +251,10 @@ pub inline fn parsePrimaryExpression(` | `expression_at_code_block` + `expression_at_control_flow` in the `.at` arm (lines 254-257) | yes — F2, F5, F6, F9, F10, F12 |
| 4 | `src/parser/syntax/statements.zig` | `@@ -16,6 +16,7 @@` | `const parser_extension = @import("parser_extension");` (line 19) | yes |
| 5 | `src/parser/syntax/statements.zig` | `@@ -76,6 +77,10 @@ pub fn parseStatement(parser: *Parser, opts: ParseStatementOpts) Error!?ast.Node` | `statement_at_code_block` + `statement_at_control_flow` in `parseDecoratedStatement` (lines 80-83) | yes — F2, F5, F6, F9, F10, F12 |
| 6 | `src/parser/syntax/for_loop.zig` | `@@ -8,6 +8,7 @@` | `const parser_extension = @import("parser_extension");` (line 11) | yes |
| 7 | `src/parser/syntax/for_loop.zig` | `@@ -346,6 +347,13 @@ fn parseForOfStatementRest(` | `for_of_tail` after right-expr, before `expect(.right_paren)` (lines 350-356) | yes — F3, F4, F9, F10, F12 |
| 8 | `src/parser/syntax/modules.zig` | `@@ -15,6 +15,7 @@` | `const parser_extension = @import("parser_extension");` (line 18) | yes |
| 9 | `src/parser/syntax/modules.zig` | `@@ -945,6 +946,8 @@ fn parseModuleExportName(parser: *Parser) Error!?ast.NodeIndex {` | `module_specifier` inside the non-string guard, before `reportExpected` (lines 949-950) | yes — F2, F8, F9, F10, F12 |

Nine hunks total across the four in-scope files; four are bare `@import` additions, five contain hook calls. No `-` lines in any of them.

**Read beyond the diff** (as directed): `parsePrimaryExpression` in full and all three of its callers (`expressions.zig:166`, `:682`, `:1442`); `parsePrefix` in full; `parseStatement`'s dispatch table and `parseDecoratedStatement`; `parseForOfStatementRest` in full plus its `parseForInStatementRest` sibling for contrast; `parseModuleExportName` in full and all eleven call sites of it and `parseModuleSpecifier`; `pr-164:src/parser/syntax/extensions.zig` in full (`parseDecorators`, `parseDecorator`). Supporting reads: `parser.zig` (`Error`, `Parser` fields, `checkpoint`/`rewind`/`Peek`/`expect`/`recover`), `root.zig` exports, `ast.zig:4032` (`NodeData`), `build.zig:22-32`, and the downstream `source`-consumers in `printer.zig` / `module_record.zig`.

**Note on the packet's tally**: the packet asks for "the 6 extension points in scope" but its own scope list enumerates **seven** decl names (`lazy_assignment_pattern`, `expression_at_code_block`, `expression_at_control_flow`, `statement_at_code_block`, `statement_at_control_flow`, `for_of_tail`, `module_specifier`). The names are unambiguous, so all seven are covered below; the count in the instruction is simply off by one.

### F13 — Inferred decl signatures for the seven in-scope extension points

Under comptime duck typing the extension module must declare, **`pub`**, with `R` bound to `error{OutOfMemory}!??ast.NodeIndex`:

```zig
pub fn lazy_assignment_pattern   (comptime R: type, parser: anytype) R
pub fn expression_at_code_block  (comptime R: type, parser: anytype) R
pub fn expression_at_control_flow(comptime R: type, parser: anytype) R
pub fn statement_at_code_block   (comptime R: type, parser: anytype) R
pub fn statement_at_control_flow (comptime R: type, parser: anytype) R
pub fn module_specifier          (comptime R: type, parser: anytype) R
pub fn for_of_tail               (comptime R: type, parser: anytype, args: anytype) R
```

- `parser` is `*parser.Parser` (`pr-164:src/parser/parser.zig:93`), newly re-exported as `Parser` from `pr-164:src/parser/root.zig:4`. It must be taken as `anytype` in practice: naming the concrete type requires importing the `parser` module, which already imports `parser_extension` (`build.zig:32`).
- `for_of_tail`'s `args` is the anonymous struct literal at `pr-164:src/parser/syntax/for_loop.zig:351-356`, structurally `struct { start: u32, left: ast.NodeIndex, right: ast.NodeIndex, is_for_await: bool }`.
- `R` is passed as a value argument, so `comptime R: type` (or `R: anytype`, since a `type` argument is always comptime) is required for it to be usable as the return type.
- Return protocol: outer `null` = decline; inner `null` = handled-and-failed; `node` = handled.

**What breaks on a mismatched signature**

| Mismatch | Result |
|---|---|
| Decl not marked `pub` | `@hasDecl` returns `false` → site erased → **silent no-op, no error anywhere**. Worst case. |
| Decl name typo'd | Same: silent no-op; the guard string is a bare literal with no cross-check. |
| Wrong arity (e.g. omitting `R`, or omitting `args` on `for_of_tail`) | Compile error `expected N argument(s), found M` reported **inside yuku's source**, not the extension's. |
| Return type `?ast.NodeIndex` (no error union) | Compile error at the `try`: expected error union, found optional. |
| Return type `Error!?ast.NodeIndex` (single optional) | **Compiles.** `node` binds as `NodeIndex`, coerces to the host's `?NodeIndex`. Decline and handled-and-failed collapse into "decline" — silent semantic break. |
| `parser: *const Parser` | **Compiles** (`*Parser` coerces). The hook silently cannot advance the lexer or add nodes; every call declines. |
| `R` declared non-comptime | Compile error: return type expression cannot reference a runtime parameter. |
| Decl is a `const`, not a function | Compile error `cannot call non-function`. |
| Wrong `args` field names/types on `for_of_tail` | Compile error only if `args` is a concrete struct type; with `anytype` it surfaces as a field-not-found error deep inside the extension body. |

Three of these nine failure modes (non-`pub`, name typo, single-optional return) fail **silently**, which is the strongest argument for the comptime-assertion helper proposed in **F10**.
