# T012 Judge spec: interactivity tranche (wasm dialect + hero editor + playground)

Judge: read-only review, 2026-08-17. Board: docs/goals/yuku-tsrx-docs-site/state.yaml.
Owner ask: "cmon we gotta have some interactivity". oxc-tsrx ships an editable
hero editor, a /playground page backed by its engine in WebAssembly, and
"Try in playground" buttons on doc code blocks. The honest yuku-tsrx equivalent
runs the real dialect in the browser: parse -> AST, diagnostics, generated
code, semantic view. Verdict: TRACTABLE NOW. Ship the real thing.

## 1. Feasibility verdict: wasm build is tractable (evidence)

1. yuku already compiles the same parser for wasm32-freestanding and runs it in
   CI. /Users/jacksm5pro/dev/open-source/yuku-minimal-seam/build.zig lines
   186-230 create `wasm_target` (wasm32, freestanding, bulk_memory,
   nontrapping_fptoint, sign_ext, simd128), a `wasm` step, a wasm transfer
   module importing `parser`, and three ReleaseSmall/strip executables with
   `entry = .disabled`, `rdynamic = true`. `.github/workflows/ci.yml` line
   99-100 runs `bun run build:wasm` = `zig build wasm && ...`. yuku-tsrx pins
   yuku as `.path = "../yuku-minimal-seam"` (build.zig.zon), i.e. exactly this
   code. Reference sizes from a sibling checkout: yuku-parser.wasm 738 KB,
   yuku-codegen.wasm 535 KB (ReleaseSmall). Expect one yuku-tsrx.wasm carrying
   parse+analyze+generate at roughly 1.0-1.6 MB. Fine for a docs site; no
   COOP/COEP, no threads, no SharedArrayBuffer (unlike oxc-tsrx's
   wasm32-wasip1-threads NAPI-RS build, docs/assets/demo-wasm-backend.js).
2. `std.heap.wasm_allocator` exists in this toolchain (zig 0.16.0; std/heap.zig
   line 359). `smp_allocator` is used only in src/ffi/root.zig and
   src/ffi/performance.zig (napi files that the wasm entry does not import).
3. src/dialect has no OS surface. `grep` over src/dialect/*.zig and src/root.zig
   for std.fs, std.Thread, std.io/std.Io, std.posix, std.time, std.process,
   std.os, std.log, std.debug.print, @cImport, napi, page_allocator,
   smp_allocator returns nothing. The dialect codegen (src/dialect/codegen.zig,
   3940 lines) is pure: std + util + a local sourcemap struct.
4. Module graph a `src/ffi/wasm.zig` needs is exactly what the napi lib gets in
   build.zig (the `napi_zig.addLib(... .name = "yuku-tsrx" ...)` block):
   `parser` = production_parser_module (root src/dialect/root.zig, imports:
   yuku = production_parser_base [clone of yuku parser with parser_extension =
   src/dialect/parser_extension.zig], parser_extension, dialect_abi, util,
   codegen_options) and `transfer` = production_transfer_module (root
   src/dialect/transfer.zig, imports: parser, base_transfer = yuku
   src/parser/ffi/transfer/root.zig over production_parser_base). Codegen is
   `parser.codegen` (src/dialect/root.zig line 133), no separate module.
5. Per-module target inheritance is safe here: std/Build/Module.zig line 592
   emits `-target/-mcpu` for a module only when its query is not native, so
   yuku's native-query modules (util, codegen_options, the yuku parser clone
   template) compile for the wasm root just as they do in yuku's own wasm step.
   Every module the Worker creates for the wasm graph must be created with
   `wasm_target`. Optimize: pass `-Doptimize=ReleaseSmall` on the command line
   so the yuku dependency modules (created with `.optimize = optimize`) are
   also ReleaseSmall; also set `.optimize = .ReleaseSmall, .strip = true` on
   the wasm root and transfer modules like yuku does.
6. Transfer buffer is position independent: header + sections addressed by u32
   counts/offsets, strings by (start,end) offsets, no pointers
   (src/dialect/transfer.zig lines 1-115, Header at 120-137). yuku's host
   already ships it out of wasm memory with `memory.buffer.slice(ptr+4, ...)`
   (npm/yuku-parser-wasm/index.js). The dialect section (records/overlays,
   FLAG_DIALECT_RECORDS) is part of the same buffer and decode.js already reads
   it (DIALECT_RECORDS table at decode.js line 25+).
7. Generated JS hosts are browser-clean. npm/yuku-tsrx/decode.js (844 lines),
   decode-analyzer.js (1376), encode.js (2470): only `TextDecoder`,
   `ArrayBuffer`, typed arrays; no `node:` imports, no Buffer, no process. Only
   index.js/binding.js are Node-bound (binding.js requires the .node addon), and
   the wasm host will not import them.
8. Diagnostics live in the AST buffer (diagnostics section; decode.js
   `_decodeDiagnostics` at line 793 yields `{severity, message, start, end,
   help, labels[{start,end,message}]}`; severities error/warning/hint/info).
   Semantic early errors: napi `parse` with `semantic_errors` calls
   `parser.diagnostics.analyzeWithBoundarySeverity(&tree)` before serializing
   (src/ffi/root.zig line 33); wasm must do the same under the semantic flag so
   the playground shows what `parseModule` would. Codegen errors:
   `parser.codegen.Result.errors: []Diagnostic{message,start,end}`
   (src/dialect/codegen.zig lines 641-666); they must be returned in the
   generate buffer.
9. Blockers found: none that require touching src/dialect. Two facts to
   respect: (a) `deserializeFromBuf` asserts a 4-byte-aligned buffer pointer
   (transfer.zig ~line 762); the wasm `generate` avoids it entirely by parsing
   from source and printing in one call, so no encode.js round trip is needed
   in the browser. (b) `parser.codegen.Options` has no strip/minify fields;
   strip and minify are separate entry points (`codegen.strip`,
   `codegen.minify`, `codegen.print`, lines 683-697), so the wasm opts word
   selects the entry point instead of setting fields (see ABI below).

Unavoidable src/dialect change: NONE. If `zig build wasm` surfaces a compile
error inside src/dialect (for example a `usize`/`u64` narrowing that only bites
on wasm32), the Worker may make a one-line, behaviour-neutral cast fix and must
name file:line and the diff in its receipt; anything larger stops the package.

## 2. Wasm ABI (src/ffi/wasm.zig, new; mirrors yuku's three wasm entries in one module)

Exports (all `export fn`, freestanding, `const gpa = std.heap.wasm_allocator`):

- `alloc(len: usize) [*]u8` / `free(ptr: [*]u8, len: usize) void` as in yuku.
- `parse(ptr, len, flags: u32) usize` -> pointer to `[u32 N][N bytes]` where the
  N bytes are exactly the buffer `transfer.serializeInto` writes for napi
  `parse` (decode.js input), or 0 on failure. Flags (superset of yuku's
  packFlags): bits 0-1 source_type (ast.SourceType index; module=1), bits 2-4
  lang (js=0 ts=1 jsx=2 tsx=3 dts=4), bit 5 preserve_parens, bit 6 semantic
  (run `parser.diagnostics.analyzeWithBoundarySeverity(&tree)` before
  serializing), bit 7 attach_comments (`.comments = .both` else `.flat`), bit 8
  loose (dialect Options.loose).
- `analyze(ptr, len, flags) usize` -> `[u32 N][N bytes]` where the bytes are
  what napi `analyze` produces: `transfer.serializeInto` core followed by
  `transfer.semantic.appendInto(&tree, &semantic, records, buf, core_written)`
  with `parser.semantic.analyze` and `parser.semantic.module_record.collect`
  (src/ffi/root.zig lines 40-58, note the dialect signature
  `semantic_transfer.bufferSize(tree, semantic, records, core_size)`), decoded
  by decode-analyzer.js. Semantic bit ignored (always runs). 0 on failure.
- `generate(ptr, len, flags, opts: u32) usize` -> `[u32 total][payload]` where
  payload = `[u32 code_len][code UTF-8][u32 error_count]{[u32 start][u32 end]
  [u32 msg_len][msg UTF-8]}*`. It parses with the same flags as `parse` (no
  semantic pass) and calls `parser.codegen.print/strip/minify(gpa, &tree,
  options)` where opts: bit 0 strip -> `strip`, bit 1 minify -> `minify`, else
  `print`; bit 2 compact -> `.format = .compact`; bits 3-4 quotes
  (0 preserve, 1 double, 2 single; 3 treated as preserve because the dialect
  Quotes enum has no `shortest`); bits 5-7 comments (none/all/some/line/block,
  clamp to 4); bits 8-15 indent. `source_maps` stays null. 0 on failure.
- Memory grows; the host must re-view `memory.buffer` after every call and
  `free` both the source buffer and the result buffer.

## 3. build.zig additions

- Add near the existing production block: `const wasm_target =
  b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding,
  .cpu_features_add = std.Target.wasm.featureSet(&.{ .bulk_memory,
  .nontrapping_fptoint, .sign_ext, .simd128 }) });` and `const wasm_step =
  b.step("wasm", "Build the yuku-tsrx dialect for the browser
  (zig-out/wasm/yuku-tsrx.wasm)");`.
- Build a second production module graph for `wasm_target` (dialect_abi,
  schema, parser_extension, cloneModule(yuku parser) with parser_extension, the
  src/dialect/root.zig parser module with yuku/parser_extension/dialect_abi/
  util/codegen_options imports, base transfer, dialect transfer), all with
  `.target = wasm_target, .optimize = .ReleaseSmall`. Recommended: extract the
  existing block into `fn addProductionGraph(b, yuku, target, optimize) struct
  { parser: *std.Build.Module, transfer: *std.Build.Module, dialect_abi, ... }`
  and call it twice; if the Worker prefers a duplicated block to keep the
  native graph byte-identical, that is acceptable. Do not change how the
  napi lib, generators, sentinel graph, or fixture steps are wired.
- `const wasm_module = b.createModule(.{ .root_source_file =
  b.path("src/ffi/wasm.zig"), .target = wasm_target, .optimize =
  .ReleaseSmall, .strip = true }); wasm_module.addImport("parser", wasm.parser);
  wasm_module.addImport("transfer", wasm.transfer); const wasm_exe =
  b.addExecutable(.{ .name = "yuku-tsrx", .root_module = wasm_module });
  wasm_exe.entry = .disabled; wasm_exe.rdynamic = true;
  wasm_step.dependOn(&b.addInstallArtifact(wasm_exe, .{ .dest_dir = .{
  .override = .{ .custom = "wasm" } } }).step);` -> zig-out/wasm/yuku-tsrx.wasm.
- Command: `zig build wasm -Doptimize=ReleaseSmall`. `zig-out/` is already
  gitignored (.gitignore line 5).
- Decision on who runs it: docs/build.mjs must NOT invoke zig. Add
  package.json scripts `docs:wasm` = `zig build wasm -Doptimize=ReleaseSmall`
  and `docs:wasm-smoke` = `node tools/wasm-smoke.mjs`. docs/build.mjs reads
  `path.join(repoRoot, 'zig-out', 'wasm', 'yuku-tsrx.wasm')` (env override
  `YUKU_TSRX_WASM`), throws with the message "run pnpm docs:wasm first" when it
  is missing, and copies it plus `npm/yuku-tsrx/decode.js` and
  `decode-analyzer.js` into `<siteDir>/assets/wasm/`. Nothing binary is
  committed; the wasm and decoders are always built from the same tree, so the
  wire format cannot drift (decode.js is regenerated by the existing
  gen-parser-decoder step and checked by tools/m3-generated.ts).

## 4. Browser host: docs/assets/yuku-wasm.js (new, ~90 lines)

Mirrors npm/yuku-parser-wasm/index.js: `const wasmUrl = new URL(
'./wasm/yuku-tsrx.wasm', import.meta.url)`; `instantiateStreaming(fetch)` with
arrayBuffer fallback (Vercel serves .wasm as application/wasm; docs/serve.mjs
needs `'.wasm': 'application/wasm'` added to its `types` table, line 25-38);
lazy singleton `ready()` promise so the home page pays nothing until the
reader touches the editor (import on first focus/pointer, or immediately on
/playground). Exports:

- `parse(source, opts) -> { program, comments, diagnostics, nodeCount, ms }`
  using `import { decode } from './wasm/decode.js'` on
  `memory.buffer.slice(ptr+4, ptr+4+len)`; nodeCount is header u32[0]
  (Header.node_count, transfer.zig line 121); ms via performance.now().
- `analyze(source, opts) -> decodeAnalyzer(buffer, source)` (`semantic`
  getter yields scope/symbol/reference/import/export tables,
  decode-analyzer.js lines 1288-1370, plus `SymbolFlags`).
- `generate(source, opts) -> { code, errors: [{start,end,message}], ms }`
  reading the payload layout above.
- `packFlags({sourceType, lang, preserveParens, semanticErrors,
  attachComments, loose})` and `packGenerateOptions({strip, minify, format,
  quotes, comments, indent})` per section 2.
Errors: pointer 0 -> throw `Error('yuku-tsrx wasm: parse failed')`; the UI
shows it in the status line and Diagnostics tab.

## 5. UI surfaces (oxc-tsrx shape, same CSS classes; no threads, no COOP/COEP)

Keep the CSS classes the port kept: `.code-panel*`, `.demo-input`,
`.demo-diags/.demo-diag`, `.demo-button`, `.demo-tooltip`, `.code-panel-hint`,
`.code-panel-actions` (home+playground region, style.css 1730-1934),
`.pg`, `.pg-topbar`, `.pg-panes`, `.pg-panel`, `.pg-output`, `.pg-output-tabs`,
`.pg-output-body`, `.pg-output-code`, `.pg-plain`, `.pg-note`,
`.pg-structure-table` (playground region 2142-2448), `.pg-examples-bar`
(3598-3650, home+playground), `.try-button` (doc region, 1096-1116). To reuse
`.pg-output*` on the home page, change the region opener at style.css line 2142
from `/* #css-pages: playground */` to `/* #css-pages: home playground */`
(one line; splitStylesheet validates it) or move just the `.pg-output*`,
`.pg-plain`, `.pg-note`, `.pg-structure-table` rules into a `home playground`
region. No new colours; the gold tokens already apply.

(a) Home hero (docs/build.mjs renderHomePage, lines 794-806): keep
`#hero-demo` panel; add `<span class="code-panel-hint" id="demo-hint">` and
`<span class="code-panel-actions" id="demo-actions" hidden>` with buttons
`#demo-reset` (Reset) and `#demo-open` (Open in playground, carries the
current text as `#code=`). Status line `#demo-status` (aria-live) shows
"parsed in 0.4 ms · 62 nodes · 0 diagnostics · runs in your browser" after
each keystroke (debounced ~60 ms), and `#demo-meta` shows the lang/sourceType.
Below the panel inside the same `.band`, an output panel `<div class="code-panel
pg-output" id="pg-output" data-explorer>` with the tablist AST | Diagnostics |
Generated code | Semantic (ids `pg-tab-ast/diagnostics/generated/semantic`,
panels `pg-panel-*`, targets `#pg-ast`, `#pg-diagnostics`, `#pg-generated`,
`#pg-semantic`). app.js already contains the delegated `[data-explorer]
[role="tab"]` click and ArrowLeft/Right handlers (docs/assets/app.js lines
724-736, 799-810), so tabs need no new JS. Until wasm is ready the editor stays
the static highlighted `<pre>` and the status reads "loading the in-browser
parser..." for at most the fetch time; if instantiation fails, status says
"in-browser parser unavailable" and the panel stays read-only (never a fake
result).

(b) /playground page (new `renderPlaygroundPage()` in docs/build.mjs, written
to `<siteDir>/playground.html`, `shell: 'playground'`, `bodyClass:
'home-page'`, main class `home playground-page`, exactly the oxc-tsrx markup
shape at oxc build.mjs lines 2288-2340 minus lint/format wording): `.pg-topbar`
with title "TSRX Playground" and tagline "Real yuku-tsrx, compiled to
WebAssembly, running in this tab: parse, analyze, generate."; an examples bar
`.pg-toolbar.pg-examples-bar#pg-side` with `.demo-button` scenario buttons
loading the fixtures verbatim from test/parser/misc/tsrx/: code-block,
control-flow-for, control-flow-if, control-flow-switch, dynamic-tag,
style-element, and control-flow-switch-invalid labelled "Invalid switch"
(the invalid one shows real error diagnostics); a `#pg-scenario-note` line;
`.pg-panes` with the editor `.code-panel.pg-panel#hero-demo` (file label
`playground.tsrx`, actions Share | Reset) and the output panel with the same
four tabs; `.code-panel-status` `#pg-output-status`. Fixture sources are
inlined at build time by build.mjs reading the files (so the page has no
extra fetch); build.mjs fails if a fixture is missing. Share: `#code=<base64url>`
plus `lang=` and `src=` (sourceType) params, copied to clipboard, read back on
load (readShareHash). Add `{ text: 'Playground', link: '/playground' }` to
`config.nav` before GitHub in docs/site.config.mjs; add '/playground' to
sitemap publicPaths.

Tab contents:
- AST: `JSON.stringify(program, replacer, 2)` where the replacer skips nothing
  but the output is truncated at ~200 KB with a "truncated" `.pg-note`; rendered
  in `<pre class="pg-plain">`. Header note: node type names include
  JSXCodeBlock, TSRXExpression, JSXStyleElement (from decode.js DIALECT_RECORDS).
- Diagnostics: list of `severity  message  (start:end)` from `parse` with the
  semantic flag on; empty state "0 diagnostics"; the same diagnostics draw
  underlines in the editor via `.demo-diags` markers keyed by
  byteToCharIndex(start/end) and a hover `.demo-tooltip` with the message.
- Generated code: `generate(source)` pretty output in `<pre class="pg-plain">`
  (quickTokens colouring is fine); codegen errors listed above it with
  `.pg-output-error`. Optional small `<select>` for print | strip | minify.
- Semantic: from `analyze(source)`: summary line "N scopes · N symbols · N
  references · N imports · N exports", then a `.pg-structure-table` of symbols
  (name, flags decoded with SymbolFlags, scope kind, declarations, reference
  count) and, if any, an imports/exports table.
Timing: `parse` runs on every input (debounced 60 ms); `analyze` and
`generate` run when their tab is visible or after 250 ms idle, whichever first.

(c) Try in playground: in docs/build.mjs `createMarked` code renderer (line
319-325) add the oxc button verbatim for `language === 'tsrx' &&
!flags.includes('no-playground')`: `<button type="button" class="try-button"
data-code="${escapeHtml(text)}">Try in playground</button>` appended inside
`.code-block`. In docs/assets/app.js add the oxc `playgroundHref`,
`toBase64Url` and the `.try-button` click branch (oxc app.js lines 731-746)
inside the existing delegated click handler. Every `tsrx` fence that keeps the
button must parse with zero error-severity diagnostics under the wasm (verify
script); fences that show fragments or deliberately invalid code get
```tsrx no-playground.

(d) Engine module docs/assets/yuku-playground.js (new; rewrite, not port):
export `initDemo(panel)`; app.js `initPage()` imports it when `#hero-demo`
exists and is not `data-ready` (oxc app.js lines 698-704), and registers a
cleanup that clears timers on SPA navigation. Reuse from oxc
docs/assets/playground.js, copied close to verbatim: `escapeHtml`,
`byteToCharIndex`, `b64uEncode/b64uDecode/readShareHash` (code + lang only),
the overlay editor construction and metrics (lines 215-300: preStyle
measurements, textarea `.demo-input`, `.demo-diags` layer, syncSize with
fillMode for `.pg-panes`, scroll sync), `quickTokens`/`syncMirror`/`adoptMirror`
(lines 307-365), `renderDiagnostics` (adapted to `{start,end}` byte offsets),
`setStatus`, keyboard handling for Tab/Escape/auto-close brackets (961-1060),
the mousemove tooltip (1167-1211), the scenario button loop, and share
(699-716). Drop: api()/fetch/capabilities, lint/format/projection panes,
Shiki rehighlight, completions/quickinfo, type-aware, filters, config, fuel.
Target size 500-700 lines. Highlighting in the browser is the quickTokens
regex colouring only (no Shiki bundle, no rolldown).

## 6. Packages (ordered; each bounded, verified, reversible)

### T014 Worker: wasm build + Node smoke test
objective: Add `src/ffi/wasm.zig` (ABI in section 2) and a `wasm` step in
build.zig (section 3) producing zig-out/wasm/yuku-tsrx.wasm; add package.json
scripts `docs:wasm` and `docs:wasm-smoke`; add tools/wasm-smoke.mjs that
instantiates the wasm in Node (readFile + WebAssembly.instantiate), imports
`decode` from npm/yuku-tsrx/decode.js and `decode` from
npm/yuku-tsrx/decode-analyzer.js, and asserts: exports include memory, alloc,
free, parse, analyze, generate; parsing `heroCode` from docs/demo-sources.mjs
with lang tsx, module, semantic on returns program.type === 'Program', node
count > 0, and zero error-severity diagnostics; analyze returns semantic with
symbol.count > 0; generate returns non-empty code containing `Cart` with zero
errors; test/parser/misc/tsrx/control-flow-switch-invalid.module.tsrx returns
at least one error-severity diagnostic without throwing; every fixture in
test/parser/misc/tsrx/*.module.tsrx round-trips through parse and generate
without a 0 pointer; prints wasm size, parse ms, node count. `--fences` mode
(used by T015) extracts ```tsrx fences without `no-playground` from docs
guide/architecture/reference *.md and requires zero error-severity
diagnostics on each.
allowed_files: build.zig, src/ffi/wasm.zig, tools/wasm-smoke.mjs,
package.json, zig-out (build output only).
verify:
- `zig build wasm -Doptimize=ReleaseSmall && test -f zig-out/wasm/yuku-tsrx.wasm`
- `node tools/wasm-smoke.mjs` (exit 0)
- `test $(wc -c < zig-out/wasm/yuku-tsrx.wasm) -lt 4194304`
- `zig build && zig build test` (native graph still green)
- `git status --porcelain -- src/dialect npm/yuku-tsrx` prints nothing
stop_if: the wasm graph fails to compile for a reason inside src/dialect or
../yuku-minimal-seam that is not a one-line behaviour-neutral cast (report the
exact error, file:line, and proposed diff; do not patch); the wasm exceeds
4 MB; the Cart snippet yields any error-severity diagnostic (report, do not
edit demo-sources.mjs); anything requires touching npm/yuku-tsrx generated
files, src/dialect/transfer.zig, or the yuku checkout; `zig build test` fails
after the change.

### T015 Worker: browser host + playground page + hero editor + try buttons
objective: Implement sections 4 and 5: docs/assets/yuku-wasm.js,
docs/assets/yuku-playground.js, hero editor and output tabs on the home page,
renderPlaygroundPage with fixture scenarios and share hash, Try in playground
buttons and app.js click handler, wasm/decoder copy step in docs/build.mjs
(reads zig-out/wasm/yuku-tsrx.wasm, throws if missing), Playground nav item,
'/playground' in sitemap, `.wasm` MIME in docs/serve.mjs, style.css region
tweak for `.pg-output` on the home shell, `no-playground` flags on tsrx fences
that are fragments or deliberately invalid, and docs/verify-playground.mjs
(playwright-core + the Chrome executable already used by
docs/generate-social-card.mjs) that serves docs/dist, loads /yuku-tsrx/ and
/yuku-tsrx/playground, waits for `#demo-status` to contain " ms", types into
`#demo-input`, asserts the status changes, clicks each of the four tabs and
asserts each panel is non-empty, loads `#code=` from a try button, and fails
on any console error or pageerror.
allowed_files: docs/build.mjs, docs/assets/yuku-wasm.js,
docs/assets/yuku-playground.js, docs/assets/app.js, docs/assets/style.css,
docs/site.config.mjs, docs/serve.mjs, docs/verify-playground.mjs,
docs/guide/*.md, docs/architecture/*.md, docs/reference/*.md (only to add
`no-playground` to fences), package.json (script docs:verify-playground),
docs/dist (build output).
verify:
- `pnpm run docs:wasm && node tools/wasm-smoke.mjs --fences`
- `pnpm run docs:build` (exit 0) and `test -f docs/dist/yuku-tsrx/playground.html && test -f docs/dist/yuku-tsrx/assets/wasm/yuku-tsrx.wasm && test -f docs/dist/yuku-tsrx/assets/wasm/decode.js && test -f docs/dist/yuku-tsrx/assets/wasm/decode-analyzer.js`
- `grep -c 'role="tab"' docs/dist/yuku-tsrx/playground.html` >= 4 and `grep -q 'id="pg-tab-semantic"' docs/dist/yuku-tsrx/index.html`
- `grep -c 'class="try-button"' docs/dist/yuku-tsrx/guide/tsrx-syntax.html` >= 1
- `grep -q '/playground' docs/dist/yuku-tsrx/sitemap.xml && grep -q 'Playground' docs/dist/yuku-tsrx/index.html`
- `node docs/verify-playground.mjs` (exit 0, no console errors)
- `! grep -rniE 'lint|format' docs/dist/yuku-tsrx/playground.html` (no lint/format claims)
stop_if: the wasm fails to instantiate in Chrome (report the error); output
tabs would need pre-computed or faked results; a Try button would need a
fence that does not parse clean (add `no-playground` instead); style.css
changes beyond the region opener or moving existing `.pg-*` rules; any change
under src/, npm/, build.zig; app.js SPA navigation into/out of /playground
throws.

### T016 Worker: redeploy and prove the live surfaces
objective: Rebuild (docs:wasm, docs:build), redeploy docs/dist to production
with the T007 commands, and prove: HTTP 200 for /yuku-tsrx/playground and
/yuku-tsrx/assets/wasm/yuku-tsrx.wasm with content-type application/wasm;
`node docs/verify-playground.mjs --url <production origin>` passes against the
live site (script accepts a base URL); screenshot of the live playground with
the Diagnostics tab open on the invalid fixture and of the home hero after an
edit; record deployment id and URL in notes/T016-deploy.md.
allowed_files: docs/verify-playground.mjs (URL flag only),
docs/goals/yuku-tsrx-docs-site/notes/T016-deploy.md, docs/dist.
verify: `curl -sI <origin>/yuku-tsrx/playground | head -1` shows 200;
`curl -sI <origin>/yuku-tsrx/assets/wasm/yuku-tsrx.wasm | grep -i content-type`
shows application/wasm; `node docs/verify-playground.mjs --url <origin>` exit 0.
stop_if: Vercel rejects the deploy; the live wasm 404s or serves as
text/plain; live verify reports console errors.
Ordering note: T013 (compiled.run origin switch) also edits
docs/site.config.mjs and README.md; run T015 and T013 sequentially, never in
parallel.

### T017 Judge: audit of the interactive surfaces
objective: On the production URL, confirm the hero editor is editable and its
status line changes with input; the four tabs show real outputs from the wasm
(AST JSON with a TSRX node type, diagnostics on the invalid fixture,
generated code, semantic table); the fixture buttons load the committed
fixture text; a Try in playground button from a guide page lands on
/playground with the fence loaded; no page claims linting or formatting; no
COOP/COEP headers; wasm size and load time recorded; and that
docs/verify-playground.mjs is what proved it. Decide whether the tranche is
complete or what T018 must fix.

## 7. Fallback if wasm is blocked (Q5)

Degraded option: keep the editable overlay editor but only replay
pre-computed outputs for the seven fixture scenarios (JSON generated at build
time by the native addon via npm/yuku-tsrx), with the status line reading
"pre-generated example · edits are not parsed". It is honest only with that
label and it is not what the owner asked for ("interactive code blocks ...
keep it interesting" implies live results). Judgment: do not ship it as the
tranche outcome. Use it only as a temporary bridge if T014 stops on a real
blocker, and record the blocker for an owner decision. Given the evidence in
section 1 (same parser already ships as wasm; no OS surface in src/dialect),
the expected path is the real thing.
