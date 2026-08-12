const std = @import("std");
const schema = @import("schema.zig");

pub fn printText(comptime Host: type, host: *Host, value: []const u8) !void {
    std.debug.assert(value.len <= std.math.maxInt(u32));
    var start: usize = 0;
    for (value, 0..) |byte, index| {
        const entity: ?[]const u8 = switch (byte) {
            '&' => "&amp;",
            '<' => "&lt;",
            '>' => "&gt;",
            else => null,
        };
        if (entity) |replacement| {
            if (start < index) try host.dialectWrite(value[start..index]);
            try host.dialectWrite(replacement);
            start = index + 1;
        }
    }
    if (start < value.len) try host.dialectWrite(value[start..]);
}

pub fn print(comptime Host: type, host: *Host, record_index: u32) !void {
    std.debug.assert(record_index < host.tree.dialect_store.records.items.len);
    const record = host.tree.dialect_store.records.items[record_index];
    switch (record) {
        .node => |node| try host.dialectEmit(node.value.raw),
        .jsx_code_block => |block| {
            try host.dialectWrite("@{");
            if (block.body.len > 0) {
                try host.dialectSpace();
                try host.dialectEmitStatements(block.body.start, block.body.len);
            }
            if (block.render.raw != std.math.maxInt(u32)) {
                try host.dialectSpace();
                try host.dialectEmit(block.render.raw);
            }
            try host.dialectSpace();
            try host.dialectWrite("}");
        },
        .jsx_for_expression => |expression| {
            try host.dialectWrite("@");
            try host.dialectEmit(expression.statement.raw);
            if (expression.empty.raw != std.math.maxInt(u32)) {
                try host.dialectWrite(" @empty ");
                try host.dialectEmit(expression.empty.raw);
            }
        },
        .jsx_if_expression => |expression| {
            try host.dialectWrite("@if (");
            try host.dialectEmit(expression.@"test".raw);
            try host.dialectWrite(") ");
            try host.dialectEmit(expression.consequent.raw);
            if (expression.alternate.raw != std.math.maxInt(u32)) {
                try host.dialectWrite(" @else ");
                try host.dialectEmit(expression.alternate.raw);
            }
        },
        .jsx_switch_expression => |expression| {
            try printSwitch(Host, host, expression.statement.raw);
        },
        .jsx_try_expression => |expression| {
            try printTry(Host, host, expression.statement.raw, expression.pending.raw);
        },
        .style_sheet => |sheet| try host.dialectWrite(
            host.tree.string(.{ .start = sheet.source.start, .end = sheet.source.end }),
        ),
        .jsx_style_element => |element| {
            try host.dialectEmit(element.opening_element.raw);
            try host.dialectWrite(host.tree.string(.{
                .start = element.css.start,
                .end = element.css.end,
            }));
            if (element.closing_element.raw != std.math.maxInt(u32))
                try host.dialectEmit(element.closing_element.raw);
        },
        .tsrx_expression => |expression| {
            try host.dialectWrite("{");
            try host.dialectEmit(expression.expression.raw);
            try host.dialectWrite("}");
        },
        .for_of, .catch_clause, .array_pattern, .object_pattern => unreachable,
    }
}

pub fn hasDisambiguatingAssignmentTargetPrefix(
    comptime Host: type,
    host: *const Host,
    record_index: u32,
    target_raw: u32,
) bool {
    std.debug.assert(target_raw < host.tree.nodes.len);
    std.debug.assert(record_index < host.tree.dialect_store.records.items.len);
    const target = host.tree.data(@enumFromInt(target_raw));
    std.debug.assert(target == .object_pattern);
    const overlay_index = host.tree.dialectOverlay(target_raw);
    std.debug.assert(overlay_index != null);
    std.debug.assert(overlay_index.? == record_index);
    return switch (host.tree.dialect_store.records.items[record_index]) {
        .object_pattern => |overlay| overlay.lazy,
        else => false,
    };
}

pub fn printOverlay(
    comptime Host: type,
    host: *Host,
    record_index: u32,
    node_index: anytype,
) !bool {
    std.debug.assert(record_index < host.tree.dialect_store.records.items.len);
    const raw: u32 = @intFromEnum(node_index);
    return switch (host.tree.dialect_store.records.items[record_index]) {
        .for_of => |overlay| block: {
            try printForOf(Host, host, raw, overlay.index.raw, overlay.key.raw);
            break :block true;
        },
        .array_pattern => |overlay| block: {
            if (!overlay.lazy) break :block false;
            try host.dialectWrite("&");
            try host.dialectEmitOverlaySuppressed(raw);
            break :block true;
        },
        .object_pattern => |overlay| block: {
            if (!overlay.lazy) break :block false;
            try host.dialectWrite("&");
            try host.dialectEmitOverlaySuppressed(raw);
            break :block true;
        },
        .catch_clause => |overlay| block: {
            try printCatch(Host, host, raw, overlay.reset_param.raw);
            break :block true;
        },
        .node,
        .jsx_code_block,
        .jsx_for_expression,
        .jsx_if_expression,
        .jsx_switch_expression,
        .jsx_try_expression,
        .style_sheet,
        .jsx_style_element,
        .tsrx_expression,
        => false,
    };
}

fn printForOf(comptime Host: type, host: *Host, raw: u32, index: u32, key: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .for_of_statement);
    const statement = data.for_of_statement;

    try host.dialectWrite("for");
    if (statement.await) try host.dialectWrite(" await");
    try host.dialectWrite(" (");
    try host.dialectEmitForLeft(@intFromEnum(statement.left));
    try host.dialectWrite(" of ");
    try host.dialectEmitValue(@intFromEnum(statement.right));
    if (index < host.tree.nodes.len) {
        try host.dialectWrite("; index ");
        try host.dialectEmit(index);
    } else std.debug.assert(index == std.math.maxInt(u32));
    if (key < host.tree.nodes.len) {
        try host.dialectWrite("; key ");
        try host.dialectEmit(key);
    } else std.debug.assert(key == std.math.maxInt(u32));
    try host.dialectWrite(") ");
    try host.dialectEmitStatement(@intFromEnum(statement.body));
}

fn printCatch(comptime Host: type, host: *Host, raw: u32, reset: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .catch_clause);
    const clause = data.catch_clause;

    try host.dialectWrite("@catch");
    if (clause.param != .null or reset < host.tree.nodes.len) {
        try host.dialectWrite(" (");
        if (clause.param != .null) try host.dialectEmit(@intFromEnum(clause.param));
        if (reset < host.tree.nodes.len) {
            if (clause.param != .null) try host.dialectWrite(", ");
            try host.dialectEmit(reset);
        } else std.debug.assert(reset == std.math.maxInt(u32));
        try host.dialectWrite(")");
    } else std.debug.assert(reset == std.math.maxInt(u32));
    try host.dialectSpace();
    try host.dialectEmit(@intFromEnum(clause.body));
}

fn printTry(comptime Host: type, host: *Host, raw: u32, pending: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .try_statement);
    const statement = data.try_statement;

    try host.dialectWrite("@try ");
    try host.dialectEmit(@intFromEnum(statement.block));
    if (pending < host.tree.nodes.len) {
        try host.dialectWrite(" @pending ");
        try host.dialectEmit(pending);
    } else std.debug.assert(pending == std.math.maxInt(u32));
    if (statement.handler != .null) {
        try host.dialectSpace();
        try host.dialectEmit(@intFromEnum(statement.handler));
    }
}

fn printSwitch(comptime Host: type, host: *Host, raw: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .switch_statement);
    const statement = data.switch_statement;
    const cases = host.tree.extra(statement.cases);

    try host.dialectWrite("@switch (");
    try host.dialectEmit(@intFromEnum(statement.discriminant));
    try host.dialectWrite(") {");
    for (cases) |case_index| {
        std.debug.assert(@intFromEnum(case_index) < host.tree.nodes.len);
        try host.dialectSpace();
        try printSwitchCase(Host, host, @intFromEnum(case_index));
    }
    if (cases.len > 0) try host.dialectSpace();
    try host.dialectWrite("}");
}

fn printSwitchCase(comptime Host: type, host: *Host, raw: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .switch_case);
    const case = data.switch_case;

    if (case.@"test" != .null) {
        try host.dialectWrite("@case ");
        try host.dialectEmit(@intFromEnum(case.@"test"));
    } else {
        try host.dialectWrite("@default");
    }
    try host.dialectWrite(": ");
    try host.dialectEmitBlock(case.consequent.start, case.consequent.len);
}
