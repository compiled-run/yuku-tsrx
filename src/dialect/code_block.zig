const abi = @import("dialect_abi");
const schema = @import("schema.zig");

pub fn statement(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = try parse(Host, parser, false) };
}

pub fn expression(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = try parse(Host, parser, false) };
}

pub fn jsxChild(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = try parse(Host, parser, false) };
}

pub fn functionBodyStarts(comptime Host: type, parser: anytype) abi.Decision(bool) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = true };
}

pub fn functionBody(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = try parse(Host, parser, true) };
}

fn startsBlock(comptime Host: type, parser: anytype) bool {
    if (Host.currentToken(parser) != .at) return false;
    const span = Host.currentSpan(parser);
    const source = Host.source(parser);
    return span.end < source.len and source[span.end] == '{';
}

fn parse(comptime Host: type, parser: anytype, allow_return: bool) Host.ErrorType!?Host.NodeIndex {
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return null;
    // Parse template blocks with return syntax enabled so the dialect owns the
    // single template-specific diagnostic below. Function bodies retain it.
    const block = try Host.parseBlockWithTemporaryReturn(parser, true) orelse return null;
    if (!allow_return) try reportReturns(Host, parser, block, 0);

    const range = switch (Host.data(parser, block)) {
        .block_statement => |data| data.body,
        .function_body => |data| data.body,
        else => return null,
    };
    const items = Host.extra(parser, range);
    var body_len = items.len;
    var render = Host.NodeIndex.null;
    if (body_len > 0) {
        const last = items[body_len - 1];
        render = renderNode(Host, parser, last);
        if (render != .null) body_len -= 1;
    }
    const body = try Host.addExtra(parser, items[0..body_len]);
    const end = Host.nodeSpan(parser, block).end;
    return @as(?Host.NodeIndex, try Host.addDialectNode(parser, schema.Record{ .jsx_code_block = .{
        .body = .{ .start = body.start, .len = body.len },
        .render = abi.OptionalNodeRef.init(@intFromEnum(render)),
    } }, .{ .start = start, .end = end }));
}

fn renderNode(comptime Host: type, parser: anytype, node: Host.NodeIndex) Host.NodeIndex {
    return switch (Host.data(parser, node)) {
        .expression_statement => |data| switch (Host.data(parser, data.expression)) {
            .jsx_element, .jsx_fragment, .dialect_node => data.expression,
            else => .null,
        },
        .dialect_node => node,
        else => .null,
    };
}

fn reportReturns(comptime Host: type, parser: anytype, node: Host.NodeIndex, depth: u8) Host.ErrorType!void {
    if (depth == 64) return;
    switch (Host.data(parser, node)) {
        .return_statement => try Host.reportWithHelp(
            parser,
            Host.nodeSpan(parser, node),
            "`return` is invalid inside TSRX template blocks",
            "Use rendered output as the final expression instead.",
        ),
        .block_statement => |data| for (Host.extra(parser, data.body)) |child| {
            try reportReturns(Host, parser, child, depth + 1);
        },
        .if_statement => |data| {
            try reportReturns(Host, parser, data.consequent, depth + 1);
            if (data.alternate != .null) try reportReturns(Host, parser, data.alternate, depth + 1);
        },
        else => {},
    }
}
