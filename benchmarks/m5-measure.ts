import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Variant = "tsrx" | "tsx" | "yuku" | "core";
type AggregateMetric = Readonly<{
	duration_ns: number;
	ns_per_parse: number;
	peak_rss_bytes: number;
	parses_per_second: number;
	bytes_per_second: number;
}>;
type FeatureMetric = Omit<AggregateMetric, "peak_rss_bytes">;
type ChildResult = Readonly<{
	schema: string;
	scenario: string;
	variant: string;
	sample_index: number;
	features?: Array<Readonly<{ id: string; duration_ns: number; parses: number; bytes: number }>>;
	aggregate: Readonly<{ duration_ns: number; parses: number; bytes: number }>;
}>;
type RawSample = Readonly<{
	sample_index: number;
	order?: string[];
	aggregate: AggregateMetric;
	features?: Record<string, FeatureMetric>;
}>;

const expectedPairsHash = "11106c618f7fcad9340441bdb1c4a4813ae3f1ed6cc8cb30ac61c2c225bbc5f5";
const expectedClassificationHash =
	"00a2604a218e5995c49a94d69fd6171289d3959691b8b83d035fb9bd5f9f4858";
const expectedPairIds = [
	"function-code-block",
	"arrow-code-block",
	"if-expression",
	"basic-for-of-expression",
	"switch-expression",
	"dynamic-tag",
];
const options = Object.freeze({ collect: false, loose: false });

const fail = (message: string): never => {
	throw new Error(message);
};
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const stable = (value: unknown): string => {
	const sort = (item: any): any =>
		Array.isArray(item)
			? item.map(sort)
			: item && typeof item === "object"
				? Object.fromEntries(
						Object.keys(item)
							.sort()
							.map((key) => [key, sort(item[key])]),
					)
				: item;
	return `${JSON.stringify(sort(value))}\n`;
};
const hashPaths = (paths: string[]): string => {
	const hash = createHash("sha256");
	for (const path of paths) hash.update(path).update("\0");
	return hash.digest("hex");
};
const hashCorpus = (files: Array<{ path: string; source: string }>): string => {
	const hash = createHash("sha256");
	for (const file of files) hash.update(file.path).update("\0").update(file.source).update("\0");
	return hash.digest("hex");
};

const parseArguments = () => {
	const value = (name: string): string => {
		const index = process.argv.indexOf(name);
		const argument = process.argv[index + 1];
		if (index < 0 || !argument || argument.startsWith("--")) fail(`${name} requires a value`);
		return argument;
	};
	const integer = (name: string): number => {
		const parsed = Number(value(name));
		if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${name} must be a positive integer`);
		return parsed;
	};
	const allowed = new Set([
		"--check",
		"--corpus",
		"--pairs",
		"--classification",
		"--output",
		"--warmups",
		"--samples",
		"--pair-iterations",
		"--corpus-iterations",
		"--seed",
		"--scenario",
		"--preserve-from-sha256",
	]);
	for (const argument of process.argv.slice(2))
		if (argument.startsWith("--") && !allowed.has(argument)) fail(`unknown option ${argument}`);
	return {
		check: process.argv.includes("--check"),
		corpus: resolve(value("--corpus")),
		pairs: resolve(value("--pairs")),
		classification: resolve(value("--classification")),
		output: resolve(value("--output")),
		warmups: integer("--warmups"),
		samples: integer("--samples"),
		pairIterations: integer("--pair-iterations"),
		corpusIterations: integer("--corpus-iterations"),
		seed: value("--seed"),
		scenario: value("--scenario"),
		preserveFromSha256: value("--preserve-from-sha256"),
	};
};

const metric = (
	duration_ns: number,
	parses: number,
	bytes: number,
	peak_rss_bytes: number,
): AggregateMetric => {
	if (![duration_ns, parses, bytes, peak_rss_bytes].every((value) => value > 0))
		fail("child returned a nonpositive metric");
	return {
		duration_ns,
		ns_per_parse: duration_ns / parses,
		peak_rss_bytes,
		parses_per_second: (parses * 1e9) / duration_ns,
		bytes_per_second: (bytes * 1e9) / duration_ns,
	};
};
const featureMetric = (duration_ns: number, parses: number, bytes: number): FeatureMetric => {
	if (![duration_ns, parses, bytes].every((value) => value > 0))
		fail("child returned a nonpositive feature metric");
	return {
		duration_ns,
		ns_per_parse: duration_ns / parses,
		parses_per_second: (parses * 1e9) / duration_ns,
		bytes_per_second: (bytes * 1e9) / duration_ns,
	};
};
const median = (values: number[]): number => {
	const ordered = [...values].sort((left, right) => left - right);
	const middle = ordered.length / 2;
	return ordered.length % 2
		? ordered[Math.floor(middle)]
		: (ordered[middle - 1] + ordered[middle]) / 2;
};
const summarizeValues = (values: number[]) => {
	if (values.length !== 20 || values.some((value) => !Number.isFinite(value) || value <= 0))
		fail("summary requires exactly 20 positive samples");
	const center = median(values);
	return {
		median: center,
		mad: median(values.map((value) => Math.abs(value - center))),
		p95: [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1],
	};
};
const summarizeMetrics = (metrics: AggregateMetric[]) => ({
	duration_ns: summarizeValues(metrics.map((value) => value.duration_ns)),
	ns_per_parse: summarizeValues(metrics.map((value) => value.ns_per_parse)),
	peak_rss_bytes: summarizeValues(metrics.map((value) => value.peak_rss_bytes)),
	parses_per_second: summarizeValues(metrics.map((value) => value.parses_per_second)),
	bytes_per_second: summarizeValues(metrics.map((value) => value.bytes_per_second)),
});
const summarizeFeatureMetrics = (metrics: FeatureMetric[]) => ({
	duration_ns: summarizeValues(metrics.map((value) => value.duration_ns)),
	ns_per_parse: summarizeValues(metrics.map((value) => value.ns_per_parse)),
	parses_per_second: summarizeValues(metrics.map((value) => value.parses_per_second)),
	bytes_per_second: summarizeValues(metrics.map((value) => value.bytes_per_second)),
});
const summarizeSamples = (samples: RawSample[]) => {
	const summary: Record<string, unknown> = {
		aggregate: summarizeMetrics(samples.map((sample) => sample.aggregate)),
	};
	if (samples[0]?.features) {
		const ids = Object.keys(samples[0].features);
		summary.features = Object.fromEntries(
			ids.map((id) => [
				id,
				summarizeFeatureMetrics(
					samples.map((sample) => sample.features?.[id] ?? fail(`missing feature ${id}`)),
				),
			]),
		);
	}
	return summary;
};
const aggregateNoise = (summary: any) => {
	const duration = summary.aggregate.duration_ns;
	const rss = summary.aggregate.peak_rss_bytes;
	return {
		duration_mad_over_median: duration.mad / duration.median,
		duration_p95_over_median: duration.p95 / duration.median,
		rss_mad_over_median: rss.mad / rss.median,
		rss_p95_over_median: rss.p95 / rss.median,
		valid:
			duration.mad / duration.median <= 0.1 &&
			duration.p95 / duration.median <= 1.25 &&
			rss.mad / rss.median <= 0.05 &&
			rss.p95 / rss.median <= 1.1,
	};
};
const oracle4Noise = (statistics: any) => {
	const gates: Array<Record<string, unknown>> = [];
	for (const variant of ["tsrx", "tsx"] as const) {
		const aggregate = aggregateNoise(statistics[variant]);
		for (const [metric, value, threshold] of [
			["duration_mad_over_median", aggregate.duration_mad_over_median, 0.1],
			["duration_p95_over_median", aggregate.duration_p95_over_median, 1.25],
			["rss_mad_over_median", aggregate.rss_mad_over_median, 0.05],
			["rss_p95_over_median", aggregate.rss_p95_over_median, 1.1],
		] as const)
			gates.push({
				variant,
				scope: "aggregate",
				metric,
				value,
				threshold,
				passed: value <= threshold,
			});
		for (const id of expectedPairIds) {
			const duration = statistics[variant].features[id].duration_ns;
			for (const [metric, value, threshold] of [
				["duration_mad_over_median", duration.mad / duration.median, 0.1],
				["duration_p95_over_median", duration.p95 / duration.median, 1.25],
			] as const)
				gates.push({
					variant,
					scope: "feature",
					feature: id,
					metric,
					value,
					threshold,
					passed: value <= threshold,
				});
		}
	}
	if (gates.length !== 32) fail("oracle4 noise gate count differs");
	return { gates, valid: gates.every((gate) => gate.passed === true) };
};
const ratioAndClaims = (candidate: any, reference: any, oracle4: boolean) => {
	const ratios = {
		duration_ns: candidate.aggregate.duration_ns.median / reference.aggregate.duration_ns.median,
		peak_rss_bytes:
			candidate.aggregate.peak_rss_bytes.median / reference.aggregate.peak_rss_bytes.median,
		parses_per_second:
			reference.aggregate.parses_per_second.median / candidate.aggregate.parses_per_second.median,
	};
	const claims = {
		duration_lower: ratios.duration_ns < 1,
		peak_rss_lower: ratios.peak_rss_bytes < 1,
		throughput_higher: ratios.parses_per_second < 1,
		overall: ratios.duration_ns < 1 && ratios.peak_rss_bytes < 1 && ratios.parses_per_second < 1,
	};
	return {
		ratios,
		...(oracle4
			? {
					unique_tsrx_overhead_percent: {
						duration_ns: 100 * (ratios.duration_ns - 1),
						peak_rss_bytes: 100 * (ratios.peak_rss_bytes - 1),
						parses_per_second: 100 * (ratios.parses_per_second - 1),
					},
				}
			: {}),
		claims,
	};
};

const shuffledOrder = (seed: string, sampleIndex: number, length: number): number[] => {
	let state = Number.parseInt(sha256(`${seed}:${sampleIndex}`).slice(0, 8), 16) >>> 0;
	const next = (): number => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	};
	const order = Array.from({ length }, (_, index) => index);
	for (let index = order.length - 1; index > 0; index--) {
		const selected = next() % (index + 1);
		[order[index], order[selected]] = [order[selected], order[index]];
	}
	return order;
};

const runChild = (
	scenario: "pairs" | "corpus",
	variant: Variant,
	iterations: number,
	sampleIndex: number,
	payload: unknown,
): { result: ChildResult; peakRss: number } => {
	const input = `${JSON.stringify(payload)}\n`;
	const result = spawnSync(
		"/usr/bin/time",
		[
			"-l",
			process.execPath,
			resolve("benchmarks/m5-measure-child.ts"),
			"--scenario",
			scenario,
			"--variant",
			variant,
			"--iterations",
			String(iterations),
			"--sample-index",
			String(sampleIndex),
			"--payload-sha256",
			sha256(input),
		],
		{
			encoding: "utf8",
			env: { ...process.env, LC_ALL: "C" },
			input,
			maxBuffer: 16 * 1024 * 1024,
		},
	);
	if (result.error) throw result.error;
	if (result.status !== 0)
		fail(`child ${scenario}/${variant} exited ${result.status ?? "unknown"}`);
	const matches = [...result.stderr.matchAll(/^\s*(\d+)\s+maximum resident set size\s*$/gm)];
	if (matches.length !== 1 || /sandbox|permission|terminated/i.test(result.stderr))
		fail(`invalid time output for ${scenario}/${variant}`);
	const peakRss = Number(matches[0][1]);
	if (!Number.isSafeInteger(peakRss) || peakRss < 0) fail("invalid peak RSS");
	const parsed = JSON.parse(result.stdout) as ChildResult;
	if (
		parsed.schema !== "yuku-tsrx-m5-child-v1" ||
		parsed.scenario !== scenario ||
		parsed.variant !== variant ||
		parsed.sample_index !== sampleIndex
	)
		fail("child identity mismatch");
	return { result: parsed, peakRss };
};

const rawSample = (result: ChildResult, peakRss: number, orderIds?: string[]): RawSample => ({
	sample_index: result.sample_index,
	...(orderIds ? { order: orderIds } : {}),
	aggregate: metric(
		result.aggregate.duration_ns,
		result.aggregate.parses,
		result.aggregate.bytes,
		peakRss,
	),
	...(result.features
		? {
				features: Object.fromEntries(
					result.features.map((feature) => [
						feature.id,
						featureMetric(feature.duration_ns, feature.parses, feature.bytes),
					]),
				),
			}
		: {}),
});

const assertProtocolArguments = (arguments_: ReturnType<typeof parseArguments>): void => {
	if (
		arguments_.warmups !== 5 ||
		arguments_.samples !== 20 ||
		arguments_.pairIterations !== 30000 ||
		arguments_.corpusIterations !== 25 ||
		arguments_.seed !== "4d353339" ||
		arguments_.scenario !== "oracle4" ||
		arguments_.preserveFromSha256 !==
			"db1babbb79f6727c080ee326680dcc65c13a1ef150bfbcdf75fcf3e49df03822"
	)
		fail("measurement protocol differs from T339");
	if (process.platform !== "darwin" || process.arch !== "arm64" || process.env.LC_ALL !== "C")
		fail("measurement platform or locale differs");
};

const loadInputs = (arguments_: ReturnType<typeof parseArguments>) => {
	const pairText = readFileSync(arguments_.pairs, "utf8");
	const classificationText = readFileSync(arguments_.classification, "utf8");
	if (sha256(pairText) !== expectedPairsHash) fail("pair manifest drift");
	if (sha256(classificationText) !== expectedClassificationHash) fail("classification drift");
	const pairManifest = JSON.parse(pairText);
	const classification = JSON.parse(classificationText);
	if (
		pairManifest.schema !== "yuku-tsrx-m5-pairs-v1" ||
		JSON.stringify(pairManifest.pairs.map((pair: any) => pair.id)) !==
			JSON.stringify(expectedPairIds)
	)
		fail("unexpected pair manifest");
	const tsrxBytes = pairManifest.pairs.reduce(
		(sum: number, pair: any) => sum + Buffer.byteLength(pair.tsrx.source),
		0,
	);
	const tsxBytes = pairManifest.pairs.reduce(
		(sum: number, pair: any) => sum + Buffer.byteLength(pair.tsx.source),
		0,
	);
	if (tsrxBytes !== 640 || tsxBytes !== 661) fail("pair byte totals differ");
	for (const pair of pairManifest.pairs)
		for (const side of [pair.tsrx, pair.tsx])
			if (sha256(side.source) !== side.source_sha256) fail(`pair source drift ${pair.id}`);
	const paths: string[] = classification.partitions.common_valid.paths;
	if (
		paths.length !== 224 ||
		hashPaths(paths) !== "b42716fbfa16ffc7a900aa9386b3411a3f07d2ebbff4b49527e423a49b646cbb"
	)
		fail("common-valid paths differ");
	const records = new Map(classification.files.map((file: any) => [file.path, file]));
	for (const path of paths) {
		const record: any = records.get(path) ?? fail(`missing classification record ${path}`);
		if (record.core.valid !== true || record.yuku.valid !== true) fail(`non-common file ${path}`);
	}
	return { pairManifest, pairText, classificationText };
};

const validateBaseline = (
	baseline: any,
	text: string,
	arguments_: ReturnType<typeof parseArguments>,
): void => {
	if (text !== canonical(baseline)) fail("baseline is not canonical two-space-newline JSON");
	if (text.includes("/Users/") || /"source"\s*:/.test(text))
		fail("baseline contains source/root data");
	if (baseline.schema !== "yuku-tsrx-m5-measurement-v3") fail("unexpected baseline schema");
	if (
		baseline.provenance.scenario !== "oracle4" ||
		baseline.provenance.preserved_from_sha256 !== arguments_.preserveFromSha256
	)
		fail("baseline scenario provenance differs");
	if (
		sha256(stable(baseline.archived_oracle4_v1)) !==
			"eb523cbd890417b8bd7b343d96c4c037a79ec9184aaa1e64b3e53c3b3bdcd9a7" ||
		sha256(stable(baseline.archived_oracle4_v2)) !==
			"23b7dfc53a87c9af871972fded920b850c6b8e3184e0d985953d8f84cb8a1091" ||
		sha256(stable(baseline.oracle8)) !==
			"ed3e7c4d767e965b6277b3f552495d0101bd168a8fdada4505d3e531a0748a1e"
	)
		fail("preserved oracle object differs");
	if (baseline.provenance.pairs_sha256 !== sha256(readFileSync(arguments_.pairs)))
		fail("baseline pair provenance differs");
	if (baseline.provenance.classification_sha256 !== sha256(readFileSync(arguments_.classification)))
		fail("baseline classification provenance differs");
	if (
		baseline.protocol.seed !== arguments_.seed ||
		baseline.protocol.warmups !== arguments_.warmups ||
		baseline.protocol.samples !== arguments_.samples ||
		baseline.protocol.pair_iterations !== arguments_.pairIterations ||
		baseline.protocol.corpus_iterations !== arguments_.corpusIterations ||
		JSON.stringify(baseline.protocol.conditioning) !==
			JSON.stringify({
				iterations_per_pair: 30000,
				order: "same seeded order as timed sweep",
				timed: false,
			})
	)
		fail("baseline protocol differs");
	for (const variant of ["tsrx", "tsx"] as const) {
		const samples = baseline.oracle4.raw_samples[variant];
		if (samples.length !== 20) fail(`baseline ${variant} sample count differs`);
		const recomputed = summarizeSamples(samples);
		if (JSON.stringify(recomputed) !== JSON.stringify(baseline.oracle4.statistics[variant]))
			fail(`baseline ${variant} statistics differ`);
	}
	if (
		JSON.stringify(oracle4Noise(baseline.oracle4.statistics)) !==
		JSON.stringify(baseline.oracle4.noise)
	)
		fail("oracle4 noise gates differ");
	const oracle4Result = ratioAndClaims(
		baseline.oracle4.statistics.tsrx,
		baseline.oracle4.statistics.tsx,
		true,
	);
	if (baseline.oracle4.validity !== "valid" || baseline.oracle4.noise.valid !== true)
		fail("baseline is noisy");
	if (JSON.stringify(baseline.oracle4.ratios) !== JSON.stringify(oracle4Result.ratios))
		fail("ratios differ");
	if (JSON.stringify(baseline.oracle4.claims) !== JSON.stringify(oracle4Result.claims))
		fail("claims differ");
};

const main = (): void => {
	const arguments_ = parseArguments();
	assertProtocolArguments(arguments_);
	if (arguments_.check) {
		const text = readFileSync(arguments_.output, "utf8");
		validateBaseline(JSON.parse(text), text, arguments_);
		return;
	}
	const previousText = readFileSync(arguments_.output, "utf8");
	if (sha256(previousText) !== arguments_.preserveFromSha256) fail("preservation source differs");
	const previous = JSON.parse(previousText);
	if (
		previous.schema !== "yuku-tsrx-m5-measurement-v2" ||
		sha256(stable(previous.archived_oracle4)) !==
			"eb523cbd890417b8bd7b343d96c4c037a79ec9184aaa1e64b3e53c3b3bdcd9a7" ||
		sha256(stable(previous.oracle4)) !==
			"23b7dfc53a87c9af871972fded920b850c6b8e3184e0d985953d8f84cb8a1091" ||
		sha256(stable(previous.oracle8)) !==
			"ed3e7c4d767e965b6277b3f552495d0101bd168a8fdada4505d3e531a0748a1e"
	)
		fail("preserved oracle object differs");
	const { pairManifest, pairText, classificationText } = loadInputs(arguments_);
	const raw: Record<"tsrx" | "tsx", RawSample[]> = { tsrx: [], tsx: [] };
	for (let position = -arguments_.warmups; position < arguments_.samples; position++) {
		const order = shuffledOrder(arguments_.seed, position, pairManifest.pairs.length);
		const pairPayload = {
			schema: "yuku-tsrx-m5-pair-payload-v1",
			order,
			pairs: pairManifest.pairs,
		};
		for (const variant of ["tsrx", "tsx"] as const) {
			const child = runChild("pairs", variant, arguments_.pairIterations, position, pairPayload);
			if (position >= 0)
				raw[variant].push(
					rawSample(
						child.result,
						child.peakRss,
						order.map((index) => pairManifest.pairs[index].id),
					),
				);
		}
	}
	const statistics = {
		tsrx: summarizeSamples(raw.tsrx),
		tsx: summarizeSamples(raw.tsx),
	};
	const noiseResults = oracle4Noise(statistics);
	const oracle4Result = ratioAndClaims(statistics.tsrx, statistics.tsx, true);
	const valid4 = noiseResults.valid;
	const baseline = {
		schema: "yuku-tsrx-m5-measurement-v3",
		provenance: {
			scenario: "oracle4",
			preserved_from_sha256: arguments_.preserveFromSha256,
			pairs_sha256: sha256(pairText),
			classification_sha256: sha256(classificationText),
			common_paths_sha256: "b42716fbfa16ffc7a900aa9386b3411a3f07d2ebbff4b49527e423a49b646cbb",
			common_corpus_sha256: "79e79d5c599e40993de029f294a7e8446598d66c7e069d4a489174adc1ab38c5",
		},
		platform: {
			os: process.platform,
			architecture: process.arch,
			node: process.version,
			cpu: cpus()[0]?.model ?? fail("CPU identity unavailable"),
			logical_cpus: cpus().length,
			memory_bytes: totalmem(),
			locale: process.env.LC_ALL,
		},
		protocol: {
			seed: arguments_.seed,
			warmups: arguments_.warmups,
			samples: arguments_.samples,
			pair_iterations: arguments_.pairIterations,
			corpus_iterations: arguments_.corpusIterations,
			options,
			isolation: "one fresh child per variant/sample, serial strict variant alternation",
			pair_order: "seeded Fisher-Yates per sample index, shared by TSRX and TSX",
			conditioning: {
				iterations_per_pair: 30000,
				order: "same seeded order as timed sweep",
				timed: false,
			},
			time: {
				command: "/usr/bin/time",
				argument: "-l",
				peak_rss_field: "maximum resident set size",
				peak_rss_unit: "bytes",
				peak_rss_multiplier: 1,
			},
		},
		archived_oracle4_v1: previous.archived_oracle4,
		archived_oracle4_v2: previous.oracle4,
		oracle4: {
			input: { pair_count: 6, tsrx_bytes: 640, tsx_bytes: 661, pair_ids: expectedPairIds },
			raw_samples: { tsrx: raw.tsrx, tsx: raw.tsx },
			statistics: { tsrx: statistics.tsrx, tsx: statistics.tsx },
			noise: noiseResults,
			validity: valid4 ? "valid" : "invalid_noisy",
			ratios: oracle4Result.ratios,
			unique_tsrx_overhead_percent: oracle4Result.unique_tsrx_overhead_percent,
			claims: valid4 ? oracle4Result.claims : {},
		},
		oracle8: previous.oracle8,
	};
	writeFileSync(arguments_.output, canonical(baseline));
	if (!valid4) fail("measurement noise threshold exceeded");
};

main();
