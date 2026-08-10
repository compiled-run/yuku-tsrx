const std = @import("std");
const parser = @import("yuku");

const iterations_max: u32 = 512;
const source_bytes_max: u32 = 96;

const valid_sources = [_][]const u8{
    "let value = 1;",
    "const value: string = 'ok';",
    "const view = <section>{value}</section>;",
};

const invalid_sources = [_][]const u8{
    "let = ;",
    "const value: = 1;",
    "const view = <section>;",
};

pub fn main() !void {
    try check_curated_sources(valid_sources[0..], false);
    try check_curated_sources(invalid_sources[0..], true);

    var random = std.Random.DefaultPrng.init(0x59554b5554535258);
    var bytes: [source_bytes_max]u8 = undefined;
    var iteration: u32 = 0;
    while (iteration < iterations_max) : (iteration += 1) {
        const length = random.random().intRangeAtMost(u32, 1, source_bytes_max);
        random.random().bytes(bytes[0..length]);
        for (bytes[0..length]) |*byte| byte.* = 0x20 + byte.* % 0x5f;

        var tree = try parser.parse(
            std.heap.page_allocator,
            bytes[0..length],
            .{ .lang = .tsx },
        );
        tree.deinit();
    }

    std.debug.print("bounded fuzz: {d} generated cases plus {d} controls\n", .{
        iterations_max,
        valid_sources.len + invalid_sources.len,
    });
}

fn check_curated_sources(sources: []const []const u8, errors_expected: bool) !void {
    std.debug.assert(sources.len > 0);
    std.debug.assert(sources.len <= valid_sources.len);

    for (sources, 0..) |source, index| {
        const lang: parser.ast.Lang = switch (index) {
            0 => .js,
            1 => .ts,
            2 => .tsx,
            else => unreachable,
        };
        var tree = try parser.parse(std.heap.page_allocator, source, .{ .lang = lang });
        defer tree.deinit();

        if (tree.hasErrors() != errors_expected) return error.UnexpectedDiagnosticSpace;
        if (tree.nodes.len == 0) return error.EmptyTree;
    }
}
