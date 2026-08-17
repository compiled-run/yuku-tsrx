# T003-P4 — yuku PR #164 review: binding / function-semantics slice

- PR: https://github.com/yuku-toolchain/yuku/pull/164
- Head: `pr-164` = `1ec1871c9eb83a27e5dfab6f2ee865596cbf6436`
- Full diff: `git -C /Users/jacksm5pro/dev/open-source/yuku diff pr-164^ pr-164` — 11 files, +76/-3 (confirmed)
- Slice: `src/parser/syntax/variables.zig`, `src/parser/syntax/patterns.zig`, `src/parser/syntax/functions.zig`
- Method: read-only. All repo evidence read via `git show pr-164:<path>` / `git diff`. The yuku clone was never modified.

## Context that frames every finding

`build.zig:22` defines the extension module as `b.addOptions().createModule()` — an options module with **no options added**, i.e. an empty namespace. Therefore in every default yuku build, every `@hasDecl(parser_extension, …)` guard in this slice is `false` and all four hooks compile out. **Nothing in this slice changes yuku's own behavior**, with one exception: the `canStartLetBinding` textual rewrite at `variables.zig:218`, which is live in every build. Question 1 is therefore the only place where a regression could already exist; questions 2–6 are about the contract this PR is committing to for downstream extension authors.

---

## F1 — `canStartLetBinding` rewrite is behavior-preserving over all 159 `TokenTag` members (independently re-verified)

- `Severity: nit`
- Diff location: `src/parser/syntax/variables.zig`, hunk `@@ -215 +218 @@ pub fn canStartLetBinding(tag: TokenTag) bool {`

Repo evidence:

- `pr-164:src/parser/syntax/variables.zig:217-219` (new):
  `pub fn canStartLetBinding(tag: TokenTag) bool { return canStartBinding(tag) and !tag.isUnconditionallyReserved(); }`
- Old form (`pr-164^`): `return tag == .left_bracket or tag == .left_brace or canStartBindingIdentifier(tag);`
- `pr-164:src/parser/syntax/variables.zig:203-207` — `canStartBinding` baseline: `tag.isIdentifierLike() or tag == .left_bracket or tag == .left_brace`
- `pr-164:src/parser/syntax/variables.zig:210-212` — `canStartBindingIdentifier`: `tag.isIdentifierLike() and !tag.isUnconditionallyReserved()`
- `pr-164:src/parser/token.zig:261-276` — `isIdentifierLike` / `isUnconditionallyReserved` are pure bitmask tests (`Mask.IsIdentifierLike = 1 << 18`, `Mask.IsUnconditionallyReserved = 1 << 19`, `token.zig:9-11`).

Explanation — I did not take the scout's word; I extracted every `TokenTag` enumerand from `pr-164:src/parser/token.zig` (including the multi-line declarations at `token.zig:167-177`, which a naive single-line scan silently drops) and evaluated both predicates over all **159** members. Algebraically, writing `IL` for `isIdentifierLike`, `UR` for `isUnconditionallyReserved`, `B` for `tag ∈ {left_bracket, left_brace}`:

```
old = B or (IL and !UR)
new = (IL or B) and !UR
```

- Case `tag ∉ B`: both reduce to `IL and !UR`. Identical, unconditionally.
- Case `tag ∈ B`: `old = true`; `new = !UR(tag)`. So the rewrite is safe **iff** neither `left_bracket` nor `left_brace` carries the reserved bit.

Measured: `left_bracket = 0x113f`, `left_brace = 0x3d`. Bit 19 (`0x80000`) is clear in both, and no enumerand exceeds `0x340066`, so no ordinal can accidentally alias into the mask bits (ordinals are bits 0–7, precedence bits 8–12, flags bits 13–21; no duplicate enumerand values exist). Exhaustive differential evaluation over all 159 tags: **zero counterexamples**.

A second, independent reason the rewrite is safe: `UR ⊆ IL` holds today — of 86 identifier-like tags, 36 are unconditionally reserved, and there are **zero** tags with `UR` set and `IL` clear. Because of that containment, `and !UR` can only ever subtract from the `IL` term, never from the `B` term.

Worth stating explicitly because the docstring at `variables.zig:214-216` motivates the predicate with `let in obj`: `in` is `0x2c4977` — `IL=true, UR=true`. Both the old and the new form return `false` for it via the `!UR` conjunct, so the documented `let in obj` behavior is preserved exactly. The same holds for `typeof`/`void`/`delete`/`instanceof`, all of which are `IL=true, UR=true` in this token table.

Suggested direction: the rewrite is correct — no change required for correctness. But its safety now rests on a property nobody has written down (`!UR(left_bracket) and !UR(left_brace)`), which a future token-table edit could break silently and which no test covers. Add a one-line `comptime { std.debug.assert(!TokenTag.left_bracket.isUnconditionallyReserved() and !TokenTag.left_brace.isUnconditionallyReserved()); }` next to `canStartLetBinding`, or keep the old explicit form and simply not route it through `canStartBinding` (see F2, which is the stronger reason to do the latter).

---

## F2 — Routing `canStartLetBinding` through `canStartBinding` is accidental coupling: one context-free hook now answers four different grammar questions

- `Severity: major`
- Diff location: `src/parser/syntax/variables.zig`, hunks `@@ -202,0 +204,2 @@ pub fn canStartBinding(tag: TokenTag) bool {` and `@@ -215 +218 @@ pub fn canStartLetBinding(tag: TokenTag) bool {` (taken together)

Repo evidence — every consumer of `canStartBinding` after this PR:

| Site | Question being asked |
| --- | --- |
| `pr-164:src/parser/syntax/statements.zig:158` → `variables.isLetIdentifier` → `variables.zig:231` → `canStartLetBinding` | Is `let` at statement position a declaration keyword or an `IdentifierReference`? |
| `pr-164:src/parser/syntax/for_loop.zig:63` → `canStartLetBinding` | Does `for (let …` head a declaration or an expression? |
| `pr-164:src/parser/syntax/ts/statements.zig:55` | Is `declare const …` an ambient declaration? |
| `pr-164:src/parser/syntax/ts/statements.zig:85` | Is `declare var …` / `declare let …` an ambient declaration? |

Before this PR only the two TS sites reached `canStartBinding`; the two `let` sites went through `canStartBindingIdentifier` and were unreachable from any extension point. The diff adds the hook at `variables.zig:204-205` **and** rewires `canStartLetBinding` onto it in the same change, so a single extension declaration silently acquires authority over `let` disambiguation.

Explanation — the coupling is bad on three axes:

1. **The hook is context-free.** Its signature is `can_start_binding(tag) ?bool` — it receives a `TokenTag` and nothing else. It cannot see `*Parser`, so it cannot distinguish TS from JS, strict from sloppy, statement position from for-head, nor which of the four questions above it is answering. An extension that wants to widen bindings for its own TS ambient syntax has no way to decline to widen `let`.

2. **ASI / sloppy-mode `let` is directly in the blast radius.** `variables.zig:221-225` documents the intended rule: "the only ExpressionStatement lookahead restriction is `let [`, so sloppy-mode `let = 1`, `let.foo`, or `let in obj` are expression statements." That rule is now extension-overridable. Concretely, an extension returning `true` for `.assign` (or `.dot`, or `.left_paren`) makes `isLetIdentifier` return `false`, so `statements.zig:158-162` routes `let = 1;` into `parseVariableDeclaration` — the sloppy-mode assignment-to-`let` program silently becomes a malformed declaration instead of an expression statement. This is a spec-visible ASI/cover-grammar rule being handed to an extension that was only asking about binding heads.

3. **Narrowing is just as reachable as widening.** `if (parser_extension.can_start_binding(tag)) |value| return value;` returns the hook's value verbatim, so a hook returning `false` for `.left_brace` (a plausible move for a syntax that wants `{` to mean something else) makes `let {a} = o;` parse `let` as an identifier and `{a}` as a block statement — a silent misparse with no diagnostic. It also breaks `declare var {a}` at `ts/statements.zig:85`.

4. **The widening is asymmetric in a way the hook author cannot see.** `canStartLetBinding` applies `and !tag.isUnconditionallyReserved()` *after* the hook. So a hook returning `true` for a reserved tag (say `.function`) widens `ts/statements.zig:55` and `:85` but is silently vetoed at both `let` sites. Same hook, same tag, two different answers, no way to discover this except by reading `variables.zig:218`.

Suggested direction: decouple. Keep `canStartLetBinding` on its explicit pre-PR form (`tag == .left_bracket or tag == .left_brace or canStartBindingIdentifier(tag)`) so the `let` cover-grammar rule stays a fixed property of the parser, and let the hook affect only the two TS ambient sites it was presumably cut for. If `let` genuinely must be extensible, give it its own named hook (`can_start_let_binding`) so the widening is opt-in and reviewable, and pass `*Parser` so the hook can condition on dialect and position. Either way, the docstring at `variables.zig:214-216` should say that the predicate is extension-overridable — as written it reads as a closed spec rule.

---

## F3 — `canStartBindingIdentifier` is not hooked, so `using` / `await using` silently diverge from `let`

- `Severity: minor`
- Diff location: `src/parser/syntax/variables.zig`, hunk `@@ -202,0 +204,2 @@ pub fn canStartBinding(tag: TokenTag) bool {` (by omission — `canStartBindingIdentifier` at `variables.zig:210-212` is untouched)

Repo evidence:

- `pr-164:src/parser/syntax/variables.zig:245` — `isUsingIdentifier`: `return next.hasLineTerminatorBefore() or !canStartBindingIdentifier(next.tag);`
- `pr-164:src/parser/syntax/variables.zig:265` — `isAwaitUsingDeclarationAhead`: `return canStartBindingIdentifier(binding.tag);`
- `pr-164:src/parser/syntax/for_loop.zig:76` — `for (using …)` head: `!variables.canStartBindingIdentifier(next.tag)`

Explanation — after this PR, an extension that widens `can_start_binding` gets its new binding head accepted by `let`, `for (let …)`, `declare const/var/let`, and (via `parseBindingPattern`, F7–F9) the declarator itself — but **not** by `using x`, `await using x`, or `for (using x of …)`, which still consult the un-hooked `canStartBindingIdentifier`. The result is a dialect where `let ✱X = r` declares but `using ✱X = r` parses `using` as an identifier reference and then fails on `✱X`. Nothing signals this; the extension author discovers it from a confusing downstream parse error.

Suggested direction: decide deliberately whether the seam is "binding heads" (then `canStartBindingIdentifier` needs the same hook, or needs to be expressed in terms of `canStartBinding`) or "declarator heads only" (then say so in a comment on `can_start_binding` and leave `using` out on purpose). The current state looks like an oversight rather than a decision.

---

## F4 — `function_body_starts` returning `false` produces a silently wrong AST via ASI, including a body-less `FunctionExpression`

- `Severity: major`
- Diff location: `src/parser/syntax/functions.zig`, hunks `@@ -132 +133 @@ pub fn parseFunction(` (`const has_body` → `var has_body`) and `@@ -133,0 +135,5 @@ pub fn parseFunction(`

Repo evidence:

- `pr-164:src/parser/syntax/functions.zig:130-138` — hook overwrites `has_body` unconditionally, after all baseline computation.
- `pr-164:src/parser/syntax/functions.zig:139-142` — `const body = if (has_body) try parseFunctionBody(parser) orelse .null else .null;`
- `pr-164:src/parser/syntax/functions.zig:144-147` — `const end = if (body != .null) … else try parser.eatSemicolon(return_type_end) orelse return null;`
- `pr-164:src/parser/syntax/functions.zig:149-154` — `const function_type = if (is_function_expression) .function_expression else if (body == .null) .ts_declare_function else .function_declaration;`
- `pr-164:src/parser/parser.zig:485-501` — `eatSemicolon` reports and returns `null` unless the token is `;` or ASI applies.
- `pr-164:src/parser/parser.zig:519-521` — `canInsertImplicitSemicolon`: true for `.eof`, `hasLineTerminatorBefore()`, or `.right_brace`.

Explanation — forcing `has_body = false` while a `{` is actually present splits into two outcomes, and the quiet one is the bad one:

- **`{` on the same line** (`function f() {}`): `eatSemicolon` sees `.left_brace`, ASI does not apply, it reports "Expected a semicolon or an implicit semicolon after a statement" and returns `null`, so `parseFunction` returns `null` and the whole declaration is dropped. Loud, but destructive — an entire declaration disappears from the tree on what the extension intended as a routine override.
- **`{` on the next line** (`function f()\n{}`): `hasLineTerminatorBefore()` is true, ASI succeeds **silently**. `end` is set to `return_type_end`, `body` stays `.null`, and the following `{ … }` is subsequently parsed as an independent `BlockStatement`. The function's own body has been reparented to a sibling statement with no diagnostic at all.

Two node-kind consequences make this worse than a span bug:

1. In a **non-TS** parse (`is_ts == false`), `function_type` becomes `.ts_declare_function` — a TypeScript-only node kind emitted into a JavaScript tree. Every consumer that switches on `FunctionType` for `.js` input now has an unreachable arm reached.
2. For a **function expression**, `function_type` is `.function_expression` regardless of `body`, so the hook can mint a `FunctionExpression` with `body == .null`. That is not expressible in the source grammar; `parseFunction`'s own invariant comment at `functions.zig:118` ("function expressions always carry a body") is violated by the hook that was inserted eleven lines below it. Any consumer doing `tree.span(fn.body)` or walking into the body will read node `.null`.

Suggested direction: constrain the hook rather than letting it overwrite. Either (a) apply it only when the baseline is ambiguous — e.g. `if (is_ts and !is_function_expression) { … }` — so it can never contradict `is_function_expression` or a present `{`; or (b) let it only *narrow* (`has_body = has_body and value`) / only *widen*, whichever the intended use is, and document which. At minimum, assert `!(is_function_expression and !has_body)` after the hook so the impossible AST fails loudly at the point of construction instead of at some later consumer.

---

## F5 — `function_body_starts` returning `true` in an ambient/overload context yields a spurious diagnostic, and the hook sits *after* the guard it would need to override

- `Severity: major`
- Diff location: `src/parser/syntax/functions.zig`, hunk `@@ -133,0 +135,5 @@ pub fn parseFunction(`

Repo evidence:

- `pr-164:src/parser/syntax/functions.zig:118-128` — the ambient guard runs **before** the hook:
  ```zig
  const is_ambient_declaration = parser.ts_context.ambient and !is_function_expression;
  if (is_ambient_declaration and parser.current_token.tag == .left_brace) {
      try parser.report(…, "An implementation cannot be declared in ambient contexts", …);
      return null;
  }
  ```
- `pr-164:src/parser/syntax/functions.zig:195-205` — `parseFunctionBody` calls `parser.expect(.left_brace, "Expected '{' to start function body", …)`.
- `pr-164:src/parser/parser.zig:469-483` — `expect` reports and returns `false` **without advancing** on mismatch.

Explanation — answering question 3 for the `true` direction:

- **Ambient + no `{`** (`declare function f(): void;`): baseline `has_body = false`; hook forces `true`; `parseFunctionBody` finds `;` not `{`, emits **"Expected '{' to start function body"**, returns `null` → `orelse .null`. Because `expect` does not advance, `eatSemicolon` then consumes the `;` correctly and a well-formed `ts_declare_function` node is still produced. Net effect: a spurious error on *valid* ambient TypeScript, with an otherwise-correct tree. Recoverable, but the diagnostic is unattributable — nothing tells the user an extension caused it.
- **TS overload signature** (`function f(a: string): void;` followed by the implementation): identical — spurious "Expected '{'" on every overload signature.
- **Ambient + `{` present**: the hook is **unreachable**. `functions.zig:119-127` already `return null`ed. This is the ordering problem: "let bodies exist in ambient contexts" is the single most plausible reason to reach for a hook named `function_body_starts`, and it is exactly the case the hook cannot influence. An extension author will write the hook, observe nothing happening, and have no signal why.

Suggested direction: if the hook is meant to govern ambient/overload body policy, move it above the `is_ambient_declaration` guard (or fold the guard's condition into the hook's input) so it can actually suppress the "An implementation cannot be declared in ambient contexts" report. If it is not meant for that, rename it (`ts_function_body_expected`?) and add a comment stating that the ambient-with-brace case is decided before the hook runs.

---

## F6 — `function_body_starts` and `function_body` have different reach; neither covers concise arrow bodies

- `Severity: minor`
- Diff location: `src/parser/syntax/functions.zig`, hunks `@@ -133,0 +135,5 @@ pub fn parseFunction(` vs `@@ -189,0 +196,2 @@ pub fn parseFunctionBody(parser: *Parser) Error!?ast.NodeIndex {`

Repo evidence — callers of `parseFunctionBody`:

- `pr-164:src/parser/syntax/functions.zig:141` — `function` declarations/expressions (the only site that also consults `function_body_starts`)
- `pr-164:src/parser/syntax/class.zig:608` — class methods / accessors / constructors
- `pr-164:src/parser/syntax/object.zig:415` — object literal methods
- `pr-164:src/parser/syntax/parenthesized.zig:290-293` — `parseArrowBody`, **block-bodied arrows only** (`if (parser.current_token.tag == .left_brace)`); the concise-expression arm at `parenthesized.zig:296+` goes to `expressions.parseExpression` and never touches `parseFunctionBody`.

Explanation — `function_body` fires at 4 call sites, `function_body_starts` at 1. An extension implementing "these functions have no body" via `function_body_starts` gets that behavior for `function` declarations and expressions but silently not for `class { m() {} }`, `{ m() {} }`, or `() => {}`. Conversely an extension replacing bodies via `function_body` will also intercept class constructors and arrow block bodies, which may be more than it wanted. And `() => expr` is invisible to both hooks, so a `function_body` extension covers `() => { … }` but not `() => …` — an inconsistency that will read as a bug in the extension, not in yuku.

Suggested direction: document the reach of each hook at its call site (one comment line each), or push `function_body_starts` down next to `function_body` so both cover the same set. If concise arrow bodies matter, they need their own hook in `parseArrowBody`.

---

## F7 — `binding_pattern` fires inside speculative lookahead, where the tree and diagnostics are rewound underneath it

- `Severity: major`
- Diff location: `src/parser/syntax/patterns.zig`, hunk `@@ -13,0 +15,2 @@ pub inline fn parseBindingPattern(parser: *Parser) Error!?ast.NodeIndex {`

Repo evidence:

- `pr-164:src/parser/syntax/ts/types/core.zig:589-604` — `isFunctionTypeAfterPattern`, a pure lookahead helper:
  ```zig
  const cp = parser.checkpoint();
  defer parser.rewind(cp);
  try parser.advance() orelse return false;
  _ = try patterns.parseBindingPattern(parser) orelse return false;   // result discarded
  return switch (parser.current_token.tag) { .colon, .comma, .question, .assign => true, … };
  ```
  reached from `core.zig:571-574` when a TS parenthesized construct starts with `{` or `[`.
- `pr-164:src/parser/parser.zig:396-427` — `checkpoint`/`rewind` restore lexer cursor/state/mode, `current_token`, `prev_token_end`, and `shrinkRetainingCapacity` on `tree.nodes`, `tree.extras`, and `diagnostics`.

Explanation — this is the least obvious call site and the most dangerous one. Three consequences:

1. **The hook runs on input that is not being parsed.** It is invoked purely to answer "is this a TS function type or a parenthesized type?", and its result is thrown away with `_ =`. Any hook with observable side effects — logging, an extension-side symbol table, a counter, a scratch buffer append — will fire on text that is then re-parsed a second time down a different path, producing duplicates.
2. **Node indices the hook created are freed and reused.** `rewind` does `tree.nodes.shrinkRetainingCapacity(cp.nodes_len)`, so a `NodeIndex` the hook minted and stashed in an extension-side side table becomes a dangling index that will later be *reissued* to an unrelated node. This is silent aliasing, not a crash. (Diagnostics are rewound too, which is a point in the design's favour: a hook that reports inside speculation will not leak spurious errors.)
3. **The hook steers TS type disambiguation.** `isFunctionTypeAfterPattern` decides its answer from `parser.current_token.tag` *after* `parseBindingPattern` returns. A hook that consumes a different span than the baseline would have changes whether `(…)` is read as a function type or a parenthesized type — a decision far from anything the hook's name suggests it governs.

Suggested direction: at minimum, document at `patterns.zig:15` that `binding_pattern` may be invoked speculatively and must be free of side effects outside `parser.tree`/`parser.diagnostics`. Better: give the hook a way to know (pass a `speculative: bool`, or expose `parser.inSpeculation()`), or hoist the hook out of `parseBindingPattern` into the non-speculative callers so the lookahead helper keeps using the baseline grammar.

---

## F8 — A hook-returned pattern node silently loses its TS annotation, `?` marker and decorators, and defeats `isDestructuringPattern`

- `Severity: major`
- Diff location: `src/parser/syntax/patterns.zig`, hunk `@@ -13,0 +15,2 @@ pub inline fn parseBindingPattern(parser: *Parser) Error!?ast.NodeIndex {`

Repo evidence:

- `pr-164:src/parser/syntax/ts/types/predicate.zig:143-159` — `applyTypeAnnotationToPattern` switches on `.binding_identifier, .object_pattern, .array_pattern, .assignment_pattern` and `else => return;`
- `pr-164:src/parser/syntax/ts/types/predicate.zig:162-179` — `applyDecoratorsToPattern`, same shape, `else => return;`
- `pr-164:src/parser/syntax/ts/types/predicate.zig:182-193` — `markPatternOptional`, same shape, `else => return;`
- `pr-164:src/parser/syntax/patterns.zig:89-95` — `isDestructuringPattern` returns `true` only for `.array_pattern` / `.object_pattern` (recursing through `.assignment_pattern`), `else => false`
- Consumers of the above: `pr-164:src/parser/syntax/functions.zig:342-351` (`?` then `: T` on a formal parameter), `functions.zig:371` (decorators), `pr-164:src/parser/syntax/variables.zig:134-138` (`let x: T`), `variables.zig:147-155` (`using` + destructuring check), `variables.zig:170-176` ("Destructuring declaration must have an initializer")

Explanation — the three `apply*`/`mark*` helpers are written to no-op on unrecognised node kinds (`else => return;`), which is a sensible closed-world assumption that this PR opens. Once `binding_pattern` can return an arbitrary node kind:

- `function f(✱X: T) {}` — `parseTypeAnnotation` runs, produces a node, and `applyTypeAnnotationToPattern` **drops it on the floor**. The annotation is parsed, consumes source, and is then discarded with no diagnostic. Same for `✱X?` and for `@dec ✱X`.
- `let ✱X: T = 1` — same silent annotation loss at `variables.zig:135-138`, and `end` is still advanced past the annotation, so the declarator's span covers text that has no corresponding node.
- `isDestructuringPattern` returns `false` for the custom kind, so `variables.zig:170` never emits "Destructuring declaration must have an initializer" and `variables.zig:149-153` never emits "Using declaration cannot have destructuring patterns" — two checker rules silently switched off for any extension pattern, even one that is semantically destructuring.

Suggested direction: this is the cost of returning opaque nodes through a seam whose downstream consumers pattern-match on node kind. Either (a) require `binding_pattern` hooks to return one of the four recognised pattern kinds (document it, and assert it in a debug build right after the hook), or (b) add an explicit "unknown pattern kind" arm to the three `predicate.zig` helpers that reports rather than silently returns, so the loss is at least visible. Silently discarding a parsed type annotation is the worst of the available behaviors.

---

## F9 — `binding_pattern` does **not** preempt destructuring defaults, but it only covers the outermost binding position

- `Severity: minor`
- Diff location: `src/parser/syntax/patterns.zig`, hunk `@@ -13,0 +15,2 @@ pub inline fn parseBindingPattern(parser: *Parser) Error!?ast.NodeIndex {`

Repo evidence:

- `pr-164:src/parser/syntax/patterns.zig:14-36` — `parseBindingPattern` never consumes `=`; it returns after the identifier / `[` / `{` branch.
- `pr-164:src/parser/syntax/functions.zig:353-355` — the caller applies the default: `if (parser.current_token.tag == .assign) pattern = try patterns.parseAssignmentPattern(parser, pattern) …`
- `pr-164:src/parser/syntax/variables.zig:152` and `variables.zig:158-163` — the declarator caller handles `=` itself.
- `pr-164:src/parser/syntax/patterns.zig:39-48` — nested destructuring is produced by `array.parseCover`/`object.parseCover` + `coverToPattern`, **not** by recursion into `parseBindingPattern`.
- `git grep parseBindingPattern pr-164` — exactly five callers: `functions.zig:339` (formal parameters), `patterns.zig:73` (rest elements), `statements.zig:717` (catch parameter), `ts/types/core.zig:596` (speculation, see F7), `variables.zig:119` (variable declarators). `array.zig`/`object.zig` `coverToPattern` never call it.
- `pr-164:src/parser/syntax/parenthesized.zig:255-282` — arrow parameters are the already-parsed `params` cover, converted without any `parseBindingPattern` call.

Explanation — answering question 4 directly: **no**, the hook does not preempt destructuring defaults. `= default` is strictly the caller's business in every path, and a hook that returns a node and leaves `current_token` on `.assign` will still get wrapped by `parseAssignmentPattern` correctly. (The one wrinkle is that `isDestructuringPattern` then recurses into `.left` and finds the unrecognised kind — see F8.)

The real interaction is coverage asymmetry. Because nested pattern elements come from the cover-grammar reparse and arrow parameters come from `parenthesized.zig`, the hook fires only at the *outermost* binding position of a declarator, formal parameter, rest element or catch clause. An extension gets `let ✱X = 1` and `function f(✱X) {}` but not `let {a: ✱X} = o`, not `let [✱X] = a`, and not `(✱X) => …`. That inconsistency will surface as an arbitrary-looking set of places where the extension syntax works.

Suggested direction: state the covered positions in a comment at `patterns.zig:15`. If nested and arrow positions are meant to be covered, the hook has to be reflected into `array.coverToPattern`/`object.coverToPattern` and the `parenthesized.zig` cover→params conversion as well — which is a much larger seam than this PR opens, and worth deciding explicitly rather than by omission.

---

## F10 — The `?bool` tri-state is undocumented, and the natural mistake (`return false` meaning "no opinion") silently breaks the parser

- `Severity: major`
- Diff location: `src/parser/syntax/variables.zig` hunk `@@ -202,0 +204,2 @@`; `src/parser/syntax/functions.zig` hunk `@@ -133,0 +135,5 @@`

Repo evidence:

- `pr-164:src/parser/syntax/variables.zig:204-205` — `if (parser_extension.can_start_binding(tag)) |value| return value;`
- `pr-164:src/parser/syntax/functions.zig:135-139` — `if (parser_extension.function_body_starts(parser)) |value| { has_body = value; }`

Explanation — for both non-error-union hooks, `null` means "defer to the baseline" and `false` means "hard no, override the baseline". Nothing at either call site, and nothing anywhere in the repo (see F14), says so. The failure mode is silent and severe in both directions:

- `can_start_binding` returning `false` where the author meant "not my token": `false` for `.identifier` disables every variable declaration in the language; `false` for `.left_brace` breaks `let {a} = o` and `declare var {a}` (F2). A hook written as `return tag == .my_token;` — the single most natural way to write it — does exactly this.
- `function_body_starts` returning `false` for the same reason: every function in the program becomes body-less, taking the F4 path.

Note this is precisely the trap the *fallible* hooks avoid by construction: `if (try …(Error!??ast.NodeIndex, parser)) |node| return node;` uses the outer optional as "handled / not handled" and the inner optional as the parse result, which is a shape an author is unlikely to fill in wrongly. The two `?bool` hooks reuse the outer-optional convention without the visual cue.

Suggested direction: add a doc comment at each of the two call sites: `// null = defer to the default rule; non-null overrides it.` Cheaper and more robust: return a three-valued enum (`enum { default, yes, no }`) so the meaning is in the type rather than in a convention, at zero runtime cost since these are comptime-resolved.

---

## F11 — A misspelled hook name compiles clean and is silently ignored (verified)

- `Severity: major`
- Diff location: all four hunks in this slice (`variables.zig @@ -202,0 +204,2 @@`, `patterns.zig @@ -13,0 +15,2 @@`, `functions.zig @@ -133,0 +135,5 @@`, `functions.zig @@ -189,0 +196,2 @@`)

Repo evidence — the guard is `@hasDecl(parser_extension, "<string literal>")` at every site; there are 15 such string literals across the PR (`git grep parser_extension pr-164`), and `build.zig:22` supplies an empty module, so the default answer to every one of them is `false`.

Explanation — I reproduced this against Zig 0.16 with a minimal three-module build mirroring `functions.zig:133-139`. An extension declaring `pub fn function_body_start(parser: anytype) ?bool` (one character short of `function_body_starts`) **compiles with no error, no warning, and the hook is never called**. There is no registry, no `comptime` cross-check, and no way for an extension author to ask "which of my decls did yuku actually pick up?" The failure presents as "my extension does nothing", which is indistinguishable from a dozen other causes and is the hardest class of bug to diagnose across a module boundary.

This is inherent to `@hasDecl`-based duck typing and is the price of the design, but it is unmitigated here — and it compounds with F5 (a correctly-named `function_body_starts` *also* appears to do nothing in the ambient-with-brace case), so an author hitting F5 will reasonably first suspect F11.

Suggested direction: add a `comptime` validation block in the parser that iterates `@typeInfo(parser_extension).@"struct".decls` and errors on any decl name that is not in yuku's known hook set. That converts every typo into a compile error naming the offending decl, costs nothing at runtime, and doubles as the machine-readable list of hook names the seam currently lacks.

---

## F12 — The two non-error-union hooks have no self-documenting signature, and a wrong return type errors inside yuku's source rather than the extension's

- `Severity: minor`
- Diff location: `src/parser/syntax/variables.zig` hunk `@@ -202,0 +204,2 @@`; `src/parser/syntax/functions.zig` hunk `@@ -133,0 +135,5 @@`

Repo evidence — contrast the two conventions in this slice:

- Fallible: `patterns.zig:16` and `functions.zig:197` pass the return type as a comptime argument — `parser_extension.binding_pattern(Error!??ast.NodeIndex, parser)`. That argument exists because the extension module cannot name `Error` or `ast.NodeIndex` (it is a leaf module that `parser_module` imports at `build.zig:32`, so it cannot import back). It therefore doubles as a written-down contract.
- Infallible: `variables.zig:205` and `functions.zig:136` pass no type. `bool` is nameable so no argument is needed — but that also means the return type is nowhere stated, and the parameter types (`TokenTag`, `*Parser`) are equally unnameable by the extension, so both parameters must be `anytype`.

Explanation — the implied decls are `pub fn can_start_binding(tag: anytype) ?bool` and `pub fn function_body_starts(parser: anytype) ?bool`, and an author must reverse-engineer both from the call sites. Verified against Zig 0.16: declaring `function_body_starts` with return type `bool` instead of `?bool` produces

```
main.zig:7:50: error: expected optional type, found 'bool'
        if (parser_extension.function_body_starts(x)) |value| {
```

— i.e. the error points at **yuku's** source line (`functions.zig:136` in the real build), names neither the extension decl nor the expected signature, and only appears if the enclosing function is reachable from a root. Loud enough not to be a correctness risk, but it puts the diagnosis in the wrong file.

Also verified: the `const has_body` → `var has_body` change at `functions.zig:131` does **not** trip Zig's "local variable is never mutated" check when the `@hasDecl` guard is `false`, because the assignment is still present at AstGen level. The default build is clean. (I checked this specifically because it is the kind of thing that would break every downstream build; it does not.)

Suggested direction: pass the return type as a comptime argument for these two as well (`can_start_binding(?bool, tag)`), purely for symmetry and self-documentation — or, at minimum, put the expected signature in a comment above each `@hasDecl` guard. Combined with the F11 comptime registry, the signature could be checked rather than merely documented.

---

## F13 — `function_body_starts` cannot be fallible, so it cannot report a diagnostic or allocate

- `Severity: nit`
- Diff location: `src/parser/syntax/functions.zig`, hunk `@@ -133,0 +135,5 @@ pub fn parseFunction(`

Repo evidence — `functions.zig:136` calls the hook without `try`, so its return type must be `?bool`, not `Error!?bool`. Meanwhile `parser.report` (used throughout, e.g. `functions.zig:121-125`) returns `Error!void`, and `parser.fmt` allocates.

Explanation — an extension deciding "this function must not have a body here" has no way to explain itself to the user. Its only options are to stay silent (leaving the user with yuku's own baseline diagnostic, which will describe the wrong rule) or to `catch unreachable` / `catch {}` around a `report`, turning an allocation failure into UB or a swallowed error. `can_start_binding` is worse in this respect but also less likely to need it, since it receives only a `TokenTag`. Note that the fallible hooks (`binding_pattern`, `function_body`) have no such limitation — the asymmetry is not principled, it follows from the return type.

Suggested direction: make it `Error!?bool` and `try` it. The cost is one `try` at a comptime-eliminated call site; the benefit is that extensions can produce diagnostics that name their own rules.

---

## F14 — Nothing in this slice is tested or documented (STANDING; slice-scoped — P1 owns the PR-level finding)

- `Severity: major`
- Diff location: all four hunks in this slice

Repo evidence:

- `git grep -rn parser_extension pr-164` returns hits only in `build.zig` (3) and 8 parser source files. **Zero** hits under `test/`, `src/parser/testing/`, or `docs/`.
- `git ls-tree -r --name-only pr-164 | grep -i 'doc\|README\|\.md$'` — no file mentions the extension seam; `docs/content/parser/*.smd` documents `ast`, `codegen`, `semantic`, `traverse`, and has no extension page.
- `build.zig:22` — the default `parser_extension` module is empty, so no existing test exercises any hook body; the fuzzer (`build.zig:89`) gets the same empty module.
- The one **behavioral** change in this slice, `canStartLetBinding` at `variables.zig:218`, has no test asserting the old-vs-new equivalence I established in F1 by hand.

Explanation — for this slice specifically that means: the `?bool` tri-state convention (F10), the reach of each hook (F6, F9), the speculative-invocation constraint (F7), the recognised-node-kind requirement (F8), and the four implied decl signatures all exist only as reader-inferred properties of four call sites. Everything I recorded above had to be derived from the code because there is no other source of truth. The `canStartLetBinding` rewrite in particular is the kind of change that should ship with a table-driven test over `TokenTag` — the property it depends on is one token-table edit away from breaking silently.

Suggested direction (slice-scoped): add a comptime-exhaustive test asserting `canStartLetBinding` agrees with `left_bracket or left_brace or canStartBindingIdentifier` over `@typeInfo(TokenTag).@"enum".fields`, which pins F1's invariant for free. Add one fixture extension module under `src/parser/testing/` that declares all four hooks in this slice and is built as a second parser variant, so the implied signatures are compiled at least once in CI — today no build anywhere instantiates a single hook body.

---

## Coverage

Every hunk in this slice was examined. Hunk headers are from `git diff -U0 pr-164^ pr-164`.

| # | File | Hunk header | What it is | Examined | Findings |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/parser/syntax/variables.zig` | `@@ -9,0 +10 @@ const std = @import("std");` | adds `const parser_extension = @import("parser_extension");` | yes | — (import only; module wiring is `build.zig:22,32`, owned by another packet) |
| 2 | `src/parser/syntax/variables.zig` | `@@ -202,0 +204,2 @@ pub fn canStartBinding(tag: TokenTag) bool {` | `can_start_binding` hook at head of `canStartBinding` | yes | F2, F3, F10, F11, F12 |
| 3 | `src/parser/syntax/variables.zig` | `@@ -215 +218 @@ pub fn canStartLetBinding(tag: TokenTag) bool {` | `canStartLetBinding` rewritten to `canStartBinding(tag) and !tag.isUnconditionallyReserved()` — the PR's only textual semantic rewrite | yes | F1 (equivalence proven over all 159 `TokenTag`s, zero counterexamples), F2, F14 |
| 4 | `src/parser/syntax/patterns.zig` | `@@ -11,0 +12 @@ const ts = @import("ts/types.zig");` | adds `const parser_extension = @import("parser_extension");` | yes | — (import only) |
| 5 | `src/parser/syntax/patterns.zig` | `@@ -13,0 +15,2 @@ pub inline fn parseBindingPattern(parser: *Parser) Error!?ast.NodeIndex {` | `binding_pattern` hook at head of `parseBindingPattern` | yes | F7, F8, F9, F11 |
| 6 | `src/parser/syntax/functions.zig` | `@@ -10,0 +11 @@ const ts = @import("ts/types.zig");` | adds `const parser_extension = @import("parser_extension");` | yes | — (import only) |
| 7 | `src/parser/syntax/functions.zig` | `@@ -132 +133 @@ pub fn parseFunction(` | `const has_body` → `var has_body` | yes | F4; verified against Zig 0.16 that this does not trip "local variable is never mutated" when the guard is comptime-false |
| 8 | `src/parser/syntax/functions.zig` | `@@ -133,0 +135,5 @@ pub fn parseFunction(` | `function_body_starts` hook overriding `has_body` | yes | F4, F5, F6, F10, F11, F12, F13 |
| 9 | `src/parser/syntax/functions.zig` | `@@ -189,0 +196,2 @@ pub fn parseFunctionBody(parser: *Parser) Error!?ast.NodeIndex {` | `function_body` hook at head of `parseFunctionBody` | yes | F6, F11 |

Out-of-scope diff files not reviewed here (owned by other packets): `build.zig`, `src/parser/lexer.zig`, `src/parser/root.zig`, `src/parser/syntax/expressions.zig`, `src/parser/syntax/for_loop.zig`, `src/parser/syntax/jsx/root.zig`, `src/parser/syntax/modules.zig`, `src/parser/syntax/statements.zig`. Files in those paths were read only as *consumers* of this slice's predicates (`for_loop.zig:63,76`; `statements.zig:158`; `ts/statements.zig:55,85`) and are cited as evidence, not reviewed.

### Inferred decl signatures for the 5 extension points in scope

Under `@hasDecl` comptime duck typing, with the constraint that the `parser_extension` module is a leaf that `parser_module` imports (`build.zig:32`) and therefore cannot name `Parser`, `Error`, `ast.NodeIndex`, or `TokenTag`:

1. **`can_start_binding`** — `variables.zig:204-205`, called as `parser_extension.can_start_binding(tag)`, result consumed by `if (…) |value| return value;` inside `fn (TokenTag) bool`.
   → `pub fn can_start_binding(tag: anytype) ?bool`
   `tag` is a `TokenTag` by value; `anytype` is forced (unnameable). Return must be `?bool` — `null` defers to the baseline, non-`null` overrides it (F10). No `*Parser`, so the hook is context-free (F2).

2. **`canStartLetBinding`** — *not* an extension point; the in-diff rewrite at `variables.zig:217-219`. Signature unchanged: `pub fn canStartLetBinding(tag: TokenTag) bool`. It has no decl of its own in `parser_extension`; it is reachable from extensions only transitively through `can_start_binding`, which is exactly the coupling in F2.

3. **`binding_pattern`** — `patterns.zig:15-16`, called as `try parser_extension.binding_pattern(Error!??ast.NodeIndex, parser)`, result consumed by `if (…) |node| return node;` inside `fn (*Parser) Error!?ast.NodeIndex`.
   → `pub fn binding_pattern(comptime R: type, parser: anytype) R` where the caller instantiates `R = Error!??ast.NodeIndex`.
   Outer optional = "handled / not handled"; inner optional = the normal parse result (`null` = error-recovery bail). May be invoked speculatively (F7); the returned node should be one of `.binding_identifier` / `.object_pattern` / `.array_pattern` / `.assignment_pattern` or downstream TS application silently no-ops (F8).

4. **`function_body_starts`** — `functions.zig:135-139`, called as `parser_extension.function_body_starts(parser)`, result consumed by `if (…) |value| { has_body = value; }`.
   → `pub fn function_body_starts(parser: anytype) ?bool`
   `parser` is `*Parser`; `anytype` forced. Not `try`ed, so it must be infallible — no `parser.report`, no fallible allocation (F13). `null` defers, non-`null` overrides (F10). Invoked once per `parseFunction` only, and only after the ambient-with-`{` guard has already returned (F5, F6).

5. **`function_body`** — `functions.zig:196-197`, called as `try parser_extension.function_body(Error!??ast.NodeIndex, parser)`, result consumed by `if (…) |node| return node;` inside `fn (*Parser) Error!?ast.NodeIndex`.
   → `pub fn function_body(comptime R: type, parser: anytype) R` where `R = Error!??ast.NodeIndex`.
   Same outer/inner optional contract as `binding_pattern`. Reaches all four `parseFunctionBody` callers — `function` bodies, class members, object methods, and block-bodied arrows — but not concise arrow bodies (F6).

For all five: the decl name is matched by exact string literal in `@hasDecl`, so any spelling deviation compiles clean and is silently ignored (F11, verified against Zig 0.16).
