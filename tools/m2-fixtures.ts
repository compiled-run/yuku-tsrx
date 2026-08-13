import assert from "node:assert/strict";
import type { NonSharedBuffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type Diagnostic = {
	severity: string;
	message: string;
	start: number;
	end: number;
	help: string | null;
	labels: unknown[];
};

export type Parsed = {
	program: unknown;
	comments: unknown[];
	diagnostics: Diagnostic[];
};

export const intentionalDifference = Object.freeze({
	kind: "intentional-difference",
	fixture: "ts/dynamic-tag-outside-tsrx.tsx",
	diagnosticIndex: 0,
	path: "diagnostics[0].help",
	priorArtText: "Dynamic JSX tag names are only enabled in TSRX files",
	seamText: "JSX element names must start with a valid identifier",
	upstreamBase: "eb2adcb4c17da16e7ade1a0517192d81d469e67f",
	justification: "Dialect-free Yuku must not contain TSRX-specific policy.",
} as const);

export const lazyDestructuringDifference = Object.freeze({
	kind: "intentional-difference",
	fixture: "ts/lazy-destructuring-outside-tsrx.ts",
	diagnosticIndex: 0,
	differences: Object.freeze([
		Object.freeze({
			path: "diagnostics[0].message",
			priorArtText: "Lazy destructuring patterns are only enabled in TSRX files",
			seamText: "Unexpected token '&' in binding pattern",
		}),
		Object.freeze({
			path: "diagnostics[0].help",
			priorArtText: "Use a .tsrx file or remove the '&' lazy-pattern marker.",
			seamText: "Expected an identifier, array pattern ([a, b]), or object pattern ({a, b}).",
		}),
	]),
	upstreamBase: "eb2adcb4c17da16e7ade1a0517192d81d469e67f",
	justification:
		"Dialect-free Yuku must use the ordinary binding-pattern diagnostic and contain no TSRX-specific policy.",
} as const);

export const submoduleImportDifference = Object.freeze({
	kind: "intentional-difference",
	fixture: "ts/submodule-import-outside-tsrx.ts",
	diagnosticIndex: 0,
	differences: Object.freeze([
		Object.freeze({
			path: "diagnostics[0].message",
			priorArtText: "Identifier module specifiers require TSRX",
			seamText: "Expected module specifier, but found 'server'",
		}),
		Object.freeze({
			path: "diagnostics[0].help",
			priorArtText: "Use a .tsrx file for submodule imports such as import { load } from server.",
			seamText: "Module specifiers must be string literals, e.g., './module.js' or 'package'",
		}),
	]),
	upstreamBase: "eb2adcb4c17da16e7ade1a0517192d81d469e67f",
	justification:
		"Dialect-free Yuku must require string-literal module specifiers and contain no TSRX-specific submodule policy.",
} as const);

type IntentionalDifference =
	| typeof intentionalDifference
	| typeof lazyDestructuringDifference
	| typeof submoduleImportDifference;

export const compareOutside = (
	fixture: string,
	actual: Parsed,
	expected: Parsed,
): IntentionalDifference | null => {
	if (fixture === intentionalDifference.fixture) {
		assert.deepEqual(actual.program, expected.program, `${fixture} program mismatch`);
		assert.deepEqual(actual.comments, expected.comments, `${fixture} comments mismatch`);
		assert.equal(actual.diagnostics.length, 1, `${fixture} current diagnostic count`);
		assert.equal(expected.diagnostics.length, 1, `${fixture} prior-art diagnostic count`);
		const actualDiagnostic = actual.diagnostics[intentionalDifference.diagnosticIndex];
		const expectedDiagnostic = expected.diagnostics[intentionalDifference.diagnosticIndex];
		assert.deepEqual(
			Object.keys(actualDiagnostic),
			Object.keys(expectedDiagnostic),
			`${fixture} diagnostic shape mismatch`,
		);
		assert.equal(actualDiagnostic.severity, expectedDiagnostic.severity);
		assert.equal(actualDiagnostic.message, expectedDiagnostic.message);
		assert.equal(actualDiagnostic.start, expectedDiagnostic.start);
		assert.equal(actualDiagnostic.end, expectedDiagnostic.end);
		assert.deepEqual(actualDiagnostic.labels, expectedDiagnostic.labels);
		assert.equal(expectedDiagnostic.help, intentionalDifference.priorArtText);
		assert.equal(actualDiagnostic.help, intentionalDifference.seamText);
		return intentionalDifference;
	}

	if (fixture === lazyDestructuringDifference.fixture) {
		assert.deepEqual(actual.program, expected.program, `${fixture} program mismatch`);
		assert.deepEqual(actual.comments, expected.comments, `${fixture} comments mismatch`);
		assert.equal(actual.diagnostics.length, 1, `${fixture} current diagnostic count`);
		assert.equal(expected.diagnostics.length, 1, `${fixture} prior-art diagnostic count`);
		const actualDiagnostic = actual.diagnostics[lazyDestructuringDifference.diagnosticIndex];
		const expectedDiagnostic = expected.diagnostics[lazyDestructuringDifference.diagnosticIndex];
		assert.deepEqual(
			Object.keys(actualDiagnostic),
			Object.keys(expectedDiagnostic),
			`${fixture} diagnostic shape mismatch`,
		);
		assert.equal(actualDiagnostic.severity, expectedDiagnostic.severity);
		assert.equal(actualDiagnostic.start, expectedDiagnostic.start);
		assert.equal(actualDiagnostic.end, expectedDiagnostic.end);
		assert.deepEqual(actualDiagnostic.labels, expectedDiagnostic.labels);
		const message = lazyDestructuringDifference.differences[0];
		assert.equal(expectedDiagnostic.message, message.priorArtText);
		assert.equal(actualDiagnostic.message, message.seamText);
		const help = lazyDestructuringDifference.differences[1];
		assert.equal(expectedDiagnostic.help, help.priorArtText);
		assert.equal(actualDiagnostic.help, help.seamText);
		return lazyDestructuringDifference;
	}

	if (fixture === submoduleImportDifference.fixture) {
		assert.deepEqual(actual.program, expected.program, `${fixture} program mismatch`);
		assert.deepEqual(actual.comments, expected.comments, `${fixture} comments mismatch`);
		assert.equal(actual.diagnostics.length, 1, `${fixture} current diagnostic count`);
		assert.equal(expected.diagnostics.length, 1, `${fixture} prior-art diagnostic count`);
		const actualDiagnostic = actual.diagnostics[submoduleImportDifference.diagnosticIndex];
		const expectedDiagnostic = expected.diagnostics[submoduleImportDifference.diagnosticIndex];
		assert.deepEqual(
			Object.keys(actualDiagnostic),
			Object.keys(expectedDiagnostic),
			`${fixture} diagnostic shape mismatch`,
		);
		assert.equal(actualDiagnostic.severity, expectedDiagnostic.severity);
		assert.equal(actualDiagnostic.start, expectedDiagnostic.start);
		assert.equal(actualDiagnostic.end, expectedDiagnostic.end);
		assert.deepEqual(actualDiagnostic.labels, expectedDiagnostic.labels);
		const message = submoduleImportDifference.differences[0];
		assert.equal(expectedDiagnostic.message, message.priorArtText);
		assert.equal(actualDiagnostic.message, message.seamText);
		const help = submoduleImportDifference.differences[1];
		assert.equal(expectedDiagnostic.help, help.priorArtText);
		assert.equal(actualDiagnostic.help, help.seamText);
		return submoduleImportDifference;
	}

	assert.deepEqual(actual, expected, `outside-TSRX mismatch for ${fixture}`);
	return null;
};

type OracleParser = {
	langFromPath(path: string): string;
	parse(source: string, options: { lang: string; sourceType: "module" | "script" }): Parsed;
};

const parseArgs = (): { oracle: string; ref: string; fixtures: string } => {
	const values = new Map<string, string>();
	for (let index = 2; index < process.argv.length; index += 2) {
		const flag = process.argv[index];
		const value = process.argv[index + 1];
		if (!flag?.startsWith("--") || value === undefined) throw new Error("invalid arguments");
		if (values.has(flag)) throw new Error(`duplicate option ${flag}`);
		values.set(flag, value);
	}
	const oracle = values.get("--oracle");
	const ref = values.get("--ref");
	const fixtures = values.get("--fixtures");
	if (!oracle || !ref || !fixtures || values.size !== 3) {
		throw new Error("expected --oracle, --ref, and --fixtures");
	}
	return { oracle: resolve(oracle), ref, fixtures: resolve(fixtures) };
};

const readU32 = (bytes: Buffer, cursor: { value: number }): number => {
	const value = bytes.readUInt32LE(cursor.value);
	cursor.value += 4;
	return value;
};

const readBytes = (
	bytes: NonSharedBuffer,
	cursor: { value: number },
	length: number,
): NonSharedBuffer => {
	const value = bytes.subarray(cursor.value, cursor.value + length);
	cursor.value += length;
	return value;
};

const main = async (): Promise<void> => {
	const args = parseArgs();
	const head = execFileSync("git", ["-C", args.oracle, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	assert.equal(head, args.ref);

	const oracle = (await import(
		pathToFileURL(join(args.oracle, "npm/yuku-parser/index.js")).href
	)) as OracleParser;
	const { decode } = (await import(pathToFileURL(resolve("zig-out/dialect-decode.js")).href)) as {
		decode(buffer: ArrayBuffer, source: string): Parsed;
	};
	const { decode: decodePlain } = (await import(
		pathToFileURL(resolve("zig-out/dialect-free-fixture-decode.js")).href
	)) as { decode(buffer: ArrayBuffer, source: string): Parsed };
	const current = new Map<string, Parsed>();
	for (const executable of ["yuku-tsrx-m2-fixtures-dialect", "yuku-tsrx-m2-fixtures-plain"]) {
		const decodeFixture = executable.endsWith("-plain") ? decodePlain : decode;
		const output = execFileSync(resolve("zig-out/bin", executable));
		const cursor = { value: 0 };
		for (let index = 0, count = readU32(output, cursor); index < count; index++) {
			const path = readBytes(output, cursor, readU32(output, cursor)).toString("utf8");
			const source = readBytes(output, cursor, readU32(output, cursor)).toString("utf8");
			const wire = readBytes(output, cursor, readU32(output, cursor));
			const padded = Buffer.alloc((wire.byteLength + 3) & ~3);
			wire.copy(padded);
			const buffer = padded.buffer.slice(padded.byteOffset, padded.byteOffset + padded.byteLength);
			try {
				current.set(path, decodeFixture(buffer, source));
			} catch (error) {
				throw new Error(`failed to decode ${path}`, { cause: error });
			}
		}
		assert.equal(cursor.value, output.length);
	}

	const tsrxRoot = join(args.fixtures, "tsrx");
	const tsRoot = join(args.fixtures, "ts");
	const tsrxFiles = (await readdir(tsrxRoot)).filter((name) => name.endsWith(".tsrx")).sort();
	const valid = tsrxFiles.filter((name) => !name.includes("-invalid."));
	const invalid = tsrxFiles.filter((name) => name.includes("-invalid."));
	assert.equal(valid.length, 12);
	assert.equal(invalid.length, 3);
	let intentionalDifferenceCount = 0;

	for (const name of valid) {
		const source = await readFile(join(tsrxRoot, name), "utf8");
		const snapshotName = name.replace(".module.tsrx", ".snapshot.json");
		const expected = JSON.parse(await readFile(join(tsrxRoot, "snapshots", snapshotName), "utf8"));
		const reference = oracle.parse(source, {
			lang: oracle.langFromPath(name),
			sourceType: "module",
		});
		assert.deepEqual(reference, expected, `immutable oracle drift for ${name}`);
		assert.deepEqual(current.get(`tsrx/${name}`), expected, `production tree mismatch for ${name}`);
	}

	for (const name of invalid) {
		const source = await readFile(join(tsrxRoot, name), "utf8");
		const reference = oracle.parse(source, {
			lang: oracle.langFromPath(name),
			sourceType: "module",
		});
		assert(reference.diagnostics.length > 0, `oracle unexpectedly accepted ${name}`);
		assert.deepEqual(
			current.get(`tsrx/${name}`)?.diagnostics,
			reference.diagnostics,
			`production diagnostics mismatch for ${name}`,
		);
	}

	for (const name of [
		"dynamic-tag-outside-tsrx.tsx",
		"lazy-destructuring-outside-tsrx.ts",
		"submodule-import-outside-tsrx.ts",
	]) {
		const source = await readFile(join(tsRoot, name), "utf8");
		const snapshotName = name.replace(/\.(tsx|ts)$/, ".snapshot.json");
		const expected = JSON.parse(await readFile(join(tsRoot, "snapshots", snapshotName), "utf8"));
		const reference = oracle.parse(source, {
			lang: oracle.langFromPath(name),
			sourceType: "script",
		});
		assert.deepEqual(reference, expected, `outside-TSRX oracle drift for ${name}`);
		const actual = current.get(`ts/${name}`);
		assert(actual, `missing outside-TSRX result for ${name}`);
		const difference = compareOutside(`ts/${name}`, actual, expected);
		if (difference) {
			intentionalDifferenceCount += 1;
			console.log(JSON.stringify(difference));
		}
	}
	assert.equal(intentionalDifferenceCount, 3);
	console.log(JSON.stringify({ kind: "intentional-difference-summary", count: 3 }));
	console.log("M2 exact fixture oracle passed: 12 valid, 3 invalid, 3 dialect-off");
};

if (pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
