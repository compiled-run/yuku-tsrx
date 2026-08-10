import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { dependencySiblingFromManifest } from "../tools/m0-control.ts";

const readProjectFile = (path: string): Promise<string> => readFile(path, "utf8");

describe("M0 controls", () => {
	test("keeps every charter command behavioral and bounded", async () => {
		const build = await readProjectFile("build.zig");
		const fuzz = await readProjectFile("src/testing/fuzz.zig");

		expect(build).toContain('b.step("test"');
		expect(build).toContain('b.step("fuzz"');
		expect(build).toContain('b.step("profile"');
		expect(build).toContain('b.step("control"');
		expect(fuzz).toContain("iterations_max");
		expect(fuzz).toContain("invalid_sources");
	});

	test("retains the immutable archive policy and reproducibility metadata", async () => {
		const control = await readProjectFile("tools/m0-control.ts");
		const baseline = JSON.parse(await readProjectFile("baselines/m0.json")) as Record<
			string,
			unknown
		>;

		expect(control).toContain("git archive");
		expect(control).toContain("mkdtemp");
		expect(control).toContain("rm(");
		expect(baseline).toHaveProperty("control.commit");
		expect(baseline).toHaveProperty("control.binary_sha256");
		expect(baseline).toHaveProperty("tsrx_core.corpus_sha256");
		expect(baseline).toHaveProperty("toolchain.vite_plus_bundled_vite");
		expect(JSON.stringify(baseline)).not.toContain("pending-verification");
		expect(baseline).toHaveProperty("profile.ns_per_parse");
		expect(baseline).toHaveProperty("tsrx_core.memory_rss_delta_bytes");
	});

	test("derives exactly one safe Yuku sibling from the manifest", () => {
		const manifest = '.{ .dependencies = .{ .yuku = .{ .path = "../yuku-dialect" } } }';
		expect(dependencySiblingFromManifest(manifest)).toBe("yuku-dialect");
		for (const path of [
			"/tmp/yuku-dialect",
			"../../yuku-dialect",
			"../nested/yuku-dialect",
			"..\\yuku-dialect",
			"../yuku",
		]) {
			expect(() =>
				dependencySiblingFromManifest(`.{ .dependencies = .{ .yuku = .{ .path = "${path}" } } }`),
			).toThrow();
		}
		expect(() => dependencySiblingFromManifest(".{ .dependencies = .{} }")).toThrow();
		expect(() => dependencySiblingFromManifest(`${manifest}\n${manifest}`)).toThrow();
	});
});
