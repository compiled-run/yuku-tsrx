//! The ordinary Yuku tree remains the projection: standalone TSRX records use
//! EmptyStatement anchors and overlays retain their ordinary host nodes.
pub fn ordinary(tree: anytype) @TypeOf(&tree.tree) {
    return &tree.tree;
}
