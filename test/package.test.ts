import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("generated npm host composes the compatibility wrapper with package-relative binding", async () => {
	const packageRoot = resolve("zig-out/npm/yuku-tsrx");
	const entry = pathToFileURL(resolve(packageRoot, "index.js"));
	entry.searchParams.set("self-contained", String(Date.now()));
	const module = await import(entry.href);

	expect(module.parseModule("export const value = 1;", "value.tsrx").type).toBe("Program");
	expect(module.isEventAttribute("onClick")).toBe(true);

	const binding = readFileSync(resolve(packageRoot, "binding.js"), "utf8");
	expect(binding).not.toContain("YUKU_TSRX_BINDING");
	expect(binding).toContain("@yuku-tsrx");

	const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
	expect(Object.keys(manifest.optionalDependencies)).toHaveLength(12);
	expect(manifest.files).toEqual(
		expect.arrayContaining([
			"index.js",
			"index.d.ts",
			"binding.js",
			"decode.js",
			"decode-analyzer.js",
			"encode.js",
			"walk.js",
		]),
	);
});
