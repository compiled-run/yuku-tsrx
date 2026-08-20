import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { overlayBudget, parseNodeVariants } from "../tools/m1-control.ts";

type RetainedFallback = {
	control: number[];
	seam: number[];
	controlElapsedNs: number[];
	seamElapsedNs: number[];
	controlMedian: number;
	seamMedian: number;
	deltaPercent: number;
};

type RetainedMatrix = {
	id: string;
	identifier_sha256: string;
	event_count: number;
	terminal_event_sha256: string;
	pre_trace_payload: { fallback: RetainedFallback };
	final_payload: {
		status: string;
		thresholdPassed: boolean;
		result: {
			fallback: RetainedFallback;
			performancePassed: boolean;
			profilerBuilds: Record<
				"control" | "seam",
				{
					warmupIterations: number;
					sampleIterations: number;
					filesPerIteration: number;
					elapsedNs: number;
					nsPerParse: number;
				}
			>;
			timeProfiler: {
				template: string;
				timeLimitSeconds: number;
				finalizationGraceSeconds: number;
				postSigintGraceSeconds: number;
				targetExitObserved: boolean;
				postExitSigintSent: boolean;
				samplePeriodUs: number;
				totalSamples: number;
				parserStackSamples: number;
			};
			deterministicBinaries: {
				executableDeltaLocalization: Array<{ differingExecutableSections: string[] }>;
			};
			normalizedFunctions: {
				seam: Record<string, { emittedName: string; normalizedAddress: number; size: number }>;
			};
			strippedEvidence: {
				matches: { symbols: string[]; strings: string[]; disassembly: string[] };
				symbolSha256: string;
				stringSha256: string;
				disassemblySha256: string;
			};
		};
	};
};

type PostRepairCampaign = {
	campaign_id: string;
	campaign_directory: string;
	manifest_sha256: string;
	validation_sha256: string;
	contract_sha256: string;
	identity_digest: string;
	receipt_tree_sha256: string;
	validated_at: string;
	terminal_event_sha256: Record<string, string>;
	matched_fuzz: {
		id: string;
		identifier_sha256: string;
		event_count: number;
		terminal_event_sha256: string;
		final_payload: { status: string; result: { seeds: string[] } };
	};
	matrices: RetainedMatrix[];
};

describe("M1 seam controls", () => {
	test("derives appended variants without changing existing tags", () => {
		const source = `pub const NodeData = union(enum) {
    first: First,
    second: Second,
    dialect_node: DialectNode,
    /// True when this node produces a value at runtime.`;
		expect(parseNodeVariants(source)).toEqual(["first", "second", "dialect_node"]);
		expect(() => parseNodeVariants("const NodeData = void;")).toThrow();
	});

	test("enforces sparse overlay density and byte accounting", () => {
		expect(overlayBudget(100_000, 13_000)).toEqual({
			densityPercent: 13,
			indexPercent: 2,
		});
		expect(overlayBudget(100_000, 0)).toEqual({ densityPercent: 0, indexPercent: 0 });
		expect(() => overlayBudget(0, 0)).toThrow();
		expect(() => overlayBudget(100, -1)).toThrow();
	});

	test("retains complete local none and sentinel evidence", async () => {
		const baseline = JSON.parse(await readFile("baselines/m1.json", "utf8")) as Record<
			string,
			unknown
		>;
		expect(baseline).toHaveProperty("control.node_size_bytes", 52);
		expect(baseline).toHaveProperty("control.tree_size_bytes", 240);
		expect(baseline).toHaveProperty("sentinel.hook_count", 19);
		expect(baseline).toHaveProperty("sentinel.base_tag_count", 171);
		expect(baseline).toHaveProperty("sentinel.overlay_density_percent", 13);
		expect(baseline).toHaveProperty("measurement_contract.sample_iterations", 100_000);
		expect(baseline).toHaveProperty("measurement_contract.warmup_iterations", 10_000);
		expect(baseline).toHaveProperty("measurement_contract.minimum_elapsed_ns", 250_000_000);
		expect(baseline).toHaveProperty("measurement_contract.minimum_parser_stack_samples", 250);
		expect(baseline).toHaveProperty("measurement_contract.ordered_pairs", 10);
		expect(baseline).toHaveProperty("measurement_contract.independent_matrices", 3);
		expect(baseline).toHaveProperty("measurement_contract.cross_matrix_averaging", false);
		expect(baseline).toHaveProperty("measurement_evidence.matrices.length", 3);
		expect(baseline).toHaveProperty(
			"measurement_evidence.matrices.0.control_samples_ns_per_parse",
			[2572, 2627, 2601, 2620, 2622, 2690, 2677, 2590, 2583, 2622],
		);
		expect(baseline).toHaveProperty(
			"measurement_evidence.matrices.1.seam_samples_ns_per_parse",
			[2576, 2650, 2829, 2745, 2663, 2728, 2688, 2710, 2743, 2773],
		);
		expect(baseline).toHaveProperty(
			"measurement_evidence.matrices.2.delta_percent",
			-2.6992287917737787,
		);
		expect(baseline).toHaveProperty(
			"measurement_evidence.matrices.2.time_profiler.parser_stack_samples",
			279,
		);
		expect(baseline).toHaveProperty("measurement_evidence.structural.artifact_matches", {
			disassembly: [],
			strings: [],
			symbols: [],
		});
		expect(JSON.stringify(baseline)).not.toContain("pending");
	});

	test("retains the audited post-repair campaign without changing the original baseline", async () => {
		const bytes = await readFile("baselines/m1.json", "utf8");
		const start = bytes.indexOf('\t"post_repair_campaigns":');
		const end = bytes.indexOf('\t"profile_fallback":', start);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);

		const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
		const originalBytes = bytes.slice(0, start) + bytes.slice(end);
		expect(sha256(originalBytes)).toBe(
			"3dc78626621d5f3dd3298f1052008a56a04fac7a7ce2b90335bb439394210108",
		);

		const baseline = JSON.parse(bytes) as {
			measurement_contract: unknown;
			measurement_evidence: { matrices: unknown[] };
			post_repair_campaigns: PostRepairCampaign[];
			[key: string]: unknown;
		};
		const originalBaseline = Object.fromEntries(
			Object.entries(baseline).filter(([key]) => key !== "post_repair_campaigns"),
		);
		expect(sha256(JSON.stringify(originalBaseline))).toBe(
			"03c0ad47c40f0d6303e3a0078233311a4ff190dce509e268976bb4d5eb427afb",
		);
		expect(sha256(JSON.stringify(baseline.measurement_contract))).toBe(
			"097e280b4bf56f47d5723a2c93bb71093e2ee582993dd92cb29d053945559fbb",
		);
		expect(baseline.measurement_evidence.matrices).toHaveLength(3);
		expect(sha256(JSON.stringify(baseline.measurement_evidence.matrices))).toBe(
			"16835bef9d33701e8042c6ce62545c8af7ff34f68c4a156f2eb88489bf1fc56b",
		);

		expect(baseline.post_repair_campaigns).toHaveLength(1);
		const [campaign] = baseline.post_repair_campaigns;
		expect(campaign).toMatchObject({
			campaign_id: "t049-postrepair-20260809-v1",
			campaign_directory: "/private/tmp/yuku-tsrx-fixed-campaign-t049-20260809-v1",
			manifest_sha256: "afeea33d024075ed102fe35fd5adef7538890952f8f74e1d7446b16e4ae319b7",
			validation_sha256: "1bdbd474cb1ad475c919fcce8aaba6527b0036baaf6873060429274f7413d31e",
			contract_sha256: "95a6fa6761170b16b1701e1c9da53f07613565e1f37a556d7a97910f1023274a",
			identity_digest: "69740dc2084fe66866f73d427791027d63697b92caaa5ee17f2038c64acd9407",
			receipt_tree_sha256: "beaa17d4bc950345a14cbf20e16c5cf20942c6909f0a11949536b4ddac8f07a0",
			validated_at: "2026-08-10T02:10:53.963Z",
		});
		expect(campaign.terminal_event_sha256).toEqual({
			"matched-fuzz": "c6cabd37e3fc171d494bdd3720572925ee46328005f6a50cceee58a2a37f3d99",
			"matrix-1": "ece45f94282330f0923d8e80963f19bb739ddaa86fb91d4505b9ad435d8c56ea",
			"matrix-2": "a19df20afff439e1ba48aaaca939e01cf8915f956f2bebad67b21169d73cc203",
			"matrix-3": "0860e5aa8e29517e52e855ea613d115987861ea7de2ebd98b7110379f9391068",
		});
		expect(campaign.matched_fuzz).toEqual({
			id: "matched-fuzz",
			identifier_sha256: "7e86952cdbe3126ef983a94ecc9a59437a73191aa8eea2adc5a6864d3159bc6f",
			event_count: 3,
			terminal_event_sha256: "c6cabd37e3fc171d494bdd3720572925ee46328005f6a50cceee58a2a37f3d99",
			final_payload: {
				status: "pass",
				result: { seeds: ["0x59a69a3230b5d620", "0x730b1e8e350ed620"] },
			},
		});

		expect(campaign.matrices.map(({ id }) => id)).toEqual(["matrix-1", "matrix-2", "matrix-3"]);
		expect(campaign.matrices.map(({ identifier_sha256 }) => identifier_sha256)).toEqual([
			"e9c3da6c4f16943480a3f38a668628785b718b7bead118b3e41c2387b3f5b5d6",
			"4f7cbd7bfa06a1c98f24ffb4269dd7ba1bad5ce1fd5aaa3539b6d16d7c79e2ac",
			"feda2de019d5b99c8754d8e2057daf6125c8f4130e3a95627c822395119dea25",
		]);
		const median = (values: number[]): number => {
			const sorted = [...values].sort((left, right) => left - right);
			return (sorted[4] + sorted[5]) / 2;
		};
		for (const matrix of campaign.matrices) {
			expect(matrix.event_count).toBe(4);
			expect(matrix.terminal_event_sha256).toBe(campaign.terminal_event_sha256[matrix.id]);
			const fallback = matrix.pre_trace_payload.fallback;
			for (const vector of [
				fallback.control,
				fallback.seam,
				fallback.controlElapsedNs,
				fallback.seamElapsedNs,
			]) {
				expect(vector).toHaveLength(10);
				expect(vector.every((value) => Number.isInteger(value) && value > 0)).toBe(true);
			}
			expect(fallback.controlElapsedNs.every((value) => value >= 250_000_000)).toBe(true);
			expect(fallback.seamElapsedNs.every((value) => value >= 250_000_000)).toBe(true);
			expect(fallback.controlMedian).toBe(median(fallback.control));
			expect(fallback.seamMedian).toBe(median(fallback.seam));
			expect(fallback.deltaPercent).toBeCloseTo(
				((fallback.seamMedian - fallback.controlMedian) / fallback.controlMedian) * 100,
				12,
			);
			expect(Math.abs(fallback.deltaPercent)).toBeLessThanOrEqual(2);
			expect(matrix.final_payload).toMatchObject({
				status: "pass",
				thresholdPassed: true,
				result: {
					fallback,
					performancePassed: true,
					timeProfiler: {
						template: "Time Profiler",
						timeLimitSeconds: 5,
						finalizationGraceSeconds: 5,
						postSigintGraceSeconds: 1,
						targetExitObserved: true,
						postExitSigintSent: false,
						samplePeriodUs: 1000,
					},
				},
			});
			for (const build of Object.values(matrix.final_payload.result.profilerBuilds)) {
				expect(build).toMatchObject({
					warmupIterations: 10_000,
					sampleIterations: 100_000,
					filesPerIteration: 3,
				});
				expect(build.elapsedNs).toBeGreaterThanOrEqual(250_000_000);
				expect(build.nsPerParse).toBeGreaterThan(0);
			}
			const profiler = matrix.final_payload.result.timeProfiler;
			expect(profiler.parserStackSamples).toBeGreaterThanOrEqual(250);
			expect(profiler.totalSamples).toBeGreaterThanOrEqual(profiler.parserStackSamples);
			expect(
				matrix.final_payload.result.deterministicBinaries.executableDeltaLocalization.at(-1)
					?.differingExecutableSections,
			).toEqual([]);
			expect(
				matrix.final_payload.result.normalizedFunctions.seam["_syntax.functions.parseFunctionBody"],
			).toEqual({
				emittedName: "_syntax.functions.parseFunctionBodyContinuation",
				normalizedAddress: 409612,
				size: 428,
			});
			const artifacts = matrix.final_payload.result.strippedEvidence;
			expect(artifacts.matches).toEqual({ symbols: [], strings: [], disassembly: [] });
			for (const hash of [
				artifacts.symbolSha256,
				artifacts.stringSha256,
				artifacts.disassemblySha256,
			]) {
				expect(hash).toMatch(/^[0-9a-f]{64}$/);
			}
		}
		expect(sha256(JSON.stringify(campaign))).toBe(
			"e9ec6a1cc80f750e58803456484034f79447f828d9e28233f4d017455cb3d5bd",
		);
	});

	test("executes the handled, unhandled, and malformed hook contract", () => {
		const result = spawnSync(
			"node",
			[
				"tools/m1-control.ts",
				"--check-hook-contract",
				"--control-yuku",
				"../yuku",
				"--seam-yuku",
				"../yuku-minimal-seam",
				"--compare-ref",
				"eb2adcb4c17da16e7ade1a0517192d81d469e67f",
			],
			{ encoding: "utf8" },
		);
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ mode: "hook-contract", status: "pass" });
	}, 120_000);
});
