const std = @import("std");
const abi = @import("dialect_abi");

pub fn elementName(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (Host.currentToken(parser) != .left_brace) return .unhandled;
    return .{ .handled = try Host.parseTagExpressionContainer(parser) };
}

pub fn validateElementName(comptime Host: type, parser: anytype, node: Host.NodeIndex) Host.ErrorType!abi.Decision(void) {
    const expression = switch (Host.data(parser, node)) {
        .jsx_expression_container => |data| data.expression,
        else => return .unhandled,
    };
    if (!validExpression(Host, parser, expression, 0)) {
        try Host.reportWithHelp(
            parser,
            Host.nodeSpan(parser, node),
            "TSRX dynamic tag expression must resolve to an element name",
            "Use an identifier, member expression, string literal, or conditional.",
        );
    }
    return .{ .handled = {} };
}

pub fn namesMatch(comptime Host: type, parser: anytype, left: Host.NodeIndex, right: Host.NodeIndex) abi.Decision(bool) {
    const left_expression = switch (Host.data(parser, left)) {
        .jsx_expression_container => |data| data.expression,
        else => return .unhandled,
    };
    const right_expression = switch (Host.data(parser, right)) {
        .jsx_expression_container => |data| data.expression,
        else => return .unhandled,
    };
    return .{ .handled = sameExpression(Host, parser, left_expression, right_expression) };
}

fn sameExpression(comptime Host: type, parser: anytype, left: Host.NodeIndex, right: Host.NodeIndex) bool {
    const left_span = Host.nodeSpan(parser, left);
    const right_span = Host.nodeSpan(parser, right);
    return std.mem.eql(
        u8,
        std.mem.trim(u8, Host.sourceText(parser, left_span), " \t\r\n"),
        std.mem.trim(u8, Host.sourceText(parser, right_span), " \t\r\n"),
    );
}

fn validExpression(comptime Host: type, parser: anytype, node: Host.NodeIndex, depth: u8) bool {
    if (node == .null or depth == 64) return false;
    return switch (Host.data(parser, node)) {
        .identifier_reference => |data| !std.mem.eql(u8, Host.string(parser, data.name), "undefined"),
        .string_literal => true,
        .template_literal => |data| data.expressions.len == 0,
        .member_expression => |data| validExpression(Host, parser, data.object, depth + 1) and
            validExpression(Host, parser, data.property, depth + 1),
        .conditional_expression => |data| validExpression(Host, parser, data.@"test", depth + 1) and
            validExpression(Host, parser, data.consequent, depth + 1) and
            validExpression(Host, parser, data.alternate, depth + 1),
        .logical_expression => |data| validExpression(Host, parser, data.left, depth + 1) and
            validExpression(Host, parser, data.right, depth + 1),
        .parenthesized_expression => |data| validExpression(Host, parser, data.expression, depth + 1),
        .chain_expression => |data| validExpression(Host, parser, data.expression, depth + 1),
        .ts_as_expression => |data| validExpression(Host, parser, data.expression, depth + 1),
        .ts_type_assertion => |data| validExpression(Host, parser, data.expression, depth + 1),
        .ts_non_null_expression => |data| validExpression(Host, parser, data.expression, depth + 1),
        else => false,
    };
}
