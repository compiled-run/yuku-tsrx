const std = @import("std");
const base_transfer = @import("base_transfer");
const base = base_transfer.semantic;

pub const SubHeader = base.SubHeader;
pub const PackedScope = base.PackedScope;
pub const PackedSymbol = base.PackedSymbol;
pub const PackedReference = base.PackedReference;
pub const PackedImport = base.PackedImport;
pub const PackedExport = base.PackedExport;
pub const SUBHEADER_SIZE = base.SUBHEADER_SIZE;
pub const SCOPE_SIZE = base.SCOPE_SIZE;
pub const SYMBOL_SIZE = base.SYMBOL_SIZE;
pub const REFERENCE_SIZE = base.REFERENCE_SIZE;
pub const IMPORT_SIZE = base.IMPORT_SIZE;
pub const EXPORT_SIZE = base.EXPORT_SIZE;
pub const SCOPE_KIND_MASK = base.SCOPE_KIND_MASK;
pub const SCOPE_STRICT_BIT = base.SCOPE_STRICT_BIT;
pub const REFERENCE_TYPE_BIT = base.REFERENCE_TYPE_BIT;
pub const REFERENCE_WRITE_BIT = base.REFERENCE_WRITE_BIT;
pub const IMPORT_NAME_KIND_MASK = base.IMPORT_NAME_KIND_MASK;
pub const IMPORT_TYPE_BIT = base.IMPORT_TYPE_BIT;
pub const IMPORT_HAS_PHASE_BIT = base.IMPORT_HAS_PHASE_BIT;
pub const IMPORT_PHASE_BIT = base.IMPORT_PHASE_BIT;
pub const EXPORT_NAME_KIND_MASK = base.EXPORT_NAME_KIND_MASK;
pub const EXPORT_FROM_KIND_SHIFT = base.EXPORT_FROM_KIND_SHIFT;
pub const EXPORT_TYPE_BIT = base.EXPORT_TYPE_BIT;

pub fn bufferSize(tree: anytype, semantic: anytype, records: anytype, core_size: usize) usize {
    const base_core = base_transfer.bufferSize(&tree.tree);
    const base_total = base.bufferSize(&tree.tree, semantic, records);
    return std.mem.alignForward(usize, core_size, 4) +
        (base_total - std.mem.alignForward(usize, base_core, 4));
}

pub fn appendInto(
    tree: anytype,
    semantic: anytype,
    records: anytype,
    buffer: []u8,
    core_written: usize,
) !usize {
    const allocator = tree.tree.allocator();
    const base_total = base.bufferSize(&tree.tree, semantic, records);
    const temporary = try allocator.alloc(u8, base_total);
    defer allocator.free(temporary);
    const base_written = base.serializeInto(&tree.tree, semantic, records, temporary);
    const base_core = base_transfer.bufferSize(&tree.tree);
    const base_semantic = std.mem.alignForward(usize, base_core, 4);
    const local_semantic = std.mem.alignForward(usize, core_written, 4);
    @memset(buffer[core_written..local_semantic], 0);
    @memcpy(buffer[local_semantic..][0 .. base_written - base_semantic], temporary[base_semantic..base_written]);
    const flags_offset = base_transfer.HDR_FLAGS_U32 * 4;
    const flags = std.mem.readInt(u32, buffer[flags_offset..][0..4], .little);
    std.mem.writeInt(u32, buffer[flags_offset..][0..4], flags | base_transfer.FLAG_SEMANTIC, .little);
    return local_semantic + base_written - base_semantic;
}
