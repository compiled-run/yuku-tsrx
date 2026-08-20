//! Parser-mode entry point for the shared decoder generator: emits `decode.js`.
//! All generation logic lives in tools/decoder_generator.zig, so this and
//! gen_analyzer_decoder.zig cannot drift apart.
const std = @import("std");
const decoder_generator = @import("decoder_generator.zig");

pub const Mode = decoder_generator.Mode;
pub const generate = decoder_generator.generate;

pub fn main(init: std.process.Init) !void {
    try decoder_generator.emitToStdout(init, .parser);
}
