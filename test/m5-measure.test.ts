import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
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

test("M5 measurement retains the isolated canonical protocol", () => {
	for (const path of [
		"benchmarks/m5-measure.ts",
		"benchmarks/m5-measure-child.ts",
		"benchmarks/m5-baseline.json",
	])
		expect(existsSync(path), `missing ${path}`).toBe(true);

	const parent = readFileSync("benchmarks/m5-measure.ts", "utf8");
	const child = readFileSync("benchmarks/m5-measure-child.ts", "utf8");
	for (const forbidden of ["process.memoryUsage", "process.resourceUsage", "v8.getHeapStatistics"])
		expect(`${parent}\n${child}`).not.toContain(forbidden);
	expect(parent).toContain("spawnSync(");
	expect(parent).toContain('"/usr/bin/time"');
	expect(parent).toContain('"-l"');
	expect(parent).toContain("--check");
	expect(parent).toContain('"--scenario"');
	expect(parent).toContain('"--preserve-from-sha256"');
	expect(parent).toContain('scenario: "oracle4"');
	expect(parent).toContain("archived_oracle4");
	expect(parent).toContain("oracle4Noise");
	expect(parent).toContain('for (const variant of ["tsrx", "tsx"] as const)');
	expect(parent).not.toContain('for (const variant of ["yuku", "core"] as const)');
	expect(child).toContain("process.hrtime.bigint");
	expect(child).toContain("Object.freeze({ collect: false, loose: false })");
	expect(child).toContain("payload digest mismatch");
	expect(child).toContain("for (const pairIndex of payload.order)");
	expect(child).toContain("for (let index = 0; index < iterations; index++)");

	const baselineText = readFileSync("benchmarks/m5-baseline.json", "utf8");
	expect(baselineText).toBe(`${JSON.stringify(JSON.parse(baselineText), null, 2)}\n`);
	expect(baselineText).not.toMatch(/\/Users\//);
	const baseline = JSON.parse(baselineText);
	if (baseline.schema === "yuku-tsrx-m5-measurement-v1") {
		expect(sha256(baselineText)).toBe(
			"2fd489f2b45e713ae0763426885d7dac46cdb431536887f608a087f17f9bb925",
		);
		expect(sha256(stable(baseline.oracle4))).toBe(
			"eb523cbd890417b8bd7b343d96c4c037a79ec9184aaa1e64b3e53c3b3bdcd9a7",
		);
		expect(sha256(stable(baseline.oracle8))).toBe(
			"ed3e7c4d767e965b6277b3f552495d0101bd168a8fdada4505d3e531a0748a1e",
		);
		return;
	}
	if (baseline.schema === "yuku-tsrx-m5-measurement-v2") {
		expect(sha256(baselineText)).toBe(
			"db1babbb79f6727c080ee326680dcc65c13a1ef150bfbcdf75fcf3e49df03822",
		);
		expect(sha256(stable(baseline.archived_oracle4))).toBe(
			"eb523cbd890417b8bd7b343d96c4c037a79ec9184aaa1e64b3e53c3b3bdcd9a7",
		);
		expect(sha256(stable(baseline.oracle4))).toBe(
			"23b7dfc53a87c9af871972fded920b850c6b8e3184e0d985953d8f84cb8a1091",
		);
		expect(sha256(stable(baseline.oracle8))).toBe(
			"ed3e7c4d767e965b6277b3f552495d0101bd168a8fdada4505d3e531a0748a1e",
		);
		return;
	}
	expect(Object.keys(baseline)).toEqual([
		"schema",
		"provenance",
		"platform",
		"protocol",
		"archived_oracle4_v1",
		"archived_oracle4_v2",
		"oracle4",
		"oracle8",
	]);
	expect(baseline.schema).toBe("yuku-tsrx-m5-measurement-v3");
	expect(baseline.provenance).toMatchObject({
		scenario: "oracle4",
		preserved_from_sha256: "db1babbb79f6727c080ee326680dcc65c13a1ef150bfbcdf75fcf3e49df03822",
	});
	expect(baseline.protocol).toMatchObject({
		seed: "4d353339",
		warmups: 5,
		samples: 20,
		pair_iterations: 30000,
		corpus_iterations: 25,
		options: { collect: false, loose: false },
		conditioning: {
			iterations_per_pair: 30000,
			order: "same seeded order as timed sweep",
			timed: false,
		},
		time: { command: "/usr/bin/time", argument: "-l", peak_rss_multiplier: 1 },
	});
	expect(baseline.oracle4.input).toMatchObject({ pair_count: 6, tsrx_bytes: 640, tsx_bytes: 661 });
	expect(baseline.oracle8.input).toMatchObject({
		file_count: 224,
		paths_sha256: "b42716fbfa16ffc7a900aa9386b3411a3f07d2ebbff4b49527e423a49b646cbb",
		corpus_sha256: "79e79d5c599e40993de029f294a7e8446598d66c7e069d4a489174adc1ab38c5",
		bytes: 214751,
	});
	expect(sha256(stable(baseline.archived_oracle4_v1))).toBe(
		"eb523cbd890417b8bd7b343d96c4c037a79ec9184aaa1e64b3e53c3b3bdcd9a7",
	);
	expect(sha256(stable(baseline.archived_oracle4_v2))).toBe(
		"23b7dfc53a87c9af871972fded920b850c6b8e3184e0d985953d8f84cb8a1091",
	);
	expect(sha256(stable(baseline.oracle8))).toBe(
		"ed3e7c4d767e965b6277b3f552495d0101bd168a8fdada4505d3e531a0748a1e",
	);
	expect(baseline.oracle4.validity).toBe("invalid_noisy");
	expect(baseline.oracle4.claims).toEqual({});
	expect(baseline.oracle8.validity).toBe("valid");
	expect(baseline.oracle8.claims).toEqual(expect.any(Object));
	for (const oracle of [baseline.oracle4, baseline.oracle8]) {
		for (const samples of Object.values(oracle.raw_samples) as unknown[][])
			expect(samples).toHaveLength(20);
	}
	const gates = baseline.oracle4.noise.gates;
	expect(gates).toHaveLength(32);
	expect(gates.filter((gate: any) => gate.passed === true)).toHaveLength(28);
	expect(gates.filter((gate: any) => gate.passed === false)).toHaveLength(4);
	expect(gates.filter((gate: any) => gate.scope === "aggregate")).toHaveLength(8);
	expect(gates.filter((gate: any) => gate.scope === "feature")).toHaveLength(24);
	for (const samples of Object.values(baseline.oracle4.raw_samples) as any[][])
		for (const sample of samples)
			for (const feature of Object.values(sample.features) as any[])
				expect(feature).not.toHaveProperty("peak_rss_bytes");
	expect(baseline.provenance.pairs_sha256).toBe(
		sha256(readFileSync("benchmarks/m5-pairs.json", "utf8")),
	);
	expect(baseline.provenance.classification_sha256).toBe(
		sha256(readFileSync("benchmarks/m5-corpus.json", "utf8")),
	);
	expect(JSON.stringify(baseline)).not.toMatch(/"source"\s*:/);
});
