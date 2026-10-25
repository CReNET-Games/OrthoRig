import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@crenet/orthorig": path.resolve(
				import.meta.dirname,
				"./packages/runtime/src/index.ts",
			),
		},
	},
	test: {
		include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
	},
});
