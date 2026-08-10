import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const project = resolve(import.meta.dirname, "..");
const script = resolve(project, "tools/m1-reflected-transfer.ts");
const run = (args: string[], cwd = project) =>
	spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });

const validArgs = [
	"--control-yuku",
	resolve(project, "../yuku"),
	"--seam-yuku",
	resolve(project, "../yuku-dialect"),
	"--compare-ref",
	"eb2adcb4c17da16e7ade1a0517192d81d469e67f",
];

test("retains and consumes reflected dialect transfer metadata", async () => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), "m1-reflected-transfer-"));
	try {
		const build = spawnSync(
			"zig",
			[
				"build",
				"m1-reflected-transfer-fixtures",
				"gen-m1-dialect-decoder",
				"gen-m1-dialect-encoder",
				"--prefix",
				join(temporaryRoot, "zig-out"),
			],
			{ cwd: project, encoding: "utf8" },
		);
		expect(build.status, build.stderr).toBe(0);
		const result = run(validArgs, temporaryRoot);
		expect(result.status, result.stderr).toBe(0);
	} finally {
		await rm(temporaryRoot, { force: true, recursive: true });
	}
}, 60_000);

test("rejects missing, unknown, bogus, and typo comparison inputs before artifacts", () => {
	expect(run([]).status).not.toBe(0);
	expect(run([...validArgs, "--unknown", "value"]).status).not.toBe(0);
	expect(run(["--control-yuku", "/definitely/missing", ...validArgs.slice(2)]).status).not.toBe(0);
	expect(
		run([...validArgs.slice(0, 4), "--compare-ref", "eb2b472050a5c9b0fe958919635c4c7cf9e2dbf0"])
			.status,
	).not.toBe(0);
	expect(
		run([...validArgs.slice(0, 2), "--seam-yuku", "../yuku", ...validArgs.slice(4)]).status,
	).not.toBe(0);
});
