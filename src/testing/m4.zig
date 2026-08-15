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

test "every control-flow directive family parses as a JSX child" {
    // `@for`/`@switch`/`@try` reach the dialect's JSX children loop through the
    // same `jsx_element_after_open` seam as `@if`, and each has to leave the
    // enclosing element closed behind it.
    const Case = struct { source: []const u8, tag: []const u8 };
    for ([_]Case{
        .{
            .source = "const view = <div>@if (ready) {<p>a</p>}</div>;",
            .tag = "jsx_if_expression",
        },
        .{
            .source = "const view = <div>@if (ready) {<p>a</p>} @else {<p>b</p>}</div>;",
            .tag = "jsx_if_expression",
        },
        .{
            .source = "const view = <div>@for (const item of items) {<p>{item}</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@for (const item of items) {<p>a</p>} @empty {<p>b</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@for (const item of items; index i; key item.id) {<p>a</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@for (const { id } of items) {<p>{id}</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@for (let i = 0; i < total; i++) {<p>{i}</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@switch (kind) {@case 1: {<p>a</p>} @default: {<p>b</p>}}</div>;",
            .tag = "jsx_switch_expression",
        },
        .{
            .source = "const view = <div>@try {<p>a</p>} @catch (error) {<p>b</p>}</div>;",
            .tag = "jsx_try_expression",
        },
        .{
            .source = "const view = <div>@try {<p>a</p>} @pending {<p>b</p>}</div>;",
            .tag = "jsx_try_expression",
        },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
        try std.testing.expect(!tree.hasErrors());

        const element = declaredJsxElement(&tree);
        try std.testing.expect(tree.data(element).jsx_element.closing_element != .null);

        const children = dialectChildTags(&tree, element);
        try std.testing.expectEqual(@as(usize, 1), children.len);
        try std.testing.expectEqualStrings(case.tag, children.tags[0]);
    }
}

test "control-flow directives parse in template blocks and at statement position" {
    // The same directive bodies have to terminate cleanly when the directive is
    // not the last thing in its enclosing block.
    for ([_][]const u8{
        "const view = @{ @for (const item of items) {<p>{item}</p>} };",
        "const view = @{ @for (const item of items) { const label = item; <p>{label}</p> } };",
        "const view = @{ @switch (kind) {@case 1: {<p>a</p>}} };",
        "const view = @{ @for (const item of items) {<p>a</p>} @if (ready) {<b>b</b>} };",
        "const view = @{ @for (const item of items) {<p>a</p>} const trailing = 1; <p>{trailing}</p> };",
        "@for (const item of items) {<p>a</p>}",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
        try std.testing.expect(!tree.hasErrors());
        try std.testing.expect(tree.dialect_store.associations.items.len >= 1);
    }
}

test "a JSX child directive ends at its own closing brace" {
    // The children loop resumes its text scan at the child's span end, so a
    // directive node that over- or under-reports its end silently desyncs every
    // sibling that follows it.
    const source = "const view = <div>@for (const item of items) {<li>a</li>}@if (ready) {<b>b</b>}tail</div>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
    try std.testing.expect(!tree.hasErrors());

    const element = declaredJsxElement(&tree);
    try std.testing.expect(tree.data(element).jsx_element.closing_element != .null);

    const children = dialectChildTags(&tree, element);
    try std.testing.expectEqual(@as(usize, 2), children.len);
    try std.testing.expectEqualStrings("jsx_for_expression", children.tags[0]);
    try std.testing.expectEqualStrings("jsx_if_expression", children.tags[1]);

    const nodes = tree.extra(tree.data(element).jsx_element.children);
    try std.testing.expectEqual(@as(usize, 3), nodes.len);
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "@for").?)),
        tree.span(nodes[0]).start,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "}@if").? + 1)),
        tree.span(nodes[0]).end,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "}tail").? + 1)),
        tree.span(nodes[1]).end,
    );
    try std.testing.expectEqual(.jsx_text, std.meta.activeTag(tree.data(nodes[2])));
    try std.testing.expectEqualStrings("tail", tree.string(tree.data(nodes[2]).jsx_text.value));
}

test "control-flow JSX children round-trip through codegen" {
    for ([_][]const u8{
        "const view = <div>@for (const item of items) {<p>{item}</p>}</div>;",
        "const view = <div>@for (const item of items; index i; key item.id) {<p>a</p>}</div>;",
        "const view = <div>@for (const item of items) {<p>a</p>} @empty {<p>b</p>}</div>;",
        "const view = <div>@switch (kind) {@case 1: {<p>a</p>} @default: {<p>b</p>}}</div>;",
        "const view = <div>@try {<p>a</p>} @catch (error) {<p>b</p>}</div>;",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
        defer result.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(usize, 0), result.errors.len);

        var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
        defer reparsed.deinit();
        try std.testing.expect(!reparsed.hasErrors());

        const element = declaredJsxElement(&tree);
        const expected = dialectChildTags(&tree, element);
        const reparsed_element = declaredJsxElement(&reparsed);
        const actual = dialectChildTags(&reparsed, reparsed_element);
        try std.testing.expectEqual(expected.len, actual.len);
        try std.testing.expectEqual(@as(usize, 1), actual.len);
        try std.testing.expectEqualStrings(expected.tags[0], actual.tags[0]);
    }
}

test "a JSX child for-of binding resolves inside its body" {
    const source = "const view = <div>@for (const item of items) {<p>{item}</p>}</div>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    const semantic = try parser.semantic.analyze(&tree);
    try std.testing.expect(semantic.references.len >= 2);
}

fn declaredJsxElement(tree: *const parser.ParseResult) parser.ast.NodeIndex {
    const program = tree.data(tree.root).program;
    const body = tree.extra(program.body);
    const declaration = tree.data(body[0]).variable_declaration;
    const declarators = tree.extra(declaration.declarators);
    const element = tree.data(declarators[0]).variable_declarator.init;
    std.debug.assert(tree.data(element) == .jsx_element);
    return element;
}

const DialectChildTags = struct {
    tags: [8][]const u8 = undefined,
    len: usize = 0,
};

fn dialectChildTags(
    tree: *const parser.ParseResult,
    element: parser.ast.NodeIndex,
) DialectChildTags {
    var found: DialectChildTags = .{};
    for (tree.extra(tree.data(element).jsx_element.children)) |child| {
        const index = tree.dialectRecord(@intFromEnum(child)) orelse continue;
        if (found.len == found.tags.len) break;
        found.tags[found.len] = @tagName(tree.dialect_store.records.items[index]);
        found.len += 1;
    }
    return found;
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

/// Shape of one JSX child, coarse enough to describe an interleaving without
/// pinning the whole subtree.
const ChildShape = enum { text, element, fragment, directive, other };

fn childShapes(
    tree: *const parser.ParseResult,
    element: parser.ast.NodeIndex,
    buffer: []ChildShape,
) []const ChildShape {
    const children = switch (tree.data(element)) {
        .jsx_element => |value| tree.extra(value.children),
        .jsx_fragment => |value| tree.extra(value.children),
        else => &[_]parser.ast.NodeIndex{},
    };
    var len: usize = 0;
    for (children) |child| {
        if (len == buffer.len) break;
        buffer[len] = switch (tree.data(child)) {
            .jsx_text => .text,
            .jsx_element => .element,
            .jsx_fragment => .fragment,
            else => if (tree.dialectRecord(@intFromEnum(child)) != null)
                .directive
            else
                .other,
        };
        len += 1;
    }
    return buffer[0..len];
}

fn declaredJsxRoot(tree: *const parser.ParseResult) parser.ast.NodeIndex {
    const program = tree.data(tree.root).program;
    const body = tree.extra(program.body);
    const declaration = tree.data(body[0]).variable_declaration;
    const declarators = tree.extra(declaration.declarators);
    return tree.data(declarators[0]).variable_declarator.init;
}

test "TSRX directives interleave with sibling element children" {
    // The dialect owns the children loop of any element that holds a directive,
    // so that loop - not just the host's - has to accept element children on
    // either side of the directive instead of mistaking the first '<' it meets
    // for the closing tag.
    const Case = struct {
        source: []const u8,
        shapes: []const ChildShape,
    };
    for ([_]Case{
        // directive then element
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} <span>x</span></div>;",
            .shapes = &.{ .directive, .text, .element },
        },
        // element then directive
        .{
            .source = "const view = <div><span>x</span> @if (a) {<p>y</p>}</div>;",
            .shapes = &.{ .element, .text, .directive },
        },
        // directive, text, element
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} hi <b>x</b></div>;",
            .shapes = &.{ .directive, .text, .element },
        },
        // capitalised component child after a directive
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} <Link>x</Link></div>;",
            .shapes = &.{ .directive, .text, .element },
        },
        // self-closing component child before a directive
        .{
            .source = "const view = <div><Link /> @if (a) {<p>y</p>}</div>;",
            .shapes = &.{ .element, .text, .directive },
        },
        // full interleaving in both directions
        .{
            .source = "const view = <div>a <b>c</b> @if (a) {<p>y</p>} d <i>e</i> tail</div>;",
            .shapes = &.{ .text, .element, .text, .directive, .text, .element, .text },
        },
        // nested fragment among directives
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} <><b>x</b></> @if (b) {<p>z</p>}</div>;",
            .shapes = &.{ .directive, .text, .fragment, .text, .directive },
        },
        // a child element that carries its own directive
        .{
            .source = "const view = <div><Card>@if (a) {<p>y</p>}</Card> @if (b) {<p>z</p>}</div>;",
            .shapes = &.{ .element, .text, .directive },
        },
        // element child holding an expression container next to a directive
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} <b>{value}</b></div>;",
            .shapes = &.{ .directive, .text, .element },
        },
        // a code-block directive interleaved with elements
        .{
            .source = "const view = <div><b>x</b> @{ <p>y</p> } <i>z</i></div>;",
            .shapes = &.{ .element, .text, .directive, .text, .element },
        },
        // guard: directive-only children keep working
        .{
            .source = "const view = <div>@if (a) {<p>y</p>}</div>;",
            .shapes = &.{.directive},
        },
        // guard: two directives keep working
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} @if (b) {<p>z</p>}</div>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        // guard: element-only children stay on the host path
        .{
            .source = "const view = <div><span>x</span></div>;",
            .shapes = &.{.element},
        },
        // guard: a plain fragment stays on the host path
        .{
            .source = "const view = <><p>a</p></>;",
            .shapes = &.{.element},
        },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len) catch |err| {
            std.debug.print("source: {s}\n", .{case.source});
            for (tree.diagnostics.items) |diagnostic| {
                std.debug.print("  diagnostic: {s}\n", .{diagnostic.message});
            }
            return err;
        };
        try std.testing.expect(!tree.hasErrors());

        var buffer: [12]ChildShape = undefined;
        const shapes = childShapes(&tree, declaredJsxRoot(&tree), &buffer);
        std.testing.expectEqualSlices(ChildShape, case.shapes, shapes) catch |err| {
            std.debug.print("source: {s}\n", .{case.source});
            return err;
        };
    }
}

test "interleaved JSX children keep exact spans" {
    // Every child span feeds the next text rescan, so an element child that
    // over- or under-reports its end silently truncates its siblings.
    const source = "const view = <div>@if (a) {<p>y</p>} <span>x</span> tail</div>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
    try std.testing.expect(!tree.hasErrors());

    const element = declaredJsxElement(&tree);
    try std.testing.expect(tree.data(element).jsx_element.closing_element != .null);

    const nodes = tree.extra(tree.data(element).jsx_element.children);
    try std.testing.expectEqual(@as(usize, 4), nodes.len);
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "@if").?)),
        tree.span(nodes[0]).start,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "} <span").? + 1)),
        tree.span(nodes[0]).end,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "<span").?)),
        tree.span(nodes[2]).start,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "</span>").? + "</span>".len)),
        tree.span(nodes[2]).end,
    );
    try std.testing.expectEqual(.jsx_text, std.meta.activeTag(tree.data(nodes[3])));
    try std.testing.expectEqualStrings(" tail", tree.string(tree.data(nodes[3]).jsx_text.value));
}

test "interleaved JSX children round-trip through codegen" {
    for ([_][]const u8{
        "const view = <div>@if (a) {<p>y</p>} <span>x</span></div>;",
        "const view = <div><span>x</span> @if (a) {<p>y</p>}</div>;",
        "const view = <div>@for (const item of items) {<p>a</p>} <b>x</b></div>;",
    }) |source| {
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
}
