import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	resolve: {
		alias: {
			"@crenet/orthorig": path.resolve(
				import.meta.dirname,
				"../../packages/runtime/src/index.ts",
			),
		},
	},
	server: {
		port: 5173,
		open: false,
	},
	build: {
		target: "es2022",
		outDir: "dist",
	},
});
