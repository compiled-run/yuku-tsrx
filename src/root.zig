const std = @import("std");

pub const parser = @import("yuku");

comptime {
    std.debug.assert(@sizeOf(parser.ast.Node) == 52);
    std.debug.assert(@sizeOf(parser.ast.Node) != 0);
}

test "path-linked Yuku parses dialect-free TypeScript" {
    var tree = try parser.parse(
        std.testing.allocator,
        "const answer: number = 42;",
        .{ .lang = .ts },
    );
    defer tree.deinit();

    try std.testing.expect(!tree.hasErrors());
    try std.testing.expect(tree.nodes.len > 1);
}
