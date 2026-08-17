import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	gitChildEnvironment,
	repositoryLocalGitEnvironmentVariables,
} from "../tools/m1-git-environment.ts";

const project = resolve(import.meta.dirname, "..");
const controlYuku = resolve(project, "../yuku");
const seamYuku = resolve(project, "../yuku-dialect");
const foreignIndex = resolve(project, ".git/index");
const compareRef = "eb2adcb4c17da16e7ade1a0517192d81d469e67f";
const foreignEnvironment = { ...process.env, GIT_INDEX_FILE: foreignIndex };
let temporaryRoot: string;

const run = (command: string, args: string[], cwd = project) =>
	spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		env: foreignEnvironment,
	});

beforeAll(async () => {
	temporaryRoot = await mkdtemp(join(tmpdir(), "m1-git-environment-"));
	const build = run("zig", [
		"build",
		"m1-reflected-transfer-fixtures",
		"gen-m1-dialect-decoder",
		"gen-m1-dialect-encoder",
		"--prefix",
		join(temporaryRoot, "zig-out"),
	]);
	expect(build.status, build.stderr).toBe(0);
}, 30_000);

afterAll(async () => {
	await rm(temporaryRoot, { force: true, recursive: true });
});

describe("cross-repository Git environment", () => {
	test("matches Git's repository-local variable inventory without mutating the parent", () => {
		const inventory = spawnSync("git", ["rev-parse", "--local-env-vars"], {
			cwd: project,
			encoding: "utf8",
		});
		expect(inventory.status, inventory.stderr).toBe(0);
		expect(inventory.stdout.trim().split("\n")).toEqual(repositoryLocalGitEnvironmentVariables);

		const sanitized = gitChildEnvironment(foreignEnvironment);
		expect(sanitized.GIT_INDEX_FILE).toBeUndefined();
		expect(foreignEnvironment.GIT_INDEX_FILE).toBe(foreignIndex);
	});

	test("isolates every M1 cross-repository Git surface from a foreign index", () => {
		const control = run("git", ["-C", controlYuku, "status", "--porcelain=v1"]);
		expect(control.status).not.toBe(0);
		expect(control.stderr).toContain("unable to read 8a5a33bbebb1779a9ee62b0184f8577d232c9e20");

		const receipt = run(process.execPath, [
			"tools/m1-receipt.ts",
			"create",
			"--campaign",
			join(temporaryRoot, "campaign"),
			"--campaign-id",
			"foreign-index",
		]);
		expect(receipt.status, receipt.stderr).toBe(0);

		const controlTool = run(process.execPath, [
			"tools/m1-control.ts",
			"--check-hook-contract",
			"--control-yuku",
			controlYuku,
			"--seam-yuku",
			seamYuku,
			"--compare-ref",
			compareRef,
		]);
		expect(controlTool.status, controlTool.stderr).toBe(0);

		const reflected = run(
			process.execPath,
			[
				resolve(project, "tools/m1-reflected-transfer.ts"),
				"--control-yuku",
				controlYuku,
				"--seam-yuku",
				seamYuku,
				"--compare-ref",
				compareRef,
			],
			temporaryRoot,
		);
		expect(reflected.status, reflected.stderr).toBe(0);
	}, 120_000);
});
