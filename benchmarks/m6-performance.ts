import { createHash } from "node:crypto";
import { cpus, platform, arch, totalmem } from "node:os";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

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
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summary = (values: number[]) => {
	if (values.length !== 20 || values.some((item) => !Number.isFinite(item) || item <= 0))
		fail("summary requires twenty positive samples");
	const center = median(values);
	return {
		median: center,
		mad: median(values.map((item) => Math.abs(item - center))),
		p95: [...values].sort((a, b) => a - b)[18],
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
	const result = {
		duration_mad_over_median: stats.duration_ns.mad / stats.duration_ns.median,
		duration_p95_over_median: stats.duration_ns.p95 / stats.duration_ns.median,
		rss_mad_over_median: stats.peak_rss_bytes.mad / stats.peak_rss_bytes.median,
		rss_p95_over_median: stats.peak_rss_bytes.p95 / stats.peak_rss_bytes.median,
	};
	return {
		...result,
		valid:
			result.duration_mad_over_median <= 0.1 &&
			result.duration_p95_over_median <= 1.25 &&
			result.rss_mad_over_median <= 0.05 &&
			result.rss_p95_over_median <= 1.1,
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
	draws.sort((a, b) => a - b);
	return { median: median(differences), low: draws[249], high: draws[9749], resamples: 10000 };
};

const arguments_ = () => {
	const check = flag("--check");
	const phase = value("--phase", !check);
	const corpus = resolve(value("--corpus")!);
	const result = {
		check,
		phase,
		corpus,
		output: check ? undefined : resolve(value("--output")!),
		baseline: value("--baseline", false) ? resolve(value("--baseline")!) : undefined,
		attribution: value("--attribution", false) ? resolve(value("--attribution")!) : undefined,
		optimized: value("--optimized", false) ? resolve(value("--optimized")!) : undefined,
		packageBaseline: value("--package-baseline", false)
			? resolve(value("--package-baseline")!)
			: undefined,
		packageOptimized: value("--package-optimized", false)
			? resolve(value("--package-optimized")!)
			: undefined,
		performanceAddon: value("--performance-addon", false)
			? resolve(value("--performance-addon")!)
			: undefined,
		marklessRoot: value("--markless-root", false)
			? resolve(value("--markless-root")!)
			: resolve("../markless-yuku-tsrx-migration"),
		warmups: check ? expected.warmups : integer("--warmups"),
		samples: check ? expected.samples : integer("--samples"),
		iterations: check ? expected.iterations : integer("--iterations"),
		seed: check ? expected.seed : value("--seed")!,
	};
	if (
		!check &&
		(result.warmups !== 5 ||
			result.samples !== 20 ||
			result.iterations !== 25 ||
			result.seed !== expected.seed)
	)
		fail("protocol arguments differ from T003");
	if (!check && process.env.LC_ALL !== "C") fail("LC_ALL must equal C");
	return result;
};

const loadCorpus = (manifestPath: string, marklessRoot: string) => {
	const text = readFileSync(manifestPath, "utf8");
	const manifest = JSON.parse(text);
	const records = manifest.files.filter((file: any) => file.core.valid && file.yuku.valid);
	const files = records.map((record: any) => {
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
	return { text, files: Object.freeze(files) };
};

const packageEntry = (root: string): string => resolve(root, "index.js");
const addonPath = (root: string, name: string): string => resolve(root, `${name}.node`);
const coreEntry = (): string => resolve("node_modules/@tsrx/core/src/index.js");
const childRun = (
	scenario: string,
	sampleIndex: number,
	iterations: number,
	payload: unknown,
): RawSample => {
	const input = `${JSON.stringify(payload)}\n`;
	const child = spawnSync(
		"/usr/bin/time",
		[
			"-l",
			process.execPath,
			resolve("benchmarks/m6-performance-child.ts"),
			"--scenario",
			scenario,
			"--sample-index",
			String(sampleIndex),
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
		result.schema !== "yuku-tsrx-m6-child-v1" ||
		result.scenario !== scenario ||
		result.sample_index !== sampleIndex
	)
		fail("child identity differs");
	const { duration_ns, parses, bytes } = result.aggregate;
	const peak_rss_bytes = Number(matches[0][1]);
	if (
		![duration_ns, parses, bytes, peak_rss_bytes].every((item) => Number.isFinite(item) && item > 0)
	)
		fail("invalid child metric");
	return {
		sample_index: sampleIndex,
		position: sampleIndex,
		aggregate: {
			duration_ns,
			ns_per_parse: duration_ns / parses,
			peak_rss_bytes,
			parses_per_second: (parses * 1e9) / duration_ns,
			bytes_per_second: (bytes * 1e9) / duration_ns,
		},
	};
};

const provenance = (
	args: ReturnType<typeof arguments_>,
	corpusText: string,
	packageRoot: string,
) => ({
	repositories: {
		yuku_tsrx: "d65db5d716555e2f627c11c8f488b3d991482913",
		yuku_dialect: "872758e8ea30ecd3e423ae266cf5c7cf586c8820",
		yuku_control: "bf03e146d97ae2f0c2d4c4ec90456e1e544d2760",
		markless: "e16536f688187a9c0abe54766d20771c419c514b",
	},
	runtime: {
		node: process.version,
		pnpm: "10.33.2",
		zig: "0.16.0",
		platform: platform(),
		architecture: arch(),
		cpu: cpus()[0]?.model ?? fail("CPU unavailable"),
		logical_cpus: cpus().length,
		memory_bytes: totalmem(),
		locale: process.env.LC_ALL,
	},
	corpus_manifest_sha256: sha256(corpusText),
	common_paths_sha256: expected.paths,
	common_corpus_sha256: expected.corpus,
	package_files_sha256: filesWithHashes(packageRoot),
	addon_sha256: sha256(readFileSync(addonPath(resolve(packageRoot, "../..", "lib"), "yuku-tsrx"))),
});
const protocol = (args: ReturnType<typeof arguments_>) => ({
	warmups: args.warmups,
	samples: args.samples,
	iterations: args.iterations,
	seed: args.seed,
	options,
	locale: "C",
	isolation: "one fresh child per scenario/variant/sample; serial seeded order; no forced GC",
	conditioning: "one untimed corpus pass before the timed parse loop",
	retention:
		"source strings plus exactly the latest eager Program for every corpus file through child emission",
	latency: "timed parse loop only",
	peak_rss: "whole-child /usr/bin/time -l maximum resident set size",
});
const collected = (samples: Record<string, RawSample[]>) => {
	const stats = Object.fromEntries(
		Object.entries(samples).map(([id, raw]) => [id, statistics(raw)]),
	);
	const gates = Object.fromEntries(Object.entries(stats).map(([id, item]) => [id, noise(item)]));
	return {
		raw_samples: samples,
		statistics: stats,
		noise: gates,
		valid: Object.values(gates).every((item) => item.valid),
	};
};

const baselinePhase = async (
	args: ReturnType<typeof arguments_>,
	corpusText: string,
	files: readonly any[],
) => {
	const root = args.packageBaseline ?? fail("baseline package missing");
	const payload = {
		schema: "yuku-tsrx-m6-payload-v1",
		files,
		package_entry: packageEntry(root),
		core_entry: coreEntry(),
	};
	const samples: Record<string, RawSample[]> = { yuku: [], core: [] };
	const positions: Array<{ sample_index: number; order: string[] }> = [];
	for (let index = -args.warmups; index < args.samples; index++) {
		const ids = order(args.seed, index, ["yuku", "core"]);
		positions.push({ sample_index: index, order: ids });
		for (const id of ids) {
			const sample = childRun(
				id === "yuku" ? "public-retain" : "core",
				index,
				args.iterations,
				payload,
			);
			if (index >= 0) samples[id].push(sample);
		}
	}
	const data = collected(samples);
	const yuku: any = data.statistics.yuku;
	const core: any = data.statistics.core;
	const output = {
		schema: "yuku-tsrx-m6-baseline-v1",
		provenance: provenance(args, corpusText, root),
		protocol: protocol(args),
		input: {
			file_count: expected.files,
			bytes: expected.bytes,
			paths_sha256: expected.paths,
			corpus_sha256: expected.corpus,
		},
		positions,
		...data,
		ratios: {
			ns_per_parse: yuku.ns_per_parse.median / core.ns_per_parse.median,
			throughput_cost: core.parses_per_second.median / yuku.parses_per_second.median,
			peak_rss: yuku.peak_rss_bytes.median / core.peak_rss_bytes.median,
		},
	};
	writeFileSync(args.output!, canonical(output));
	if (!data.valid) fail("baseline noise gate failed");
};

const attributionPhase = async (
	args: ReturnType<typeof arguments_>,
	corpusText: string,
	files: readonly any[],
) => {
	const root = args.packageBaseline ?? fail("baseline package missing");
	const baseline = JSON.parse(
		readFileSync(args.baseline ?? fail("baseline evidence missing"), "utf8"),
	);
	if (!baseline.valid || baseline.provenance.common_corpus_sha256 !== expected.corpus)
		fail("invalid baseline evidence");
	const module = await import(`${pathToFileURL(packageEntry(root)).href}?freeze=${Date.now()}`);
	const frozenFiles = files.map((file) => {
		const wire = module.parseWire(file.source, {});
		return { ...file, wire: Buffer.from(wire).toString("base64") };
	});
	const frozenWireHash = sha256(
		Buffer.concat(frozenFiles.map((file) => Buffer.from(file.wire, "base64"))),
	);
	const payload = {
		schema: "yuku-tsrx-m6-payload-v1",
		files: frozenFiles,
		package_entry: packageEntry(root),
		core_entry: coreEntry(),
		performance_addon: addonPath(
			args.performanceAddon ?? fail("performance addon missing"),
			"yuku-tsrx-performance",
		),
		markless_entry: resolve(args.marklessRoot, "packages/compiler/src/yuku-tsrx-adapter.ts"),
	};
	const ids = [
		"harness",
		"import",
		"encoding",
		"tree",
		"wire",
		"frozen-wire-load",
		"decode",
		"public-discard",
		"public-retain",
		"markless",
	];
	const samples = Object.fromEntries(ids.map((id) => [id, [] as RawSample[]]));
	const positions: Array<{ sample_index: number; order: string[] }> = [];
	for (let index = -args.warmups; index < args.samples; index++) {
		const idsAtPosition = order(args.seed, index, ids);
		positions.push({ sample_index: index, order: idsAtPosition });
		for (const id of idsAtPosition) {
			const sample = childRun(id, index, args.iterations, payload);
			if (index >= 0) samples[id].push(sample);
		}
	}
	const data = collected(samples);
	const wireValues = samples.wire.map((item) => item.aggregate.peak_rss_bytes);
	const treeValues = samples.tree.map((item) => item.aggregate.peak_rss_bytes);
	const paired = bootstrap(wireValues, treeValues, `${args.seed}:wire-tree`);
	const pooledMad = Math.max(
		(data.statistics.wire as any).peak_rss_bytes.mad,
		(data.statistics.tree as any).peak_rss_bytes.mad,
	);
	const threshold = Math.max(8 * 1024 * 1024, 3 * pooledMad);
	const baselineRss = baseline.statistics.yuku.peak_rss_bytes.median;
	const actionable =
		paired.median >= threshold && paired.low > 0 && paired.median >= baselineRss * 0.1;
	const output = {
		schema: "yuku-tsrx-m6-attribution-v1",
		provenance: provenance(args, corpusText, root),
		protocol: {
			...protocol(args),
			frozen_wire_sha256: frozenWireHash,
			frozen_wire_bytes: frozenFiles.reduce(
				(sum, file) => sum + Buffer.from(file.wire, "base64").byteLength,
				0,
			),
		},
		positions,
		...data,
		attribution: {
			wire_minus_tree_peak_rss: paired,
			pooled_rss_mad: pooledMad,
			actionability_threshold_bytes: threshold,
			primary_ten_percent_bytes: baselineRss * 0.1,
			wire_lifetime_actionable: actionable,
		},
	};
	writeFileSync(args.output!, canonical(output));
	if (!data.valid) fail("attribution noise gate failed");
	if (!actionable) fail("wire lifetime is not actionable under T003 gates");
};

const optimizedPhase = async (
	args: ReturnType<typeof arguments_>,
	corpusText: string,
	files: readonly any[],
) => {
	const baseline = JSON.parse(
		readFileSync(args.baseline ?? fail("baseline evidence missing"), "utf8"),
	);
	const attribution = JSON.parse(
		readFileSync(args.attribution ?? fail("attribution evidence missing"), "utf8"),
	);
	if (!baseline.valid || !attribution.valid || !attribution.attribution.wire_lifetime_actionable)
		fail("optimization is not authorized by valid attribution");
	const roots = { baseline: args.packageBaseline!, optimized: args.packageOptimized! };
	const payloads = Object.fromEntries(
		Object.entries(roots).map(([id, root]) => [
			id,
			{
				schema: "yuku-tsrx-m6-payload-v1",
				files,
				package_entry: packageEntry(root),
				core_entry: coreEntry(),
			},
		]),
	);
	const samples: Record<string, RawSample[]> = { baseline: [], optimized: [], core: [] };
	const positions: Array<{ sample_index: number; order: string[] }> = [];
	for (let index = -args.warmups; index < args.samples; index++) {
		const ids = order(args.seed, index, ["baseline", "optimized", "core"]);
		positions.push({ sample_index: index, order: ids });
		for (const id of ids) {
			const scenario = id === "core" ? "core" : "public-retain";
			const payload = id === "optimized" ? payloads.optimized : payloads.baseline;
			const sample = childRun(scenario, index, args.iterations, payload);
			if (index >= 0) samples[id].push(sample);
		}
	}
	const data = collected(samples);
	const baselineStats: any = data.statistics.baseline;
	const optimized: any = data.statistics.optimized;
	const core: any = data.statistics.core;
	const historicalCore: any = baseline.statistics.core;
	const ratios = {
		optimized_ns_per_parse_over_core: optimized.ns_per_parse.median / core.ns_per_parse.median,
		optimized_throughput_cost_over_core:
			core.parses_per_second.median / optimized.parses_per_second.median,
		optimized_peak_rss_over_baseline:
			optimized.peak_rss_bytes.median / baselineStats.peak_rss_bytes.median,
		baseline_core_environmental_drift: Math.abs(
			core.ns_per_parse.median / historicalCore.ns_per_parse.median - 1,
		),
	};
	const passed =
		data.valid &&
		ratios.optimized_ns_per_parse_over_core <= 0.34 &&
		ratios.optimized_throughput_cost_over_core <= 0.34 &&
		ratios.optimized_peak_rss_over_baseline <= 0.9 &&
		optimized.peak_rss_bytes.p95 <= baselineStats.peak_rss_bytes.p95 &&
		ratios.baseline_core_environmental_drift <= 0.1;
	const output = {
		schema: "yuku-tsrx-m6-optimized-v1",
		provenance: {
			baseline: provenance(args, corpusText, roots.baseline),
			optimized: provenance(args, corpusText, roots.optimized),
		},
		protocol: protocol(args),
		positions,
		...data,
		ratios,
		gates_passed: passed,
	};
	writeFileSync(args.output!, canonical(output));
	if (!passed) fail("optimized campaign gate failed");
};

const check = (args: ReturnType<typeof arguments_>): void => {
	for (const [name, path, schema] of [
		["baseline", args.baseline, "yuku-tsrx-m6-baseline-v1"],
		["attribution", args.attribution, "yuku-tsrx-m6-attribution-v1"],
		["optimized", args.optimized, "yuku-tsrx-m6-optimized-v1"],
	] as const) {
		const text = readFileSync(path ?? fail(`${name} path missing`), "utf8");
		if (text !== canonical(JSON.parse(text))) fail(`${name} is not canonical JSON`);
		const data = JSON.parse(text);
		if (data.schema !== schema || data.valid !== true) fail(`${name} evidence invalid`);
		for (const samples of Object.values(data.raw_samples) as RawSample[][])
			if (samples.length !== 20) fail(`${name} raw samples missing`);
	}
	const attribution = JSON.parse(readFileSync(args.attribution!, "utf8"));
	const optimized = JSON.parse(readFileSync(args.optimized!, "utf8"));
	if (!attribution.attribution.wire_lifetime_actionable || optimized.gates_passed !== true)
		fail("binding oracle not satisfied");
};

const main = async (): Promise<void> => {
	const args = arguments_();
	if (args.check) return check(args);
	const { text, files } = loadCorpus(args.corpus, args.marklessRoot);
	if (args.phase === "baseline") return baselinePhase(args, text, files);
	if (args.phase === "attribution") return attributionPhase(args, text, files);
	if (args.phase === "optimized") return optimizedPhase(args, text, files);
	fail(`unknown phase ${args.phase}`);
};

await main();
