const std = @import("std");
const dialect = @import("dialect");
const parser = @import("parser");
const transfer = @import("transfer");
const production_contract = @import("production_contract");

comptime {
    if (production_contract.forbidden_parser_import) {
        @compileError("no module named 'parser' available within module 'dialect'");
    }
    if (production_contract.second_parser_declaration) {
        @compileError("external dialect contract forbids a second parser declaration");
    }
}

test "external dialect remains independent of parser types" {
    // compile the external module and drive one statically selected parser hook
    var tree = try parser.parse(
        std.testing.allocator,
        "export const sentinel = 1;",
        .{ .lang = .js },
    );
    defer tree.deinit();

    try std.testing.expect(dialect.enabled);
    try std.testing.expectEqual(@typeInfo(parser.dialect_schema.Record).@"union".fields.len, dialect.schema.record_count);
    try std.testing.expectEqual(@typeInfo(dialect.Hook).@"enum".fields.len, dialect.hooks.len);
    try std.testing.expect(!tree.hasErrors());
}

test "unhandled corpus matches the disabled parser" {
    dialect.resetHooks();
    const digest = try corpusDigest();
    std.debug.print("unhandled corpus sha256={x}\n", .{digest});
}

test "sentinel requires transformed string storage" {
    dialect.resetHooks();
    dialect.capability_mode = .transformed_text;
    var tree = try parser.parse(
        std.testing.allocator,
        "const x = <A>&quot;A&#x42;&#66;&amp;&lt;&gt;&apos;&unknown;</A>;",
        .{ .lang = .tsx },
    );
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    try std.testing.expectEqualStrings("\"ABB&<>'&unknown;", firstJsxText(&tree));
}

test "loose JSX recovers only an ancestor close transactionally" {
    // leave the ancestor close for the parent while retaining child text and comments
    const source = "const x = <div>{/* kept */}<span>text</div>;";
    var strict = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer strict.deinit();
    try std.testing.expect(strict.hasErrors());

    var loose = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx, .loose = true });
    defer loose.deinit();
    try std.testing.expect(!loose.hasErrors());
    try std.testing.expectEqual(@as(usize, 1), loose.tree.comments.len);
    try std.testing.expectEqual(@as(usize, 0), loose.dialect_store.records.items.len);
    try std.testing.expectEqual(@as(usize, 0), loose.dialect_store.associations.items.len);
    try std.testing.expectEqual(@as(usize, 0), loose.dialect_store.overlays.items.len);

    const child_start: u32 = @intCast(std.mem.indexOf(u8, source, "<span>").?);
    const ancestor_close: u32 = @intCast(std.mem.indexOf(u8, source, "</div>").?);
    const child = findNodeWithSpan(&loose, .jsx_element, child_start, ancestor_close) orelse
        return error.MissingRecoveredChild;
    try std.testing.expectEqual(parser.ast.NodeIndex.null, loose.data(child).jsx_element.closing_element);

    var closing_count: u32 = 0;
    var closing_start: u32 = 0;
    for (loose.tree.nodes.items(.data), loose.tree.nodes.items(.span)) |data, span| switch (data) {
        .jsx_closing_element => {
            closing_count += 1;
            closing_start = span.start;
        },
        else => {},
    };
    try std.testing.expectEqual(@as(u32, 1), closing_count);
    try std.testing.expectEqual(ancestor_close, closing_start);

    var unrelated = try parser.parse(
        std.testing.allocator,
        "const x = <div><span></aside></div>;",
        .{ .lang = .tsx, .loose = true },
    );
    defer unrelated.deinit();
    try std.testing.expect(unrelated.hasErrors());

    var eof = try parser.parse(
        std.testing.allocator,
        "const x = <div><span>text",
        .{ .lang = .tsx, .loose = true },
    );
    defer eof.deinit();
    try std.testing.expect(eof.hasErrors());
}

test "sentinel splits code block render and creates dialect nodes" {
    for ([_][]const u8{
        "const x = @{ const value = 1; <A /> };",
        "function C() @{ const value = 1; <A /> }",
    }) |source| {
        dialect.resetHooks();
        dialect.capability_mode = .block_split;
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());
        try std.testing.expectEqual(@as(u32, 1), dialect.capability_body_len);
        try std.testing.expect(dialect.capability_render != std.math.maxInt(u32));
        const node = findDialectNode(&tree) orelse return error.MissingCapabilityDialectNode;
        const record = tree.dialect_store.records.items[tree.dialectRecord(@intFromEnum(node)).?].node;
        try std.testing.expectEqual(dialect.capability_render, record.value.raw);
    }
}

test "reflected dialect node references are traversed" {
    // The sentinel record points at a JSX subtree whose identifier must resolve.
    dialect.resetHooks();
    dialect.capability_mode = .block_split;
    var tree = try parser.parse(
        std.testing.allocator,
        "const outer = 1; const view = @{ outer };",
        .{ .lang = .tsx },
    );
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    const semantic = try parser.semantic.analyze(&tree);
    var resolved: u32 = 0;
    for (semantic.references) |reference| {
        if (reference.symbol != .none) resolved += 1;
    }
    try std.testing.expectEqual(@as(u32, 1), resolved);
}

test "sentinel splits a JSX-child code block and resumes the element" {
    const source = "<A>{@{ const value = 1; value }}</A>";
    dialect.resetHooks();
    dialect.capability_mode = .block_split;
    dialect.marker_boundary = true;
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();

    try std.testing.expect(!tree.hasErrors());
    try std.testing.expectEqual(@as(u32, 1), dialect.capability_split_count);
    try std.testing.expectEqual(@as(u32, 1), dialect.capability_body_len);
    const block = findDialectNode(&tree) orelse return error.MissingCapabilityDialectNode;
    const close = std.mem.lastIndexOfScalar(u8, source, '}').? + 1;
    try std.testing.expectEqual(@as(u32, @intCast(std.mem.indexOfScalar(u8, source, '@').?)), tree.span(block).start);
    try std.testing.expectEqual(@as(u32, @intCast(close - 1)), tree.span(block).end);
    const record = tree.dialect_store.records.items[tree.dialectRecord(@intFromEnum(block)).?].node;
    try std.testing.expectEqual(dialect.capability_render, record.value.raw);
    try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(@enumFromInt(record.value.raw))));
    const outer = findNodeWithSpan(&tree, .jsx_element, 0, @intCast(source.len)) orelse
        return error.MissingContinuedOuterElement;
    try std.testing.expectEqual(@as(u32, @intCast(source.len)), tree.span(outer).end);
}

test "sentinel splits nested statement code blocks and resumes both blocks" {
    const source = "@{ const outer = 1; @{ const inner = outer; <B /> } }";
    dialect.resetHooks();
    dialect.capability_mode = .block_split;
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();

    try std.testing.expect(!tree.hasErrors());
    try std.testing.expectEqual(@as(u32, 2), dialect.capability_split_count);
    try std.testing.expectEqual(@as(u32, 1), dialect.capability_body_len);
    const inner_start = std.mem.indexOfPos(u8, source, 1, "@{").?;
    const inner_end = std.mem.indexOfPos(u8, source, inner_start, " } }").? + 2;
    const inner = findDialectNodeWithSpan(&tree, @intCast(inner_start), @intCast(inner_end)) orelse
        return error.MissingInnerCapabilityDialectNode;
    const outer = findDialectNodeWithSpan(&tree, 0, @intCast(source.len)) orelse
        return error.MissingOuterCapabilityDialectNode;
    const inner_record = tree.dialect_store.records.items[tree.dialectRecord(@intFromEnum(inner)).?].node;
    const outer_record = tree.dialect_store.records.items[tree.dialectRecord(@intFromEnum(outer)).?].node;
    try std.testing.expectEqual(.jsx_element, std.meta.activeTag(tree.data(@enumFromInt(inner_record.value.raw))));
    try std.testing.expectEqual(@intFromEnum(inner), outer_record.value.raw);
    try std.testing.expectEqual(@as(u32, @intCast(source.len)), tree.span(outer).end);
}

test "sentinel resumes after raw spans and diagnoses unclosed input" {
    const sources = [_][]const u8{
        "const x = <raw>.a { color:red } /* <A/> */ @media {}</raw>; const after = 1;",
        "const x = <A><raw>.a { color:red } /* <B/> */ @media {}</raw><B /></A>;",
    };
    for (sources) |source| {
        dialect.resetHooks();
        dialect.capability_mode = .raw_resume;
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());
        try std.testing.expectEqual(@as(u32, 1), dialect.capability_raw_children);
        try std.testing.expect(findDialectNode(&tree) != null);
    }
    dialect.resetHooks();
    dialect.capability_mode = .raw_resume;
    var unclosed = try parser.parse(std.testing.allocator, "const x = <raw>body;", .{ .lang = .tsx });
    defer unclosed.deinit();
    try std.testing.expect(unclosed.hasErrors());
    try std.testing.expectEqualStrings("Unclosed sentinel raw element", unclosed.diagnostics.items[0].message);
    try std.testing.expectEqualStrings("Add a matching '</raw>' closing tag", unclosed.diagnostics.items[0].help.?);
}

test "every site-specific hook executes handled and unhandled control flow" {
    const Signature = struct {
        nodes: usize,
        extras: usize,
        diagnostics: usize,
        overlays: usize,

        fn of(tree: anytype) @This() {
            return .{
                .nodes = tree.nodes.len,
                .extras = tree.extras.items.len,
                .diagnostics = tree.diagnostics.items.len,
                .overlays = tree.dialect_store.overlays.items.len,
            };
        }
    };
    const Case = struct {
        hook: dialect.Hook,
        source: []const u8,
        lang: parser.ast.Lang,
    };
    const cases = [_]Case{
        .{ .hook = .statement_at_code_block, .source = "@dec class C {}", .lang = .ts },
        .{ .hook = .statement_at_control_flow, .source = "@dec class C {}", .lang = .ts },
        .{ .hook = .expression_at_code_block, .source = "const x = @{ value; };", .lang = .js },
        .{ .hook = .expression_at_control_flow, .source = "const x = @if (flag) value;", .lang = .js },
        .{ .hook = .lazy_assignment_pattern, .source = "&[value] = source;", .lang = .js },
        .{ .hook = .function_body_starts, .source = "function f() {}", .lang = .js },
        .{ .hook = .function_body, .source = "function f() {}", .lang = .js },
        .{ .hook = .for_of_tail, .source = "for (value of values: index, key) {}", .lang = .js },
        .{ .hook = .binding_pattern, .source = "function f(&[value]) {}", .lang = .js },
        .{ .hook = .module_specifier, .source = "import value from package;", .lang = .js },
        .{ .hook = .can_start_binding, .source = "declare const value: number;", .lang = .ts },
        .{ .hook = .jsx_element_after_open, .source = "const x = <A>text</A>;", .lang = .tsx },
        .{ .hook = .jsx_names_match, .source = "const x = <A></B>;", .lang = .tsx },
        .{ .hook = .jsx_text_boundary, .source = "const x = <A>left@right</A>;", .lang = .tsx },
        .{ .hook = .jsx_text_value, .source = "const x = <A>text</A>;", .lang = .tsx },
        .{ .hook = .jsx_child_at_code_block, .source = "const x = <A>{@{value}}</A>;", .lang = .tsx },
        .{ .hook = .jsx_child_at_control_flow, .source = "const x = <A>{@{value}}</A>;", .lang = .tsx },
        .{ .hook = .jsx_element_name, .source = "const x = <{value}></{value}>;", .lang = .tsx },
        .{ .hook = .validate_jsx_element_name, .source = "const x = <A />;", .lang = .tsx },
    };

    for (cases) |case| {
        dialect.resetHooks();
        if (case.hook == .jsx_child_at_code_block or case.hook == .jsx_child_at_control_flow)
            dialect.marker_boundary = true;
        var unhandled_tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = case.lang });
        defer unhandled_tree.deinit();
        const unhandled = Signature.of(&unhandled_tree);

        dialect.resetHooks();
        dialect.selected_hook = case.hook;
        dialect.select_handled = true;
        if (case.hook == .jsx_child_at_code_block or case.hook == .jsx_child_at_control_flow)
            dialect.marker_boundary = true;
        var handled_tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = case.lang });
        defer handled_tree.deinit();
        const handled = Signature.of(&handled_tree);

        if (case.hook == .jsx_text_value) {
            try std.testing.expectEqualStrings("text", firstJsxText(&unhandled_tree));
            try std.testing.expectEqualStrings("", firstJsxText(&handled_tree));
        } else if (case.hook == .for_of_tail) {
            const host = findNode(&handled_tree, .for_of_statement) orelse return error.MissingForOfHost;
            try std.testing.expectEqual(@as(?u32, 0), handled_tree.dialectOverlay(@intFromEnum(host)));
            try std.testing.expectEqual(@as(usize, 0), unhandled.overlays);
            const record = handled_tree.dialect_store.records.items[0].for_of;
            try std.testing.expectEqual(@intFromEnum(host), record.host_node.raw);
            try std.testing.expect(record.index.raw != record.key.raw);
            const data = handled_tree.data(host).for_of_statement;
            try std.testing.expect(record.index.raw != @intFromEnum(data.left));
            try std.testing.expect(record.key.raw != @intFromEnum(data.right));
        } else {
            if (std.meta.eql(unhandled, handled)) {
                std.debug.print("missing distinct handled effect for {s}\n", .{@tagName(case.hook)});
                return error.MissingHandledEffect;
            }
        }

        switch (case.hook) {
            .statement_at_code_block, .statement_at_control_flow => {
                try std.testing.expect(findNode(&handled_tree, .expression_statement) != null);
            },
            .expression_at_code_block => {
                const node = findNode(&handled_tree, .block_statement) orelse
                    return error.MissingParsedBlock;
                try std.testing.expect(handled_tree.dialectOverlay(@intFromEnum(node)) != null);
            },
            .expression_at_control_flow => {
                const node = findNode(&handled_tree, .if_statement) orelse
                    return error.MissingParsedControlFlow;
                try std.testing.expect(handled_tree.dialectOverlay(@intFromEnum(node)) != null);
            },
            .lazy_assignment_pattern => {
                const node = findNode(&handled_tree, .array_pattern) orelse
                    return error.MissingLazyArrayPattern;
                try std.testing.expectEqual(@as(u32, 0), handled_tree.span(node).start);
                const overlay = handled_tree.dialectOverlay(@intFromEnum(node)) orelse
                    return error.MissingLazyArrayOverlay;
                const record = handled_tree.dialect_store.records.items[overlay].array_pattern;
                try std.testing.expectEqual(@intFromEnum(node), record.host_node.raw);
                try std.testing.expect(record.lazy);
            },
            .function_body => {
                const node = findNode(&handled_tree, .function_body) orelse
                    return error.MissingParsedBody;
                try std.testing.expect(handled_tree.dialectOverlay(@intFromEnum(node)) != null);
            },
            .binding_pattern => {
                const node = findNode(&handled_tree, .array_pattern) orelse
                    return error.MissingParsedPattern;
                try std.testing.expect(handled_tree.dialectOverlay(@intFromEnum(node)) != null);
            },
            .for_of_tail, .module_specifier, .jsx_names_match => {
                try std.testing.expect(unhandled_tree.hasErrors());
                try std.testing.expect(!handled_tree.hasErrors());
            },
            .jsx_element_after_open => {
                const node = findNode(&handled_tree, .jsx_element) orelse
                    return error.MissingFinishedElement;
                const opening = handled_tree.data(node).jsx_element.opening_element;
                try std.testing.expect(handled_tree.dialectOverlay(@intFromEnum(opening)) != null);
            },
            .validate_jsx_element_name => {
                try std.testing.expect(!unhandled_tree.hasErrors());
                try std.testing.expect(handled_tree.hasErrors());
            },
            .jsx_child_at_code_block, .jsx_child_at_control_flow => {
                const child = findNode(&handled_tree, .jsx_expression_container) orelse
                    return error.MissingMarkerChild;
                const span = handled_tree.span(child);
                try std.testing.expectEqual(@as(u32, 15), span.start);
                try std.testing.expectEqual(@as(u32, 22), span.end);
                const expression = handled_tree.data(child).jsx_expression_container.expression;
                try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(handled_tree.data(expression)));
            },
            .jsx_element_name => {
                var names: usize = 0;
                for (handled_tree.nodes.items(.data), 0..) |data, index| {
                    if (data != .jsx_expression_container) continue;
                    const node: parser.ast.NodeIndex = @enumFromInt(index);
                    const expression = data.jsx_expression_container.expression;
                    try std.testing.expectEqual(
                        .identifier_reference,
                        std.meta.activeTag(handled_tree.data(expression)),
                    );
                    const overlay = handled_tree.dialectOverlay(@intFromEnum(node)) orelse
                        return error.MissingDynamicNameOverlay;
                    const record = handled_tree.dialect_store.records.items[overlay].node;
                    try std.testing.expectEqual(@intFromEnum(node), record.value.raw);
                    try std.testing.expect(record.active);
                    names += 1;
                }
                try std.testing.expectEqual(@as(usize, 2), names);
                try std.testing.expect(!handled_tree.hasErrors());
            },
            else => {},
        }
    }

    dialect.resetHooks();
    dialect.selected_hook = .lazy_assignment_pattern;
    dialect.select_handled = true;
    var lazy_object = try parser.parse(
        std.testing.allocator,
        "&{value} = source;",
        .{ .lang = .js },
    );
    defer lazy_object.deinit();
    const object = findNode(&lazy_object, .object_pattern) orelse
        return error.MissingLazyObjectPattern;
    try std.testing.expectEqual(@as(u32, 0), lazy_object.span(object).start);
    const object_overlay = lazy_object.dialectOverlay(@intFromEnum(object)) orelse
        return error.MissingLazyObjectOverlay;
    const object_record = lazy_object.dialect_store.records.items[object_overlay].object_pattern;
    try std.testing.expectEqual(@intFromEnum(object), object_record.host_node.raw);
    try std.testing.expect(object_record.lazy);
    try std.testing.expect(!lazy_object.hasErrors());

    // Selecting either marker hook cannot perturb ordinary JSX expression containers.
    dialect.resetHooks();
    var ordinary = try parser.parse(std.testing.allocator, "const x = <A>{value}</A>;", .{ .lang = .tsx });
    defer ordinary.deinit();
    const ordinary_signature = Signature.of(&ordinary);
    for ([_]dialect.Hook{ .jsx_child_at_code_block, .jsx_child_at_control_flow }) |hook| {
        dialect.resetHooks();
        dialect.selected_hook = hook;
        dialect.select_handled = true;
        dialect.marker_boundary = true;
        var selected = try parser.parse(std.testing.allocator, "const x = <A>{value}</A>;", .{ .lang = .tsx });
        defer selected.deinit();
        try std.testing.expectEqualDeep(ordinary_signature, Signature.of(&selected));
    }

    dialect.resetHooks();
    dialect.selected_hook = .module_specifier;
    dialect.select_handled = true;
    var malformed = try parser.parse(std.testing.allocator, "import value from ;", .{ .lang = .js });
    defer malformed.deinit();
    try std.testing.expect(malformed.hasErrors());

    dialect.resetHooks();
    dialect.selected_hook = .for_of_tail;
    dialect.select_handled = true;
    var malformed_tail = try parser.parse(
        std.testing.allocator,
        "for (value of values: index) {}",
        .{ .lang = .js },
    );
    defer malformed_tail.deinit();
    try std.testing.expect(malformed_tail.hasErrors());
}

test "binding start routing admits lazy let patterns without broadening let ambiguity" {
    dialect.resetHooks();
    dialect.selected_hook = .binding_pattern;
    dialect.select_handled = true;
    var lazy = try parser.parse(std.testing.allocator, "let &[value] = source;", .{ .lang = .js });
    defer lazy.deinit();
    try std.testing.expect(!lazy.hasErrors());
    const lazy_pattern = findNode(&lazy, .array_pattern) orelse return error.MissingLazyLetPattern;
    try std.testing.expectEqual(@as(u32, 4), lazy.span(lazy_pattern).start);
    const lazy_overlay = lazy.dialectOverlay(@intFromEnum(lazy_pattern)) orelse
        return error.MissingLazyLetOverlay;
    try std.testing.expect(lazy.dialect_store.records.items[lazy_overlay].array_pattern.lazy);

    const Case = struct {
        source: []const u8,
        required: std.meta.Tag(parser.ast.NodeData),
        forbidden: std.meta.Tag(parser.ast.NodeData),
    };
    for ([_]Case{
        .{ .source = "let [value] = source;", .required = .variable_declaration, .forbidden = .assignment_expression },
        .{ .source = "let = 1;", .required = .assignment_expression, .forbidden = .variable_declaration },
        .{ .source = "let in object;", .required = .binary_expression, .forbidden = .variable_declaration },
    }) |case| {
        dialect.resetHooks();
        dialect.selected_hook = .binding_pattern;
        dialect.select_handled = true;
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .js });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());
        try std.testing.expect(findNode(&tree, case.required) != null);
        try std.testing.expect(findNode(&tree, case.forbidden) == null);
        try std.testing.expectEqual(@as(usize, 0), tree.dialect_store.overlays.items.len);
    }
}

fn firstJsxText(tree: anytype) []const u8 {
    var index: u32 = 0;
    while (index < tree.nodes.len) : (index += 1) {
        switch (tree.data(@enumFromInt(index))) {
            .jsx_text => |data| return tree.string(data.value),
            else => {},
        }
    }
    return "<missing>";
}

fn findNode(tree: anytype, tag: std.meta.Tag(parser.ast.NodeData)) ?parser.ast.NodeIndex {
    var index: u32 = 0;
    while (index < tree.nodes.len) : (index += 1) {
        const node: parser.ast.NodeIndex = @enumFromInt(index);
        if (std.meta.activeTag(tree.data(node)) == tag) return node;
    }
    return null;
}

fn findNodeWithSpan(
    tree: anytype,
    comptime tag: std.meta.Tag(parser.ast.NodeData),
    start: u32,
    end: u32,
) ?parser.ast.NodeIndex {
    var index: u32 = 0;
    while (index < tree.nodes.len) : (index += 1) {
        const node: parser.ast.NodeIndex = @enumFromInt(index);
        if (std.meta.activeTag(tree.data(node)) != tag) continue;
        const span = tree.span(node);
        if (span.start == start and span.end == end) return node;
    }
    return null;
}

fn findDialectNode(tree: anytype) ?parser.ast.NodeIndex {
    if (tree.dialect_store.associations.items.len == 0) return null;
    return @enumFromInt(tree.dialect_store.associations.items[0].anchor);
}

fn findDialectNodeWithSpan(tree: anytype, start: u32, end: u32) ?parser.ast.NodeIndex {
    for (tree.dialect_store.associations.items) |association| {
        const node: parser.ast.NodeIndex = @enumFromInt(association.anchor);
        const span = tree.span(node);
        if (span.start == start and span.end == end) return node;
    }
    return null;
}

fn corpusDigest() ![32]u8 {
    const Case = struct { source: []const u8, lang: parser.ast.Lang };
    const cases = [_]Case{
        .{ .source = "@dec class C {}", .lang = .ts },
        .{ .source = "const x = @dec class {};", .lang = .ts },
        .{ .source = "!value;", .lang = .js },
        .{ .source = "function f() {}", .lang = .js },
        .{ .source = "for (value of values) {}", .lang = .js },
        .{ .source = "let value = 1;", .lang = .js },
        .{ .source = "import value from package;", .lang = .js },
        .{ .source = "declare const value: number;", .lang = .ts },
        .{ .source = "const x = <A>left@right{value}</B>;", .lang = .tsx },
        .{ .source = "import value from ;", .lang = .js },
    };
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = case.lang });
        defer tree.deinit();
        const bytes = try std.testing.allocator.alloc(u8, transfer.bufferSize(&tree));
        defer std.testing.allocator.free(bytes);
        _ = transfer.serializeInto(&tree, bytes);
        hasher.update(bytes);
        const diagnostics: u64 = tree.diagnostics.items.len;
        hasher.update(std.mem.asBytes(&diagnostics));
    }
    var digest: [32]u8 = undefined;
    hasher.final(&digest);
    return digest;
}

test "statement and expression control reports retain null help through transfer" {
    const Case = struct {
        hook: dialect.Hook,
        source: []const u8,
        at: u32,
    };
    for ([_]Case{
        .{ .hook = .statement_at_control_flow, .source = "@dec class C {}", .at = 0 },
        .{ .hook = .expression_at_control_flow, .source = "const value = @if;", .at = 14 },
    }) |case| {
        dialect.resetHooks();
        dialect.selected_hook = case.hook;
        dialect.control_report_mode = .no_help;
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .ts });
        defer tree.deinit();
        try std.testing.expectEqual(@as(usize, 1), tree.diagnostics.items.len);
        const diagnostic = tree.diagnostics.items[0];
        try std.testing.expectEqual(.@"error", diagnostic.severity);
        try std.testing.expectEqualStrings("Sentinel control-flow report", diagnostic.message);
        try std.testing.expectEqual(case.at, diagnostic.span.start);
        try std.testing.expectEqual(case.at + 1, diagnostic.span.end);
        try std.testing.expectEqual(@as(?[]const u8, null), diagnostic.help);
        try std.testing.expectEqual(@as(usize, 0), diagnostic.labels.len);
        try expectTransferredDiagnostic(&tree, null);
    }

    dialect.resetHooks();
    dialect.selected_hook = .statement_at_control_flow;
    dialect.control_report_mode = .with_help;
    var helped = try parser.parse(std.testing.allocator, "@dec class C {}", .{ .lang = .ts });
    defer helped.deinit();
    try std.testing.expectEqual(@as(usize, 1), helped.diagnostics.items.len);
    try std.testing.expectEqualStrings("Sentinel control-flow help", helped.diagnostics.items[0].help.?);
    try std.testing.expectEqual(@as(usize, 0), helped.diagnostics.items[0].labels.len);
    try expectTransferredDiagnostic(&helped, "Sentinel control-flow help");
}

fn expectTransferredDiagnostic(tree: anytype, expected_help: ?[]const u8) !void {
    const bytes = try std.testing.allocator.alignedAlloc(u8, .@"4", transfer.bufferSize(tree));
    defer std.testing.allocator.free(bytes);
    _ = transfer.serializeInto(tree, bytes);
    try std.testing.expectEqual(@as(u32, 0), std.mem.readInt(u32, bytes[32..36], .little) & 16);

    var cursor = reflectedSectionOffset(bytes);
    cursor += 1; // severity
    const start = std.mem.readInt(u32, bytes[cursor..][0..4], .little);
    cursor += 4;
    const end = std.mem.readInt(u32, bytes[cursor..][0..4], .little);
    cursor += 4;
    try std.testing.expectEqual(tree.diagnostics.items[0].span.start, start);
    try std.testing.expectEqual(tree.diagnostics.items[0].span.end, end);
    const message_len = std.mem.readInt(u32, bytes[cursor..][0..4], .little);
    cursor += 4;
    try std.testing.expectEqualStrings("Sentinel control-flow report", bytes[cursor .. cursor + message_len]);
    cursor += message_len;
    const has_help = bytes[cursor];
    cursor += 1;
    if (expected_help) |help| {
        try std.testing.expectEqual(@as(u8, 1), has_help);
        const help_len = std.mem.readInt(u32, bytes[cursor..][0..4], .little);
        cursor += 4;
        try std.testing.expectEqualStrings(help, bytes[cursor .. cursor + help_len]);
        cursor += help_len;
    } else {
        try std.testing.expectEqual(@as(u8, 0), has_help);
    }
    try std.testing.expectEqual(@as(u32, 0), std.mem.readInt(u32, bytes[cursor..][0..4], .little));
}

test "sentinel records round trip and sparse overlays stay bounded" {
    // exercise every reflected record and reject tags outside the derived schema window
    var tree = parser.ParseResult.init(parser.ast.Tree.initEmpty(std.testing.allocator), .{});
    defer tree.deinit();

    const records = [_]dialect.Record{
        .{ .node = .{ .value = .{ .raw = 7 }, .active = true } },
        .{ .for_of = .{ .host_node = .{ .raw = 1 }, .index = .{ .raw = 2 }, .key = .{ .raw = 3 } } },
        .{ .catch_clause = .{ .host_node = .{ .raw = 2 }, .reset_param = .{ .raw = 4 } } },
        .{ .array_pattern = .{ .host_node = .{ .raw = 3 }, .lazy = true } },
        .{ .object_pattern = .{ .host_node = .{ .raw = 4 }, .lazy = false } },
    };
    for (records, 0..) |record, index| {
        const record_index = try tree.addDialectRecord(record);
        try std.testing.expectEqual(@as(u32, @intCast(index)), record_index);
        const packed_record = try transfer.packDialectRecord(&record);
        const unpacked = try transfer.unpackDialectRecord(packed_record);
        try std.testing.expectEqualDeep(record, unpacked);
        if (index > 0) try tree.addDialectOverlay(@intCast(index), record_index);
    }
    _ = try tree.tree.addNode(.{ .empty_statement = .{} }, .{ .start = 0, .end = 0 });
    try tree.dialect_store.addAssociation(tree.allocator(), 0, 0);
    try std.testing.expectEqual(@as(?u32, 1), tree.dialectOverlay(1));
    try std.testing.expectEqual(@as(?u32, null), tree.dialectOverlay(99));
    try std.testing.expectError(error.OutOfMemory, tree.addDialectOverlay(1, 1));
    try std.testing.expectError(error.OutOfMemory, tree.addDialectOverlay(5, 99));

    var malformed = std.mem.zeroes(transfer.PackedNode);
    malformed.tag = transfer.dialectNodeTag();
    try std.testing.expectError(error.InvalidDialectTag, transfer.unpackDialectRecord(malformed));
    malformed.tag = transfer.dialectNodeTag() + dialect.schema.record_count + 1;
    try std.testing.expectError(error.InvalidDialectTag, transfer.unpackDialectRecord(malformed));

    const TooManySlots = struct {
        a: u32,
        b: u32,
        c: u32,
        d: u32,
        e: u32,
        f: u32,
        g: u32,
        h: u32,
    };
    const TooManyFlags = struct {
        a: bool,
        b: bool,
        c: bool,
        d: bool,
        e: bool,
        f: bool,
        g: bool,
        h: bool,
        i: bool,
        j: bool,
        k: bool,
        l: bool,
        m: bool,
        n: bool,
        o: bool,
        p: bool,
        q: bool,
    };
    try std.testing.expect(comptime transfer.totalU32Slots(TooManySlots) > transfer.NODE_DATA_SLOTS);
    try std.testing.expect(comptime transfer.totalFlagBits(TooManyFlags) > transfer.NODE_FLAG_BITS);
    try std.testing.expect(@as(u16, transfer.dialectNodeTag()) + dialect.schema.record_count < 256);

    const host_count: u32 = 100_000;
    const overlay_count: u32 = 13_000;
    try std.testing.expect(overlay_count * @sizeOf(dialect.OverlayPair) <=
        host_count * @sizeOf(parser.ast.Node) * 2 / 100);
    try std.testing.expect(overlay_count * 100 <= host_count * 13);
}

test "full tree transfer retains reflected records and overlays" {
    dialect.resetHooks();
    dialect.selected_hook = .lazy_assignment_pattern;
    dialect.select_handled = true;
    var tree = try parser.parse(std.testing.allocator, "&[value] = source;", .{ .lang = .js });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 1), tree.dialect_store.records.items.len);
    try std.testing.expectEqual(@as(usize, 1), tree.dialect_store.overlays.items.len);

    const bytes = try std.testing.allocator.alignedAlloc(u8, .@"4", transfer.bufferSize(&tree));
    defer std.testing.allocator.free(bytes);
    _ = transfer.serializeInto(&tree, bytes);
    var restored = try transfer.deserializeFromBuf(std.testing.allocator, bytes, tree.source);
    defer restored.deinit();

    try std.testing.expectEqualDeep(tree.dialect_store.records.items, restored.dialect_store.records.items);
    try std.testing.expectEqualDeep(tree.dialect_store.overlays.items, restored.dialect_store.overlays.items);
}

test "reflected transfer eagerly rejects invalid unused records and dangling direct indices" {
    dialect.resetHooks();
    dialect.capability_mode = .block_split;
    var tree = try parser.parse(std.testing.allocator, "const x = @{ <A /> };", .{ .lang = .tsx });
    defer tree.deinit();
    const bytes = try std.testing.allocator.alignedAlloc(u8, .@"4", transfer.bufferSize(&tree));
    defer std.testing.allocator.free(bytes);
    _ = transfer.serializeInto(&tree, bytes);
    const section = reflectedSectionOffset(bytes);

    var invalid_tag = try std.testing.allocator.dupe(u8, bytes);
    defer std.testing.allocator.free(invalid_tag);
    invalid_tag[section + transfer.DIALECT_SUBHEADER_SIZE] = 0xff;
    try std.testing.expectError(error.InvalidBuffer, transfer.deserializeFromBuf(std.testing.allocator, invalid_tag, tree.source));

    var dangling = try std.testing.allocator.dupe(u8, bytes);
    defer std.testing.allocator.free(dangling);
    const direct = findDialectNode(&tree) orelse return error.MissingCapabilityDialectNode;
    std.mem.writeInt(u32, dangling[transfer.HEADER_SIZE + @intFromEnum(direct) * transfer.NODE_SIZE + 8 ..][0..4], 0xffff_ffff, .little);
    try std.testing.expectError(error.InvalidBuffer, transfer.deserializeFromBuf(std.testing.allocator, dangling, tree.source));

    var wrong_use = try std.testing.allocator.dupe(u8, bytes);
    defer std.testing.allocator.free(wrong_use);
    wrong_use[section + transfer.DIALECT_SUBHEADER_SIZE] = transfer.dialectNodeTag() + 4;
    try std.testing.expectError(error.InvalidBuffer, transfer.deserializeFromBuf(std.testing.allocator, wrong_use, tree.source));

    var role_bounds = try std.testing.allocator.dupe(u8, bytes);
    defer std.testing.allocator.free(role_bounds);
    std.mem.writeInt(u32, role_bounds[section + transfer.DIALECT_SUBHEADER_SIZE + 8 ..][0..4], 0xffff_ffff, .little);
    try std.testing.expectError(error.InvalidBuffer, transfer.deserializeFromBuf(std.testing.allocator, role_bounds, tree.source));

    var cycle = try std.testing.allocator.dupe(u8, bytes);
    defer std.testing.allocator.free(cycle);
    std.mem.writeInt(u32, cycle[section + transfer.DIALECT_SUBHEADER_SIZE + 8 ..][0..4], @intFromEnum(direct), .little);
    try std.testing.expectError(error.InvalidBuffer, transfer.deserializeFromBuf(std.testing.allocator, cycle, tree.source));

    var empty_flag = try std.testing.allocator.dupe(u8, bytes);
    defer std.testing.allocator.free(empty_flag);
    std.mem.writeInt(u32, empty_flag[section..][0..4], 0, .little);
    try std.testing.expectError(error.InvalidBuffer, transfer.deserializeFromBuf(std.testing.allocator, empty_flag, tree.source));
}

test "reflected transfer rejects overlay kind order and internal host mismatch" {
    dialect.resetHooks();
    dialect.selected_hook = .lazy_assignment_pattern;
    dialect.select_handled = true;
    var tree = try parser.parse(std.testing.allocator, "&[value] = source;", .{ .lang = .js });
    defer tree.deinit();
    const bytes = try std.testing.allocator.alignedAlloc(u8, .@"4", transfer.bufferSize(&tree));
    defer std.testing.allocator.free(bytes);
    _ = transfer.serializeInto(&tree, bytes);
    const section = reflectedSectionOffset(bytes);
    const record_count = std.mem.readInt(u32, bytes[section..][0..4], .little);
    const overlays = section + transfer.DIALECT_SUBHEADER_SIZE + record_count * transfer.NODE_SIZE;

    var wrong_kind = try std.testing.allocator.dupe(u8, bytes);
    defer std.testing.allocator.free(wrong_kind);
    wrong_kind[section + transfer.DIALECT_SUBHEADER_SIZE] = transfer.dialectNodeTag() + 1;
    try std.testing.expectError(error.InvalidBuffer, transfer.deserializeFromBuf(std.testing.allocator, wrong_kind, tree.source));

    var host_mismatch = try std.testing.allocator.dupe(u8, bytes);
    defer std.testing.allocator.free(host_mismatch);
    const host = std.mem.readInt(u32, host_mismatch[overlays..][0..4], .little);
    std.mem.writeInt(u32, host_mismatch[section + transfer.DIALECT_SUBHEADER_SIZE + 8 ..][0..4], host + 1, .little);
    try std.testing.expectError(error.InvalidBuffer, transfer.deserializeFromBuf(std.testing.allocator, host_mismatch, tree.source));

    const duplicate = try std.testing.allocator.alignedAlloc(u8, .@"4", bytes.len + transfer.DIALECT_OVERLAY_SIZE);
    defer std.testing.allocator.free(duplicate);
    @memcpy(duplicate[0..bytes.len], bytes);
    @memcpy(duplicate[bytes.len..], bytes[overlays .. overlays + transfer.DIALECT_OVERLAY_SIZE]);
    std.mem.writeInt(u32, duplicate[section + 4 ..][0..4], 2, .little);
    try std.testing.expectError(error.InvalidBuffer, transfer.deserializeFromBuf(std.testing.allocator, duplicate, tree.source));
}

test "semantic transfer survives a scratch buffer the allocator leaves off a 4-byte boundary" {
    // `appendInto` serializes the base tree into a scratch buffer it allocates
    // from the tree's allocator, and the base serializer writes every section
    // through 4-byte-aligned pointers. Asking for `[]u8` only guarantees
    // 1-byte alignment, so before the fix this path worked or panicked
    // depending on which size class the allocator happened to pick -- which is
    // to say, on the shape of the source. `Exactly` honours each request and
    // grants nothing beyond it, so a buffer that must be 4-aligned to work is
    // reliably handed an address that is not.
    var exact: Exactly = .{ .backing = std.testing.allocator };
    const allocator = exact.allocator();

    for ([_][]const u8{ "a", "const a = 1;\n", "let x=1", "export const y = 2;" }) |source| {
        dialect.resetHooks();
        var tree = try parser.parse(allocator, source, .{ .lang = .ts });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const semantic = try parser.semantic.analyze(&tree);
        const records = try parser.semantic.module_record.collect(&tree, &semantic);
        const core_size = transfer.bufferSize(&tree);
        const size = transfer.semantic.bufferSize(&tree, &semantic, records, core_size);

        // The output buffer stands in for the N-API ArrayBuffer the addon
        // writes into, which is aligned; the defect was never here.
        const bytes = try std.testing.allocator.alignedAlloc(u8, .@"4", size);
        defer std.testing.allocator.free(bytes);
        const core_written = transfer.serializeInto(&tree, bytes);
        const written = try transfer.semantic.appendInto(&tree, &semantic, records, bytes, core_written);
        try std.testing.expect(written <= size);

        // The semantic sections really landed: the core header advertises them
        // and the sub-header describes this module rather than an empty one.
        const flags = std.mem.readInt(u32, bytes[transfer.HDR_FLAGS_U32 * 4 ..][0..4], .little);
        try std.testing.expect(flags & transfer.FLAG_SEMANTIC != 0);

        const sub = std.mem.alignForward(usize, core_written, 4);
        try std.testing.expectEqual(@as(usize, 0), sub % 4);
        const scope_count = std.mem.readInt(u32, bytes[sub..][0..4], .little);
        const symbol_count = std.mem.readInt(u32, bytes[sub + 4 ..][0..4], .little);
        try std.testing.expect(scope_count > 0);
        try std.testing.expectEqual(@as(u32, @intCast(semantic.symbols.len)), symbol_count);
    }
}

/// An allocator that satisfies the alignment asked of it and no more, so code
/// that silently depends on getting a stronger alignment than it requested
/// fails here every time instead of only for some inputs.
const Exactly = struct {
    backing: std.mem.Allocator,

    fn allocator(self: *Exactly) std.mem.Allocator {
        return .{
            .ptr = self,
            .vtable = &.{
                .alloc = alloc,
                .resize = std.mem.Allocator.noResize,
                .remap = std.mem.Allocator.noRemap,
                .free = free,
            },
        };
    }

    /// Over-allocates at twice the requested alignment and hands back a
    /// pointer one requested-alignment further in: exactly aligned, never more.
    fn alloc(ctx: *anyopaque, len: usize, alignment: std.mem.Alignment, ret_addr: usize) ?[*]u8 {
        const self: *Exactly = @ptrCast(@alignCast(ctx));
        const pad = alignment.toByteUnits();
        const base = self.backing.rawAlloc(len + pad, wider(alignment), ret_addr) orelse return null;
        return base + pad;
    }

    fn free(ctx: *anyopaque, memory: []u8, alignment: std.mem.Alignment, ret_addr: usize) void {
        const self: *Exactly = @ptrCast(@alignCast(ctx));
        const pad = alignment.toByteUnits();
        const base = memory.ptr - pad;
        self.backing.rawFree(base[0 .. memory.len + pad], wider(alignment), ret_addr);
    }

    fn wider(alignment: std.mem.Alignment) std.mem.Alignment {
        return @enumFromInt(@intFromEnum(alignment) + 1);
    }
};

fn reflectedSectionOffset(bytes: []const u8) usize {
    const node_count = std.mem.readInt(u32, bytes[0..4], .little);
    const extra_count = std.mem.readInt(u32, bytes[4..8], .little);
    const pool_len = std.mem.readInt(u32, bytes[8..12], .little);
    const comment_count = std.mem.readInt(u32, bytes[16..20], .little);
    const attached_count = std.mem.readInt(u32, bytes[20..24], .little);
    const flags = std.mem.readInt(u32, bytes[32..36], .little);
    var pos: usize = transfer.HEADER_SIZE + @as(usize, node_count) * transfer.NODE_SIZE +
        @as(usize, extra_count) * 4 + transfer.alignPool(pool_len);
    if (flags & transfer.FLAG_ATTACHED_COMMENTS != 0) pos += (@as(usize, node_count) + 1) * 4;
    pos += @as(usize, attached_count) * transfer.ATTACHED_COMMENT_SIZE;
    pos += @as(usize, comment_count) * transfer.COMMENT_SIZE;
    return pos;
}
