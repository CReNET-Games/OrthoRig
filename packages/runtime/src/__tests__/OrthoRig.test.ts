import fs from "node:fs";
import path from "node:path";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- ESM compliance script
import { runIpComplianceAudit } from "../../../../tools/check_ip_compliance.mjs";
import {
	clamp,
	createSlotAttachment,
	evaluateCubicBezier,
	normalizeAngle,
	type OrthoAnimationEvent,
	type OrthoKeyframe,
	OrthoRig,
	type OrthoRigSchema,
	type OrthoSlotSpec,
	parseHexColor,
} from "../index";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const SCHEMA_FILE = path.join(ROOT, "schema/orthorig.schema.json");
const BLEND_FILE = path.join(
	ROOT,
	"examples/operative-mvp/assets/source/operative_demo.blend",
);
const COMPILED_JSON = path.join(
	ROOT,
	"examples/operative-mvp/public/assets/operative.orthorig.json",
);
const ATLAS_PNG = path.join(
	ROOT,
	"examples/operative-mvp/public/assets/operative.atlas.png",
);
const BLENDER_README = path.join(ROOT, "tools/blender/README.md");

const rigData = JSON.parse(
	fs.readFileSync(COMPILED_JSON, "utf8"),
) as OrthoRigSchema;

describe("1. Pipeline & Schema Contract (Data-Driven Asset Verification)", () => {
	it.each([
		{
			label: "Root MIT LICENSE",
			filePath: path.join(ROOT, "LICENSE"),
			expectedTokens: ["MIT License", "CReNET Games"],
		},
		{
			label: "Blender GPLv3/MIT boundary notice",
			filePath: BLENDER_README,
			expectedTokens: ["GPLv3", "MIT", "orthorig_spritesheet_baker.py"],
		},
		{
			label: "Draft 2020-12 JSON Schema",
			filePath: SCHEMA_FILE,
			expectedTokens: [
				"https://json-schema.org/draft/2020-12/schema",
				"sockets",
				"look_at_constraints",
				"atlasRegion",
			],
		},
	])(
		"verifies required file & tokens: $label",
		({ filePath, expectedTokens }) => {
			expect(fs.existsSync(filePath)).toBe(true);
			const content = fs.readFileSync(filePath, "utf8");
			for (const token of expectedTokens) {
				expect(content).toContain(token);
			}
		},
	);

	it.each([
		{
			label: "Blender source binary header",
			filePath: BLEND_FILE,
			magicBytes: Buffer.from("BLENDER", "ascii"),
		},
		{
			label: "Baked PNG spritesheet atlas header",
			filePath: ATLAS_PNG,
			magicBytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		},
	])(
		"verifies binary artifact signature: $label",
		({ filePath, magicBytes }) => {
			expect(fs.existsSync(filePath)).toBe(true);
			const actual = fs.readFileSync(filePath).subarray(0, magicBytes.length);
			expect(actual.equals(magicBytes)).toBe(true);
		},
	);

	it("validates compiled operative.orthorig.json structure, palette, sockets, constraints, and actions", () => {
		expect(rigData.meta).toMatchObject({
			coordinateSystem: "pixi-y-down",
			sourceFile: "operative_demo.blend",
			atlasTexture: "operative.atlas.png",
		});

		expect(rigData.bones.map((b) => b.name)).toEqual([
			"root",
			"torso",
			"head",
			"upper_arm_l",
			"forearm_l",
			"upper_arm_r",
			"forearm_r",
			"thigh_l",
			"shin_l",
			"thigh_r",
			"shin_r",
		]);

		const rootSpec = rigData.bones.find((b) => b.name === "root")!;
		expect({ x: rootSpec.restX, y: rootSpec.restY }).toEqual({ x: 0, y: -64 });

		const usedColors = new Set(
			rigData.slots.map((s) => s.colorHex.toUpperCase()),
		);
		for (const hex of ["#0A0B0E", "#F4F6F8", "#00F0FF", "#FF2A54"]) {
			expect(usedColors.has(hex)).toBe(true);
		}
		for (const slot of rigData.slots) {
			expect(slot.atlasRegion?.width).toBeGreaterThan(0);
			expect(slot.atlasRegion?.height).toBeGreaterThan(0);
		}

		expect(rigData.sockets?.map((s) => s.name)).toEqual([
			"head_top",
			"muzzle",
			"offhand_grip",
			"thruster",
		]);
		expect(Object.keys(rigData.animations).sort()).toEqual([
			"Idle",
			"Jump",
			"Recoil",
			"Run",
			"WallSlide",
		]);
	});
});

describe("2. Math & Keyframe Interpolation (Parametrized)", () => {
	it.each([
		{ hex: "#00F0FF", fallback: 0x000000, expected: 0x00f0ff },
		{ hex: "FF2A54", fallback: 0x000000, expected: 0xff2a54 },
		{ hex: "invalid-hex", fallback: 0x0a0b0e, expected: 0x0a0b0e },
	])("parseHexColor($hex) -> $expected", ({ hex, fallback, expected }) => {
		expect(parseHexColor(hex, fallback)).toBe(expected);
	});

	it.each([
		{ t: -0.2, bezier: [0.42, 0, 0.58, 1] as const, expected: 0 },
		{ t: 0, bezier: [0.42, 0, 0.58, 1] as const, expected: 0 },
		{ t: 0.35, bezier: [0.25, 0.25, 0.75, 0.75] as const, expected: 0.35 },
		{ t: 0.5, bezier: [0.42, 0, 0.58, 1] as const, expected: 0.5 },
		{ t: 1, bezier: [0.42, 0, 0.58, 1] as const, expected: 1 },
		{ t: 1.5, bezier: [0.42, 0, 0.58, 1] as const, expected: 1 },
	])(
		"evaluateCubicBezier(t=$t, $bezier) -> $expected",
		({ t, bezier, expected }) => {
			expect(clamp(t, 0, 1)).toBeGreaterThanOrEqual(0);
			expect(evaluateCubicBezier(t, ...bezier)).toBeCloseTo(expected, 3);
		},
	);

	const sampleTrack: OrthoKeyframe[] = [
		{
			time: 0.0,
			x: 0,
			y: -64,
			rotation: 0,
			easing: "cubic-bezier",
			bezier: [0.42, 0, 0.58, 1],
		},
		{ time: 1.0, x: 20, y: -54, rotation: 0.5, easing: "linear" },
		{ time: 2.0, x: 40, y: -44, rotation: 1.0 },
	];

	it.each([
		{
			label: "empty track returns zero transform",
			track: [] as OrthoKeyframe[],
			t: 0.5,
			expected: { x: 0, y: 0, rotation: 0 },
		},
		{
			label: "single-keyframe track returns constant pose",
			track: [sampleTrack[0]],
			t: 5.0,
			expected: { x: 0, y: -64, rotation: 0 },
		},
		{
			label: "clamps before first keyframe (t < 0)",
			track: sampleTrack,
			t: -1.0,
			expected: { x: 0, y: -64, rotation: 0 },
		},
		{
			label: "evaluates midpoint of cubic-bezier segment (t = 0.5)",
			track: sampleTrack,
			t: 0.5,
			expected: { x: 10, y: -59, rotation: 0.25 },
		},
		{
			label: "evaluates midpoint of linear segment (t = 1.5)",
			track: sampleTrack,
			t: 1.5,
			expected: { x: 30, y: -49, rotation: 0.75 },
		},
		{
			label: "clamps after last keyframe (t > 2.0)",
			track: sampleTrack,
			t: 3.0,
			expected: { x: 40, y: -44, rotation: 1.0 },
		},
	])("OrthoRig.interpolateTrack: $label", ({ track, t, expected }) => {
		const res = OrthoRig.interpolateTrack(track, t);
		expect(res.x).toBeCloseTo(expected.x, 3);
		expect(res.y).toBeCloseTo(expected.y, 3);
		expect(res.rotation).toBeCloseTo(expected.rotation, 3);
	});
});

describe("3. Scene Graph & Slot Rendering Modes (Parametrized)", () => {
	const testSlotBase: OrthoSlotSpec = {
		name: "slot_test",
		bone: "torso",
		shapeType: "rect",
		width: 16,
		height: 24,
		colorHex: "#00F0FF",
		strokeColorHex: "#0A0B0E",
		offsetX: 2,
		offsetY: -4,
		zIndex: 10,
		atlasRegion: {
			texture: "operative.atlas.png",
			x: 4,
			y: 4,
			width: 16,
			height: 24,
		},
	};

	it.each([
		{
			label: "procedural rect cutout -> PIXI.Graphics",
			slot: { ...testSlotBase, shapeType: "rect" as const },
			textures: undefined,
			atlasTexture: undefined,
			preferAtlas: false,
			expectedClass: Graphics,
		},
		{
			label: "procedural polygon cutout -> PIXI.Graphics",
			slot: {
				...testSlotBase,
				shapeType: "polygon" as const,
				points: [-8, -12, 8, -12, 8, 12, -8, 12],
			},
			textures: undefined,
			atlasTexture: undefined,
			preferAtlas: false,
			expectedClass: Graphics,
		},
		{
			label: "explicit per-slot texture override -> PIXI.Sprite",
			slot: testSlotBase,
			textures: { slot_test: Texture.WHITE },
			atlasTexture: undefined,
			preferAtlas: false,
			expectedClass: Sprite,
		},
		{
			label: "baked atlasRegion with preferAtlasSprites=true -> PIXI.Sprite",
			slot: testSlotBase,
			textures: undefined,
			atlasTexture: Texture.WHITE,
			preferAtlas: true,
			expectedClass: Sprite,
		},
	])(
		"createSlotAttachment: $label",
		({ slot, textures, atlasTexture, preferAtlas, expectedClass }) => {
			const attachment = createSlotAttachment(
				slot,
				textures,
				atlasTexture,
				preferAtlas,
			);
			expect(attachment).toBeInstanceOf(expectedClass);
		},
	);

	it("toggles setAtlasMode and setDebugDraw dynamically on a live OrthoRig instance", () => {
		const rig = new OrthoRig(rigData, {
			atlasTexture: Texture.WHITE,
			debugDraw: true,
		});
		expect(rig).toBeInstanceOf(Container);
		expect(rig.bones.size).toBe(11);
		expect(rig.sockets.size).toBe(4);
		expect(rig.debugDraw).toBe(true);

		for (const [mode, expectedType] of [
			[true, Sprite],
			[false, Graphics],
		] as const) {
			rig.setAtlasMode(mode, Texture.WHITE);
			for (const slot of rig.slots.values()) {
				expect(slot).toBeInstanceOf(expectedType);
			}
		}

		rig.setDebugDraw(false);
		expect(rig.debugDraw).toBe(false);
		rig.setDebugDraw(true);
		expect(rig.debugDraw).toBe(true);
	});
});

describe("4. Analytic 2-Bone IK, Multi-Target Sockets & 1-Bone Look-At (Parametrized)", () => {
	it.each([
		{
			label:
				"singularity at exact chain root (dist = 0 -> clamped to |L1-L2|+1e-4)",
			upper: "upper_arm_r",
			lower: "forearm_r",
			offsetX: 0,
			offsetY: 0,
			bendDir: 1 as const,
			autoFlip: true,
			mix: 1.0,
			expectedFacing: 1,
			checkExactReach: false,
		},
		{
			label: "in-reach target (dist = 40 -> exact end-effector convergence)",
			upper: "upper_arm_r",
			lower: "forearm_r",
			offsetX: 32,
			offsetY: -24,
			bendDir: 1 as const,
			autoFlip: true,
			mix: 1.0,
			expectedFacing: 1,
			checkExactReach: true,
		},
		{
			label:
				"beyond-reach target behind spine (autoFlip=true -> flips scale.x=-1)",
			upper: "upper_arm_r",
			lower: "forearm_r",
			offsetX: -200,
			offsetY: -50,
			bendDir: 1 as const,
			autoFlip: true,
			mix: 1.0,
			expectedFacing: -1,
			checkExactReach: false,
		},
		{
			label:
				"secondary leg chain behind spine (autoFlip=false -> preserves scale.x=1)",
			upper: "thigh_l",
			lower: "shin_l",
			offsetX: -18,
			offsetY: 20,
			bendDir: -1 as const,
			autoFlip: false,
			mix: 1.0,
			expectedFacing: 1,
			checkExactReach: true,
		},
		{
			label:
				"partial FK-to-IK blend (mix = 0.5 -> blends smoothly without NaN)",
			upper: "upper_arm_r",
			lower: "forearm_r",
			offsetX: 35,
			offsetY: -10,
			bendDir: 1 as const,
			autoFlip: true,
			mix: 0.5,
			expectedFacing: 1,
			checkExactReach: false,
		},
	])(
		"solveTwoBoneIK: $label",
		({
			upper,
			lower,
			offsetX,
			offsetY,
			bendDir,
			autoFlip,
			mix,
			expectedFacing,
			checkExactReach,
		}) => {
			const rig = new OrthoRig(rigData);
			rig.position.set(500, 400);
			rig.scale.x = 1;

			const L1 = rig.boneNodes.get(upper)!.spec.length;
			const L2 = rig.boneNodes.get(lower)!.spec.length;
			const rootTf = rig.getBoneLocalCharacterTransform(upper);
			const tx = rig.x + rootTf.x + offsetX;
			const ty = rig.y + rootTf.y + offsetY;

			const res = rig.solveTwoBoneIK(
				tx,
				ty,
				upper,
				lower,
				bendDir,
				"test_chain",
				autoFlip,
				mix,
			);

			expect(Number.isNaN(res.upperLocalRotation)).toBe(false);
			expect(Number.isNaN(res.lowerLocalRotation)).toBe(false);
			expect(rig.scale.x).toBe(expectedFacing);
			expect(res.mix).toBeCloseTo(mix, 4);

			// Verify rigid segment lengths L1 and L2 are strictly preserved
			expect(
				Math.hypot(
					res.midLocal.x - res.rootLocal.x,
					res.midLocal.y - res.rootLocal.y,
				),
			).toBeCloseTo(L1, 4);
			expect(
				Math.hypot(
					res.endLocal.x - res.midLocal.x,
					res.endLocal.y - res.midLocal.y,
				),
			).toBeCloseTo(L2, 4);

			if (checkExactReach) {
				expect(res.endWorld.x).toBeCloseTo(tx, 2);
				expect(res.endWorld.y).toBeCloseTo(ty, 2);
			}
		},
	);

	it.each(
		Array.from({ length: 12 }, (_, i) => ({
			step: i,
			angleRad: -Math.PI + (2 * Math.PI * i) / 12,
		})),
	)(
		"360° aim sweep step $step (angle=$angleRad rad): flips facing, inverts bend, and tracks cursor",
		({ angleRad }) => {
			const rig = new OrthoRig(rigData);
			rig.position.set(640, 360);
			const shoulder = rig.getBoneLocalCharacterTransform("upper_arm_r");
			const cursorX = rig.x + Math.cos(angleRad) * 220;
			const cursorY = rig.y + shoulder.y + Math.sin(angleRad) * 220;

			rig.update(1 / 60, cursorX, cursorY);

			const res = rig.ikResult!;
			const expectedFacing = cursorX < rig.x ? -1 : 1;
			expect(rig.scale.x).toBe(expectedFacing);
			expect(res.effectiveBendDirection).toBe(expectedFacing === -1 ? -1 : 1);

			const barrel = rig.getBoneWorldTransform("forearm_r");
			const expectedAngle = Math.atan2(
				cursorY - res.shoulderWorld.y,
				cursorX - res.shoulderWorld.x,
			);
			expect(
				Math.abs(normalizeAngle(barrel.rotation - expectedAngle)),
			).toBeLessThan(0.005);
		},
	);

	it("evaluates targetSocket off-hand grip, explicit setIKTarget/clearIKTarget overrides, and Look-At limits", () => {
		const rig = new OrthoRig(rigData);
		rig.position.set(400, 300);
		rig.update(0, 620, 180);

		// 1. Default targetSocket: left_arm_grip tracks the "offhand_grip" socket on forearm_r
		const gripSocket = rig.getSocketWorldTransform("offhand_grip");
		const leftGrip = rig.getIKResult("left_arm_grip")!;
		expect(leftGrip.endWorld.x).toBeCloseTo(gripSocket.x, 2);
		expect(leftGrip.endWorld.y).toBeCloseTo(gripSocket.y, 2);

		// 2. Explicit setIKTarget("offhand_grip") overrides targetSocket; clearIKTarget restores socket tracking
		rig.setIKTarget(420, 225, "offhand_grip", 1.0);
		rig.update(0, 620, 180);
		expect(rig.getIKResult("left_arm_grip")!.endWorld.x).toBeCloseTo(420, 2);
		expect(rig.getIKResult("left_arm_grip")!.endWorld.y).toBeCloseTo(225, 2);

		rig.clearIKTarget("offhand_grip");
		rig.update(0, 620, 180);
		expect(rig.getIKResult("left_arm_grip")!.endWorld.x).toBeCloseTo(
			rig.getSocketWorldTransform("offhand_grip").x,
			2,
		);

		// 3. Constraint mix overrides on both 2-Bone IK and 1-Bone Look-At constraints
		for (const [constraintName, getter] of [
			["left_arm_grip", () => rig.getIKResult("left_arm_grip")],
			["head_look_at", () => rig.getLookAtResult("head_look_at")],
		] as const) {
			rig.setConstraintMix(constraintName, 0);
			expect(rig.getConstraintMix(constraintName)).toBe(0);
			rig.update(0, 620, 180);
			expect(getter()).toBeUndefined();

			rig.setConstraintMix(constraintName, 0.75);
			rig.update(0, 620, 180);
			expect(getter()!.mix).toBeCloseTo(0.75, 4);
		}
	});
});

describe("5. Animation State Machine, Layers, Sockets & Timeline Events (Parametrized)", () => {
	it.each([
		{ fromAction: "Idle", toAction: "Run", transition: 0.2, stepDt: 0.1 },
		{ fromAction: "Run", toAction: "WallSlide", transition: 0.1, stepDt: 0.05 },
		{ fromAction: "WallSlide", toAction: "Jump", transition: 0.0, stepDt: 0.2 },
	])(
		"cross-fades base Layer 0 from $fromAction -> $toAction (transition=$transition s)",
		({ fromAction, toAction, transition, stepDt }) => {
			const rig = new OrthoRig(rigData, { initialAnimation: fromAction });
			rig.setIKEnabled(false);
			rig.play(toAction, transition);
			expect(rig.activeAction).toBe(toAction);
			rig.update(stepDt);
			expect(rig.playbackTime).toBeCloseTo(stepDt, 4);
		},
	);

	it.each([
		{
			label: "Layer 0 delegation via playLayer(0, 'Run')",
			layerIndex: 0,
			action: "Run",
			mode: "override" as const,
			boneMask: undefined,
			fadeOutDuration: 0,
		},
		{
			label: "Layer 1 additive Recoil kick (non-looping auto-finish)",
			layerIndex: 1,
			action: "Recoil",
			mode: "additive" as const,
			boneMask: undefined,
			fadeOutDuration: 0,
		},
		{
			label:
				"Layer 2 masked override on torso & head with gradual stopLayer fade-out",
			layerIndex: 2,
			action: "WallSlide",
			mode: "override" as const,
			boneMask: ["torso", "head"],
			fadeOutDuration: 0.1,
		},
	])(
		"evaluates animation layer: $label",
		({ layerIndex, action, mode, boneMask, fadeOutDuration }) => {
			const rig = new OrthoRig(rigData, { initialAnimation: "Idle" });
			rig.setIKEnabled(false);
			rig.update(0);

			rig.playLayer(layerIndex, action, {
				mode,
				boneMask,
				weight: 1.0,
				transitionDuration: 0.02,
			});
			rig.update(1 / 24);

			if (layerIndex === 0) {
				expect(rig.activeAction).toBe(action);
			} else {
				const baseAtStep = OrthoRig.interpolateTrack(
					rigData.animations.Idle.tracks.torso,
					rig.playbackTime,
				).rotation;
				expect(rig.bones.get("torso")!.rotation).not.toBeCloseTo(baseAtStep, 3);
				rig.stopLayer(layerIndex, fadeOutDuration);
				rig.update(fadeOutDuration + 0.05);
				const baseAfterStop = OrthoRig.interpolateTrack(
					rigData.animations.Idle.tracks.torso,
					rig.playbackTime,
				).rotation;
				expect(rig.bones.get("torso")!.rotation).toBeCloseTo(baseAfterStop, 4);
			}
		},
	);

	it("manages socket child attachments and fires timeline pose-marker events across loop boundaries", () => {
		const rig = new OrthoRig(rigData, { initialAnimation: "Run" });
		const childA = new Container();
		const childB = new Container();

		rig.attachToSocket("muzzle", childA);
		rig.attachToSocket("muzzle", childB);
		expect(rig.getSocket("muzzle")!.children).toContain(childA);

		// Detach single child, then detach all remaining children
		rig.detachFromSocket("muzzle", childA);
		expect(childA.parent).toBeNull();
		expect(childB.parent).toBe(rig.getSocket("muzzle"));
		rig.detachFromSocket("muzzle");
		expect(childB.parent).toBeNull();

		const events: OrthoAnimationEvent[] = [];
		const unsub = rig.onAnimationEvent((ev) => events.push(ev));

		for (const [dt, expectedNames] of [
			[0.3, ["footstep_r"]],
			[0.5, ["footstep_r", "footstep_l"]],
			[0.5, ["footstep_r", "footstep_l", "footstep_r"]],
		] as const) {
			rig.update(dt, 500, 400);
			expect(events.map((e) => e.name)).toEqual(expectedNames);
		}
		unsub();
	});

	it.each([
		{
			label: "play() with unknown action",
			invoke: (rig: OrthoRig) => rig.play("NonExistentAction"),
			expectedMessage: 'Unknown action "NonExistentAction"',
		},
		{
			label: "playLayer() with unknown action",
			invoke: (rig: OrthoRig) => rig.playLayer(1, "NonExistentLayerAction"),
			expectedMessage: 'Unknown action "NonExistentLayerAction"',
		},
		{
			label: "attachToSocket() with unknown socket",
			invoke: (rig: OrthoRig) =>
				rig.attachToSocket("unknown_socket", new Container()),
			expectedMessage: 'Unknown socket "unknown_socket"',
		},
		{
			label: "getSocketLocalCharacterTransform() with unknown socket",
			invoke: (rig: OrthoRig) =>
				rig.getSocketLocalCharacterTransform("unknown_socket"),
			expectedMessage: 'Unknown socket "unknown_socket"',
		},
		{
			label: "getBoneWorldTransform() with unknown bone",
			invoke: (rig: OrthoRig) => rig.getBoneWorldTransform("unknown_bone"),
			expectedMessage: 'Unknown bone "unknown_bone"',
		},
		{
			label: "solveTwoBoneIK() with unknown bone names",
			invoke: (rig: OrthoRig) =>
				rig.solveTwoBoneIK(0, 0, "bad_upper", "bad_lower"),
			expectedMessage: 'IK bones "bad_upper" and/or "bad_lower" not found',
		},
	])("defensive error guard: $label", ({ invoke, expectedMessage }) => {
		const rig = new OrthoRig(rigData);
		expect(() => invoke(rig)).toThrow(expectedMessage);
	});
});

describe("6. Automated Clean-Room IP, License & Shingle Similarity Audit", () => {
	it("passes clean-room IP, dependency license, and token-shingle similarity audit", () => {
		const audit = runIpComplianceAudit();
		expect(audit.passed).toBe(true);
		expect(audit.errors).toEqual([]);
		expect(audit.similarity).toBeLessThan(0.05);
	});
});
