import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { analyze, parse } from "yuku-tsrx";

// `decode.js` and `decode-analyzer.js` are emitted by two generators --
// `tools/gen_parser_decoder.zig` and `tools/gen_analyzer_decoder.zig` -- that
// are near-identical copies of one another differing only in the mode they pass
// to `generate`. Nothing in the build makes them agree, and they silently drifted
// once already: 0.1.0 shipped an analyzer decoder whose ArrayPattern and
// ObjectPattern cases read the element/property count out of `f0` when the
// encoder writes it to `f0b`, so every destructuring pattern decoded with an
// empty `elements`/`properties` list. These tests exist so the next drift fails
// here rather than in a consumer's AST.
//
// If one of these fails after a deliberate change to a generator, apply the same
// change to the other and re-run `pnpm gen:npm`.

const REGENERATE = "apply the same change to both tools/gen_*_decoder.zig, then run `pnpm gen:npm`";

const readDecoder = (name: string): string[] =>
	readFileSync(`npm/yuku-tsrx/${name}`, "utf8").split("\n");

/**
 * The per-node `case N: { ... }` blocks of a generated decoder, keyed by tag.
 * These are emitted from shared generator code, so a tag present in both
 * decoders must decode to the same JavaScript in both.
 */
const decodeCases = (lines: string[]): Map<string, string> => {
	const starts: number[] = [];
	for (const [index, line] of lines.entries()) {
		if (/^ {4}case \d+: \{/.test(line)) starts.push(index);
	}
	const blocks = new Map<string, string>();
	for (const [position, start] of starts.entries()) {
		const end = position + 1 < starts.length ? starts[position + 1] : start + 1;
		const tag = lines[start].match(/^ {4}case (\d+)/)?.[1];
		if (tag !== undefined) blocks.set(tag, lines.slice(start, end).join("\n").trimEnd());
	}
	return blocks;
};

test("the parser and analyzer decoders emit identical node cases", () => {
	const parserCases = decodeCases(readDecoder("decode.js"));
	const analyzerCases = decodeCases(readDecoder("decode-analyzer.js"));

	expect(parserCases.size).toBeGreaterThan(100);
	expect([...analyzerCases.keys()].sort()).toEqual([...parserCases.keys()].sort());

	const drifted = [...parserCases]
		.filter(([tag, body]) => analyzerCases.get(tag) !== body)
		.map(([tag]) => tag);
	expect(drifted, `decode.js and decode-analyzer.js drifted on node tags -- ${REGENERATE}`).toEqual(
		[],
	);
});

test("the parser and analyzer decoders resolve source positions the same way", () => {
	// `_firstNa` is the first non-ASCII offset, and the `_srcLen === 0` fallback
	// is what keeps the position map from being consulted when the wire carries
	// no source pool. The analyzer decoder shipped 0.1.0 without the fallback.
	// No input reachable through `analyze()` exposes the difference today, so
	// only a textual check can hold the two decoders together here.
	const firstNaLine = (name: string): string => {
		const line = readDecoder(name).find((candidate) => candidate.includes("const _firstNa ="));
		if (line === undefined) throw new Error(`no _firstNa binding in ${name}`);
		return line.trim();
	};

	expect(firstNaLine("decode-analyzer.js"), REGENERATE).toBe(firstNaLine("decode.js"));
	expect(firstNaLine("decode.js")).toContain("_srcLen === 0 ? _src.length");
});

test("analyze() and parse() decode destructuring patterns identically", () => {
	// The behavioural half of the same guard: whatever the generated text says,
	// both decoders have to produce the same tree. Destructuring is called out
	// because that is where they drifted, but the comparison is whole-program.
	const sources = [
		"const [a, b] = xs;\n",
		"const [first, , third, ...rest] = xs;\n",
		"const { p, q: r } = o;\n",
		"const { p, q: { deep }, ...rest } = o;\n",
		"const [{ a }, [b]] = pairs;\n",
		"function f([a, b], { c }) { return a + b + c; }\n",
		"for (const [key, value] of entries) log(key, value);\n",
		"export const [only] = xs;\n",
	];

	for (const lang of ["js", "ts"] as const) {
		for (const source of sources) {
			const parsed = parse(source, { lang, sourceType: "module" });
			const analyzed = analyze(source, { lang, sourceType: "module" });
			expect(analyzed.program, `${lang}: ${source.trim()}`).toEqual(parsed.program);
		}
	}
});

test("the analyzer decoder keeps every binding of a destructuring pattern", () => {
	// The concrete 0.1.0 defect, asserted directly: with the element count read
	// from the wrong half of the packed word these lists came back empty.
	const { program } = analyze("const [a, b] = xs;\nconst { p, q } = o;\n", {
		lang: "ts",
		sourceType: "module",
	});
	const body = program.body as unknown as Array<{
		declarations: Array<{ id: Record<string, unknown> }>;
	}>;

	expect(body[0].declarations[0].id).toMatchObject({
		type: "ArrayPattern",
		elements: [
			{ type: "Identifier", name: "a" },
			{ type: "Identifier", name: "b" },
		],
	});
	expect(body[1].declarations[0].id).toMatchObject({
		type: "ObjectPattern",
		properties: [{ type: "Property" }, { type: "Property" }],
	});
});
