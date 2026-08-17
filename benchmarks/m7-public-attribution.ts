import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { relative, resolve } from "node:path";

type RawSample = Readonly<{
	sample_index: number;
	position: number;
	aggregate: Readonly<{
		duration_ns: number;
		ns_per_parse: number;
		peak_rss_bytes: number;
		parses_per_second: number;
		bytes_per_second: number;
	}>;
}>;

const expected = Object.freeze({
	files: 224,
	bytes: 214751,
	paths: "b42716fbfa16ffc7a900aa9386b3411a3f07d2ebbff4b49527e423a49b646cbb",
	corpus: "79e79d5c599e40993de029f294a7e8446598d66c7e069d4a489174adc1ab38c5",
	m6Baseline: "5c98532712a5d1dd515a1ef29ef2d37d1f475570b2bf8993ad8a1c853598de24",
	m6Attribution: "4254d79487ff50459cbb53d818b8a88c1d53e5ecf6a62d6310ae87a9c84ec4f5",
	warmups: 5,
	samples: 20,
	iterations: 25,
	seed: "6d362d7631",
});
const options = Object.freeze({ collect: false, loose: false });
const fail = (message: string): never => {
	throw new Error(message);
};
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const flag = (name: string): boolean => process.argv.includes(name);
const value = (name: string, required = true): string | undefined => {
	const index = process.argv.indexOf(name);
	if (index < 0) {
		if (required) fail(`${name} is required`);
		return undefined;
	}
	const result = process.argv[index + 1];
	if (!result || result.startsWith("--")) fail(`${name} requires a value`);
	return result;
};
const integer = (name: string): number => {
	const result = Number(value(name));
	if (!Number.isSafeInteger(result) || result <= 0) fail(`${name} must be positive`);
	return result;
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
const filesWithHashes = (root: string): Record<string, string> => {
	const output: Record<string, string> = {};
	const visit = (directory: string): void => {
		for (const name of readdirSync(directory).sort()) {
			const path = resolve(directory, name);
			const stat = statSync(path);
			if (stat.isDirectory()) visit(path);
			else if (stat.isFile()) output[relative(root, path)] = sha256(readFileSync(path));
		}
	};
	visit(root);
	return output;
};
const median = (values: number[]): number => {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = sorted.length >> 1;
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summary = (values: number[]) => {
	if (
		values.length !== expected.samples ||
		values.some((item) => !Number.isFinite(item) || item <= 0)
	)
		fail("summary requires twenty positive samples");
	const center = median(values);
	return {
		median: center,
		mad: median(values.map((item) => Math.abs(item - center))),
		p95: [...values].sort((left, right) => left - right)[18],
	};
};
const statistics = (samples: RawSample[]) => ({
	duration_ns: summary(samples.map((item) => item.aggregate.duration_ns)),
	ns_per_parse: summary(samples.map((item) => item.aggregate.ns_per_parse)),
	peak_rss_bytes: summary(samples.map((item) => item.aggregate.peak_rss_bytes)),
	parses_per_second: summary(samples.map((item) => item.aggregate.parses_per_second)),
	bytes_per_second: summary(samples.map((item) => item.aggregate.bytes_per_second)),
});
const noise = (stats: ReturnType<typeof statistics>) => {
	const ratios = {
		duration_mad_over_median: stats.duration_ns.mad / stats.duration_ns.median,
		duration_p95_over_median: stats.duration_ns.p95 / stats.duration_ns.median,
		rss_mad_over_median: stats.peak_rss_bytes.mad / stats.peak_rss_bytes.median,
		rss_p95_over_median: stats.peak_rss_bytes.p95 / stats.peak_rss_bytes.median,
	};
	return {
		...ratios,
		valid:
			ratios.duration_mad_over_median <= 0.1 &&
			ratios.duration_p95_over_median <= 1.25 &&
			ratios.rss_mad_over_median <= 0.05 &&
			ratios.rss_p95_over_median <= 1.1,
	};
};
const order = (seed: string, index: number, ids: string[]): string[] => {
	let state = Number.parseInt(sha256(`${seed}:${index}`).slice(0, 8), 16) >>> 0;
	const next = (): number => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	};
	const result = [...ids];
	for (let position = result.length - 1; position > 0; position--) {
		const selected = next() % (position + 1);
		[result[position], result[selected]] = [result[selected], result[position]];
	}
	return result;
};
const bootstrap = (left: number[], right: number[], seed: string) => {
	if (left.length !== right.length || left.length !== expected.samples)
		fail("paired samples missing");
	const differences = left.map((item, index) => item - right[index]);
	let state = Number.parseInt(sha256(seed).slice(0, 8), 16) >>> 0;
	const next = (): number => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state;
	};
	const draws = new Array<number>(10000);
	for (let draw = 0; draw < draws.length; draw++) {
		const sample = new Array<number>(differences.length);
		for (let index = 0; index < sample.length; index++)
			sample[index] = differences[next() % differences.length];
		draws[draw] = median(sample);
	}
	draws.sort((left, right) => left - right);
	return { median: median(differences), low: draws[249], high: draws[9749], resamples: 10000 };
};

const arguments_ = () => {
	const check = flag("--check");
	const result = {
		check,
		corpus: resolve(value("--corpus")!),
		m6Baseline: resolve(value("--m6-baseline")!),
		m6Attribution: resolve(value("--m6-attribution")!),
		result: check ? resolve(value("--result")!) : undefined,
		output: check ? undefined : resolve(value("--output")!),
		packageBaseline: check ? undefined : resolve(value("--package-baseline")!),
		marklessRoot: resolve(value("--markless-root", false) ?? "../markless-yuku-tsrx-migration"),
		warmups: check ? expected.warmups : integer("--warmups"),
		samples: check ? expected.samples : integer("--samples"),
		iterations: check ? expected.iterations : integer("--iterations"),
		seed: check ? expected.seed : value("--seed")!,
	};
	if (
		!check &&
		(result.warmups !== expected.warmups ||
			result.samples !== expected.samples ||
			result.iterations !== expected.iterations ||
			result.seed !== expected.seed)
	)
		fail("protocol arguments differ from T005");
	if (!check && process.env.LC_ALL !== "C") fail("LC_ALL must equal C");
	return result;
};
const loadJson = (path: string, hash: string, schema: string): any => {
	const text = readFileSync(path, "utf8");
	if (sha256(text) !== hash) fail(`${schema} hash differs`);
	const result = JSON.parse(text);
	if (result.schema !== schema) fail(`${schema} identity differs`);
	return result;
};
const loadCorpus = (manifestPath: string, marklessRoot: string) => {
	const manifestText = readFileSync(manifestPath, "utf8");
	const manifest = JSON.parse(manifestText);
	const files = manifest.files
		.filter((file: any) => file.core.valid && file.yuku.valid)
		.map((record: any) => {
			const source = readFileSync(resolve(marklessRoot, record.path), "utf8");
			if (sha256(source) !== record.source_sha256 || Buffer.byteLength(source) !== record.bytes)
				fail(`corpus file drift ${record.path}`);
			return Object.freeze({ path: record.path, source });
		});
	if (
		files.length !== expected.files ||
		files.reduce((sum: number, file: any) => sum + Buffer.byteLength(file.source), 0) !==
			expected.bytes ||
		hashPaths(files.map((file: any) => file.path)) !== expected.paths ||
		hashCorpus(files) !== expected.corpus
	)
		fail("common-valid corpus identity differs");
	return { manifestText, files: Object.freeze(files) };
};
const childRun = (
	scenario: string,
	sampleIndex: number,
	position: number,
	iterations: number,
	payload: unknown,
): RawSample => {
	const input = `${JSON.stringify(payload)}\n`;
	const child = spawnSync(
		"/usr/bin/time",
		[
			"-l",
			process.execPath,
			resolve("benchmarks/m7-public-attribution-child.ts"),
			"--scenario",
			scenario,
			"--sample-index",
			String(sampleIndex),
			"--position",
			String(position),
			"--iterations",
			String(iterations),
			"--payload-sha256",
			sha256(input),
		],
		{ input, encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, maxBuffer: 64 * 1024 * 1024 },
	);
	if (child.error) throw child.error;
	if (child.status !== 0) fail(`child ${scenario}/${sampleIndex} failed: ${child.stderr.trim()}`);
	const matches = [...child.stderr.matchAll(/^\s*(\d+)\s+maximum resident set size\s*$/gm)];
	if (matches.length !== 1) fail(`invalid OS RSS output for ${scenario}`);
	const result = JSON.parse(child.stdout);
	if (
		result.schema !== "yuku-tsrx-m7-child-v1" ||
		result.scenario !== scenario ||
		result.sample_index !== sampleIndex ||
		result.position !== position
	)
		fail("child identity differs");
	if (scenario === "public-retain" || scenario === "core") {
		if (result.retained_count !== expected.files) fail(`${scenario} retention differs`);
	} else if (result.retained_count !== 0) fail("public-discard retained a result");
	const { duration_ns, parses, bytes } = result.aggregate;
	const peak_rss_bytes = Number(matches[0][1]);
	if (
		![duration_ns, parses, bytes, peak_rss_bytes].every((item) => Number.isFinite(item) && item > 0)
	)
		fail("invalid child metric");
	return {
		sample_index: sampleIndex,
		position,
		aggregate: {
			duration_ns,
			ns_per_parse: duration_ns / parses,
			peak_rss_bytes,
			parses_per_second: (parses * 1e9) / duration_ns,
			bytes_per_second: (bytes * 1e9) / duration_ns,
		},
	};
};

const validateFrozenIdentity = (m6Baseline: any, packageRoot: string): void => {
	if (
		process.version !== m6Baseline.provenance.runtime.node ||
		platform() !== m6Baseline.provenance.runtime.platform ||
		arch() !== m6Baseline.provenance.runtime.architecture ||
		cpus()[0]?.model !== m6Baseline.provenance.runtime.cpu ||
		cpus().length !== m6Baseline.provenance.runtime.logical_cpus ||
		totalmem() !== m6Baseline.provenance.runtime.memory_bytes
	)
		fail("runtime identity differs from m6 baseline");
	if (
		canonical(filesWithHashes(packageRoot)) !==
		canonical(m6Baseline.provenance.package_files_sha256)
	)
		fail("package artifact identity differs from m6 baseline");
};

const run = (args: ReturnType<typeof arguments_>): void => {
	const m6Baseline = loadJson(args.m6Baseline, expected.m6Baseline, "yuku-tsrx-m6-baseline-v1");
	const m6Attribution = loadJson(
		args.m6Attribution,
		expected.m6Attribution,
		"yuku-tsrx-m6-attribution-v1",
	);
	const { manifestText, files } = loadCorpus(args.corpus, args.marklessRoot);
	const packageRoot = args.packageBaseline!;
	validateFrozenIdentity(m6Baseline, packageRoot);
	const validM6Ids = [
		"harness",
		"import",
		"encoding",
		"tree",
		"wire",
		"frozen-wire-load",
		"decode",
	];
	if (validM6Ids.some((id) => m6Attribution.noise[id]?.valid !== true))
		fail("required m6 stratum is invalid");
	const payload = Object.freeze({
		schema: "yuku-tsrx-m7-source-payload-v1",
		files,
		package_entry: resolve(packageRoot, "index.js"),
		core_entry: resolve("node_modules/@tsrx/core/src/index.js"),
	});
	const ids = ["public-discard", "public-retain", "core"];
	const samples = Object.fromEntries(ids.map((id) => [id, [] as RawSample[]]));
	const positions: Array<{ sample_index: number; order: string[] }> = [];
	for (let sampleIndex = -args.warmups; sampleIndex < args.samples; sampleIndex++) {
		const sampleOrder = order(args.seed, sampleIndex, ids);
		positions.push({ sample_index: sampleIndex, order: sampleOrder });
		for (let position = 0; position < sampleOrder.length; position++) {
			const id = sampleOrder[position];
			const sample = childRun(id, sampleIndex, position, args.iterations, payload);
			if (sampleIndex >= 0) samples[id].push(sample);
		}
	}
	const stats = Object.fromEntries(
		Object.entries(samples).map(([id, raw]) => [id, statistics(raw)]),
	);
	const gates = Object.fromEntries(Object.entries(stats).map(([id, item]) => [id, noise(item)]));
	const paired = bootstrap(
		samples["public-retain"].map((item) => item.aggregate.peak_rss_bytes),
		samples["public-discard"].map((item) => item.aggregate.peak_rss_bytes),
		`${args.seed}:public-retain-public-discard`,
	);
	const pooledMad = Math.max(
		stats["public-retain"].peak_rss_bytes.mad,
		stats["public-discard"].peak_rss_bytes.mad,
	);
	const primaryTenPercent = m6Baseline.statistics.yuku.peak_rss_bytes.median * 0.1;
	const actionabilityThreshold = Math.max(8 * 1024 * 1024, 3 * pooledMad, primaryTenPercent);
	const drift = {
		yuku: Math.abs(
			stats["public-retain"].ns_per_parse.median / m6Baseline.statistics.yuku.ns_per_parse.median -
				1,
		),
		core: Math.abs(
			stats.core.ns_per_parse.median / m6Baseline.statistics.core.ns_per_parse.median - 1,
		),
	};
	const sourceOnlyValid =
		Object.values(gates).every((item) => item.valid) && drift.yuku <= 0.1 && drift.core <= 0.1;
	const publicRetentionActionable = paired.median >= actionabilityThreshold && paired.low > 0;
	const decodeDelta = bootstrap(
		m6Attribution.raw_samples.decode.map((item: RawSample) => item.aggregate.peak_rss_bytes),
		m6Attribution.raw_samples["frozen-wire-load"].map(
			(item: RawSample) => item.aggregate.peak_rss_bytes,
		),
		`${args.seed}:decode-frozen-wire-load`,
	);
	const decodeThreshold = Math.max(
		8 * 1024 * 1024,
		3 *
			Math.max(
				m6Attribution.statistics.decode.peak_rss_bytes.mad,
				m6Attribution.statistics["frozen-wire-load"].peak_rss_bytes.mad,
			),
		primaryTenPercent,
	);
	const decodeActionable = decodeDelta.median >= decodeThreshold && decodeDelta.low > 0;
	const verdict = publicRetentionActionable
		? {
				kind: "actionable_yuku_tsrx_owned_layer",
				layer: "eager public Program retention/materialization",
				production_authorized: false,
				next_boundary:
					"A Judge must determine whether any locally owned change can reduce eager Program materialization without weakening the required public AST.",
			}
		: {
				kind: "owner_decision_required",
				finding: decodeActionable
					? "The only measured layer meeting the 10% threshold is generated AST decode/materialization."
					: "No measured locally owned layer meets the 10% threshold.",
				choices: [
					"Relax the binding 10% median peak-RSS oracle.",
					"Separately authorize upstream-generated decoder work while preserving the complete eager public AST.",
				],
				production_authorized: false,
			};
	const output = {
		schema: "yuku-tsrx-m7-public-attribution-v1",
		provenance: {
			repositories: m6Baseline.provenance.repositories,
			runtime: m6Baseline.provenance.runtime,
			corpus_manifest_sha256: sha256(manifestText),
			m6_baseline_sha256: expected.m6Baseline,
			m6_attribution_sha256: expected.m6Attribution,
			package_files_sha256: filesWithHashes(packageRoot),
		},
		protocol: {
			warmups: args.warmups,
			samples: args.samples,
			iterations: args.iterations,
			seed: args.seed,
			options,
			locale: "C",
			payload: "source paths and source strings only; no frozen-wire fields or base64 wire payload",
			isolation:
				"one fresh child per variant/sample; variants interleaved in serial seeded order; no forced GC",
			conditioning: "one untimed corpus pass before the timed parse loop",
			retention:
				"public-retain and core root exactly the latest eager Program for each file; public-discard roots none",
			latency: "timed parse loop only",
			peak_rss: "whole-child /usr/bin/time -l maximum resident set size",
		},
		input: {
			file_count: expected.files,
			bytes: expected.bytes,
			paths_sha256: expected.paths,
			corpus_sha256: expected.corpus,
		},
		positions,
		raw_samples: samples,
		statistics: stats,
		noise: gates,
		environmental_drift: drift,
		valid: sourceOnlyValid,
		attribution: {
			public_retain_minus_discard_peak_rss: paired,
			pooled_rss_mad: pooledMad,
			primary_ten_percent_bytes: primaryTenPercent,
			actionability_threshold_bytes: actionabilityThreshold,
			public_retention_actionable: publicRetentionActionable,
			valid_m6_strata: validM6Ids,
			decode_minus_frozen_wire_load_peak_rss: decodeDelta,
			decode_actionability_threshold_bytes: decodeThreshold,
			decode_materialization_actionable: decodeActionable,
		},
		feasibility_verdict: verdict,
	};
	writeFileSync(args.output!, canonical(output));
	if (!sourceOnlyValid) fail("m7 source-only noise or environmental-drift gate failed");
};

const check = (args: ReturnType<typeof arguments_>): void => {
	loadJson(args.m6Baseline, expected.m6Baseline, "yuku-tsrx-m6-baseline-v1");
	loadJson(args.m6Attribution, expected.m6Attribution, "yuku-tsrx-m6-attribution-v1");
	loadCorpus(args.corpus, args.marklessRoot);
	const text = readFileSync(args.result!, "utf8");
	if (text !== canonical(JSON.parse(text))) fail("m7 result is not canonical JSON");
	const result = JSON.parse(text);
	if (result.schema !== "yuku-tsrx-m7-public-attribution-v1" || result.valid !== true)
		fail("m7 result is invalid");
	for (const id of ["public-discard", "public-retain", "core"]) {
		if (result.raw_samples[id]?.length !== expected.samples || result.noise[id]?.valid !== true)
			fail(`${id} evidence is incomplete`);
		for (let index = 0; index < expected.samples; index++) {
			const sample = result.raw_samples[id][index];
			if (
				sample.sample_index !== index ||
				result.positions[index + expected.warmups].order[sample.position] !== id
			)
				fail(`${id} sample positions differ`);
		}
	}
	if (result.environmental_drift.yuku > 0.1 || result.environmental_drift.core > 0.1)
		fail("environmental drift exceeds T005 threshold");
	if (result.attribution.public_retain_minus_discard_peak_rss.resamples !== 10000)
		fail("paired bootstrap contract differs");
	if (!result.feasibility_verdict || result.feasibility_verdict.production_authorized !== false)
		fail("phase-closing feasibility verdict missing");
	if (/base64|\"wire\"\s*:/.test(JSON.stringify(result.raw_samples)))
		fail("wire data leaked into retained samples");
};

const main = (): void => {
	const args = arguments_();
	if (args.check) check(args);
	else run(args);
};

main();
