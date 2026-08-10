const abi = @import("dialect_abi");

pub fn specifier(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    return .{ .handled = try Host.parseIdentifier(parser) };
}
