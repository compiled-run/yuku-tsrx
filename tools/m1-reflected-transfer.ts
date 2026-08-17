import assert from "node:assert/strict";
import type { NonSharedBuffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gitChildEnvironment } from "./m1-git-environment.ts";

const expectedRef = "eb2adcb4c17da16e7ade1a0517192d81d469e67f";
const expectedSeamHead = "872758e8ea30ecd3e423ae266cf5c7cf586c8820";
const expectedControlHead = "bf03e146d97ae2f0c2d4c4ec90456e1e544d2760";
const expectedSeamBranch = "seam/dialect";
const nonTsPins = [
	{
		bytes: "5d6d46b2107807fb6a4c20cfad852c090315f0ec5fb3ad88098b17cfa0cd6a76",
		json: "9d9f72cd41acd073c9a9dbe0afaf19177f71ac09578b25e0ad2f4a6d8e689fe2",
	},
	{
		bytes: "e84000dbf2e8c2a2ebfe2bc87ebd78914c08d896fd55c6561a672c9533a41e98",
		json: "5ca7dda90689a2dc935d5467d164e525783742328685268312fa5e249fc10fb5",
	},
] as const;

const parseArgs = (): { controlYuku: string; seamYuku: string; compareRef: string } => {
	const names = new Set(["--control-yuku", "--seam-yuku", "--compare-ref"]);
	const values = new Map<string, string>();
	if (process.argv.length !== 8)
		throw new Error("expected exactly --control-yuku, --seam-yuku, and --compare-ref");
	for (let index = 2; index < process.argv.length; index += 2) {
		const name = process.argv[index];
		const value = process.argv[index + 1];
		if (!name || !names.has(name)) throw new Error(`unknown argument ${name ?? "<missing>"}`);
		if (!value || value.startsWith("--")) throw new Error(`missing value for ${name}`);
		if (values.has(name)) throw new Error(`duplicate argument ${name}`);
		values.set(name, value);
	}
	const compareRef = values.get("--compare-ref");
	if (compareRef !== expectedRef) throw new Error(`compare-ref must equal ${expectedRef}`);
	return {
		controlYuku: resolve(values.get("--control-yuku")!),
		seamYuku: resolve(values.get("--seam-yuku")!),
		compareRef,
	};
};

const args = parseArgs();
const gitText = (cwd: string, gitArgs: string[]): string =>
	execFileSync("git", ["-C", cwd, ...gitArgs], {
		encoding: "utf8",
		env: gitChildEnvironment(),
	}).trim();
const gitBytes = (cwd: string, gitArgs: string[]): Buffer =>
	execFileSync("git", ["-C", cwd, ...gitArgs], { env: gitChildEnvironment() });

assert.equal(
	gitText(args.controlYuku, ["rev-parse", "HEAD"]),
	expectedControlHead,
	"control checkout HEAD mismatch",
);
assert.equal(
	gitText(args.controlYuku, ["status", "--porcelain", "--untracked-files=all"]),
	"",
	"control checkout must be clean",
);
assert.equal(
	gitText(args.seamYuku, ["symbolic-ref", "--short", "HEAD"]),
	expectedSeamBranch,
	"seam checkout branch mismatch",
);
assert.equal(
	gitText(args.seamYuku, ["rev-parse", "HEAD"]),
	expectedSeamHead,
	"seam checkout HEAD mismatch",
);
gitBytes(args.controlYuku, ["cat-file", "-e", `${args.compareRef}^{commit}`]);
gitBytes(args.seamYuku, ["cat-file", "-e", `${args.compareRef}^{commit}`]);

execFileSync("zig", ["build", "gen-parser-decoder", "gen-codegen-encoder"], { cwd: args.seamYuku });
assert.deepEqual(
	await readFile(join(args.seamYuku, "zig-out/decode.js")),
	gitBytes(args.controlYuku, ["show", `${args.compareRef}:npm/yuku-parser/decode.js`]),
	"disabled generated decoder differs from exact control-ref blob",
);
assert.deepEqual(
	await readFile(join(args.seamYuku, "zig-out/encode.js")),
	gitBytes(args.controlYuku, ["show", `${args.compareRef}:npm/yuku-codegen/encode.js`]),
	"disabled generated encoder differs from exact control-ref blob",
);

const decoderPath = resolve("zig-out/dialect-decode.js");
const encoderPath = resolve("zig-out/dialect-encode.js");
const sourceText = await readFile(decoderPath, "utf8");
assert.match(sourceText, /DIALECT_RECORDS/);
assert.ok(
	(sourceText.match(/DIALECT_RECORDS/g) ?? []).length > 1,
	"generated dialect metadata is unused",
);

const bytes = execFileSync(resolve("zig-out/bin/yuku-tsrx-m1-reflected-transfer"));
const { decode } = (await import(pathToFileURL(decoderPath).href)) as {
	decode(buffer: ArrayBuffer, source: string): { program: unknown };
};
const { encode } = (await import(pathToFileURL(encoderPath).href)) as {
	encode(program: unknown): ArrayBuffer;
};
let cursor = 0;
const u32 = (): number => {
	const value = bytes.readUInt32LE(cursor);
	cursor += 4;
	return value;
};
const count = u32();
assert.equal(count, 4);
const programs: unknown[] = [];
const frames: Array<{ source: string; wire: NonSharedBuffer }> = [];
for (let i = 0; i < count; i++) {
	const sourceLength = u32();
	const source = bytes.subarray(cursor, cursor + sourceLength).toString("utf8");
	cursor += sourceLength;
	const wireLength = u32();
	const wire = bytes.subarray(cursor, cursor + wireLength);
	cursor += wireLength;
	const buffer = wire.buffer.slice(wire.byteOffset, wire.byteOffset + wire.byteLength);
	programs.push(decode(buffer, source).program);
	frames.push({ source, wire });
}
assert.equal(cursor, bytes.length);
assert.deepEqual(
	frames.map((frame) => frame.wire.readUInt32LE(32)),
	[17, 16, 1, 0],
);
const directJson = JSON.stringify(programs[0]);
assert.doesNotMatch(directJson, /DialectNode/, "direct dialect record was not reflected");
assert.match(directJson, /"type":"Node"/);
assert.match(directJson, /"active":true/);
const overlayJson = JSON.stringify(programs[1]);
assert.match(overlayJson, /"type":"ArrayPattern"/);
assert.match(overlayJson, /"lazy":true/);
assert.doesNotMatch(overlayJson, /hostNode/);

const asArrayBuffer = (wire: NonSharedBuffer): ArrayBuffer =>
	wire.buffer.slice(wire.byteOffset, wire.byteOffset + wire.byteLength);
const layout = (
	wire: NonSharedBuffer,
): {
	section: number;
	records: number;
	overlays: number;
	recordsOff: number;
	overlaysOff: number;
} => {
	const nodeCount = wire.readUInt32LE(0);
	const extraCount = wire.readUInt32LE(4);
	const poolLen = wire.readUInt32LE(8);
	const commentCount = wire.readUInt32LE(16);
	const attachedCount = wire.readUInt32LE(20);
	const flags = wire.readUInt32LE(32);
	let section = 40 + nodeCount * 44 + extraCount * 4 + ((poolLen + 3) & ~3);
	if (flags & 2) section += (nodeCount + 1) * 4;
	section += attachedCount * 12 + commentCount * 20;
	const records = wire.readUInt32LE(section);
	const overlays = wire.readUInt32LE(section + 4);
	const recordsOff = section + 8;
	return { section, records, overlays, recordsOff, overlaysOff: recordsOff + records * 44 };
};
const expectMalformed = (
	wire: NonSharedBuffer,
	source: string,
	mutate: (copy: NonSharedBuffer) => NonSharedBuffer = (value) => value,
): void => {
	const copy = mutate(Buffer.from(wire));
	assert.throws(() => decode(asArrayBuffer(copy), source), /yuku:|RangeError/);
};
const directLayout = layout(frames[0].wire);
const overlayLayout = layout(frames[1].wire);
expectMalformed(frames[0].wire, frames[0].source, (copy) => {
	copy[directLayout.recordsOff] = 0xff;
	return copy;
});
expectMalformed(frames[0].wire, frames[0].source, (copy) => {
	copy.writeUInt32LE(0, directLayout.section);
	return copy;
});
expectMalformed(frames[0].wire, frames[0].source, (copy) => {
	copy.writeUInt32LE(0xffff_ffff, directLayout.section);
	return copy;
});
const directNode = (() => {
	for (let index = 0; index < frames[0].wire.readUInt32LE(0); index++)
		if (frames[0].wire[40 + index * 44] === 171) return index;
	throw new Error("missing direct dialect fixture node");
})();
expectMalformed(frames[0].wire, frames[0].source, (copy) => {
	copy.writeUInt32LE(0xffff_ffff, 40 + directNode * 44 + 8);
	return copy;
});
expectMalformed(frames[0].wire, frames[0].source, (copy) => {
	copy.writeUInt32LE(0xffff_ffff, directLayout.recordsOff + 8);
	return copy;
});
expectMalformed(frames[0].wire, frames[0].source, (copy) => {
	copy.writeUInt32LE(directNode, directLayout.recordsOff + 8);
	return copy;
});
expectMalformed(frames[1].wire, frames[1].source, (copy) => {
	copy[overlayLayout.recordsOff] = 172;
	return copy;
});
expectMalformed(frames[1].wire, frames[1].source, (copy) => {
	const host = copy.readUInt32LE(overlayLayout.overlaysOff);
	copy.writeUInt32LE(host + 1, overlayLayout.recordsOff + 8);
	return copy;
});
expectMalformed(frames[1].wire, frames[1].source, (copy) => {
	const expanded = Buffer.alloc(copy.length + 8);
	copy.copy(expanded);
	expanded.writeUInt32LE(2, overlayLayout.section + 4);
	copy.copy(expanded, copy.length, overlayLayout.overlaysOff, overlayLayout.overlaysOff + 8);
	return expanded;
});

const encodedFrames = programs.map((program) => Buffer.from(encode(program)));
const sha256 = (value: Uint8Array | string): string =>
	createHash("sha256").update(value).digest("hex");
assert.equal(sha256(encodedFrames[1]!), nonTsPins[0].bytes, "non-TS dialect bytes changed");
assert.equal(sha256(JSON.stringify(programs[1])), nonTsPins[0].json, "non-TS dialect JSON changed");
assert.equal(sha256(encodedFrames[3]!), nonTsPins[1].bytes, "ordinary non-TS bytes changed");
assert.equal(
	sha256(JSON.stringify(programs[3])),
	nonTsPins[1].json,
	"ordinary non-TS JSON changed",
);
assert.deepEqual(
	encodedFrames.map((frame) => frame.readUInt32LE(32)),
	[17, 16, 1, 0],
);
for (const index of [0, 2]) {
	const program = programs[index] as object;
	const symbols = Object.getOwnPropertySymbols(program);
	assert.equal(symbols.length, 1);
	assert.deepEqual(Object.getOwnPropertyDescriptor(program, symbols[0]!), {
		value: true,
		writable: false,
		enumerable: false,
		configurable: false,
	});
	assert.doesNotMatch(Object.keys(program).join(","), /yuku\.estree\.transfer\.ts/);
	assert.doesNotMatch(JSON.stringify(program), /yuku\.estree\.transfer\.ts/);
}
for (const index of [1, 3])
	assert.equal(Object.getOwnPropertySymbols(programs[index] as object).length, 0);
for (const [index, program] of programs.entries()) {
	const first = encode(program);
	const second = encode(program);
	assert.deepEqual(
		new Uint8Array(first),
		new Uint8Array(second),
		"generated dialect wire is not deterministic",
	);
	const encoded = encodedFrames[index];
	assert(encoded);
	if (index < 2) {
		assert.equal(encoded.readUInt32LE(8 * 4) & 16, 16, "generated encoder omitted dialect records");
		const encodedLayout = layout(encoded);
		assert.equal(encodedLayout.records, 1);
		assert.equal(encodedLayout.overlays, index);
	}
	assert.deepEqual(
		decode(first, frames[index]!.source).program,
		program,
		"decode-encode-decode changed reflected AST",
	);
}

const missing = structuredClone(programs[0]) as Record<string, unknown>;
const removeActive = (value: unknown): boolean => {
	if (!value || typeof value !== "object") return false;
	const object = value as Record<string, unknown>;
	if (object.type === "Node") {
		delete object.active;
		return true;
	}
	for (const child of Object.values(object))
		if (Array.isArray(child) ? child.some(removeActive) : removeActive(child)) return true;
	return false;
};
assert(removeActive(missing));
assert.throws(() => encode(missing), /missing required dialect field active/);
const encoderText = await readFile(encoderPath, "utf8");
assert.match(encoderText, /ambiguous direct dialect schema/);
assert.match(encoderText, /ambiguous overlay dialect schema/);

console.log("M1 reflected transfer seam passed");
