import { defineConfig, type ViteUserConfig } from "vitest/config";
import type { OxfmtConfig } from "vite-plus/fmt";
import type { OxlintConfig } from "vite-plus/lint";

type VitePlusUserConfig = ViteUserConfig & {
	fmt?: OxfmtConfig;
	lint?: OxlintConfig;
};

const config = {
	fmt: {
		ignorePatterns: [
			"benchmarks/m5-baseline.json",
			"benchmarks/m5-corpus.json",
			"benchmarks/m5-pairs.json",
			"README.md",
			"docs/**",
			"goal.md",
			"test/parser/misc/**",
			"npm/yuku-tsrx/decode.js",
			"npm/yuku-tsrx/decode-analyzer.js",
			"npm/yuku-tsrx/encode.js",
		],
	},
	lint: {
		ignorePatterns: [
			"test/parser/misc/**",
			"npm/yuku-tsrx/decode.js",
			"npm/yuku-tsrx/decode-analyzer.js",
			"npm/yuku-tsrx/encode.js",
		],
	},
	test: {
		include: ["test/**/*.test.ts"],
	},
} satisfies VitePlusUserConfig;

export default defineConfig(config);
