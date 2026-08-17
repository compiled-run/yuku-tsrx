const std = @import("std");
const abi = @import("dialect_abi");
const schema = @import("dialect_schema");

pub fn afterOpen(comptime Host: type, parser: anytype, opening: Host.NodeIndex, comptime context: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    const opening_data = switch (Host.data(parser, opening)) {
        .jsx_opening_element => |data| data,
        else => return .unhandled,
    };
    const name_value = switch (Host.data(parser, opening_data.name)) {
        .jsx_identifier => |data| data.name,
        else => return .unhandled,
    };
    if (!std.mem.eql(u8, Host.string(parser, name_value), "style")) return .unhandled;

    const opening_span = Host.nodeSpan(parser, opening);
    if (opening_data.self_closing) {
        return .{ .handled = try Host.addDialectNode(parser, schema.Record{ .jsx_style_element = .{
            .opening_element = abi.NodeRef.init(@intFromEnum(opening)),
            .children = .{ .start = 0, .len = 0 },
            .closing_element = abi.OptionalNodeRef.init(@intFromEnum(Host.NodeIndex.null)),
            .css = .{ .start = 0, .end = 0 },
        } }, opening_span) };
    }

    const source = Host.source(parser);
    const close = "</style>";
    const close_index = std.mem.indexOfPos(u8, source, opening_span.end, close) orelse {
        try Host.reportWithHelp(
            parser,
            .{ .start = opening_span.end, .end = opening_span.end },
            "Unclosed TSRX style element",
            "Add '</style>' before the end of the template.",
        );
        return .{ .handled = null };
    };
    const close_start: u32 = @intCast(close_index);
    const close_end: u32 = @intCast(close_index + close.len);
    const css = Host.sourceSlice(parser, opening_span.end, close_start);
    const sheet = try Host.addDialectNode(parser, schema.Record{ .style_sheet = .{ .source = .{
        .start = css.start,
        .end = css.end,
    } } }, .{ .start = opening_span.end, .end = close_start });
    const children = try Host.addExtra(parser, &.{sheet});

    const closing_name_span: Host.Span = .{ .start = close_start + 2, .end = close_start + 7 };
    const closing_name = try Host.addNode(parser, Host.NodeData{ .jsx_identifier = .{
        .name = Host.sourceSlice(parser, closing_name_span.start, closing_name_span.end),
    } }, closing_name_span);
    const closing = try Host.addNode(parser, Host.NodeData{ .jsx_closing_element = .{
        .name = closing_name,
    } }, .{ .start = close_start, .end = close_end });

    const node = try Host.addDialectNode(parser, schema.Record{ .jsx_style_element = .{
        .opening_element = abi.NodeRef.init(@intFromEnum(opening)),
        .children = .{ .start = children.start, .len = children.len },
        .closing_element = abi.OptionalNodeRef.init(@intFromEnum(closing)),
        .css = .{ .start = css.start, .end = css.end },
    } }, .{ .start = opening_span.start, .end = close_end });
    if (!try Host.resumeAfterRawSpan(parser, close_end, context)) return .{ .handled = null };
    return .{ .handled = node };
}
