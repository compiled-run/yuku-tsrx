import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { parseModule } from "@tsrx/core";

const warmupIterations = 2;
const sampleIterations = 5;

const fail = (message: string): never => {
	throw new Error(message);
};

const corpusArgument = (): string => {
	const index = process.argv.indexOf("--corpus");
	if (index < 0 || !process.argv[index + 1]) fail("--corpus is required");
	return resolve(process.argv[index + 1]);
};

const trackedTsrxFiles = (corpus: string): string[] => {
	const result = spawnSync("git", ["-C", corpus, "ls-files", "-z", "--", "*.tsrx"], {
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) fail(`git ls-files exited with ${result.status ?? "unknown"}`);
	const files = result.stdout.split("\0").filter(Boolean).sort();
	if (files.length === 0) fail("the tracked Markless TSRX corpus is empty");
	return files;
};

const main = async (): Promise<void> => {
	const corpus = corpusArgument();
	const files = trackedTsrxFiles(corpus);
	const sources = await Promise.all(
		files.map(async (path) => ({ path, source: await readFile(resolve(corpus, path), "utf8") })),
	);
	const corpusHash = createHash("sha256");
	for (const file of sources)
		corpusHash.update(file.path).update("\0").update(file.source).update("\0");

	let validCount = 0;
	let invalidCount = 0;
	const parseCorpus = (): void => {
		for (const file of sources) {
			try {
				parseModule(file.source, file.path);
				validCount += 1;
			} catch {
				invalidCount += 1;
			}
		}
	};
	for (let iteration = 0; iteration < warmupIterations; iteration += 1) parseCorpus();
	validCount = 0;
	invalidCount = 0;
	const rssBefore = process.memoryUsage.rss();
	const samplesMs: number[] = [];
	for (let iteration = 0; iteration < sampleIterations; iteration += 1) {
		const started = performance.now();
		parseCorpus();
		samplesMs.push(performance.now() - started);
	}
	const rssAfter = process.memoryUsage.rss();

	const result = {
		command: `node benchmarks/tsrx-core.ts --corpus ${process.argv[process.argv.indexOf("--corpus") + 1]} --json`,
		corpus_files: files.length,
		corpus_sha256: corpusHash.digest("hex"),
		invalid_per_sample: invalidCount / sampleIterations,
		machine: { arch: process.arch, node: process.version, platform: process.platform },
		memory_rss_delta_bytes: Math.max(0, rssAfter - rssBefore),
		samples_ms: samplesMs,
		valid_per_sample: validCount / sampleIterations,
		warmup_iterations: warmupIterations,
	};
	process.stdout.write(`${JSON.stringify(result)}\n`);
};

await main();
