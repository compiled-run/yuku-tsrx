const std = @import("std");
const parser = @import("yuku");

const warmup_iterations: u32 = 10_000;
const sample_iterations: u32 = 100_000;
const Case = struct { source: []const u8, lang: parser.ast.Lang };

pub fn main(init: std.process.Init) !void {
    const cases = [_]Case{
        .{ .source = @embedFile("fixtures/control.js"), .lang = .js },
        .{ .source = @embedFile("fixtures/control.ts"), .lang = .ts },
        .{ .source = @embedFile("fixtures/control.tsx"), .lang = .tsx },
    };

    const resolution = try std.Io.Clock.awake.resolution(init.io);
    if (resolution.nanoseconds <= 0) return error.ClockUnavailable;
    try parse_iterations(cases[0..], warmup_iterations);
    const started = std.Io.Clock.awake.now(init.io);
    try parse_iterations(cases[0..], sample_iterations);
    const elapsed = started.durationTo(std.Io.Clock.awake.now(init.io));
    if (elapsed.nanoseconds <= 0) return error.ClockDidNotAdvance;
    const elapsed_ns: u64 = @intCast(elapsed.nanoseconds);
    const parses = @as(u64, sample_iterations) * cases.len;

    std.debug.assert(elapsed_ns > 0);
    std.debug.assert(parses > 0);
    std.debug.print(
        "{{\"warmup_iterations\":{d},\"sample_iterations\":{d}," ++
            "\"files_per_iteration\":{d},\"elapsed_ns\":{d},\"ns_per_parse\":{d}}}\n",
        .{ warmup_iterations, sample_iterations, cases.len, elapsed_ns, elapsed_ns / parses },
    );
}

fn parse_iterations(cases: []const Case, iterations: u32) !void {
    std.debug.assert(cases.len > 0);
    std.debug.assert(iterations > 0);

    var iteration: u32 = 0;
    while (iteration < iterations) : (iteration += 1) {
        for (cases) |case| {
            var tree = try parser.parse(
                std.heap.page_allocator,
                case.source,
                .{ .lang = case.lang },
            );
            defer tree.deinit();
            if (tree.hasErrors()) return error.ProfileDiagnostic;
        }
    }
}
