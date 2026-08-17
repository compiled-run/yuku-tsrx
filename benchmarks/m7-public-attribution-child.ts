import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type FileInput = Readonly<{ path: string; source: string }>;
type Payload = Readonly<{
	schema: "yuku-tsrx-m7-source-payload-v1";
	files: FileInput[];
	package_entry: string;
	core_entry: string;
}>;

const fail = (message: string): never => {
	throw new Error(message);
};
const argument = (name: string): string => {
	const index = process.argv.indexOf(name);
	const result = process.argv[index + 1];
	if (index < 0 || !result || result.startsWith("--")) fail(`${name} requires a value`);
	return result;
};
const positiveInteger = (name: string): number => {
	const result = Number(argument(name));
	if (!Number.isSafeInteger(result) || result <= 0) fail(`${name} must be positive`);
	return result;
};
const timed = (run: () => void): number => {
	const start = process.hrtime.bigint();
	run();
	const result = Number(process.hrtime.bigint() - start);
	if (!Number.isSafeInteger(result) || result <= 0) fail("invalid duration");
	return result;
};

const options = Object.freeze({ collect: false, loose: false });
let retained: unknown;

const main = async (): Promise<void> => {
	const scenario = argument("--scenario");
	const sampleIndex = Number(argument("--sample-index"));
	const position = Number(argument("--position"));
	const iterations = positiveInteger("--iterations");
	if (
		!Number.isSafeInteger(sampleIndex) ||
		!Number.isSafeInteger(position) ||
		position < 0 ||
		position > 2
	)
		fail("invalid sample identity");
	const bytes = readFileSync(0);
	if (createHash("sha256").update(bytes).digest("hex") !== argument("--payload-sha256"))
		fail("payload digest mismatch");
	const payload = JSON.parse(bytes.toString("utf8")) as Payload;
	if (
		payload.schema !== "yuku-tsrx-m7-source-payload-v1" ||
		payload.files.length !== 224 ||
		Object.keys(payload).sort().join(",") !== "core_entry,files,package_entry,schema" ||
		payload.files.some((file) => Object.keys(file).sort().join(",") !== "path,source")
	)
		fail("invalid source-only payload");
	const totalBytes = payload.files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0);
	if (totalBytes !== 214751) fail("corpus byte count differs");

	let duration_ns = 0;
	if (scenario === "public-discard" || scenario === "public-retain") {
		const module = await import(pathToFileURL(payload.package_entry).href);
		for (const file of payload.files) module.parseModule(file.source, file.path, options);
		duration_ns = timed(() => {
			for (let iteration = 0; iteration < iterations; iteration++) {
				const latest = scenario === "public-retain" ? new Array(payload.files.length) : undefined;
				for (let index = 0; index < payload.files.length; index++) {
					const file = payload.files[index];
					const program = module.parseModule(file.source, file.path, options);
					if (latest && iteration === iterations - 1) latest[index] = program;
				}
				if (latest && iteration === iterations - 1) retained = latest;
			}
		});
	} else if (scenario === "core") {
		const module = await import(pathToFileURL(payload.core_entry).href);
		for (const file of payload.files) module.parseModule(file.source, file.path, options);
		duration_ns = timed(() => {
			for (let iteration = 0; iteration < iterations; iteration++) {
				const latest = new Array(payload.files.length);
				for (let index = 0; index < payload.files.length; index++) {
					const file = payload.files[index];
					latest[index] = module.parseModule(file.source, file.path, options);
				}
				retained = latest;
			}
		});
	} else fail(`unknown scenario ${scenario}`);

	process.stdout.write(
		`${JSON.stringify({
			schema: "yuku-tsrx-m7-child-v1",
			scenario,
			sample_index: sampleIndex,
			position,
			aggregate: {
				duration_ns,
				parses: payload.files.length * iterations,
				bytes: totalBytes * iterations,
			},
			retained_count: Array.isArray(retained) ? retained.length : retained ? 1 : 0,
		})}\n`,
	);
};

await main();
