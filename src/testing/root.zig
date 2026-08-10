const std = @import("std");
const parser = @import("yuku");

test "dialect-free controls cover valid and invalid source" {
    // prove the linked parser accepts JS, TS, and TSX while retaining diagnostics
    const cases = [_]struct {
        source: []const u8,
        lang: parser.ast.Lang,
        errors_expected: bool,
    }{
        .{ .source = "export const value = 1;", .lang = .js, .errors_expected = false },
        .{ .source = "const value: number = 1;", .lang = .ts, .errors_expected = false },
        .{ .source = "const view = <main>{value}</main>;", .lang = .tsx, .errors_expected = false },
        .{ .source = "const = ;", .lang = .js, .errors_expected = true },
        .{ .source = "const value: = 1;", .lang = .ts, .errors_expected = true },
        .{ .source = "const view = <main>;", .lang = .tsx, .errors_expected = true },
    };

    for (cases) |case| {
        var tree = try parser.parse(
            std.testing.allocator,
            case.source,
            .{ .lang = case.lang },
        );
        defer tree.deinit();

        try std.testing.expectEqual(case.errors_expected, tree.hasErrors());
        try std.testing.expect(tree.nodes.len > 0);
    }
}
