//! Store-first identity lookup used by local downstream surfaces.
const yuku = @import("yuku");

pub const basic = yuku.traverser.basic;
pub const scoped = yuku.traverser.scoped;
pub const semantic = yuku.traverser.semantic;
pub const transform = yuku.traverser.transform;
pub const walk = yuku.traverser.walk;
pub const Layer = yuku.traverser.Layer;
pub const Action = yuku.traverser.Action;
pub const NodePath = yuku.traverser.NodePath;

pub fn recordIndex(tree: anytype, node: anytype) ?u32 {
    return tree.dialectRecord(@intFromEnum(node));
}

pub fn overlayIndex(tree: anytype, node: anytype) ?u32 {
    return tree.dialectOverlay(@intFromEnum(node));
}
