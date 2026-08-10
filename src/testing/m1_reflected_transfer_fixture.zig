const std = @import("std");
const dialect = @import("dialect");
const parser = @import("parser");
const transfer = @import("transfer");

pub fn main(init: std.process.Init) !void {
    const stdout = std.Io.File.stdout();
    var output_buffer: [16 * 1024]u8 = undefined;
    var output = stdout.writer(init.io, &output_buffer);
    try writeU32(&output.interface, 4);
    try emit(&output.interface, "const x = @{ <A /> };", .block_split, .tsx, false);
    try emit(&output.interface, "let [value] = source;", .none, .js, true);
    try emit(&output.interface, "const typed: number = 1;", .none, .ts, false);
    try emit(&output.interface, "const plain = 1;", .none, .js, false);
    try output.interface.flush();
}

fn emit(
    w: *std.Io.Writer,
    source: []const u8,
    mode: dialect.CapabilityMode,
    lang: parser.ast.Lang,
    add_overlay: bool,
) !void {
    dialect.resetHooks();
    dialect.capability_mode = mode;
    var tree = try parser.parse(std.heap.page_allocator, source, .{ .lang = lang });
    defer tree.deinit();
    if (add_overlay) {
        for (tree.nodes.items(.data), 0..) |data, index| {
            if (data != .array_pattern) continue;
            const ri = try tree.addDialectRecord(.{ .array_pattern = .{
                .host_node = .{ .raw = @intCast(index) },
                .lazy = true,
            } });
            try tree.addDialectOverlay(@intCast(index), ri);
            break;
        }
    }
    const out = try std.heap.page_allocator.alignedAlloc(u8, .@"4", transfer.bufferSize(&tree));
    defer std.heap.page_allocator.free(out);
    _ = transfer.serializeInto(&tree, out);
    try writeU32(w, source.len);
    try w.writeAll(source);
    try writeU32(w, out.len);
    try w.writeAll(out);
}

fn writeU32(w: *std.Io.Writer, value: usize) !void {
    var bytes: [4]u8 = undefined;
    std.mem.writeInt(u32, &bytes, @intCast(value), .little);
    try w.writeAll(&bytes);
}
