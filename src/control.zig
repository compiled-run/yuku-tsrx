const std = @import("std");
const parser = @import("yuku");

pub fn main() !void {
    const sources = [_]struct { source: []const u8, lang: parser.ast.Lang }{
        .{ .source = @embedFile("control_js"), .lang = .js },
        .{ .source = @embedFile("control_ts"), .lang = .ts },
        .{ .source = @embedFile("control_tsx"), .lang = .tsx },
    };
    var nodes_total: u32 = 0;
    for (sources) |case| {
        var tree = try parser.parse(std.heap.page_allocator, case.source, .{ .lang = case.lang });
        defer tree.deinit();

        if (tree.hasErrors()) return error.ControlDiagnostic;
        nodes_total += @intCast(tree.nodes.len);
    }

    std.debug.assert(nodes_total > sources.len);
    std.debug.assert(@sizeOf(parser.ast.Node) == 52);
    std.debug.print("dialect-free control: {d} files, {d} nodes, Node={d} bytes\n", .{
        sources.len,
        nodes_total,
        @sizeOf(parser.ast.Node),
    });
}
