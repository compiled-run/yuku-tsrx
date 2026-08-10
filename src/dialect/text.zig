const std = @import("std");
const abi = @import("dialect_abi");

pub fn boundary(comptime Host: type, source: []const u8, cursor: u32) abi.Decision(bool) {
    _ = Host;
    return .{ .handled = cursor < source.len and source[cursor] == '@' };
}

pub fn value(comptime Host: type, parser: anytype, span: anytype) Host.ErrorType!abi.Decision(Host.Value) {
    const source = Host.sourceText(parser, span);
    if (std.mem.indexOfScalar(u8, source, '&') == null) return .unhandled;
    var decoded: std.ArrayList(u8) = .empty;
    defer decoded.deinit(Host.allocator(parser));
    var cursor: usize = 0;
    while (cursor < source.len) {
        if (source[cursor] != '&') {
            try decoded.append(Host.allocator(parser), source[cursor]);
            cursor += 1;
            continue;
        }
        const semicolon = std.mem.indexOfScalarPos(u8, source, cursor, ';') orelse {
            try decoded.append(Host.allocator(parser), '&');
            cursor += 1;
            continue;
        };
        const entity = source[cursor + 1 .. semicolon];
        const replacement: ?u8 = if (std.mem.eql(u8, entity, "quot")) '"' else if (std.mem.eql(u8, entity, "amp")) '&' else if (std.mem.eql(u8, entity, "lt")) '<' else if (std.mem.eql(u8, entity, "gt")) '>' else if (std.mem.eql(u8, entity, "apos")) '\'' else if (std.mem.startsWith(u8, entity, "#x")) std.fmt.parseInt(u8, entity[2..], 16) catch null else if (std.mem.startsWith(u8, entity, "#")) std.fmt.parseInt(u8, entity[1..], 10) catch null else null;
        if (replacement) |byte| try decoded.append(Host.allocator(parser), byte) else try decoded.appendSlice(Host.allocator(parser), source[cursor .. semicolon + 1]);
        cursor = semicolon + 1;
    }
    return .{ .handled = try Host.addString(parser, decoded.items) };
}
