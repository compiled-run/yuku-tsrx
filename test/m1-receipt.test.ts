import { createHash } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const roots: string[] = [];
const project = resolve(import.meta.dirname, "..");
const receiptTool = resolve(project, "tools/m1-receipt.ts");
const receiptChild = resolve(project, "test/fixtures/m1-receipt-child.ts");
const ids = ["matched-fuzz", "matrix-1", "matrix-2", "matrix-3"] as const;

type Scenarios = {
	fuzz?: string;
	matrices?: [string, string, string];
};

type SyntheticCampaign = {
	campaign: string;
	identity: string;
	manifestSha256: string;
};

const root = async (): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), "m1-receipt-simulation-"));
	roots.push(directory);
	return directory;
};

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

const cli = (args: string[], env: NodeJS.ProcessEnv = process.env): SpawnSyncReturns<string> =>
	spawnSync(process.execPath, [receiptTool, ...args], {
		cwd: project,
		encoding: "utf8",
		env,
	});

const testCli = (args: string[]): SpawnSyncReturns<string> =>
	spawnSync(process.execPath, [receiptChild, ...args], {
		cwd: project,
		encoding: "utf8",
	});

const expectPass = (result: SpawnSyncReturns<string>): void => {
	expect(result.status, result.stderr).toBe(0);
};

const expectFail = (result: SpawnSyncReturns<string>, pattern?: RegExp): void => {
	expect(result.status).not.toBe(0);
	if (pattern) expect(result.stderr).toMatch(pattern);
};

const createSynthetic = async (
	name: string,
	scenarios: Scenarios = {},
): Promise<SyntheticCampaign> => {
	const parent = await root();
	const campaign = join(parent, name);
	const identity = join(parent, "synthetic-identity.txt");
	await writeFile(identity, "identity-v1\n");
	const matrices = scenarios.matrices ?? ["matrix-success", "matrix-success", "matrix-success"];
	const created = testCli([
		"test-create",
		campaign,
		name,
		identity,
		scenarios.fuzz ?? "matched-fuzz-success",
		...matrices,
	]);
	expectPass(created);
	const output = JSON.parse(created.stdout) as { manifestSha256: string };
	return { campaign, identity, manifestSha256: output.manifestSha256 };
};

const run = (campaign: SyntheticCampaign, id: (typeof ids)[number]): SpawnSyncReturns<string> =>
	testCli(["test-run", campaign.campaign, id]);

const runAll = (campaign: SyntheticCampaign): void => {
	for (const id of ids) expectPass(run(campaign, id));
};

const validate = (campaign: SyntheticCampaign, digest = campaign.manifestSha256) =>
	testCli(["test-validate", campaign.campaign, digest]);

const digest = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");

describe("M1 fixed external receipt CLI", () => {
	test("generates the exact real four-command manifest without launching it", async () => {
		const parent = await root();
		const campaign = join(parent, "real-manifest-simulation");
		const created = cli([
			"create",
			"--campaign",
			campaign,
			"--campaign-id",
			"real-manifest-simulation",
		]);
		expectPass(created);
		const manifest = JSON.parse(await readFile(join(campaign, "manifest.json"), "utf8")) as {
			commands: Array<{ id: string; argv: string[] }>;
			identityFiles: Array<{ path: string; sha256: string }>;
			fixedContract: Record<string, unknown>;
			identityDigest: string;
		};
		expect(manifest.commands.map((command) => command.id)).toEqual(ids);
		expect(manifest.commands[0].argv).toContain("--matched-fuzz");
		expect(manifest.commands[0].argv).toContain("0x59a69a3230b5d620,0x730b1e8e350ed620");
		for (const command of manifest.commands.slice(1)) {
			expect(command.argv).toContain("none");
			expect(command.argv).toContain("--profile");
			expect(command.argv).toContain("--disassembly");
		}
		expect(manifest.identityFiles.map((entry) => entry.path)).toEqual(
			expect.arrayContaining([
				receiptTool,
				resolve(project, "tools/m1-control.ts"),
				resolve(project, "profiler/profile.zig"),
				resolve(project, "baselines/m1.json"),
				resolve(project, "package.json"),
				resolve(project, "pnpm-lock.yaml"),
				resolve(project, "tsconfig.json"),
				resolve(project, "vite.config.ts"),
			]),
		);
		expect(manifest.identityFiles.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
		const paths = manifest.identityFiles.map((entry) => entry.path);
		expect(paths).toEqual([...paths].sort());
		expect(new Set(paths).size).toBe(paths.length);
		expect(manifest.identityDigest).toMatch(/^[0-9a-f]{64}$/);
		expect(manifest.fixedContract).toMatchObject({
			optimize: "ReleaseFast",
			controlThenSeam: true,
			profiler: {
				timeLimitSeconds: 5,
				finalizationGraceSeconds: 5,
				postSigintGraceSeconds: 1,
				targetExitObserved: true,
			},
		});
	});

	test("rejects arbitrary CLI inputs, unsafe paths, and identifier reuse", async () => {
		const relative = cli(["create", "--campaign", "relative", "--campaign-id", "relative"]);
		expectFail(relative, /absolute/);
		const parent = await root();
		const unsafe = join(parent, "yuku-tsrx-m1-control", "campaign");
		expectFail(cli(["create", "--campaign", unsafe, "--campaign-id", "unsafe"]), /auto-deleted/);
		expectFail(
			cli([
				"create",
				"--campaign",
				join(parent, "arbitrary"),
				"--campaign-id",
				"arbitrary",
				"--executable",
				"/bin/true",
			]),
			/unexpected option/,
		);
		expectFail(
			cli(
				[
					"create",
					"--campaign",
					join(parent, "synthetic"),
					"--campaign-id",
					"synthetic",
					"--synthetic",
					"true",
				],
				{ ...process.env, YUKU_TSRX_M1_RECEIPT_ALLOW_SYNTHETIC: "1" },
			),
			/unexpected option/,
		);
		expectFail(
			cli([
				"create",
				"--campaign",
				join(parent, "duplicate"),
				"--campaign",
				join(parent, "duplicate-2"),
				"--campaign-id",
				"duplicate",
			]),
			/duplicate option/,
		);
		const campaign = await createSynthetic("reuse");
		expectFail(
			cli(["run", "--campaign", campaign.campaign, "--id", "matched-fuzz"]),
			/production operations reject synthetic/,
		);
		expectFail(
			cli([
				"validate",
				"--campaign",
				campaign.campaign,
				"--expected-manifest-sha256",
				campaign.manifestSha256,
			]),
			/production operations reject synthetic/,
		);
		expectPass(run(campaign, "matched-fuzz"));
		expectFail(run(campaign, "matched-fuzz"));
		expectFail(
			cli(["run", "--campaign", campaign.campaign, "--id", "matrix-4"]),
			/invalid command identifier/,
		);
	});

	test("records stale, silent, exceptional, interrupted, and threshold failures fail-closed", async () => {
		for (const scenario of [
			"silent-exit",
			"nonzero-exception",
			"interrupted-trace",
			"threshold-failure",
		]) {
			const campaign = await createSynthetic(`failure-${scenario}`, {
				matrices: [scenario, "matrix-success", "matrix-success"],
			});
			for (const id of ids) run(campaign, id);
			expectFail(validate(campaign));
			expectFail(run(campaign, "matrix-1"));
			expect(await readFile(join(campaign.campaign, "manifest.json"), "utf8")).toContain(
				campaign.campaign,
			);
		}
	}, 15_000);

	test("rejects missing matched fuzz and matched-fuzz failure", async () => {
		const missing = await createSynthetic("missing-fuzz");
		for (const id of ids.slice(1)) expectPass(run(missing, id));
		expectFail(validate(missing), /ENOENT|incomplete/);

		const failed = await createSynthetic("failed-fuzz", { fuzz: "matched-fuzz-failure" });
		runAll(failed);
		expectFail(validate(failed), /final receipt failed/);
	});

	test("independently rejects fake thresholds and malformed measurement evidence", async () => {
		const cases = [
			["fake-threshold-pass", /threshold/],
			["malformed-vectors", /ten values/],
			["short-elapsed", /shorter than 250ms/],
			["wrong-medians", /medians diverge/],
			["wrong-delta", /delta diverges/],
			["low-parser-samples", /Time Profiler evidence/],
			["wrong-profiler-contract", /profiler contract/],
			["pretrace-final-divergence", /fallback evidence diverge/],
			["invalid-numeric", /positive finite integers/],
			["inconsistent-samples", /Time Profiler evidence/],
		] as const;
		for (const [scenario, message] of cases) {
			const campaign = await createSynthetic(`semantic-${scenario}`, {
				matrices: [scenario, "matrix-success", "matrix-success"],
			});
			runAll(campaign);
			expectFail(validate(campaign), message);
			expect(await readFile(join(campaign.campaign, "manifest.json"), "utf8")).not.toContain(
				"campaign-validation",
			);
		}
	}, 20_000);

	test("rejects changed identity bytes and manifest-hash mismatch", async () => {
		const changed = await createSynthetic("changed-identity");
		await writeFile(changed.identity, "identity-v2\n");
		expectFail(run(changed, "matched-fuzz"), /identity bytes changed/);
		expectFail(validate(changed), /identity bytes changed/);

		const mismatch = await createSynthetic("hash-mismatch");
		runAll(mismatch);
		expectFail(validate(mismatch, "0".repeat(64)), /manifest hash/);
	});

	test("rejects omitted, symlinked, and lifecycle-divergent identities", async () => {
		const parent = await root();
		const target = join(parent, "identity-target.txt");
		const linked = join(parent, "identity-link.txt");
		await writeFile(target, "identity\n");
		await symlink(target, linked);
		expectFail(
			testCli([
				"test-create",
				join(parent, "symlink-campaign"),
				"symlink-campaign",
				linked,
				"matched-fuzz-success",
				"matrix-success",
				"matrix-success",
				"matrix-success",
			]),
			/symlink/,
		);

		for (const mutation of ["omitted-identity", "contract-lifecycle"] as const) {
			const campaign = await createSynthetic(mutation);
			const path = join(campaign.campaign, "manifest.json");
			const manifest = JSON.parse(await readFile(path, "utf8")) as {
				identityFiles: unknown[];
				fixedContract: { profiler: { finalizationGraceSeconds: number } };
				contractSha256: string;
			};
			if (mutation === "omitted-identity") manifest.identityFiles.pop();
			else {
				manifest.fixedContract.profiler.finalizationGraceSeconds = 4;
				manifest.contractSha256 = digest(JSON.stringify(manifest.fixedContract));
			}
			const bytes = `${JSON.stringify(manifest)}\n`;
			await writeFile(path, bytes);
			expectFail(
				validate({ ...campaign, manifestSha256: digest(bytes) }),
				mutation === "omitted-identity" ? /identity-file list/ : /fixed measurement contract/,
			);
		}
	});

	test("rejects relocated unsafe campaigns and duplicate or reordered manifest identifiers", async () => {
		const source = await createSynthetic("relocated-source");
		runAll(source);
		const unsafeParent = join(await root(), "yuku-tsrx-m1-relocated");
		const unsafe = join(unsafeParent, "campaign");
		await cp(source.campaign, unsafe, { recursive: true });
		const relocated = { ...source, campaign: unsafe };
		expectFail(validate(relocated), /auto-deleted/);

		for (const mutation of ["duplicate", "reordered"] as const) {
			const campaign = await createSynthetic(`manifest-${mutation}`);
			const path = join(campaign.campaign, "manifest.json");
			const manifest = JSON.parse(await readFile(path, "utf8")) as {
				commands: Array<{ id: string }>;
			};
			if (mutation === "duplicate") manifest.commands[1].id = "matched-fuzz";
			else
				[manifest.commands[0], manifest.commands[1]] = [manifest.commands[1], manifest.commands[0]];
			const bytes = `${JSON.stringify(manifest)}\n`;
			await writeFile(path, bytes);
			expectFail(validate({ ...campaign, manifestSha256: digest(bytes) }), /reordered/);
		}
	});

	test("publishes one terminal-bound receipt and revalidates read-only", async () => {
		const campaign = await createSynthetic("complete-campaign");
		runAll(campaign);
		const first = validate(campaign);
		expectPass(first);
		const path = join(campaign.campaign, "campaign-validation.json");
		const bytes = await readFile(path, "utf8");
		const validation = JSON.parse(bytes) as {
			identifiers: string[];
			manifestSha256: string;
			identityDigest: string;
			terminalEventSha256: Record<string, string>;
		};
		expect(validation.identifiers).toEqual(ids);
		expect(validation.manifestSha256).toBe(campaign.manifestSha256);
		expect(validation.identityDigest).toMatch(/^[0-9a-f]{64}$/);
		expect(Object.keys(validation.terminalEventSha256)).toEqual(ids);
		expect(Object.values(validation.terminalEventSha256)).toEqual(
			expect.arrayContaining([expect.stringMatching(/^[0-9a-f]{64}$/)]),
		);
		expectPass(validate(campaign));
		expect(await readFile(path, "utf8")).toBe(bytes);

		const exitPath = join(campaign.campaign, "identifiers/matrix-3/events/003-exit.json");
		const exit = JSON.parse(await readFile(exitPath, "utf8")) as {
			payload: Record<string, unknown>;
		};
		exit.payload.auditTamper = true;
		await writeFile(exitPath, `${JSON.stringify(exit)}\n`);
		expectFail(validate(campaign), /campaign-validation receipt diverged/);
		expect(await readFile(path, "utf8")).toBe(bytes);
	});
});
