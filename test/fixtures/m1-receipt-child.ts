import {
	createSyntheticCampaignForTests,
	recordInternalPhaseFromEnvironment,
	runSyntheticCommandForTests,
	validateSyntheticCampaignForTests,
} from "../../tools/m1-receipt.ts";

type Fallback = {
	control: number[];
	seam: number[];
	controlElapsedNs: number[];
	seamElapsedNs: number[];
	controlMedian: number;
	seamMedian: number;
	deltaPercent: number;
};

const scenario = process.argv[2];
const expectedSeeds = ["0x59a69a3230b5d620", "0x730b1e8e350ed620"];

const fallback = (): Fallback => ({
	control: Array<number>(10).fill(1_000),
	seam: Array<number>(10).fill(1_010),
	controlElapsedNs: Array<number>(10).fill(300_000_000),
	seamElapsedNs: Array<number>(10).fill(303_000_000),
	controlMedian: 1_000,
	seamMedian: 1_010,
	deltaPercent: 1,
});

const result = (evidence: Fallback, parserStackSamples = 300): Record<string, unknown> => ({
	fallback: evidence,
	profilerBuilds: {
		control: {
			warmupIterations: 10_000,
			sampleIterations: 100_000,
			filesPerIteration: 3,
			elapsedNs: 300_000_000,
			nsPerParse: 1_000,
		},
		seam: {
			warmupIterations: 10_000,
			sampleIterations: 100_000,
			filesPerIteration: 3,
			elapsedNs: 303_000_000,
			nsPerParse: 1_010,
		},
	},
	timeProfiler: {
		template: "Time Profiler",
		timeLimitSeconds: 5,
		finalizationGraceSeconds: 5,
		postSigintGraceSeconds: 1,
		samplePeriodUs: 1_000,
		targetExitObserved: true,
		postExitSigintSent: false,
		parserStackSamples,
		totalSamples: 400,
	},
});

const finishMatrix = async (
	preTrace: Fallback,
	finalEvidence: Fallback = preTrace,
	options: { parserStackSamples?: number; status?: "pass" | "fail"; wrongProfiler?: boolean } = {},
): Promise<void> => {
	await recordInternalPhaseFromEnvironment("pre-trace", { fallback: preTrace });
	const finalResult = result(finalEvidence, options.parserStackSamples);
	if (options.wrongProfiler) {
		(
			finalResult.profilerBuilds as { control: { sampleIterations: number } }
		).control.sampleIterations = 1;
	}
	await recordInternalPhaseFromEnvironment("final", {
		status: options.status ?? "pass",
		thresholdPassed: true,
		result: finalResult,
	});
};

if (scenario === "test-create") {
	const [, , , campaign, campaignId, identityFile, fuzz, matrix1, matrix2, matrix3] = process.argv;
	if (!campaign || !campaignId || !identityFile || !fuzz || !matrix1 || !matrix2 || !matrix3) {
		throw new Error("test-create requires complete synthetic arguments");
	}
	const manifestSha256 = await createSyntheticCampaignForTests(campaign, campaignId, identityFile, {
		matchedFuzz: fuzz,
		matrices: [matrix1, matrix2, matrix3],
	});
	process.stdout.write(`${JSON.stringify({ manifestSha256 })}\n`);
} else if (scenario === "test-run") {
	const campaign = process.argv[3];
	const id = process.argv[4];
	if (!campaign || !id || !["matched-fuzz", "matrix-1", "matrix-2", "matrix-3"].includes(id)) {
		throw new Error("test-run requires a fixed identifier");
	}
	const result = await runSyntheticCommandForTests(
		campaign,
		id as "matched-fuzz" | "matrix-1" | "matrix-2" | "matrix-3",
	);
	process.stdout.write(`${JSON.stringify({ status: result.status })}\n`);
	if (result.status !== 0) process.exitCode = result.status ?? 1;
} else if (scenario === "test-validate") {
	const campaign = process.argv[3];
	const manifestSha256 = process.argv[4];
	if (!campaign || !manifestSha256) throw new Error("test-validate requires campaign and hash");
	const validation = await validateSyntheticCampaignForTests(campaign, manifestSha256);
	process.stdout.write(`${JSON.stringify({ validation })}\n`);
} else
	switch (scenario) {
		case "silent-exit":
			break;
		case "nonzero-exception":
			throw new Error("synthetic child failure");
		case "interrupted-trace":
			await recordInternalPhaseFromEnvironment("pre-trace", { fallback: fallback() });
			process.exitCode = 3;
			break;
		case "threshold-failure":
			await finishMatrix(fallback(), fallback(), { status: "fail" });
			break;
		case "fake-threshold-pass": {
			const evidence = fallback();
			evidence.seam.fill(1_030);
			evidence.seamMedian = 1_030;
			evidence.deltaPercent = 3;
			await finishMatrix(evidence);
			break;
		}
		case "malformed-vectors": {
			const evidence = fallback();
			evidence.control.pop();
			await finishMatrix(evidence);
			break;
		}
		case "short-elapsed": {
			const evidence = fallback();
			evidence.seamElapsedNs[4] = 249_999_999;
			await finishMatrix(evidence);
			break;
		}
		case "wrong-medians": {
			const evidence = fallback();
			evidence.controlMedian = 999;
			await finishMatrix(evidence);
			break;
		}
		case "wrong-delta": {
			const evidence = fallback();
			evidence.deltaPercent = 0;
			await finishMatrix(evidence);
			break;
		}
		case "low-parser-samples":
			await finishMatrix(fallback(), fallback(), { parserStackSamples: 249 });
			break;
		case "wrong-profiler-contract":
			await finishMatrix(fallback(), fallback(), { wrongProfiler: true });
			break;
		case "pretrace-final-divergence": {
			const finalEvidence = fallback();
			finalEvidence.seamElapsedNs[0] += 1;
			await finishMatrix(fallback(), finalEvidence);
			break;
		}
		case "invalid-numeric": {
			const evidence = fallback();
			evidence.control[0] = 0;
			await finishMatrix(evidence);
			break;
		}
		case "inconsistent-samples": {
			const evidence = fallback();
			await recordInternalPhaseFromEnvironment("pre-trace", { fallback: evidence });
			const finalResult = result(evidence, 300);
			(finalResult.timeProfiler as { totalSamples: number }).totalSamples = 299;
			await recordInternalPhaseFromEnvironment("final", {
				status: "pass",
				thresholdPassed: true,
				result: finalResult,
			});
			break;
		}
		case "matrix-success":
			await finishMatrix(fallback());
			break;
		case "matched-fuzz-failure":
			await recordInternalPhaseFromEnvironment("final", {
				status: "fail",
				result: { seeds: expectedSeeds },
			});
			break;
		case "matched-fuzz-success":
			await recordInternalPhaseFromEnvironment("final", {
				status: "pass",
				result: { seeds: expectedSeeds },
			});
			break;
		default:
			throw new Error(`unknown synthetic receipt scenario ${scenario}`);
	}
