# T003-P2 — yuku PR #164 review: JSX + lexer hot path

- PR: https://github.com/yuku-toolchain/yuku/pull/164
- Head: `pr-164` = `1ec1871c9eb83a27e5dfab6f2ee865596cbf6436`
- Diff verified: 11 files, +76/-3 (`git -C /Users/jacksm5pro/dev/open-source/yuku diff pr-164^ pr-164`)
- Slice: `src/parser/lexer.zig` (1 hook) + `src/parser/syntax/jsx/root.zig` (7 hooks)

Key facts established while reading beyond the diff, referenced repeatedly below:

- `pr-164:src/parser/parser.zig:91` — `pub const Error = error{OutOfMemory};`. The error union in every hook signature carries exactly one error, and it is not a parse error.
- `pr-164:src/parser/strings.zig:4-14` — `String` is `struct { start: u32, end: u32 }`, a *handle*, not a byte slice. `ASTStringPool.get` (`strings.zig:23-32`) disambiguates source-vs-extra by `id.start < source.len`.
- `pr-164:src/parser/parser.zig:225-231` — a `null` return from a parse function reaches `parseBody`, which calls `self.recover(terminator)` (`parser.zig:595`), a panic-mode token skip. The repo-wide convention is that returning `null` implies a diagnostic was already reported.
- `pr-164:src/parser/parser.zig:396-426` — `checkpoint()` / `rewind()` exist and restore lexer cursor/state/mode, current token, `tree.nodes.len`, `tree.extras.len`, `diagnostics.len`, and parser context. Nothing in this diff uses them.
- `pr-164:build.zig:22` — `const parser_extension = b.addOptions().createModule();`. The default seam is an **empty options module** with no declarations.

---

## Finding 1 — `jsx_text_boundary` is genuinely zero-cost when absent; the cost profile when present is per-byte and unbounded

`Severity: minor`

**Diff location** — `src/parser/lexer.zig` `@@ -453,6 +454,8 @@` and `@@ -6,6 +6,7 @@`

**Repo evidence**

`pr-164:src/parser/lexer.zig:449-468` (`reScanJsxText`), compared against `pr-164^:src/parser/lexer.zig` where the loop body is exactly `const c = ...; switch (c) { '<','{','>','}' => break, else => self.cursor += 1 }`.

```zig
while (self.cursor < self.source.len) {
    const c = self.source[self.cursor];
    if (comptime @hasDecl(parser_extension, "jsx_text_boundary"))
        if (parser_extension.jsx_text_boundary(self.source, self.cursor)) |stop| if (stop) break;

    switch (c) { '<', '{', '>', '}' => break, else => self.cursor += 1 }
}
```

**Explanation**

Zero-cost claim: **yes, provably, given the current default module.** `@hasDecl` is comptime-known unconditionally; the `comptime` keyword on the condition is redundant but harmless. With a comptime-known `false` condition Zig emits only the taken branch and does not semantically analyse the untaken one, so no branch, no call, and no register pressure survives into codegen. And `parser_extension` today is `b.addOptions().createModule()` with zero options registered (`build.zig:22`), whose generated `.zig` has no `pub` declarations, so `@hasDecl` is `false` for all eight names. The default build's `reScanJsxText` is byte-identical to `pr-164^`'s.

The caveat is that this is a property of the *default module*, not of the seam: nothing in the repo pins it. There is no test asserting the generated options module is empty, and because the seam **is** an options module, any future `-D<flag>` whose name collides with a hook name (e.g. a build option literally named `jsx_names_match`) would make `@hasDecl` true and then fail to compile at the call site, since the decl would be a `bool` rather than a function.

Cost when an extension *is* present, in what is the hottest JSX scanning loop in the parser:

- One predicate evaluation **per byte of JSX text**, plus an optional-null test and a bool test — i.e. two extra branches per byte on top of a loop whose baseline body is a single load and a 4-way switch. Even fully inlined this is roughly a 2–3× per-byte cost increase and it prevents the switch from being lowered to a vectorised byte scan.
- The hook is called *before* the switch, so it also runs on the delimiter bytes that would have terminated the loop anyway.
- The signature passes `(self.source, self.cursor)` — the whole source plus an absolute offset, and **no `start`, no lexer mode, no "is this the first byte" flag**. An extension that needs any positional context (line start, indentation depth, distance from the token start — exactly the cases a boundary hook exists for) must re-derive it by scanning backwards from `cursor` on every call, making the loop O(n²) over a text run. That is the realistic worst case, and it is a consequence of the parameter list, not of extension author carelessness.

**Suggested direction** — pass the `*Lexer` (or at minimum `start` alongside `cursor`) so context is O(1) to obtain; consider hoisting the hook to a chunked form (`jsx_text_boundary(source, start, cursor) ?u32` returning the next boundary offset) so the extension is consulted once per text run rather than once per byte. Separately, give the seam its own dedicated empty module rather than reusing an options module, so hook names cannot collide with build flags.

---

## Finding 2 — A `jsx_text_boundary` that stops on a non-delimiter byte silently truncates the children list and emits a misleading diagnostic

`Severity: major`

**Diff location** — `src/parser/lexer.zig` `@@ -453,6 +454,8 @@` (interacting with `src/parser/syntax/jsx/root.zig` `parseJsxChildren`)

**Repo evidence** — `pr-164:src/parser/syntax/jsx/root.zig:313-378`, `pr-164:src/parser/parser.zig:458-461`

**Explanation**

The lexer hook is free to break at *any* byte. The consumer is not. Trace what happens when the hook returns `true` at a byte that is not one of `<`/`{`/`>`/`}` — say `|` in `<Foo>a|b</Foo>`:

1. `reScanJsxText` returns a `jsx_text` token spanning `[scan_from, boundary)`.
2. `parseJsxChildren` adds the text node, then calls `advanceWithRescannedToken(text_token)` (`parser.zig:458`), which re-lexes from the lexer cursor and yields the next real token — here an operator, not a JSX delimiter.
3. The `switch (parser.current_token.tag)` at `jsx/root.zig:349` has no arm for it, so it falls into `else => break`.
4. `parseJsxChildren` returns the truncated child list; `parseJsxElement` then calls `parseJsxClosingElement`, which sees `current_token.tag != .less_than` and reports **"Expected '</' to close the JSX element"** (`jsx/root.zig:242-248`) and returns `null`, which drops the whole enclosing statement into `recover()`.

So there is no infinite loop (good), but the failure is silent-then-confusing: children after the boundary vanish and the user gets a closing-tag error pointing at a position where their closing tag is perfectly fine. Worse, if the hook returns `true` at `cursor == start`, the resulting token has `len() == 0`, no text node is created at all, and the same `else => break` path fires immediately.

The implicit, unstated contract is "you may only stop at a byte the `parseJsxChildren` switch can dispatch on". Nothing enforces or documents it, and the hook has no way to signal "I stopped, here is what to do next".

**Suggested direction** — document the contract explicitly on the hook, and consider making it enforceable: either restrict the hook to *narrowing* within the existing delimiter set, or extend `parseJsxChildren`'s switch with an extension-owned arm so a custom boundary has a defined continuation instead of falling through to `else => break`.

---

## Finding 3 — The `?bool` return on `jsx_text_boundary` and `jsx_names_match` is a tri-state with only two meanings

`Severity: nit`

**Diff location** — `src/parser/lexer.zig` `@@ -453,6 +454,8 @@`; `src/parser/syntax/jsx/root.zig` `@@ -284,6 +294,8 @@`

**Repo evidence** — `if (... ) |stop| if (stop) break;` (lexer.zig:455-456); `if (...) |value| return value;` (jsx/root.zig:295-296)

**Explanation**

For `jsx_text_boundary`, `null` (declined) and `false` (explicitly not a boundary) produce byte-identical behaviour: fall through to the switch. The optional buys nothing over a plain `bool` and costs an extra branch in the hottest loop in the file. For `jsx_names_match` the optional *is* meaningful (`null` = defer to textual comparison, `false` = force mismatch), so the two hooks use the same type for different reasons — which is precisely the sort of inconsistency that makes a duck-typed seam hard to implement correctly from call sites alone.

**Suggested direction** — make `jsx_text_boundary` return `bool`; keep `?bool` for `jsx_names_match` and document the three-way meaning.

---

## Finding 4 — `jsx_text_value` changes value/span coupling and hands the extension an unvalidated `String` handle; ill-formed handles are UB in release builds

`Severity: major`

**Diff location** — `src/parser/syntax/jsx/root.zig` `@@ -313,9 +325,19 @@`

**Repo evidence** — `pr-164:src/parser/strings.zig:4-32`, `pr-164:src/parser/ast.zig:347-360`, `pr-164:src/parser/ast.zig:4016-4018` (`JSXText { value: String }`), `pr-164:src/parser/codegen/printer.zig:2828-2830` (`emit_jsx_text` writes `t.value`)

**Explanation**

Answering the ownership question directly: **the returned value is not a byte slice and does not carry memory.** `sourceSlice` returns `String{ .start, .end }`, a pair of `u32` offsets. `ASTStringPool.get` resolves it by branching on `id.start < source.len`: below that, it slices the *original source buffer*; at or above, it slices `pool.extra`, which lives in the tree's arena (`ast.zig:205-218`, `deinit` frees the arena). So:

- Lifetime the AST assumes: the handle is valid for as long as the `Tree` *and* the source buffer the tree was built over both live. Handles are not self-describing and are not portable across trees.
- The only sound way for an extension to produce a *computed* value is `parser.tree.addString(bytes)` (`ast.zig:353-356`), which copies into the arena and dedups. That path is reachable through the `parser` argument and its ownership is correct.
- But nothing at the seam requires it. An extension can return a hand-built `String{ .start = x, .end = y }`. If `start < source.len` and `end > source.len`, `get` hits `std.debug.assert(id.end <= src_len)` (`strings.zig:27`) — which is *erased in ReleaseFast/ReleaseSmall*, leaving an out-of-bounds slice of `self.source`. A handle with `end < start` trips the assert in `String.len()` (`strings.zig:10`) the same way. So a mis-implemented hook is memory-unsafe in release, not merely wrong.

Semantics also shift subtly: the node is still added with the *original* `text_token.span` (`jsx/root.zig:341`), so after an override the node's span and its value describe different bytes. `emit_jsx_text` prints `t.value`, so codegen follows the override, while anything span-driven (source maps — `build.zig` gates `codegen_options.source_maps`) follows the original text. That divergence may well be intended for a transforming dialect, but it is a new AST invariant that is nowhere written down.

Two smaller notes on the same hunk: the hook only runs inside `if (text_token.len() > 0)`, so an extension cannot synthesise text where the source had none; and `@TypeOf(text_value)` is used to spell the return type rather than the explicit `ast.String`, which means the hook's signature silently changes if `sourceSlice`'s return type ever changes.

**Suggested direction** — document that the hook must return a handle obtained from `parser.tree.addString` or `parser.tree.sourceSlice`, and add a debug-mode validation at the call site (`start <= end`, `end <= source.len + extra.len`) so a bad handle fails loudly in debug rather than reading OOB in release. Spell the type as `ast.String` rather than `@TypeOf(text_value)`.

---

## Finding 5 — A `jsx_names_match` override can accept mismatched tags, and the binder does depend on names having matched

`Severity: major`

**Diff location** — `src/parser/syntax/jsx/root.zig` `@@ -284,6 +294,8 @@`

**Repo evidence** — `pr-164:src/parser/syntax/jsx/root.zig:275-292` (sole call site), `pr-164:src/parser/semantic/binder.zig:1106-1117`, `pr-164:src/parser/codegen/printer.zig:2753,2772`

**Explanation**

Yes, on both sides, and there is a concrete downstream invariant.

*Forcing `true` on mismatched tags.* `jsxNamesMatch` has exactly one caller (`jsx/root.zig:275`); returning `true` suppresses the diagnostic and builds `jsx_element{ opening, children, closing }` where opening and closing names are different nodes with different text. The binder then walks **both** (`binder.zig:1109`: `inline .jsx_opening_element, .jsx_closing_element => |el|`) and, for any capitalised tag root, calls `addReference(id.name, ...)`. So `<Foo>…</Bar>` accepted by an override produces a symbol reference to `Bar` as well as `Foo` — a reference to a name the user never intended to use, with whatever unresolved-symbol / unused-import consequences follow. The printer likewise emits the closing element's own name (`printer.zig:2753` → `emit_jsx_closing_element` at 2772), so the mismatch round-trips into output.

*Forcing `false` on textually identical names.* The diagnostic at `jsx/root.zig:277-287` is built from `parser.spanText` of both spans, so rejecting a valid pair produces the self-contradictory message `Expected closing tag for '<Foo>' but found '</Foo>'`, then returns `null` into `recover()`.

Two structural problems make the hook hard to use well:

- It takes `parser: *const Parser`, so an extension **cannot report its own diagnostic**. It can only flip the verdict and inherit a message hardcoded to the textual-mismatch wording. Any extension implementing aliased, case-insensitive, or namespace-aware matching is stuck with a message that describes a different rule than the one it enforces.
- The hook fires at `jsx/root.zig:275`, which is *after* the `switch (context)` block at 264-274 has already committed the lexer mode change and, for `.top_level` / `.attribute`, already advanced past `>`. So a hook that forces a mismatch does so from a parser state that has already moved on, and error recovery starts from there rather than from the closing tag.

**Suggested direction** — take `*Parser` so the hook can report a rule-appropriate diagnostic, and let it return a tri-state that distinguishes "mismatch, I already reported" from "mismatch, use the built-in message". Document that accepting a mismatch produces an extra binder reference for the closing name.

---

## Finding 6 — `Error!??ast.NodeIndex`: `some(null)` routes into panic-mode recovery, possibly with zero diagnostics

`Severity: major`

**Diff location** — `src/parser/syntax/jsx/root.zig` `@@ -49,6 +50,15 @@`, `@@ -367,6 +389,11 @@`, `@@ -618,6 +645,8 @@`

**Repo evidence** — `pr-164:src/parser/parser.zig:91`, `pr-164:src/parser/parser.zig:225-231`, `pr-164:src/parser/parser.zig:595-626`

**Explanation**

The four points shaped `Error!??ast.NodeIndex` are all consumed identically:

```zig
if (try parser_extension.hook(Error!??ast.NodeIndex, parser, ...)) |node| return node;
```

`try` strips the error; `if (…) |node|` strips the **outer** optional; `node` is the inner `?ast.NodeIndex`, returned directly into the enclosing `Error!?ast.NodeIndex`. So the three-way meaning is:

| Returned | Meaning | Effect |
|---|---|---|
| `null` (outer) | extension declined | falls through to built-in parsing — the only benign case |
| `some(some(idx))` | extension parsed a node | `idx` becomes the result |
| `some(null)` | extension took over **and failed** | propagates `null` up through `orelse return null` chains into `parseBody`'s `recover()` |
| `error.OutOfMemory` | allocation failure | aborts the whole parse |

The layering is coherent and the double optional is genuinely load-bearing — but it is also the easiest thing in this PR to get backwards, and nothing documents it. Two concrete hazards:

- **`some(null)` without a diagnostic is a silent statement drop.** The whole parser relies on "`null` implies I already reported". `parseBody` (`parser.zig:225-231`) responds to `null` by calling `recover()`, which skips tokens until EOF, the terminator, or a keyword after a line break. An extension that returns `some(null)` on an input it doesn't like, without calling `parser.report*`, yields a tree that is missing an arbitrary span of the program while `tree.diagnostics` stays empty — i.e. a parse that reports success and silently ate code. This is the most dangerous single misuse the seam permits and there is no `@compileError`, assert, or doc guarding it.
- **`error` is not an escape hatch.** `Error = error{OutOfMemory}` (`parser.zig:91`). An extension cannot invent a parse error to return, so `some(null)` is the *only* way to signal failure. That makes the previous bullet not an edge case but the default path an extension author will take.

**Suggested direction** — document the four-way table on the seam, and add a debug assertion at each call site that a `some(null)` return was accompanied by at least one new diagnostic (`diagnostics.items.len` grew), which is cheap and catches the silent-drop case immediately.

---

## Finding 7 — `jsx_child_at_code_block` / `jsx_child_at_control_flow`: decline-after-consume corrupts parser state, and the two hooks sit at an identical program point

`Severity: major`

**Diff location** — `src/parser/syntax/jsx/root.zig` `@@ -367,6 +389,11 @@`

**Repo evidence** — `pr-164:src/parser/syntax/jsx/root.zig:385-400`, `pr-164:src/parser/parser.zig:396-426` (`checkpoint`/`rewind`)

**Explanation**

Both hooks run after `{` has been consumed (`jsx/root.zig:390`) and before the `.spread` / `.right_brace` / expression dispatch. To decide whether to claim the construct, a hook must inspect — and realistically *advance past* — one or more tokens. If it then returns `null` (declined), the parser resumes at `jsx/root.zig:392` with `current_token` wherever the hook left it, and the built-in path proceeds on corrupted state: `if (parser.current_token.tag == .spread)` and the `.right_brace` empty-expression check both test a token the hook may have consumed.

The parser already has the right primitive for this — `checkpoint()` / `rewind()` at `parser.zig:396-426` restore lexer cursor/mode/state, `current_token`, `prev_token_end`, `tree.nodes.len`, `tree.extras.len`, `diagnostics.len`, and both context structs. Neither call site uses it, and nothing states whether the hook or the host owns rollback. Given the extension is duck-typed and out of tree, the host is the only place this can be enforced.

Two hooks at the same position with the same signature also raises a design question: `jsx_child_at_code_block` and `jsx_child_at_control_flow` are indistinguishable to the parser — same state, same arguments, same return shape, dispatched in fixed order with code-block winning. Nothing in the call site explains why the split exists rather than one hook that inspects `parser.current_token` itself.

Additionally, `parseJsxChildren` computes `scan_from = parser.tree.span(child).end` (`jsx/root.zig:361`) from the returned node's span. A hook-produced node whose span does not actually end at the consumed text will make the next `reScanJsxText` start at the wrong offset — either re-scanning text already consumed or skipping source.

**Suggested direction** — wrap each hook call in `checkpoint()` / `rewind()` on decline, so declining is genuinely free; document that a returned node's span must end exactly at the last consumed byte; and either merge the two hooks or document what distinguishes them.

---

## Finding 8 — `jsx_element_after_open` observes different parser state depending on `self_closing`, and passes a private type across the seam

`Severity: major`

**Diff location** — `src/parser/syntax/jsx/root.zig` `@@ -49,6 +50,15 @@`

**Repo evidence** — `pr-164:src/parser/syntax/jsx/root.zig:12-20` (`const JsxElementContext = enum` — **not** `pub`), `pr-164:src/parser/syntax/jsx/root.zig:189-206` (mode/advance block in `parseJsxOpeningElement`), `pr-164:src/parser/syntax/jsx/root.zig:50-58`

**Explanation**

The hook fires immediately after `parseJsxOpeningElement` returns, but that function's exit state is not uniform. From `jsx/root.zig:189-206`:

- non-self-closing: lexer still in `jsx_tag` mode, `current_token` is still the un-consumed `>`;
- self-closing + `.attribute`: mode set back to `jsx_tag`, `>` already consumed;
- self-closing + `.top_level`: mode `normal`, `>` already consumed;
- self-closing + `.child`: mode `normal`, `>` **not** consumed.

An extension that takes over at this point therefore has to reproduce all four cases from `opening_data.self_closing` and `context` before it can parse anything — but `opening_data` is not passed to the hook, only `opening`, so it must re-fetch `parser.tree.data(opening).jsx_opening_element` itself. It also isn't given `start` (the element's start offset, `jsx/root.zig:37`), so a returned node's span must be reconstructed via `parser.tree.span(opening).start`.

Separately, the hook receives `context`, whose type `JsxElementContext` is declared without `pub` at `jsx/root.zig:12`. An extension can only accept it as `anytype` — it cannot name the type, cannot exhaustively switch on it with named tags without `@tagName` string comparison, and gets no compile-time guarantee it received the enum it expects. This is the clearest illustration of why the seam uses return-type-as-comptime-argument at all (see Finding 10): the extension module cannot import the parser module that imports it, so no parser type can appear in an extension signature.

**Suggested direction** — pass `opening_data` and `start` explicitly, make `JsxElementContext` `pub`, and document the four exit states (or normalise them before the hook fires).

---

## Finding 9 — `jsx_element_name` fires for both opening and closing tags with no way to tell them apart, and a synthetic name node breaks two downstream consumers

`Severity: major`

**Diff location** — `src/parser/syntax/jsx/root.zig` `@@ -618,6 +645,8 @@`

**Repo evidence** — `parseJsxElementName` callers: `pr-164:src/parser/syntax/jsx/root.zig:166` (inside `parseJsxOpeningElement`) and `:249` (inside `parseJsxClosingElement`); `pr-164:src/parser/syntax/jsx/root.zig:296-308` (`jsxNamesMatch` compares spans then bytes); `pr-164:src/parser/semantic/binder.zig:1109-1116` (`jsxTagRoot`)

**Explanation**

Unlike `parseJsxElement` and `parseJsxOpeningElement`, which are parameterised by `comptime context: JsxElementContext`, `parseJsxElementName` takes only `parser`. The hook therefore fires identically for `<Foo…` and `</Foo>` and has no argument that distinguishes them; an extension that wants to accept an extended name grammar in opening tags only would have to infer position from `parser.prev_token_end` or lexer state, which is not part of any stated contract.

The returned node also has two implicit obligations that the signature does not express:

1. **Its span must cover the name text.** `jsxNamesMatch` (`jsx/root.zig:296-308`) matches by comparing `parser.tree.span(a)` and `parser.tree.span(b)` lengths and then `parser.spanText` bytes. A synthetic name node with a zero-width or non-source span makes every closing tag either spuriously match (both zero-length) or spuriously mismatch.
2. **Its node kind must be one the binder recognises.** `binder.zig:1110` calls `jsxTagRoot(self.tree, el.name)` to find the leftmost `jsx_identifier`; a node kind outside `jsx_identifier` / `jsx_member_expression` / `jsx_namespaced_name` yields no binding reference at all, so a capitalised custom tag would silently fail to reference its import.

The hook is also placed *above* the `parser.current_token.tag != .jsx_identifier` guard at `jsx/root.zig:649`, which is deliberate (it lets an extension accept names the built-in lexer would reject) but means the hook is the only thing standing between a malformed tag and the built-in diagnostic — the two paths are mutually exclusive rather than layered.

**Suggested direction** — thread `context` (or an opening/closing discriminator) through `parseJsxElementName` to the hook, and document the span and node-kind obligations on the returned node.

---

## Finding 10 — `validate_jsx_element_name` cannot reject a name recoverably

`Severity: minor`

**Diff location** — `src/parser/syntax/jsx/root.zig` `@@ -49,6 +50,15 @@`

**Repo evidence** — `pr-164:src/parser/parser.zig:91` (`Error = error{OutOfMemory}`), `pr-164:src/parser/syntax/jsx/root.zig:57-58`

**Explanation**

The hook is `try`-ed with return type `Error!void`. Since `Error` contains only `OutOfMemory`, the hook's *only* failure channel is an allocation failure that aborts the entire parse. It cannot signal "this name is invalid, stop parsing this element" the way every built-in path does (report + `return null`). Its sole usable behaviour is to call `parser.report*` and let parsing continue as if the name were fine — which produces a diagnostic *and* a complete AST node for a construct the extension just declared invalid.

That may be exactly the intent (a lint-style hook), but it is a different contract from the other seven points in this slice, and the `Error!void` shape suggests a rejection capability that does not exist.

**Suggested direction** — either return `Error!bool` / `Error!?void` so the hook can stop element parsing after reporting, or rename it to something that reflects that it is advisory only.

---

## Finding 11 — Not one of the eight extension points is tested, documented, or exercised anywhere in the repository

`Severity: major` *(slice-local note; the PR-level version of this finding belongs to P1)*

**Diff location** — all eight hunks in this slice

**Repo evidence**

```
git grep -n -E "jsx_text_boundary|jsx_element_after_open|validate_jsx_element_name|jsx_names_match|jsx_text_value|jsx_child_at_code_block|jsx_child_at_control_flow|jsx_element_name|parser_extension" pr-164
```
returns hits **only** in `build.zig`, `src/parser/lexer.zig`, and `src/parser/syntax/*` — i.e. only the call sites this PR adds. There is no test, no doc comment on any hook, no example extension module, and no non-empty implementation anywhere in the tree.

**Explanation**

Every signature in the Coverage table below is *inferred from call sites*, not compile-verified, because the default `parser_extension` module is empty (`build.zig:22`) and therefore no branch containing a hook call is ever semantically analysed by any build or test in this repository. Concretely: all eight call sites are dead code under `zig build test`. A typo in an argument list, a wrong comptime-argument position, or a shape mismatch in a return type would not be caught by CI today.

The failure modes on a mismatched declaration are also asymmetric and one of them is silent:

- **Missing `pub`** — `@hasDecl` from another module sees only public declarations, so a non-`pub` hook makes the condition `false` and the hook is **silently ignored**, with no error and no warning. This is the worst mode: the extension author writes a hook, the build succeeds, and nothing happens.
- **Wrong name** (typo, casing) — same silent no-op.
- **Wrong arity or parameter types** — hard compile error raised inside `src/parser/lexer.zig` or `src/parser/syntax/jsx/root.zig`, pointing at parser internals rather than at the extension, and it fires for every consumer of the `parser` module including the fuzzer target (`build.zig:89`).
- **Wrong return shape** — e.g. `jsx_names_match` declared `bool` instead of `?bool` fails at `if (…) |value|` with "expected optional type"; an `Error!?ast.NodeIndex` (single optional) where `Error!??ast.NodeIndex` is expected compiles the `if`-unwrap but then fails to coerce `ast.NodeIndex` into the `?ast.NodeIndex` return — or, worse, in some shapes coerces silently and inverts the declined/failed semantics from Finding 6.
- **Non-function declaration with a colliding name** (the options-module hazard from Finding 1) — `@hasDecl` true, call site fails to compile.

**Suggested direction** — add a test-only extension module wired to a dedicated build step that implements all eight hooks, so every call site is compiled and its inferred signature is pinned by CI. Add `@compileError` guards (e.g. `@hasDecl` plus a `@typeInfo(@TypeOf(decl))` arity/shape check) so a mismatched declaration produces a message naming the hook and its expected signature rather than a raw type error in parser internals. Document the four-way `Error!??T` convention and the return-type-as-comptime-argument convention in one place.

---

## Coverage

### In-scope hunks examined

| # | File | Hunk header | Content | Examined |
|---|---|---|---|---|
| 1 | `src/parser/lexer.zig` | `@@ -6,6 +6,7 @@` | `const parser_extension = @import("parser_extension");` | yes — Findings 1, 11 |
| 2 | `src/parser/lexer.zig` | `@@ -453,6 +454,8 @@` | `jsx_text_boundary` inside `reScanJsxText` loop (L454-456); compared against `pr-164^:src/parser/lexer.zig` `reScanJsxText` and read in full at `pr-164:src/parser/lexer.zig:449-468` | yes — Findings 1, 2, 3 |
| 3 | `src/parser/syntax/jsx/root.zig` | `@@ -7,6 +7,7 @@` | `const parser_extension = @import("parser_extension");` | yes — Finding 11 |
| 4 | `src/parser/syntax/jsx/root.zig` | `@@ -49,6 +50,15 @@` | `jsx_element_after_open` (L50-57) + `validate_jsx_element_name` (L58-59) in `parseJsxElement`; whole of `parseJsxElement` read (L36-89) | yes — Findings 6, 8, 10 |
| 5 | `src/parser/syntax/jsx/root.zig` | `@@ -284,6 +294,8 @@` | `jsx_names_match` at head of `jsxNamesMatch` (L294-296); sole caller in `parseJsxClosingElement` read in full (L237-294) | yes — Finding 5 |
| 6 | `src/parser/syntax/jsx/root.zig` | `@@ -313,9 +325,19 @@` | `jsx_text_value` replacing `tree.sourceSlice` for the `jsx_text` node value (L325-337); whole of `parseJsxChildren` read (L313-378) | yes — Findings 2, 4 |
| 7 | `src/parser/syntax/jsx/root.zig` | `@@ -367,6 +389,11 @@` | `jsx_child_at_code_block` + `jsx_child_at_control_flow` in `parseJsxChildFromLeftBrace` (L389-393); whole function read (L381-420) | yes — Finding 7 |
| 8 | `src/parser/syntax/jsx/root.zig` | `@@ -618,6 +645,8 @@` | `jsx_element_name` at head of `parseJsxElementName` (L645-647); whole function and both callers read | yes — Finding 9 |

### Read beyond the diff

- `pr-164:src/parser/lexer.zig:449-468` vs `pr-164^:src/parser/lexer.zig` — `reScanJsxText` before/after.
- `pr-164:src/parser/syntax/jsx/root.zig` — `parseJsxElement`, `parseJsxOpeningElement`, `parseJsxClosingElement`, `parseJsxChildren`, `parseJsxChildFromLeftBrace`, `parseJsxSpreadAttribute`, `parseJsxElementName`, `parseJsxFragment`, `jsxNamesMatch`, all read in full.
- `pr-164:src/parser/ast.zig` — `JSXText` (4016-4018), `Tree.sourceSlice` / `addString` / `string` (347-362), arena ownership (205-218).
- `pr-164:src/parser/strings.zig:1-90` — `String` handle representation and `ASTStringPool.get`.
- `pr-164:src/parser/parser.zig` — `Error` (91), `parseInner`/`parseBody` null handling (148-231), `checkpoint`/`rewind` (396-426), `advanceWithRescannedToken` (458-461), `recover` (595-626).
- `pr-164:src/parser/codegen/printer.zig:2753,2772,2828` — jsx element/closing/text emission.
- `pr-164:src/parser/semantic/binder.zig:1106-1117` — JSX tag name binding.
- `pr-164:build.zig:22,32,89` — only as it establishes that the default `parser_extension` module is empty (build.zig itself is out of this slice; P1 owns it).

### Inferred declaration signatures for the 8 in-scope extension points

All are inferred from call sites only — none is compile-verified anywhere in the repo (Finding 11). Under comptime duck typing the extension module cannot import the `parser` module (which imports `parser_extension`), so no parser-owned type can be named in a signature; parameters must be `anytype` and return types arrive as a comptime `type` argument. All must be `pub` or `@hasDecl` silently reports `false`.

| # | Hook | Inferred declaration | Notes |
|---|---|---|---|
| 1 | `jsx_text_boundary` | `pub fn jsx_text_boundary(source: []const u8, cursor: u32) ?bool` | `lexer.zig:455-456`. No comptime return-type argument, no error union — the only hook that cannot fail. `source` is `Lexer.source` (`[]const u8`), `cursor` is `u32`. `null` and `false` are behaviourally identical. |
| 2 | `jsx_element_after_open` | `pub fn jsx_element_after_open(comptime R: type, parser: anytype, opening: anytype, context: anytype) R` where `R = Error!??ast.NodeIndex` | `jsx/root.zig:51-57`. `parser: *Parser`, `opening: ast.NodeIndex`, `context: JsxElementContext` (private type — must be `anytype`). |
| 3 | `validate_jsx_element_name` | `pub fn validate_jsx_element_name(comptime R: type, parser: anytype, name: anytype) R` where `R = Error!void` | `jsx/root.zig:58-59`. `name: ast.NodeIndex` from `opening_data.name`. Only failure is `OutOfMemory`. |
| 4 | `jsx_names_match` | `pub fn jsx_names_match(parser: anytype, a: anytype, b: anytype) ?bool` | `jsx/root.zig:295-296`. No comptime return-type argument (return type names no parser type). `parser: *const Parser` — read-only, cannot report diagnostics. `a`/`b`: `ast.NodeIndex`. |
| 5 | `jsx_text_value` | `pub fn jsx_text_value(comptime R: type, parser: anytype, span: anytype) R` where `R = Error!?ast.String` | `jsx/root.zig:329-336`. `R` is spelled `Error!?@TypeOf(text_value)` at the call site, i.e. `Error!?strings.String`. `span: ast.Span`. `null` = keep the default `sourceSlice` value. |
| 6 | `jsx_child_at_code_block` | `pub fn jsx_child_at_code_block(comptime R: type, parser: anytype) R` where `R = Error!??ast.NodeIndex` | `jsx/root.zig:390`. Called after `{` is consumed. |
| 7 | `jsx_child_at_control_flow` | `pub fn jsx_child_at_control_flow(comptime R: type, parser: anytype) R` where `R = Error!??ast.NodeIndex` | `jsx/root.zig:392`. Identical position and shape to #6; runs second. |
| 8 | `jsx_element_name` | `pub fn jsx_element_name(comptime R: type, parser: anytype) R` where `R = Error!??ast.NodeIndex` | `jsx/root.zig:646`. Fires for both opening and closing tags with no discriminator. |

**`Error!??ast.NodeIndex` convention** (points 2, 6, 7, 8) — outer `null` = "declined, fall through to built-in parsing"; `some(some(idx))` = "parsed this node"; `some(null)` = "took over and failed", which propagates into `parseBody`'s `recover()` and **must** be accompanied by a reported diagnostic; `error.OutOfMemory` = abort the parse. `Error!?ast.String` (point 5) is a single optional: `null` = declined.

**Breakage on a mismatched declaration** — missing `pub` or a misspelled name makes `@hasDecl` `false` and the hook is silently ignored with no diagnostic; a wrong arity, wrong parameter type, or non-function declaration produces a hard compile error inside parser internals for every consumer of the `parser` module (including the fuzz target); a wrong return shape either fails at the unwrap (`expected optional type`) or, in the single-vs-double-optional case, inverts the declined/failed semantics above.
