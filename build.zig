const std = @import("std");
const napi_zig = @import("napi_zig");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const yuku = b.dependency("yuku", .{
        .target = target,
        .optimize = optimize,
    });

    const module = b.addModule("yuku-tsrx", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("yuku", yuku.module("parser"));

    const unit_tests = b.addTest(.{ .root_module = module });
    const behavior_tests_module = b.createModule(.{
        .root_source_file = b.path("src/testing/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    behavior_tests_module.addImport("yuku", yuku.module("parser"));
    const behavior_tests = b.addTest(.{ .root_module = behavior_tests_module });

    const test_step = b.step("test", "Run unit and parser control tests");
    test_step.dependOn(&b.addRunArtifact(unit_tests).step);
    test_step.dependOn(&b.addRunArtifact(behavior_tests).step);

    const fuzz_module = b.createModule(.{
        .root_source_file = b.path("src/testing/fuzz.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    fuzz_module.addImport("yuku", yuku.module("parser"));
    const fuzz_executable = b.addExecutable(.{
        .name = "yuku-tsrx-fuzz",
        .root_module = fuzz_module,
    });
    const fuzz_run = b.addRunArtifact(fuzz_executable);
    fuzz_run.has_side_effects = true;
    const fuzz_step = b.step("fuzz", "Run the bounded parser control fuzzer");
    fuzz_step.dependOn(&fuzz_run.step);

    const control_module = b.createModule(.{
        .root_source_file = b.path("src/control.zig"),
        .target = target,
        .optimize = optimize,
        .strip = true,
    });
    control_module.addImport("yuku", yuku.module("parser"));
    control_module.addAnonymousImport("control_js", .{
        .root_source_file = b.path("profiler/fixtures/control.js"),
    });
    control_module.addAnonymousImport("control_ts", .{
        .root_source_file = b.path("profiler/fixtures/control.ts"),
    });
    control_module.addAnonymousImport("control_tsx", .{
        .root_source_file = b.path("profiler/fixtures/control.tsx"),
    });
    const control_executable = b.addExecutable(.{
        .name = "yuku-tsrx-control",
        .root_module = control_module,
    });
    const control_install = b.addInstallArtifact(control_executable, .{});
    const control_run = b.addRunArtifact(control_executable);
    const control_step = b.step("control", "Build and run the dialect-free control");
    control_step.dependOn(&control_install.step);
    control_step.dependOn(&control_run.step);

    const profile_module = b.createModule(.{
        .root_source_file = b.path("profiler/profile.zig"),
        .target = target,
        .optimize = optimize,
    });
    profile_module.addImport("yuku", yuku.module("parser"));
    const profile_executable = b.addExecutable(.{
        .name = "yuku-tsrx-profiler",
        .root_module = profile_module,
    });
    const profile_run = b.addRunArtifact(profile_executable);
    profile_run.has_side_effects = true;
    const profile_step = b.step("profile", "Measure dialect-free parser controls");
    profile_step.dependOn(&profile_run.step);

    if (yuku.builder.modules.get("dialect-abi")) |dialect_abi_module| {
        const production_dialect_module = b.createModule(.{
            .root_source_file = b.path("src/dialect/root.zig"),
            .target = target,
            .optimize = optimize,
        });
        production_dialect_module.addImport("dialect_abi", dialect_abi_module);
        const dialect_parser_template = yuku.module("parser-dialect");
        const production_parser_module = cloneModule(
            b,
            dialect_parser_template,
            yuku.path("src/parser/root.zig"),
            target,
            optimize,
        );
        production_parser_module.addImport("dialect", production_dialect_module);
        const production_transfer_module = b.createModule(.{
            .root_source_file = yuku.path("src/parser/ffi/transfer/root.zig"),
            .target = target,
            .optimize = optimize,
        });
        production_transfer_module.addImport("parser", production_parser_module);

        const napi_dep = b.dependency("napi_zig", .{});
        napi_zig.addLib(b, napi_dep, .{
            .name = "yuku-tsrx",
            .root = yuku.path("src/parser/ffi/parser.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "parser", .module = production_parser_module }},
            .npm = .{
                .scope = "@yuku-tsrx",
                .description = "Native TSRX parser bindings",
                .dts = .auto,
            },
        });

        addEstreeGenerator(b, yuku, production_parser_module, production_transfer_module, .{
            .step = "gen-parser-decoder",
            .description = "Generate production TSRX parser decoder",
            .root = "tools/gen_parser_decoder.zig",
            .kind = .decoder,
            .output = "decode.js",
        });
        addEstreeGenerator(b, yuku, production_parser_module, production_transfer_module, .{
            .step = "gen-analyzer-decoder",
            .description = "Generate production TSRX analyzer decoder",
            .root = "tools/gen_analyzer_decoder.zig",
            .kind = .decoder,
            .output = "decode-analyzer.js",
        });
        addEstreeGenerator(b, yuku, production_parser_module, production_transfer_module, .{
            .step = "gen-codegen-encoder",
            .description = "Generate production TSRX codegen encoder",
            .root = "tools/gen_codegen_encoder.zig",
            .kind = .encoder,
            .output = "encode.js",
        });
        const sentinel_dialect_module = b.createModule(.{
            .root_source_file = b.path("src/testing/sentinel_dialect.zig"),
            .target = target,
            .optimize = optimize,
        });
        sentinel_dialect_module.addImport("dialect_abi", dialect_abi_module);
        const sentinel_parser_module = dialect_parser_template;
        sentinel_parser_module.addImport("dialect", sentinel_dialect_module);
        const sentinel_transfer_module = yuku.module("transfer-dialect");
        sentinel_transfer_module.addImport("parser", sentinel_parser_module);
        const production_contract_source = std.Io.Dir.cwd().readFileAlloc(
            b.graph.io,
            "src/dialect/root.zig",
            b.allocator,
            .limited(1024 * 1024),
        ) catch @panic("unable to read production dialect contract");
        const production_contract = b.addOptions();
        production_contract.addOption(
            bool,
            "forbidden_parser_import",
            std.mem.indexOf(u8, production_contract_source, "@import(\"parser\")") != null,
        );
        production_contract.addOption(
            bool,
            "second_parser_declaration",
            std.mem.indexOf(u8, production_contract_source, "pub fn parse") != null,
        );
        const dialect_test_module = b.createModule(.{
            .root_source_file = b.path("src/testing/dialect.zig"),
            .target = target,
            .optimize = optimize,
        });
        dialect_test_module.addImport("dialect", sentinel_dialect_module);
        dialect_test_module.addImport("parser", sentinel_parser_module);
        dialect_test_module.addImport("transfer", sentinel_transfer_module);
        dialect_test_module.addImport("production_contract", production_contract.createModule());
        const dialect_tests = b.addRunArtifact(b.addTest(.{ .root_module = dialect_test_module }));
        const dialect_cycle_step = b.step(
            "test-m1-module-cycle",
            "Compile the dependency-free dialect module graph",
        );
        dialect_cycle_step.dependOn(&dialect_tests.step);

        const m1_fixture_module = b.createModule(.{
            .root_source_file = b.path("src/testing/m1_reflected_transfer_fixture.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        m1_fixture_module.addImport("dialect", sentinel_dialect_module);
        m1_fixture_module.addImport("parser", sentinel_parser_module);
        m1_fixture_module.addImport("transfer", sentinel_transfer_module);
        const m1_fixture = b.addExecutable(.{
            .name = "yuku-tsrx-m1-reflected-transfer",
            .root_module = m1_fixture_module,
        });
        const m1_fixture_install = b.addInstallArtifact(m1_fixture, .{});
        const m1_fixture_step = b.step(
            "m1-reflected-transfer-fixtures",
            "Build reflected dialect transfer fixtures",
        );
        m1_fixture_step.dependOn(&m1_fixture_install.step);

        inline for ([_]struct {
            name: []const u8,
            root: []const u8,
            output: []const u8,
        }{
            .{
                .name = "gen-m1-dialect-decoder",
                .root = "tools/gen_parser_decoder.zig",
                .output = "dialect-decode.js",
            },
            .{
                .name = "gen-m1-dialect-encoder",
                .root = "tools/gen_codegen_encoder.zig",
                .output = "dialect-encode.js",
            },
        }) |cfg| {
            const generator_module = b.createModule(.{
                .root_source_file = yuku.path(cfg.root),
                .target = b.graph.host,
                .optimize = optimize,
            });
            generator_module.addImport("parser", sentinel_parser_module);
            generator_module.addImport("transfer", sentinel_transfer_module);
            const generator = b.addExecutable(.{
                .name = cfg.name,
                .root_module = generator_module,
            });
            const output = b.addRunArtifact(generator).captureStdOut(.{});
            const install = b.addInstallFile(output, cfg.output);
            const step = b.step(cfg.name, "Generate reflected sentinel dialect metadata");
            step.dependOn(&install.step);
        }

        const plain_transfer_module = b.createModule(.{
            .root_source_file = yuku.path("src/parser/ffi/transfer/root.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        plain_transfer_module.addImport("parser", yuku.module("parser"));
        addEstreeGenerator(b, yuku, yuku.module("parser"), plain_transfer_module, .{
            .step = "gen-dialect-free-parser-decoder",
            .description = "Generate exact dialect-free parser decoder",
            .root = "tools/gen_parser_decoder.zig",
            .kind = .decoder,
            .output = "dialect-free-decode.js",
        });

        const binding_test_module = b.createModule(.{
            .root_source_file = b.path("src/testing/m2.zig"),
            .target = target,
            .optimize = optimize,
        });
        binding_test_module.addImport("dialect", production_dialect_module);
        binding_test_module.addImport("parser", production_parser_module);
        binding_test_module.addImport("transfer", production_transfer_module);
        const binding_tests = b.addRunArtifact(b.addTest(.{ .root_module = binding_test_module }));
        const binding_test_step = b.step(
            "test-m2-binding-seam",
            "Test the production lazy binding-prefix seam",
        );
        binding_test_step.dependOn(&binding_tests.step);

        const dialect_fixture_options = b.addOptions();
        dialect_fixture_options.addOption(bool, "dialect_mode", true);
        const dialect_fixture_module = b.createModule(.{
            .root_source_file = b.path("src/testing/fixtures.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        dialect_fixture_module.addImport("parser", production_parser_module);
        dialect_fixture_module.addImport("transfer", production_transfer_module);
        dialect_fixture_module.addImport(
            "fixture_options",
            dialect_fixture_options.createModule(),
        );
        addM2FixtureImports(b, dialect_fixture_module);
        const dialect_fixture_executable = b.addExecutable(.{
            .name = "yuku-tsrx-m2-fixtures-dialect",
            .root_module = dialect_fixture_module,
        });
        const dialect_fixture_install = b.addInstallArtifact(
            dialect_fixture_executable,
            .{},
        );

        const plain_fixture_options = b.addOptions();
        plain_fixture_options.addOption(bool, "dialect_mode", false);
        const plain_fixture_module = b.createModule(.{
            .root_source_file = b.path("src/testing/fixtures.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        plain_fixture_module.addImport("parser", yuku.module("parser"));
        plain_fixture_module.addImport("transfer", plain_transfer_module);
        plain_fixture_module.addImport(
            "fixture_options",
            plain_fixture_options.createModule(),
        );
        addM2FixtureImports(b, plain_fixture_module);
        const plain_fixture_executable = b.addExecutable(.{
            .name = "yuku-tsrx-m2-fixtures-plain",
            .root_module = plain_fixture_module,
        });
        const plain_fixture_install = b.addInstallArtifact(
            plain_fixture_executable,
            .{},
        );

        const fixture_decoder_module = b.createModule(.{
            .root_source_file = yuku.path("tools/gen_parser_decoder.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        fixture_decoder_module.addImport("parser", production_parser_module);
        fixture_decoder_module.addImport("transfer", production_transfer_module);
        const fixture_decoder = b.addExecutable(.{
            .name = "gen-m2-fixture-decoder",
            .root_module = fixture_decoder_module,
        });
        const fixture_decoder_output = b.addRunArtifact(fixture_decoder).captureStdOut(.{});
        const fixture_decoder_install = b.addInstallFile(
            fixture_decoder_output,
            "dialect-decode.js",
        );

        const fixture_oracle = b.addSystemCommand(&.{
            "node",
            "tools/m2-fixtures.ts",
            "--oracle",
            "../yuku",
            "--ref",
            "bf03e146d97ae2f0c2d4c4ec90456e1e544d2760",
            "--fixtures",
            "test/parser/misc",
        });
        fixture_oracle.step.dependOn(&dialect_fixture_install.step);
        fixture_oracle.step.dependOn(&plain_fixture_install.step);
        fixture_oracle.step.dependOn(&fixture_decoder_install.step);
        const fixture_step = b.step(
            "test-m2-fixtures",
            "Compare production TSRX trees and diagnostics with the immutable oracle",
        );
        fixture_step.dependOn(&fixture_oracle.step);
    }
}

fn cloneModule(
    b: *std.Build,
    template: *std.Build.Module,
    root_source_file: std.Build.LazyPath,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
) *std.Build.Module {
    const module = b.createModule(.{
        .root_source_file = root_source_file,
        .target = target,
        .optimize = optimize,
    });
    for (template.import_table.keys(), template.import_table.values()) |name, dependency| {
        module.addImport(name, dependency);
    }
    return module;
}

fn addM2FixtureImports(b: *std.Build, module: *std.Build.Module) void {
    inline for ([_]struct { name: []const u8, path: []const u8 }{
        .{ .name = "code_block_expression", .path = "test/parser/misc/tsrx/code-block-expression.module.tsrx" },
        .{ .name = "code_block_function", .path = "test/parser/misc/tsrx/code-block-function.module.tsrx" },
        .{ .name = "code_block", .path = "test/parser/misc/tsrx/code-block.module.tsrx" },
        .{ .name = "control_flow_for", .path = "test/parser/misc/tsrx/control-flow-for.module.tsrx" },
        .{ .name = "control_flow_if", .path = "test/parser/misc/tsrx/control-flow-if.module.tsrx" },
        .{ .name = "control_flow_switch_invalid", .path = "test/parser/misc/tsrx/control-flow-switch-invalid.module.tsrx" },
        .{ .name = "control_flow_switch", .path = "test/parser/misc/tsrx/control-flow-switch.module.tsrx" },
        .{ .name = "control_flow_try", .path = "test/parser/misc/tsrx/control-flow-try.module.tsrx" },
        .{ .name = "dynamic_tag_invalid", .path = "test/parser/misc/tsrx/dynamic-tag-invalid.module.tsrx" },
        .{ .name = "dynamic_tag", .path = "test/parser/misc/tsrx/dynamic-tag.module.tsrx" },
        .{ .name = "lazy_destructuring", .path = "test/parser/misc/tsrx/lazy-destructuring.module.tsrx" },
        .{ .name = "style_element", .path = "test/parser/misc/tsrx/style-element.module.tsrx" },
        .{ .name = "submodule_import", .path = "test/parser/misc/tsrx/submodule-import.module.tsrx" },
        .{ .name = "template_return_invalid", .path = "test/parser/misc/tsrx/template-return-invalid.module.tsrx" },
        .{ .name = "text_entities", .path = "test/parser/misc/tsrx/text-entities.module.tsrx" },
        .{ .name = "dynamic_tag_outside", .path = "test/parser/misc/ts/dynamic-tag-outside-tsrx.tsx" },
        .{ .name = "lazy_destructuring_outside", .path = "test/parser/misc/ts/lazy-destructuring-outside-tsrx.ts" },
        .{ .name = "submodule_import_outside", .path = "test/parser/misc/ts/submodule-import-outside-tsrx.ts" },
    }) |fixture| {
        module.addAnonymousImport(fixture.name, .{
            .root_source_file = b.path(fixture.path),
        });
    }
}

const EstreeGeneratorKind = enum { decoder, encoder };

const EstreeGenerator = struct {
    step: []const u8,
    description: []const u8,
    root: []const u8,
    kind: EstreeGeneratorKind,
    output: []const u8,
};

fn addEstreeGenerator(
    b: *std.Build,
    yuku: *std.Build.Dependency,
    parser_module: *std.Build.Module,
    transfer_module: *std.Build.Module,
    config: EstreeGenerator,
) void {
    const meta_module = b.createModule(.{
        .root_source_file = yuku.path("tools/estree/meta.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    meta_module.addImport("parser", parser_module);

    const shared_module = b.createModule(.{
        .root_source_file = yuku.path(switch (config.kind) {
            .decoder => "tools/estree/decoder.zig",
            .encoder => "tools/estree/encoder.zig",
        }),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    shared_module.addImport("parser", parser_module);
    shared_module.addImport("transfer", transfer_module);
    shared_module.addImport("meta", meta_module);

    const emit_module = b.createModule(.{
        .root_source_file = yuku.path("tools/estree/emit.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    emit_module.addImport("parser", parser_module);

    const root_module = b.createModule(.{
        .root_source_file = b.path(config.root),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    root_module.addImport(switch (config.kind) {
        .decoder => "decoder",
        .encoder => "encoder",
    }, shared_module);
    root_module.addImport("meta", meta_module);
    root_module.addImport("emit", emit_module);

    const executable = b.addExecutable(.{ .name = config.step, .root_module = root_module });
    const output = b.addRunArtifact(executable).captureStdOut(.{});
    const step = b.step(config.step, config.description);
    step.dependOn(&b.addInstallFile(output, config.output).step);
}
