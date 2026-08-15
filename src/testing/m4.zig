const std = @import("std");
const parser = @import("parser");

test "dialect children participate in semantic analysis" {
    // References inside a code block resolve through reflected dialect children.
    const source = "const outer = 1; const view = @{ const inner = outer; <p>{inner}</p> };";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    const semantic = try parser.semantic.analyze(&tree);
    var resolved: u32 = 0;
    resolved = @intCast(semantic.references.len);
    try std.testing.expect(resolved >= 2);
}

test "dialect codegen reparses without diagnostics" {
    // The printer callback emits grammar, then the strict parser validates it.
    const source = "const view = @if (ready) { <p /> } @else { <span /> };";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), result.errors.len);
    var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
    defer reparsed.deinit();
    try std.testing.expect(!reparsed.hasErrors());
}

test "lazy object assignment prefix disambiguates statement lead" {
    // Lazy overlays remove only the wrapper made unnecessary by their emitted prefix.
    const Case = struct {
        source: []const u8,
        expected: []const u8,
        lazy: bool,
        parenthesized: bool,
    };
    for ([_]Case{
        .{
            .source = "({ title } = props);",
            .expected = "({ title } = props);",
            .lazy = false,
            .parenthesized = true,
        },
        .{
            .source = "&{ title } = props;",
            .expected = "&{ title } = props;",
            .lazy = true,
            .parenthesized = false,
        },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
        defer result.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(usize, 0), result.errors.len);
        try std.testing.expectEqualStrings(case.expected, result.code);

        var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
        defer reparsed.deinit();
        try std.testing.expect(!reparsed.hasErrors());
        try expectObjectAssignment(&reparsed, case.lazy, case.parenthesized);
    }
}

test "lazy object assignment remains wrapped in arrow body" {
    // Arrow bodies keep the wrapper required to preserve their assignment shape.
    const source = "const update = () => (&{ title } = props);";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), result.errors.len);
    try std.testing.expectEqualStrings(source, result.code);

    var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
    defer reparsed.deinit();
    try std.testing.expect(!reparsed.hasErrors());
    const program = reparsed.data(reparsed.root).program;
    const body = reparsed.extra(program.body);
    try std.testing.expectEqual(@as(usize, 1), body.len);
    const declaration = reparsed.data(body[0]).variable_declaration;
    const declarators = reparsed.extra(declaration.declarators);
    try std.testing.expectEqual(@as(usize, 1), declarators.len);
    const declarator = reparsed.data(declarators[0]).variable_declarator;
    const arrow = reparsed.data(declarator.init).arrow_function_expression;
    try std.testing.expect(arrow.expression);
    try std.testing.expectEqual(
        .parenthesized_expression,
        std.meta.activeTag(reparsed.data(arrow.body)),
    );
    const expression = reparsed.data(arrow.body).parenthesized_expression.expression;
    const assignment = reparsed.data(expression).assignment_expression;
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(reparsed.data(assignment.left)));
    const record_index = reparsed.dialectOverlay(@intFromEnum(assignment.left));
    try std.testing.expect(record_index != null);
    const record = reparsed.dialect_store.records.items[record_index.?];
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(record));
    try std.testing.expect(record.object_pattern.lazy);
}

test "lazy object assignment prefix disambiguates direct arrow body" {
    // Direct arrow bodies preserve assignment shape through the emitted lazy prefix.
    const source = "const update = () => &{ title } = props;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), result.errors.len);
    try std.testing.expectEqualStrings(source, result.code);

    var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
    defer reparsed.deinit();
    try std.testing.expect(!reparsed.hasErrors());
    const program = reparsed.data(reparsed.root).program;
    const body = reparsed.extra(program.body);
    try std.testing.expectEqual(@as(usize, 1), body.len);
    const declaration = reparsed.data(body[0]).variable_declaration;
    const declarators = reparsed.extra(declaration.declarators);
    try std.testing.expectEqual(@as(usize, 1), declarators.len);
    const declarator = reparsed.data(declarators[0]).variable_declarator;
    const arrow = reparsed.data(declarator.init).arrow_function_expression;
    try std.testing.expect(arrow.expression);
    try std.testing.expectEqual(
        .assignment_expression,
        std.meta.activeTag(reparsed.data(arrow.body)),
    );
    const assignment = reparsed.data(arrow.body).assignment_expression;
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(reparsed.data(assignment.left)));
    const record_index = reparsed.dialectOverlay(@intFromEnum(assignment.left));
    try std.testing.expect(record_index != null);
    const record = reparsed.dialect_store.records.items[record_index.?];
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(record));
    try std.testing.expect(record.object_pattern.lazy);
}

fn expectObjectAssignment(
    tree: *const parser.ParseResult,
    lazy: bool,
    parenthesized: bool,
) !void {
    const program = tree.data(tree.root).program;
    const body = tree.extra(program.body);
    try std.testing.expectEqual(@as(usize, 1), body.len);
    const statement = tree.data(body[0]).expression_statement;
    var expression = statement.expression;
    if (parenthesized) {
        try std.testing.expectEqual(
            .parenthesized_expression,
            std.meta.activeTag(tree.data(expression)),
        );
        expression = tree.data(expression).parenthesized_expression.expression;
    } else {
        try std.testing.expectEqual(
            .assignment_expression,
            std.meta.activeTag(tree.data(expression)),
        );
    }
    const assignment = tree.data(expression).assignment_expression;
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(tree.data(assignment.left)));
    const record_index = tree.dialectOverlay(@intFromEnum(assignment.left));
    if (lazy) {
        try std.testing.expect(record_index != null);
        const record = tree.dialect_store.records.items[record_index.?];
        try std.testing.expectEqual(.object_pattern, std.meta.activeTag(record));
        try std.testing.expect(record.object_pattern.lazy);
    } else {
        try std.testing.expectEqual(@as(?u32, null), record_index);
    }
}
