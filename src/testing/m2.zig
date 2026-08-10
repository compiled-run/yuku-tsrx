const std = @import("std");
const parser = @import("parser");
const transfer = @import("transfer");

test "production lazy object parameter preserves alias type span overlay and transfer" {
    const source = "type Props = { title: string }; function pick(&{ title: label }: Props) { return label; }";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const pattern = findNode(&tree, .object_pattern) orelse return error.MissingObjectPattern;
    const prefix = std.mem.indexOfScalar(u8, source, '&').?;
    try std.testing.expectEqual(@as(u32, @intCast(prefix)), tree.span(pattern).start);
    const data = tree.data(pattern).object_pattern;
    try std.testing.expect(data.type_annotation != .null);
    try std.testing.expectEqualStrings(": Props", source[tree.span(data.type_annotation).start..tree.span(data.type_annotation).end]);

    const properties = tree.extra(data.properties);
    try std.testing.expectEqual(@as(usize, 1), properties.len);
    const property = tree.data(properties[0]).binding_property;
    try std.testing.expectEqualStrings("title", source[tree.span(property.key).start..tree.span(property.key).end]);
    try std.testing.expectEqualStrings("label", source[tree.span(property.value).start..tree.span(property.value).end]);

    const overlay = tree.dialectOverlay(@intFromEnum(pattern)) orelse return error.MissingObjectOverlay;
    const record = tree.dialect_store.records.items[overlay].object_pattern;
    try std.testing.expectEqual(@intFromEnum(pattern), record.host_node.raw);
    try std.testing.expect(record.lazy);
    try expectRoundTrip(&tree);
}

test "production lazy array parameter preserves type span overlay and transfer" {
    const source = "type Values = string[]; function pick(&[first, ...rest]: Values) { return first; }";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const pattern = findNode(&tree, .array_pattern) orelse return error.MissingArrayPattern;
    const prefix = std.mem.indexOfScalar(u8, source, '&').?;
    try std.testing.expectEqual(@as(u32, @intCast(prefix)), tree.span(pattern).start);
    const data = tree.data(pattern).array_pattern;
    try std.testing.expect(data.type_annotation != .null);
    try std.testing.expectEqualStrings(": Values", source[tree.span(data.type_annotation).start..tree.span(data.type_annotation).end]);
    try std.testing.expectEqual(@as(usize, 1), tree.extra(data.elements).len);
    try std.testing.expect(data.rest != .null);

    const overlay = tree.dialectOverlay(@intFromEnum(pattern)) orelse return error.MissingArrayOverlay;
    const record = tree.dialect_store.records.items[overlay].array_pattern;
    try std.testing.expectEqual(@intFromEnum(pattern), record.host_node.raw);
    try std.testing.expect(record.lazy);
    try expectRoundTrip(&tree);
}

test "production binding prefix leaves ordinary patterns untouched" {
    const source = "type Props = { title: string }; function pick({ title: label }: Props) { return label; }";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    const pattern = findNode(&tree, .object_pattern) orelse return error.MissingOrdinaryObjectPattern;
    try std.testing.expectEqual(@as(?u32, null), tree.dialectOverlay(@intFromEnum(pattern)));
    try std.testing.expectEqual(@as(usize, 0), tree.dialect_store.records.items.len);
}

test "production lazy let bindings preserve ordinary let ambiguity" {
    for ([_]struct { source: []const u8, tag: std.meta.Tag(parser.ast.NodeData), lazy: bool }{
        .{ .source = "let &[value] = source;", .tag = .array_pattern, .lazy = true },
        .{ .source = "let &{value} = source;", .tag = .object_pattern, .lazy = true },
        .{ .source = "let [value] = source;", .tag = .array_pattern, .lazy = false },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .js });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());
        const pattern = findNode(&tree, case.tag) orelse return error.MissingLetPattern;
        const overlay = tree.dialectOverlay(@intFromEnum(pattern));
        if (case.lazy) {
            const record_index = overlay orelse return error.MissingLazyLetOverlay;
            switch (tree.dialect_store.records.items[record_index]) {
                .array_pattern => |record| try std.testing.expect(record.lazy),
                .object_pattern => |record| try std.testing.expect(record.lazy),
                else => return error.UnexpectedLazyLetOverlay,
            }
        } else {
            try std.testing.expectEqual(@as(?u32, null), overlay);
        }
    }

    for ([_]struct { source: []const u8, tag: std.meta.Tag(parser.ast.NodeData) }{
        .{ .source = "let = 1;", .tag = .assignment_expression },
        .{ .source = "let in object;", .tag = .binary_expression },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .js });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());
        try std.testing.expect(findNode(&tree, case.tag) != null);
        try std.testing.expect(findNode(&tree, .variable_declaration) == null);
        try std.testing.expectEqual(@as(usize, 0), tree.dialect_store.overlays.items.len);
    }
}

test "production for transformation retains parser overlay node refs and spans" {
    const source = "const view = @for (const item of items; index item_index; key item.id) { <span /> };";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    var transformed: ?parser.ast.NodeIndex = null;
    for (tree.dialect_store.records.items) |record| switch (record) {
        .jsx_for_expression => |jsx_for| transformed = @enumFromInt(jsx_for.statement.raw),
        else => {},
    };
    const transformed_node = transformed orelse return error.MissingTransformedFor;
    try std.testing.expectEqual(.for_of_statement, std.meta.activeTag(tree.data(transformed_node)));
    const transformed_overlay = tree.dialectOverlay(@intFromEnum(transformed_node)) orelse
        return error.MissingTransformedForOverlay;
    const transformed_record = tree.dialect_store.records.items[transformed_overlay].for_of;

    var source_record: ?parser.dialect_schema.ForOfOverlay = null;
    for (tree.dialect_store.records.items) |record| switch (record) {
        .for_of => |for_of| if (for_of.host_node.raw != @intFromEnum(transformed_node)) {
            source_record = for_of;
        },
        else => {},
    };
    const original = source_record orelse return error.MissingParserForOverlay;
    try std.testing.expectEqual(original.index.raw, transformed_record.index.raw);
    try std.testing.expectEqual(original.key.raw, transformed_record.key.raw);

    const index: parser.ast.NodeIndex = @enumFromInt(transformed_record.index.raw);
    const key: parser.ast.NodeIndex = @enumFromInt(transformed_record.key.raw);
    try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(index)));
    try std.testing.expectEqual(.member_expression, std.meta.activeTag(tree.data(key)));
    try std.testing.expectEqualStrings("item_index", source[tree.span(index).start..tree.span(index).end]);
    try std.testing.expectEqualStrings("item.id", source[tree.span(key).start..tree.span(key).end]);
}

test "production binding prefix deterministically rejects non-pattern targets" {
    for ([_][]const u8{
        "function invalid(&name: string) {}",
        "function invalid(&42) {}",
    }) |source| {
        var first = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
        defer first.deinit();
        var second = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
        defer second.deinit();
        try std.testing.expect(first.hasErrors());
        try std.testing.expectEqual(first.diagnostics.items.len, second.diagnostics.items.len);
        for (first.diagnostics.items, second.diagnostics.items) |left, right| {
            try std.testing.expectEqualStrings(left.message, right.message);
            try std.testing.expectEqual(left.span, right.span);
        }
        try std.testing.expectEqual(@as(usize, 0), first.dialect_store.records.items.len);
        try std.testing.expectEqual(@as(usize, 0), first.dialect_store.overlays.items.len);
    }
}

fn expectRoundTrip(tree: *const parser.ast.Tree) !void {
    const bytes = try std.testing.allocator.alignedAlloc(u8, .@"4", transfer.bufferSize(tree));
    defer std.testing.allocator.free(bytes);
    _ = transfer.serializeInto(tree, bytes);
    var restored = try transfer.deserializeFromBuf(std.testing.allocator, bytes, tree.source);
    defer restored.deinit();
    try std.testing.expectEqualDeep(tree.dialect_store.records.items, restored.dialect_store.records.items);
    try std.testing.expectEqualDeep(tree.dialect_store.overlays.items, restored.dialect_store.overlays.items);
}

fn findNode(tree: *const parser.ast.Tree, tag: std.meta.Tag(parser.ast.NodeData)) ?parser.ast.NodeIndex {
    for (tree.nodes.items(.data), 0..) |data, index| {
        if (std.meta.activeTag(data) == tag) return @enumFromInt(index);
    }
    return null;
}
