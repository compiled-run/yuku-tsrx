import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

test("M7 retains the prescribed source-only public attribution campaign", () => {
	for (const path of [
		"benchmarks/m7-public-attribution.ts",
		"benchmarks/m7-public-attribution-child.ts",
		"benchmarks/m7-public-attribution.json",
	])
		expect(existsSync(path), `missing ${path}`).toBe(true);

	const parent = readFileSync("benchmarks/m7-public-attribution.ts", "utf8");
	const child = readFileSync("benchmarks/m7-public-attribution-child.ts", "utf8");
	expect(parent).toContain('"/usr/bin/time"');
	expect(parent).toContain('"-l"');
	expect(parent).toContain("10000");
	expect(parent).toContain("primaryTenPercent");
	expect(parent).toContain("public-retain-public-discard");
	expect(parent).not.toContain("process.memoryUsage");
	expect(child).toContain('"yuku-tsrx-m7-source-payload-v1"');
	expect(child).toContain("payload digest mismatch");
	expect(child).not.toMatch(/\.wire\b|wire\?:|Buffer\.from\([^)]*,\s*["']base64["']/);
	expect(child).not.toContain("global.gc");

	const baselineText = readFileSync("benchmarks/m6-baseline.json", "utf8");
	const attributionText = readFileSync("benchmarks/m6-attribution.json", "utf8");
	expect(sha256(baselineText)).toBe(
		"5c98532712a5d1dd515a1ef29ef2d37d1f475570b2bf8993ad8a1c853598de24",
	);
	expect(sha256(attributionText)).toBe(
		"4254d79487ff50459cbb53d818b8a88c1d53e5ecf6a62d6310ae87a9c84ec4f5",
	);

	const resultText = readFileSync("benchmarks/m7-public-attribution.json", "utf8");
	expect(resultText).toBe(`${JSON.stringify(JSON.parse(resultText), null, 2)}\n`);
	const result = JSON.parse(resultText);
	expect(result).toMatchObject({
		schema: "yuku-tsrx-m7-public-attribution-v1",
		input: {
			file_count: 224,
			bytes: 214751,
			paths_sha256: "b42716fbfa16ffc7a900aa9386b3411a3f07d2ebbff4b49527e423a49b646cbb",
			corpus_sha256: "79e79d5c599e40993de029f294a7e8446598d66c7e069d4a489174adc1ab38c5",
		},
		protocol: { warmups: 5, samples: 20, iterations: 25, seed: "6d362d7631" },
		valid: true,
	});
	expect(result.positions).toHaveLength(25);
	expect(result.positions.slice(0, 5).map((item: any) => item.sample_index)).toEqual([
		-5, -4, -3, -2, -1,
	]);
	for (const id of ["public-discard", "public-retain", "core"]) {
		expect(result.raw_samples[id]).toHaveLength(20);
		expect(result.noise[id].valid).toBe(true);
	}
	expect(result.environmental_drift.yuku).toBeLessThanOrEqual(0.1);
	expect(result.environmental_drift.core).toBeLessThanOrEqual(0.1);
	expect(result.attribution).toMatchObject({
		actionability_threshold_bytes: expect.any(Number),
		public_retain_minus_discard_peak_rss: { resamples: 10000 },
		valid_m6_strata: [
			"harness",
			"import",
			"encoding",
			"tree",
			"wire",
			"frozen-wire-load",
			"decode",
		],
	});
	expect(Math.abs(result.attribution.primary_ten_percent_bytes - 26474086.4)).toBeLessThan(0.00001);
	expect(result.feasibility_verdict.production_authorized).toBe(false);
	expect(JSON.stringify(result.raw_samples)).not.toMatch(/base64|\"wire\"\s*:/);
});
