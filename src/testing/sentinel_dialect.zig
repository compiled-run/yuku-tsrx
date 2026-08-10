const std = @import("std");
const abi = @import("dialect_abi");

pub const enabled = true;
pub const Hook = abi.Hook;
pub const hooks = std.enums.values(abi.Hook);
pub const NodeRecord = struct {
    value: abi.NodeRef,
    active: bool,
};

pub const ForOfOverlay = struct {
    pub const estree_type = "ForOfStatement";
    host_node: abi.OverlayHost,
    index: abi.NodeRef,
    key: abi.NodeRef,
};

pub const CatchClauseOverlay = struct {
    host_node: abi.OverlayHost,
    reset_param: abi.OptionalNodeRef,
};

pub const ArrayPatternOverlay = struct {
    host_node: abi.OverlayHost,
    lazy: bool,
};

pub const ObjectPatternOverlay = struct {
    host_node: abi.OverlayHost,
    lazy: bool,
};

pub const Record = union(enum) {
    node: NodeRecord,
    for_of: ForOfOverlay,
    catch_clause: CatchClauseOverlay,
    array_pattern: ArrayPatternOverlay,
    object_pattern: ObjectPatternOverlay,
};

const SentinelRecord = Record;
pub const schema = struct {
    pub const Record = SentinelRecord;
    pub const record_count: u8 = @typeInfo(SentinelRecord).@"union".fields.len;
};

pub const OverlayPair = struct {
    host_node: u32,
    record_index: u32,
};

pub const Store = struct {
    records: std.ArrayList(Record) = .empty,
    overlays: std.ArrayList(OverlayPair) = .empty,

    pub fn addRecord(self: *Store, arena: std.mem.Allocator, record: Record) !u32 {
        std.debug.assert(self.records.items.len <= records_max);
        std.debug.assert(self.overlays.items.len <= overlays_max);
        if (self.records.items.len == records_max) return error.RecordCapacityExceeded;
        const index: u32 = @intCast(self.records.items.len);
        try self.records.append(arena, record);
        return index;
    }

    pub fn addOverlay(
        self: *Store,
        arena: std.mem.Allocator,
        host_node: u32,
        record_index: u32,
    ) !void {
        std.debug.assert(self.records.items.len <= records_max);
        std.debug.assert(self.overlays.items.len <= overlays_max);
        if (record_index >= self.records.items.len) return error.InvalidRecordIndex;
        if (self.overlays.items.len == overlays_max) return error.OverlayCapacityExceeded;
        if (self.overlays.getLastOrNull()) |last| {
            if (host_node <= last.host_node) return error.OverlayOrderInvalid;
        }
        try self.overlays.append(arena, .{
            .host_node = host_node,
            .record_index = record_index,
        });
    }

    pub fn findOverlay(self: *const Store, host_node: u32) ?u32 {
        std.debug.assert(self.records.items.len <= records_max);
        std.debug.assert(self.overlays.items.len <= overlays_max);
        var lower: u32 = 0;
        var upper: u32 = @intCast(self.overlays.items.len);
        var probes: u8 = 0;
        while (lower < upper and probes < overlay_probes_max) : (probes += 1) {
            const middle = lower + (upper - lower) / 2;
            const pair = self.overlays.items[middle];
            if (pair.host_node < host_node) lower = middle + 1 else upper = middle;
        }
        std.debug.assert(probes < overlay_probes_max or lower == upper);
        if (lower == self.overlays.items.len) return null;
        const pair = self.overlays.items[lower];
        return if (pair.host_node == host_node) pair.record_index else null;
    }
};

const records_max: u32 = 1 << 20;
const overlays_max: u32 = 1 << 20;
const overlay_probes_max: u8 = 32;

pub var selected_hook: ?Hook = null;
pub var select_handled: bool = false;
pub var marker_boundary: bool = false;
pub const CapabilityMode = enum { none, transformed_text, block_split, raw_resume };
pub var capability_mode: CapabilityMode = .none;
pub var capability_body_len: u32 = 0;
pub var capability_render: u32 = std.math.maxInt(u32);
pub var capability_split_count: u32 = 0;
pub var capability_raw_children: u32 = 0;
pub const ControlReportMode = enum { none, no_help, with_help };
pub var control_report_mode: ControlReportMode = .none;

pub fn resetHooks() void {
    selected_hook = null;
    select_handled = false;
    marker_boundary = false;
    capability_mode = .none;
    capability_body_len = 0;
    capability_render = std.math.maxInt(u32);
    capability_split_count = 0;
    capability_raw_children = 0;
    control_report_mode = .none;
}

fn handles(comptime hook: Hook) bool {
    return select_handled and selected_hook == hook;
}

pub fn statement_at_code_block(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (capability_mode == .block_split) {
        const start = Host.currentSpan(parser).start;
        if (!try Host.expect(parser, .at, "Expected sentinel code-block marker")) return .{ .handled = null };
        const block = try Host.parseBlockWithTemporaryReturn(parser, false) orelse
            return .{ .handled = null };
        return .{ .handled = try splitBlock(Host, parser, block, start) };
    }
    return if (handles(.statement_at_code_block)) .{ .handled = try Host.parseStatementExpression(parser) } else .unhandled;
}
pub fn statement_at_control_flow(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (selected_hook == .statement_at_control_flow and control_report_mode != .none) {
        if (control_report_mode == .no_help) {
            try Host.report(parser, Host.currentSpan(parser), "Sentinel control-flow report");
        } else {
            try Host.reportWithHelp(
                parser,
                Host.currentSpan(parser),
                "Sentinel control-flow report",
                "Sentinel control-flow help",
            );
        }
        return .{ .handled = null };
    }
    return if (handles(.statement_at_control_flow)) .{ .handled = try Host.parseStatementExpression(parser) } else .unhandled;
}
pub fn expression_at_code_block(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (capability_mode == .block_split) {
        const start = Host.currentSpan(parser).start;
        if (!try Host.advance(parser)) return .{ .handled = null };
        const block = try Host.parseBlockWithTemporaryReturn(parser, false) orelse
            return .{ .handled = null };
        return .{ .handled = try splitBlock(Host, parser, block, start) };
    }
    if (!handles(.expression_at_code_block)) return .unhandled;
    if (!try Host.advance(parser)) return .{ .handled = null };
    const node = try Host.parseBlock(parser) orelse return .{ .handled = null };
    const record = try Host.addRecord(parser, Record{ .node = .{ .value = abi.NodeRef.init(@intFromEnum(node)), .active = true } });
    try Host.addOverlay(parser, node, record);
    return .{ .handled = node };
}
pub fn expression_at_control_flow(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (selected_hook == .expression_at_control_flow and control_report_mode != .none) {
        if (control_report_mode == .no_help) {
            try Host.report(parser, Host.currentSpan(parser), "Sentinel control-flow report");
        } else {
            try Host.reportWithHelp(
                parser,
                Host.currentSpan(parser),
                "Sentinel control-flow report",
                "Sentinel control-flow help",
            );
        }
        return .{ .handled = null };
    }
    if (!handles(.expression_at_control_flow)) return .unhandled;
    if (!try Host.advance(parser)) return .{ .handled = null };
    const node = try Host.parseStatement(parser) orelse return .{ .handled = null };
    const record = try Host.addRecord(parser, Record{ .node = .{ .value = abi.NodeRef.init(@intFromEnum(node)), .active = true } });
    try Host.addOverlay(parser, node, record);
    return .{ .handled = node };
}
pub fn lazy_assignment_pattern(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!handles(.lazy_assignment_pattern)) return .unhandled;
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return .{ .handled = null };
    const open = Host.currentToken(parser);
    const node = switch (open) {
        .left_bracket => try Host.parseArrayCover(parser) orelse return .{ .handled = null },
        .left_brace => try Host.parseObjectCover(parser) orelse return .{ .handled = null },
        else => return .{ .handled = null },
    };
    try Host.expressionToAssignablePattern(parser, node);
    Host.extendNodeStart(parser, node, start);
    const record = try Host.addRecord(parser, switch (open) {
        .left_bracket => Record{ .array_pattern = .{
            .host_node = abi.OverlayHost.init(@intFromEnum(node)),
            .lazy = true,
        } },
        .left_brace => Record{ .object_pattern = .{
            .host_node = abi.OverlayHost.init(@intFromEnum(node)),
            .lazy = true,
        } },
        else => unreachable,
    });
    try Host.addOverlay(parser, node, record);
    return .{ .handled = node };
}
pub fn function_body_starts(comptime Host: type, parser: anytype) abi.Decision(bool) {
    if (capability_mode == .block_split) return .{ .handled = Host.currentToken(parser) != .left_brace };
    return if (handles(.function_body_starts)) .{ .handled = Host.currentToken(parser) != .left_brace } else .unhandled;
}
pub fn function_body(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (capability_mode == .block_split) {
        const start = Host.currentSpan(parser).start;
        if (!try Host.advance(parser)) return .{ .handled = null };
        const block = try Host.parseBlockWithTemporaryReturn(parser, true) orelse
            return .{ .handled = null };
        return .{ .handled = try splitBlock(Host, parser, block, start) };
    }
    if (!handles(.function_body)) return .unhandled;
    const node = try Host.parseBody(parser) orelse return .{ .handled = null };
    const record = try Host.addRecord(parser, Record{ .node = .{ .value = abi.NodeRef.init(@intFromEnum(node)), .active = true } });
    try Host.addOverlay(parser, node, record);
    return .{ .handled = node };
}
pub fn for_of_tail(comptime Host: type, parser: anytype, context: Host.Context) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!handles(.for_of_tail)) return .unhandled;
    if (Host.currentToken(parser) != .colon) return .unhandled;
    if (!try Host.advance(parser)) return .{ .handled = null };
    const index = try Host.parseExpression(parser) orelse return .{ .handled = null };
    if (!try Host.expect(parser, .comma, "Expected ',' in sentinel loop tail")) return .{ .handled = null };
    const key = try Host.parseExpression(parser) orelse return .{ .handled = null };
    if (!try Host.expect(parser, .right_paren, "Expected ')' after sentinel loop tail")) return .{ .handled = null };
    const body = try Host.parseStatement(parser) orelse return .{ .handled = null };
    const host = try Host.addForOf(parser, context, body);
    const record_index = try Host.addRecord(parser, Record{ .for_of = .{
        .host_node = abi.OverlayHost.init(@intFromEnum(host)),
        .index = abi.NodeRef.init(@intFromEnum(index)),
        .key = abi.NodeRef.init(@intFromEnum(key)),
    } });
    try Host.addOverlay(parser, host, record_index);
    return .{ .handled = host };
}
pub fn binding_pattern(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!handles(.binding_pattern)) return .unhandled;
    if (Host.currentToken(parser) != .bitwise_and) return .unhandled;
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return .{ .handled = null };
    const open = Host.currentToken(parser);
    if (open != .left_bracket and open != .left_brace) return .{ .handled = null };
    const node = try Host.parseOrdinaryBinding(parser) orelse return .{ .handled = null };
    Host.extendNodeStart(parser, node, start);
    const record = try Host.addRecord(parser, switch (open) {
        .left_bracket => Record{ .array_pattern = .{
            .host_node = abi.OverlayHost.init(@intFromEnum(node)),
            .lazy = true,
        } },
        .left_brace => Record{ .object_pattern = .{
            .host_node = abi.OverlayHost.init(@intFromEnum(node)),
            .lazy = true,
        } },
        else => unreachable,
    });
    try Host.addOverlay(parser, node, record);
    return .{ .handled = node };
}
pub fn module_specifier(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    return if (handles(.module_specifier)) .{ .handled = try Host.parseIdentifier(parser) } else .unhandled;
}
pub fn can_start_binding(comptime Host: type, token: Host.Token) abi.Decision(bool) {
    if (handles(.binding_pattern) and token == .bitwise_and) return .{ .handled = true };
    return if (handles(.can_start_binding)) .{ .handled = !Host.isIdentifierLike(token) } else .unhandled;
}
pub fn jsx_element_after_open(comptime Host: type, parser: anytype, opening: Host.NodeIndex, comptime context: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (capability_mode == .raw_resume) return parseRawElement(Host, parser, opening, context);
    if (!handles(.jsx_element_after_open)) return .unhandled;
    const node = try Host.finishElement(parser, opening, context) orelse return .{ .handled = null };
    const record = try Host.addRecord(parser, Record{ .node = .{ .value = abi.NodeRef.init(@intFromEnum(node)), .active = true } });
    try Host.addOverlay(parser, node, record);
    return .{ .handled = node };
}
pub fn jsx_names_match(comptime Host: type, parser: anytype, left: Host.NodeIndex, right: Host.NodeIndex) abi.Decision(bool) {
    return if (handles(.jsx_names_match)) .{ .handled = !Host.namesEqual(parser, left, right) } else .unhandled;
}
pub fn jsx_text_boundary(comptime Host: type, source: []const u8, cursor: u32) abi.Decision(bool) {
    _ = Host;
    const is_marker = cursor < source.len and source[cursor] == '@';
    if (select_handled and selected_hook == .jsx_text_boundary) {
        return .{ .handled = is_marker };
    }
    if (marker_boundary) return .{ .handled = is_marker };
    return .unhandled;
}
pub fn jsx_text_value(comptime Host: type, parser: anytype, span: anytype) Host.ErrorType!abi.Decision(Host.Value) {
    if (capability_mode == .transformed_text) {
        const source = Host.sourceText(parser, span);
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
                try decoded.append(Host.allocator(parser), source[cursor]);
                cursor += 1;
                continue;
            };
            const entity = source[cursor + 1 .. semicolon];
            const replacement: ?u8 = if (std.mem.eql(u8, entity, "quot")) '"' else if (std.mem.eql(u8, entity, "amp")) '&' else if (std.mem.eql(u8, entity, "lt")) '<' else if (std.mem.eql(u8, entity, "gt")) '>' else if (std.mem.eql(u8, entity, "apos")) '\'' else if (std.mem.startsWith(u8, entity, "#x")) std.fmt.parseInt(u8, entity[2..], 16) catch null else if (std.mem.startsWith(u8, entity, "#")) std.fmt.parseInt(u8, entity[1..], 10) catch null else null;
            if (replacement) |byte| {
                try decoded.append(Host.allocator(parser), byte);
            } else {
                try decoded.appendSlice(Host.allocator(parser), source[cursor .. semicolon + 1]);
            }
            cursor = semicolon + 1;
        }
        return .{ .handled = try Host.addString(parser, decoded.items) };
    }
    return if (handles(.jsx_text_value)) .{ .handled = Host.sourceSlice(parser, span.start, span.start) } else .unhandled;
}
pub fn jsx_child_at_code_block(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (capability_mode == .block_split) {
        const start = Host.currentSpan(parser).start;
        if (!try Host.advance(parser)) return .{ .handled = null };
        const block = try Host.parseBlockWithTemporaryReturn(parser, false) orelse
            return .{ .handled = null };
        return .{ .handled = try splitBlock(Host, parser, block, start) };
    }
    if (!handles(.jsx_child_at_code_block)) return .unhandled;
    if (!try Host.advance(parser)) return .{ .handled = null };
    return .{ .handled = try Host.parseChild(parser) };
}
pub fn jsx_child_at_control_flow(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!handles(.jsx_child_at_control_flow)) return .unhandled;
    if (!try Host.advance(parser)) return .{ .handled = null };
    return .{ .handled = try Host.parseChild(parser) };
}
pub fn jsx_element_name(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!handles(.jsx_element_name)) return .unhandled;
    const node = try Host.parseTagExpressionContainer(parser) orelse return .{ .handled = null };
    const record = try Host.addRecord(parser, Record{ .node = .{ .value = abi.NodeRef.init(@intFromEnum(node)), .active = true } });
    try Host.addOverlay(parser, node, record);
    return .{ .handled = node };
}
pub fn validate_jsx_element_name(comptime Host: type, parser: anytype, node: Host.NodeIndex) Host.ErrorType!abi.Decision(void) {
    if (!handles(.validate_jsx_element_name)) return .unhandled;
    try Host.report(parser, Host.nodeSpan(parser, node), "Sentinel rejected JSX element name");
    return .{ .handled = {} };
}

fn splitBlock(comptime Host: type, parser: anytype, block: Host.NodeIndex, start: u32) Host.ErrorType!?Host.NodeIndex {
    const range = switch (Host.data(parser, block)) {
        .block_statement => |data| data.body,
        .function_body => |data| data.body,
        else => return null,
    };
    const items = Host.extra(parser, range);
    var body_end = items.len;
    while (body_end > 0 and Host.data(parser, items[body_end - 1]) == .empty_statement) body_end -= 1;
    if (body_end == 0) return null;
    const render_statement = items[body_end - 1];
    const render = switch (Host.data(parser, render_statement)) {
        .expression_statement => |data| data.expression,
        .dialect_node => render_statement,
        else => return null,
    };
    _ = try Host.addExtra(parser, items[0 .. body_end - 1]);
    capability_body_len = @intCast(body_end - 1);
    capability_render = @intFromEnum(render);
    capability_split_count += 1;
    const span = Host.nodeSpan(parser, block);
    return @as(?Host.NodeIndex, try Host.addDialectNode(parser, Record{ .node = .{
        .value = abi.NodeRef.init(@intFromEnum(render)),
        .active = Host.currentReturnContext(parser) or start <= span.start,
    } }, .{ .start = start, .end = span.end }));
}

fn parseRawElement(comptime Host: type, parser: anytype, opening: Host.NodeIndex, comptime context: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    const opening_data = switch (Host.data(parser, opening)) {
        .jsx_opening_element => |data| data,
        else => return .unhandled,
    };
    if (opening_data.self_closing) return .unhandled;
    const name_value = switch (Host.data(parser, opening_data.name)) {
        .jsx_identifier => |data| data.name,
        else => return .unhandled,
    };
    const name = Host.string(parser, name_value);
    if (!std.mem.eql(u8, name, "raw")) return .unhandled;
    const source = Host.source(parser);
    const opening_span = Host.nodeSpan(parser, opening);
    const close_start = std.mem.indexOfPos(u8, source, opening_span.end, "</raw>") orelse {
        try Host.reportWithHelp(parser, opening_span, "Unclosed sentinel raw element", "Add a matching '</raw>' closing tag");
        return .{ .handled = null };
    };
    const close_end: u32 = @intCast(close_start + "</raw>".len);
    const content_span: Host.Span = .{ .start = opening_span.end, .end = @intCast(close_start) };
    const content = try Host.addNode(parser, Host.NodeData{ .jsx_text = .{
        .value = Host.sourceSlice(parser, content_span.start, content_span.end),
    } }, content_span);
    const closing_name_span: Host.Span = .{ .start = @intCast(close_start + 2), .end = @intCast(close_start + 5) };
    const closing_name = try Host.addNode(parser, Host.NodeData{ .jsx_identifier = .{
        .name = Host.sourceSlice(parser, closing_name_span.start, closing_name_span.end),
    } }, closing_name_span);
    _ = try Host.addNode(parser, Host.NodeData{ .jsx_closing_element = .{ .name = closing_name } }, .{
        .start = @intCast(close_start),
        .end = close_end,
    });
    _ = try Host.addExtra(parser, &.{content});
    capability_raw_children = 1;
    const node = try Host.addDialectNode(parser, Record{ .node = .{
        .value = abi.NodeRef.init(@intFromEnum(content)),
        .active = true,
    } }, .{ .start = opening_span.start, .end = close_end });
    if (!try Host.resumeAfterRawSpan(parser, close_end, context)) return .{ .handled = null };
    return .{ .handled = node };
}
