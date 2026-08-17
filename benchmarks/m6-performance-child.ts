import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type FileInput = Readonly<{ path: string; source: string; wire?: string }>;
type Payload = Readonly<{
	schema: "yuku-tsrx-m6-payload-v1";
	files: FileInput[];
	package_entry?: string;
	core_entry?: string;
	performance_addon?: string;
	markless_entry?: string;
}>;

const fail = (message: string): never => {
	throw new Error(message);
};
const argument = (name: string): string => {
	const index = process.argv.indexOf(name);
	const value = process.argv[index + 1];
	if (index < 0 || !value || value.startsWith("--")) fail(`${name} requires a value`);
	return value;
};
const positiveInteger = (name: string): number => {
	const value = Number(argument(name));
	if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} must be positive`);
	return value;
};
const timed = (run: () => void): number => {
	const start = process.hrtime.bigint();
	run();
	const value = Number(process.hrtime.bigint() - start);
	if (!Number.isSafeInteger(value) || value <= 0) fail("invalid duration");
	return value;
};
const options = Object.freeze({ collect: false, loose: false });
const encoder = new TextEncoder();
let retained: unknown;

const main = async (): Promise<void> => {
	const scenario = argument("--scenario");
	const sampleIndex = Number(argument("--sample-index"));
	const iterations = positiveInteger("--iterations");
	if (!Number.isSafeInteger(sampleIndex)) fail("invalid sample index");
	const bytes = readFileSync(0);
	if (createHash("sha256").update(bytes).digest("hex") !== argument("--payload-sha256"))
		fail("payload digest mismatch");
	const payload = JSON.parse(bytes.toString("utf8")) as Payload;
	if (payload.schema !== "yuku-tsrx-m6-payload-v1" || payload.files.length !== 224)
		fail("invalid payload");
	const totalBytes = payload.files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0);
	if (totalBytes !== 214751) fail("corpus byte count differs");

	let duration_ns = 0;
	let parses = payload.files.length * iterations;
	if (scenario === "harness") {
		let checksum = 0;
		for (const file of payload.files) checksum += file.source.length;
		duration_ns = timed(() => {
			for (let iteration = 0; iteration < iterations * 100; iteration++)
				for (const file of payload.files) checksum ^= file.source.charCodeAt(0);
		});
		retained = [payload.files, checksum];
		parses *= 100;
	} else if (scenario === "import") {
		const entry = payload.package_entry ?? fail("missing package entry");
		duration_ns = timed(() => {
			for (let iteration = 0; iteration < iterations * 1000; iteration++)
				createHash("sha256").update(entry).digest();
		});
		retained = await import(pathToFileURL(entry).href);
		parses = iterations * 1000;
	} else if (scenario === "encoding") {
		for (const file of payload.files) encoder.encode(file.source);
		duration_ns = timed(() => {
			for (let iteration = 0; iteration < iterations; iteration++)
				retained = payload.files.map((file) => encoder.encode(file.source));
		});
	} else if (scenario === "tree") {
		const packageEntry = payload.package_entry ?? fail("missing package entry");
		await import(pathToFileURL(packageEntry).href);
		const require = createRequire(import.meta.url);
		const probe = require(payload.performance_addon ?? fail("missing performance addon"));
		for (const file of payload.files) probe.parseTree(encoder.encode(file.source), {});
		duration_ns = timed(() => {
			for (let iteration = 0; iteration < iterations; iteration++)
				for (const file of payload.files) probe.parseTree(encoder.encode(file.source), {});
		});
		retained = payload.files;
	} else if (scenario === "wire") {
		const module = await import(
			pathToFileURL(payload.package_entry ?? fail("missing package entry")).href
		);
		for (const file of payload.files) module.parseWire(file.source, {});
		duration_ns = timed(() => {
			for (let iteration = 0; iteration < iterations; iteration++)
				retained = payload.files.map((file) => module.parseWire(file.source, {}));
		});
	} else if (scenario === "frozen-wire-load" || scenario === "decode") {
		const module = await import(
			pathToFileURL(payload.package_entry ?? fail("missing package entry")).href
		);
		const wires = payload.files.map((file) => {
			const wire = Buffer.from(file.wire ?? fail("missing frozen wire"), "base64");
			return wire.buffer.slice(wire.byteOffset, wire.byteOffset + wire.byteLength);
		});
		if (scenario === "frozen-wire-load") {
			duration_ns = timed(() => {
				for (let iteration = 0; iteration < iterations * 100; iteration++) retained = wires.slice();
			});
			parses *= 100;
		} else {
			for (let index = 0; index < wires.length; index++)
				module.decode(wires[index], payload.files[index].source).program;
			duration_ns = timed(() => {
				for (let iteration = 0; iteration < iterations; iteration++)
					retained = wires.map((wire, index) => {
						const result = module.decode(wire, payload.files[index].source);
						const program = result.program;
						result.comments;
						result.diagnostics;
						return program;
					});
			});
		}
	} else if (scenario === "public-discard" || scenario === "public-retain") {
		const module = await import(
			pathToFileURL(payload.package_entry ?? fail("missing package entry")).href
		);
		for (const file of payload.files) module.parseModule(file.source, file.path, options);
		duration_ns = timed(() => {
			for (let iteration = 0; iteration < iterations; iteration++) {
				const latest = new Array(payload.files.length);
				for (let index = 0; index < payload.files.length; index++) {
					const file = payload.files[index];
					const program = module.parseModule(file.source, file.path, options);
					if (scenario === "public-retain" && iteration === iterations - 1) latest[index] = program;
				}
				if (scenario === "public-retain") retained = latest;
			}
		});
	} else if (scenario === "core") {
		const module = await import(
			pathToFileURL(payload.core_entry ?? fail("missing core entry")).href
		);
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
	} else if (scenario === "markless") {
		const module = await import(
			pathToFileURL(payload.markless_entry ?? fail("missing Markless entry")).href
		);
		for (const file of payload.files) module.parseModule(file.source, file.path, { collect: true });
		duration_ns = timed(() => {
			for (let iteration = 0; iteration < iterations; iteration++)
				retained = payload.files.map((file) =>
					module.parseModule(file.source, file.path, { collect: true }),
				);
		});
	} else fail(`unknown scenario ${scenario}`);

	process.stdout.write(
		`${JSON.stringify({
			schema: "yuku-tsrx-m6-child-v1",
			scenario,
			sample_index: sampleIndex,
			aggregate: { duration_ns, parses, bytes: totalBytes * iterations },
			retained_count: Array.isArray(retained) ? retained.length : retained ? 1 : 0,
		})}\n`,
	);
};

await main();
