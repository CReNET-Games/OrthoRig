import fs from "node:fs";
import path from "node:path";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- ESM compliance script
import { runIpComplianceAudit } from "../../../../tools/check_ip_compliance.mjs";
import {
	evaluateCubicBezier,
	normalizeAngle,
	OrthoRig,
	type OrthoRigSchema,
} from "../OrthoRig";

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
const BLENDER_README = path.join(ROOT, "tools/blender/README.md");

const rigData = JSON.parse(
	fs.readFileSync(COMPILED_JSON, "utf8"),
) as OrthoRigSchema;

describe("Tasks 1, 2 & 3: Monorepo Scaffolding, JSON Schema & Blender Compiler", () => {
	it("includes MIT root LICENSE and GPLv3/MIT boundary notice in tools/blender/README.md", () => {
		expect(fs.existsSync(path.join(ROOT, "LICENSE"))).toBe(true);
		expect(fs.existsSync(BLENDER_README)).toBe(true);
		const readmeText = fs.readFileSync(BLENDER_README, "utf8");
		expect(readmeText).toContain("GPLv3");
		expect(readmeText).toContain("MIT");
	});

	it("defines a valid Draft 2020-12 JSON Schema at /schema/orthorig.schema.json", () => {
		expect(fs.existsSync(SCHEMA_FILE)).toBe(true);
		const schemaObj = JSON.parse(fs.readFileSync(SCHEMA_FILE, "utf8"));
		expect(schemaObj.$schema).toBe(
			"https://json-schema.org/draft/2020-12/schema",
		);
		expect(schemaObj.required).toEqual([
			"meta",
			"bones",
			"slots",
			"ik_constraints",
			"animations",
		]);
	});

	it("generates a valid Blender file (operative_demo.blend) and compiled operative.orthorig.json", () => {
		expect(fs.existsSync(BLEND_FILE)).toBe(true);
		const header = fs.readFileSync(BLEND_FILE).subarray(0, 7).toString("ascii");
		expect(header).toBe("BLENDER");

		expect(rigData.meta.coordinateSystem).toBe("pixi-y-down");
		expect(rigData.meta.sourceFile).toBe("operative_demo.blend");

		// Verify all 11 required bones
		const expectedBones = [
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
		];
		expect(rigData.bones.map((b) => b.name)).toEqual(expectedBones);

		// Verify the rig stands on the ground plane (0,0,0) with pelvis root at Z=+64 (Pixi Y=-64)
		const rootSpec = rigData.bones.find((b) => b.name === "root")!;
		expect(rootSpec.restX).toBe(0);
		expect(rootSpec.restY).toBe(-64);

		// Verify High-Gloss Survival 4-color palette (#0A0B0E, #F4F6F8, #00F0FF, #FF2A54)
		const usedColors = new Set(
			rigData.slots.map((s) => s.colorHex.toUpperCase()),
		);
		expect(usedColors.has("#0A0B0E")).toBe(true);
		expect(usedColors.has("#F4F6F8")).toBe(true);
		expect(usedColors.has("#00F0FF")).toBe(true);
		expect(usedColors.has("#FF2A54")).toBe(true);

		// Verify 2-bone IK constraint on upper_arm_r / forearm_r
		expect(rigData.ik_constraints).toEqual([
			{
				name: "right_arm_aim",
				chain: ["upper_arm_r", "forearm_r"],
				target: "aim_cursor",
				bendDirection: 1,
			},
		]);

		// Verify all 4 required Blender Actions (Idle, Run, Jump, WallSlide)
		expect(Object.keys(rigData.animations).sort()).toEqual([
			"Idle",
			"Jump",
			"Run",
			"WallSlide",
		]);
	});
});

describe("Task 4: @crenet/orthorig TypeScript Runtime & Analytic 2-Bone IK Solver", () => {
	it("constructs hierarchical PIXI.Container bone nodes and zIndex-sorted slots", () => {
		const rig = new OrthoRig(rigData, { debugDraw: true });
		expect(rig).toBeInstanceOf(Container);
		expect(rig.bones.size).toBe(11);
		expect(rig.slots.size).toBe(rigData.slots.length);
		expect(rig.debugDraw).toBe(true);

		for (const slot of rig.slots.values()) {
			expect(slot).toBeInstanceOf(Graphics);
		}

		// Verify sprite mode when texture is passed
		const spriteRig = new OrthoRig(rigData, {
			textures: { slot_torso_plate: Texture.WHITE },
		});
		expect(spriteRig.slots.get("slot_torso_plate")).toBeInstanceOf(Sprite);
	});

	it("supports linear and cubic-bezier keyframe interpolation and cross-fade state transitions", () => {
		expect(evaluateCubicBezier(0, 0.42, 0, 0.58, 1)).toBe(0);
		expect(evaluateCubicBezier(1, 0.42, 0, 0.58, 1)).toBe(1);
		expect(evaluateCubicBezier(0.5, 0.42, 0, 0.58, 1)).toBeCloseTo(0.5, 3);

		const rig = new OrthoRig(rigData, { initialAnimation: "Idle" });
		rig.setIKEnabled(false);

		rig.play("Run", 0.2);
		expect(rig.activeAction).toBe("Run");

		// Advance halfway through the 0.2s cross-fade transition
		rig.update(0.1);
		expect(rig.playbackTime).toBeCloseTo(0.1, 4);

		// Transition to WallSlide and Jump
		rig.play("WallSlide", 0.1);
		rig.update(0.05);
		expect(rig.activeAction).toBe("WallSlide");

		rig.play("Jump", 0);
		rig.update(rigData.animations.Jump.duration * 0.5);
		expect(rig.bones.get("root")!.y).toBeLessThan(-10);
	});

	it("solves 2-Bone IK in O(1) with distance clamping [|L1 - L2| + 1e-4, L1 + L2 - 1e-4] and zero NaN", () => {
		const rig = new OrthoRig(rigData);
		rig.position.set(500, 400);

		const L1 = rig.boneNodes.get("upper_arm_r")!.spec.length;
		const L2 = rig.boneNodes.get("forearm_r")!.spec.length;

		// 1. Test singularity at exact shoulder origin (distance = 0 -> clamped to |L1 - L2| + 1e-4)
		const shoulderTf = rig.getBoneLocalCharacterTransform("upper_arm_r");
		const resZero = rig.solveTwoBoneIK(
			rig.x + shoulderTf.x,
			rig.y + shoulderTf.y,
		);
		expect(Number.isNaN(resZero.upperLocalRotation)).toBe(false);
		expect(Number.isNaN(resZero.lowerLocalRotation)).toBe(false);

		// 2. Test target inside reach (distance = 40)
		const targetDist = 40;
		const targetAngle = -Math.PI / 5;
		const tx = rig.x + shoulderTf.x + targetDist * Math.cos(targetAngle);
		const ty = rig.y + shoulderTf.y + targetDist * Math.sin(targetAngle);

		const resMid = rig.solveTwoBoneIK(tx, ty);
		expect(resMid.wristWorld.x).toBeCloseTo(tx, 2);
		expect(resMid.wristWorld.y).toBeCloseTo(ty, 2);

		// Verify rigid bone lengths L1 and L2 are preserved
		const d1 = Math.hypot(
			resMid.elbowLocal.x - resMid.shoulderLocal.x,
			resMid.elbowLocal.y - resMid.shoulderLocal.y,
		);
		const d2 = Math.hypot(
			resMid.wristLocal.x - resMid.elbowLocal.x,
			resMid.wristLocal.y - resMid.elbowLocal.y,
		);
		expect(d1).toBeCloseTo(L1, 4);
		expect(d2).toBeCloseTo(L2, 4);

		// 3. Test non-cursor 2-bone chain (leg terrain foot placement with autoFlipFacing = false)
		rig.scale.x = 1;
		const footTargetX = rig.x - 18; // Behind character spine, but should NOT flip scale.x
		const footTargetY = rig.y - 14; // Elevated step/ledge
		const legRes = rig.solveTwoBoneIK(
			footTargetX,
			footTargetY,
			"thigh_l",
			"shin_l",
			-1,
			"left_leg_ground",
			false,
		);
		expect(rig.scale.x).toBe(1);
		expect(legRes.endWorld.x).toBeCloseTo(footTargetX, 2);
		expect(legRes.endWorld.y).toBeCloseTo(footTargetY, 2);
	});

	it("flips scale.x = -1 when aiming behind spine, inverts effectiveBendDirection, and aims across 360°", () => {
		const rig = new OrthoRig(rigData);
		rig.position.set(640, 360);
		rig.play("Run", 0);

		const radius = 220;
		const steps = 24;

		for (let i = 0; i < steps; i++) {
			const angle = -Math.PI + (2 * Math.PI * i) / steps;
			const shoulderBefore = rig.getBoneLocalCharacterTransform("upper_arm_r");
			const cursorX = rig.x + Math.cos(angle) * radius;
			const cursorY = rig.y + shoulderBefore.y + Math.sin(angle) * radius;

			rig.update(1 / 60, cursorX, cursorY);

			const res = rig.ikResult!;
			const expectedFacing = cursorX < rig.x ? -1 : 1;
			expect(rig.scale.x).toBe(expectedFacing);
			expect(res.facing).toBe(expectedFacing);
			expect(res.effectiveBendDirection).toBe(expectedFacing === -1 ? -1 : 1);

			const barrel = rig.getBoneWorldTransform("forearm_r");
			const expectedAngle = Math.atan2(
				cursorY - res.shoulderWorld.y,
				cursorX - res.shoulderWorld.x,
			);
			const aimErr = Math.abs(
				normalizeAngle(res.aimWorldAngle - expectedAngle),
			);
			expect(aimErr).toBeLessThan(1e-6);

			const barrelErr = Math.abs(
				normalizeAngle(barrel.rotation - expectedAngle),
			);
			expect(barrelErr).toBeLessThan(0.005);
		}
	});

	it("passes clean-room IP, dependency license, and token-shingle similarity audit", () => {
		const audit = runIpComplianceAudit();
		expect(audit.passed).toBe(true);
		expect(audit.errors).toEqual([]);
		expect(audit.similarity).toBeLessThan(0.05);
	});
});
