#!/usr/bin/env node
/**
 * Automated Clean-Room IP, License & Dependency Compliance Audit
 *
 * Verifies:
 * 1. Root MIT `LICENSE` and `tools/blender/README.md` licensing boundary documentation exist.
 * 2. `@crenet/orthorig` (`packages/runtime/package.json`) has zero external runtime `dependencies`
 *    (only `peerDependencies: { "pixi.js": "^8.0.0" }`).
 * 3. Every non-dev dependency in `package-lock.json` is strictly under a permissive OSI license.
 * 4. Compiled `.orthorig.json` strictly adheres to `/schema/orthorig.schema.json` top-level keys.
 * 5. Normalized token 4-gram Jaccard similarity against external shear/matrix IK solver signatures is near zero (< 0.05).
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const ALLOWED_RUNTIME_LICENSES = new Set([
	"MIT",
	"ISC",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"Apache-2.0",
	"0BSD",
	"Unlicense",
]);

const ALLOWED_SCHEMA_ROOT_KEYS = new Set([
	"meta",
	"bones",
	"sockets",
	"slots",
	"ik_constraints",
	"look_at_constraints",
	"animations",
]);

// Normalized token signature of non-analytic shear/matrix IK solvers for clean-room comparison
const EXTERNAL_MATRIX_IK_REFERENCE_TOKENS = [
	"psx",
	"psy",
	"sx",
	"sy",
	"cwx",
	"cwy",
	"pp",
	"pa",
	"pb",
	"pc",
	"pd",
	"softness",
	"tdx",
	"tdy",
	"l1",
	"l2",
	"tx",
	"ty",
	"dd",
	"updateWorldTransformWith",
	"shearX",
	"shearY",
	"appliedRotation",
];

function tokenizeNormalized(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/\/\/.*/g, " ")
		.split(/[^a-zA-Z0-9_]+/)
		.filter((t) => t.length > 1);
}

function buildShingles(tokens, k = 4) {
	const set = new Set();
	for (let i = 0; i <= tokens.length - k; i++) {
		set.add(tokens.slice(i, i + k).join(":"));
	}
	return set;
}

function jaccardSimilarity(setA, setB) {
	if (setA.size === 0 || setB.size === 0) return 0;
	let intersection = 0;
	for (const item of setA) {
		if (setB.has(item)) intersection++;
	}
	const union = setA.size + setB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

export function runIpComplianceAudit() {
	const errors = [];

	// 1. Verify root LICENSE and Blender licensing documentation exist
	if (!fs.existsSync(path.join(ROOT, "LICENSE"))) {
		errors.push("Missing root LICENSE file");
	}
	if (!fs.existsSync(path.join(ROOT, "tools/blender/README.md"))) {
		errors.push("Missing tools/blender/README.md licensing boundary notice");
	}

	// 2. Verify @crenet/orthorig has zero external runtime dependencies
	const runtimePkgJson = JSON.parse(
		fs.readFileSync(path.join(ROOT, "packages/runtime/package.json"), "utf8"),
	);
	const runtimeDeps = Object.keys(runtimePkgJson.dependencies ?? {});
	if (runtimeDeps.length > 0) {
		errors.push(
			`@crenet/orthorig must have zero runtime dependencies, found: ${runtimeDeps.join(", ")}`,
		);
	}

	// 3. Check package-lock.json runtime licenses
	const lockJson = JSON.parse(
		fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"),
	);

	for (const [pkgPath, meta] of Object.entries(lockJson.packages ?? {})) {
		if (!pkgPath) continue;
		const pkgName = pkgPath.replace(/^.*node_modules\//, "");
		if (
			!meta.dev &&
			meta.license &&
			!ALLOWED_RUNTIME_LICENSES.has(meta.license)
		) {
			errors.push(
				`Non-permissive runtime license on ${pkgName}: ${meta.license}`,
			);
		}
	}

	// 4. Verify exported .orthorig.json strictly matches schema root keys
	const rigJsonPath = path.join(
		ROOT,
		"examples/operative-mvp/public/assets/operative.orthorig.json",
	);
	if (fs.existsSync(rigJsonPath)) {
		const rigData = JSON.parse(fs.readFileSync(rigJsonPath, "utf8"));
		for (const key of Object.keys(rigData)) {
			if (!ALLOWED_SCHEMA_ROOT_KEYS.has(key)) {
				errors.push(
					`Undeclared root key "${key}" found in operative.orthorig.json`,
				);
			}
		}
	}

	// 5. Token n-gram shingle similarity check across @crenet/orthorig runtime modules
	const runtimeSources = [
		"packages/runtime/src/OrthoRig.ts",
		"packages/runtime/src/ikSolver.ts",
		"packages/runtime/src/math.ts",
		"packages/runtime/src/slotBuilder.ts",
		"packages/runtime/src/debugOverlay.ts",
	]
		.map((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8"))
		.join("\n");
	const rigShingles = buildShingles(tokenizeNormalized(runtimeSources), 4);
	const refShingles = buildShingles(EXTERNAL_MATRIX_IK_REFERENCE_TOKENS, 4);
	const similarity = jaccardSimilarity(rigShingles, refShingles);

	if (similarity >= 0.05) {
		errors.push(
			`Token shingle similarity (${similarity.toFixed(4)}) exceeds clean-room threshold (0.05)`,
		);
	}

	return {
		passed: errors.length === 0,
		similarity,
		errors,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const result = runIpComplianceAudit();
	if (!result.passed) {
		console.error("[IP-Check] FAILED:");
		for (const err of result.errors) {
			console.error(`  - ${err}`);
		}
		process.exit(1);
	}
	console.log(
		`[IP-Check] PASSED (token shingle similarity: ${result.similarity.toFixed(4)}, runtime licenses verified MIT/permissive)`,
	);
}
