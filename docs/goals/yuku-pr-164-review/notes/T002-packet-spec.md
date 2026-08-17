# T002 Judge Decision — Review Packet Spec for yuku PR #164

Decision: **approved** — Scout's 4-way partition confirmed against the real diff (`git diff pr-164^ pr-164` in `/Users/jacksm5pro/dev/open-source/yuku`; pr-164 = 1ec1871c; 11 files, +76/−3; all 19 `@hasDecl(parser_extension, ...)` sites located). Coverage: P1(2) + P2(2) + P3(4) + P4(3) = 11 files, no overlap, no gap.

## Standing questions (EVERY packet must answer for its slice)

1. Does anything in-diff or in-repo test or document this slice's extension points? (PR body claims a 19-point tested proof; the diff adds zero tests.)
2. What exact decl signature does each point imply under comptime duck typing (record it — including return-type-as-comptime-argument and `Error!??ast.NodeIndex` double-optional conventions), and what breaks if an extension supplies a mismatched signature?

P1 owns the single consolidated PR-level finding for both (missing-tests contradiction; whether the 19-point contract should be pinned by an in-repo reference extension or doc). Other packets note slice-level facts only — no duplicate PR-level findings.

## Mandatory findings format

Per finding: `Severity: blocker|major|minor|nit|question`; Diff location (file + hunk header); Repo evidence (yuku paths/lines, pr-164 ref where needed); Explanation; Suggested direction.
Each packet file MUST end with a `## Coverage` section listing every in-scope hunk and confirming it was examined, plus the inferred decl signature for each extension point in scope.

## Packets

### P1 — Build graph + public API + PR-level meta
- Output: `docs/goals/yuku-pr-164-review/notes/T003-P1-findings.md`
- Diff scope: `build.zig` (options-module creation ~L19, parser_module addImport ~L29, fuzz_parser addImport ~L86); `src/parser/root.zig` (`pub const Parser` re-export).
- Context inputs: entire build.zig module graph and every consumer of parser_module (lib, ffi, wasm, fuzz, tests); src/parser/root.zig existing exports; src/parser/parser.zig Parser surface.
- Questions: does every compilation unit importing parser files receive the parser_extension import (a missing consumer fails to compile); is `b.addOptions().createModule()` a sound empty-module idiom; what API commitment does publicly re-exporting Parser create; consolidated standing-question findings.

### P2 — JSX + lexer hot path
- Output: `docs/goals/yuku-pr-164-review/notes/T003-P2-findings.md`
- Diff scope: `src/parser/lexer.zig` (import + per-char `jsx_text_boundary` in JSX text scan loop ~L454–456); `src/parser/syntax/jsx/root.zig` (7 points: jsx_element_after_open ~L50, validate_jsx_element_name ~L58, jsx_names_match ~L294, jsx_text_value replacing tree.sourceSlice ~L325, jsx_child_at_code_block + jsx_child_at_control_flow ~L389, jsx_element_name ~L645).
- Context inputs: full lexer JSX text scan function (pr-164 and parent); parseJsxElement / parseJsxChildren / parseJsxClosingElement / parseJsxSpreadAttribute whole functions; JSX text node storage in src/parser/ast.zig.
- Questions: per-char cost provably zero when absent, worst-case when present; jsx_text_value vs sourceSlice AST value/allocation/ownership semantics; can jsx_names_match override break closing-tag validation; `Error!??NodeIndex` hazards at each point; interaction with JSX error recovery.

### P3 — Statement/expression/for-of/module interception
- Output: `docs/goals/yuku-pr-164-review/notes/T003-P3-findings.md`
- Diff scope: `src/parser/syntax/expressions.zig` (lazy_assignment_pattern ~L108; expression_at_code_block + expression_at_control_flow in the `.at` branch ~L251); `src/parser/syntax/statements.zig` (statement_at_code_block + statement_at_control_flow ~L77); `src/parser/syntax/for_loop.zig` (for_of_tail ~L347, after right-expr before right_paren expect); `src/parser/syntax/modules.zig` (module_specifier fallback ~L946).
- Context inputs: parsePrimaryExpression `.at`/decorator dispatch; parseStatement decorator path; parseForOfStatementRest full function; parseModuleExportName full function; extensions.zig decorator module (precedence interplay).
- Questions: erasure + order preservation when absent; can an extension consume tokens then return null (parser-state corruption); do paired at_code_block/at_control_flow hooks shadow or reorder decorator parsing; for_of_tail placement vs right_paren expectation and error recovery; module_specifier fallback vs export-name string/identifier rules; error-union propagation.

### P4 — Binding/function semantics (includes the PR's only textual rewrite)
- Output: `docs/goals/yuku-pr-164-review/notes/T003-P4-findings.md`
- Diff scope: `src/parser/syntax/variables.zig` (can_start_binding ~L201; canStartLetBinding rewrite ~L215); `src/parser/syntax/patterns.zig` (binding_pattern head ~L9); `src/parser/syntax/functions.zig` (function_body_starts overriding has_body ~L130; function_body ~L193).
- Context inputs: canStartBinding / canStartBindingIdentifier / canStartLetBinding cluster; TokenTag.isUnconditionallyReserved (src/parser/token.zig ~L267); parseFunction incl. TS ambient/declare/overload body-less logic; parseVariableDeclarator; patterns.zig parseBindingPattern entry.
- Questions: independently re-verify the canStartLetBinding rewrite is behavior-preserving for every TokenTag (do not take Scout's word); is can_start_binding composing into canStartLetBinding desired or accidental coupling (answer explicitly); can function_body_starts force has_body true/false in TS ambient contexts, and what diagnostics result; binding_pattern preemption vs destructuring defaults; comptime signature hazards for the two non-error-union hooks (can_start_binding, function_body_starts).

## Worker constraints (T003)

- Read-only against the yuku clone; writes only under `docs/goals/yuku-pr-164-review/notes/**`.
- Dispatch each packet through the fable-opus-cockpit packet gate to opus-worker subagents. Packets are disjoint (read-only review, four distinct output files) — parallel-safe.
- Stop if: pr-164 ≠ 1ec1871c or diff ≠ 11 files +76/−3; a write outside notes/ is needed; a packet scope proves ambiguous; any impulse to fix the PR or post to GitHub; verification fails twice.
