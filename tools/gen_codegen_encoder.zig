const std = @import("std");
const encoder = @import("encoder");
const emit = @import("emit");

pub fn main(init: std.process.Init) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    var generated: std.Io.Writer.Allocating = .init(arena.allocator());
    try encoder.generate(&generated.writer);
    var buffer: [128 * 1024]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try emit.minified(arena.allocator(), &output.interface, generated.written());
    try output.flush();
}
