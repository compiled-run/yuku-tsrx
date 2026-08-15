const std = @import("std");
const napi = @import("napi-zig");
const parser = @import("parser");

const ParseOptions = struct {
    source_type: parser.ast.SourceType = .module,
    lang: parser.ast.Lang = .js,
    preserve_parens: bool = true,
    loose: bool = false,
};

/// Benchmark-only probe for production parser/tree cost. This module is not
/// installed into or exported by the public yuku-tsrx npm package.
pub fn parseTree(source: []const u8, options: ParseOptions) !u32 {
    var tree = parser.parse(std.heap.smp_allocator, source, .{
        .source_type = options.source_type,
        .lang = options.lang,
        .preserve_parens = options.preserve_parens,
        .comments = .flat,
        .loose = options.loose,
    }) catch return error.ParseFailed;
    defer tree.deinit();
    return @intCast(source.len);
}

comptime {
    napi.module(@This());
}
