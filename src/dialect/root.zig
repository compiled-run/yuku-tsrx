const std = @import("std");
const abi = @import("dialect_abi");

pub const enabled = true;
pub const Hook = abi.Hook;
pub const hooks = std.enums.values(abi.Hook);
pub const schema = @import("schema.zig");
pub const Record = schema.Record;

pub const OverlayPair = struct {
    host_node: u32,
    record_index: u32,
};

pub const Store = struct {
    records: std.ArrayList(Record) = .empty,
    overlays: std.ArrayList(OverlayPair) = .empty,

    pub fn addRecord(self: *Store, arena: std.mem.Allocator, record: Record) !u32 {
        if (self.records.items.len == records_max) return error.RecordCapacityExceeded;
        const index: u32 = @intCast(self.records.items.len);
        try self.records.append(arena, record);
        return index;
    }

    pub fn addOverlay(self: *Store, arena: std.mem.Allocator, host_node: u32, record_index: u32) !void {
        if (record_index >= self.records.items.len) return error.InvalidRecordIndex;
        if (self.overlays.items.len == overlays_max) return error.OverlayCapacityExceeded;
        if (self.overlays.getLastOrNull()) |last| {
            if (host_node <= last.host_node) return error.OverlayOrderInvalid;
        }
        try self.overlays.append(arena, .{ .host_node = host_node, .record_index = record_index });
    }

    pub fn findOverlay(self: *const Store, host_node: u32) ?u32 {
        var lower: u32 = 0;
        var upper: u32 = @intCast(self.overlays.items.len);
        var probes: u8 = 0;
        while (lower < upper and probes < overlay_probes_max) : (probes += 1) {
            const middle = lower + (upper - lower) / 2;
            const pair = self.overlays.items[middle];
            if (pair.host_node < host_node) lower = middle + 1 else upper = middle;
        }
        if (lower == self.overlays.items.len) return null;
        const pair = self.overlays.items[lower];
        return if (pair.host_node == host_node) pair.record_index else null;
    }
};

const records_max: u32 = 1 << 20;
const overlays_max: u32 = 1 << 20;
const overlay_probes_max: u8 = 32;

const code_block = @import("code_block.zig");
const control_flow = @import("control_flow.zig");
const jsx = @import("jsx.zig");
const modules = @import("modules.zig");
const patterns = @import("patterns.zig");
const style = @import("style.zig");
const text = @import("text.zig");

pub const statement_at_code_block = code_block.statement;
pub const expression_at_code_block = code_block.expression;
pub const function_body_starts = code_block.functionBodyStarts;
pub const function_body = code_block.functionBody;
pub const jsx_child_at_code_block = code_block.jsxChild;

pub const statement_at_control_flow = control_flow.statement;
pub const expression_at_control_flow = control_flow.expression;
pub const jsx_child_at_control_flow = control_flow.jsxChild;
pub const for_of_tail = control_flow.forOfTail;

pub const lazy_assignment_pattern = patterns.lazyAssignment;
pub const binding_pattern = patterns.binding;
pub const can_start_binding = patterns.canStartBinding;
pub const module_specifier = modules.specifier;

pub const jsx_element_after_open = style.afterOpen;
pub const jsx_element_name = jsx.elementName;
pub const validate_jsx_element_name = jsx.validateElementName;
pub const jsx_names_match = jsx.namesMatch;
pub const jsx_text_boundary = text.boundary;
pub const jsx_text_value = text.value;
