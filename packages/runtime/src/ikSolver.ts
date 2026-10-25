import { clamp, normalizeAngle } from "./math";
import type { IKSolveResult } from "./types";

export interface TwoBoneSolveParams {
	constraintName: string;
	upperBoneName: string;
	lowerBoneName: string;
	upperLength: number;
	lowerLength: number;
	/** Chain root joint X (e.g. shoulder or hip) in local unscaled character space. */
	rootLocalX: number;
	/** Chain root joint Y (e.g. shoulder or hip) in local unscaled character space. */
	rootLocalY: number;
	/** Accumulated rotation of the chain root's parent bone in local character space. */
	parentRotation: number;
	rigWorldX: number;
	rigWorldY: number;
	rigScaleY: number;
	/** World-space X coordinate of the IK target (cursor, ground contact point, grip socket, etc.). */
	targetWorldX: number;
	/** World-space Y coordinate of the IK target. */
	targetWorldY: number;
	bendDirection: 1 | -1;
	/**
	 * Whether this IK chain determines horizontal character facing (`scale.x = 1 | -1`) based on
	 * which side of `rigWorldX` the target lies on. Set to `true` (default) for primary aim chains,
	 * or `false` for secondary chains like foot terrain placement or off-hand weapon grips.
	 */
	autoFlipFacing?: boolean;
	/** Current horizontal facing (`1` or `-1`), used when `autoFlipFacing` is `false`. */
	currentFacing?: 1 | -1;
}

/**
 * General-purpose deterministic $O(1)$ Analytic 2-Bone IK Solver using the Law of Cosines.
 *
 * Applicable to any 2-bone planar limb chain (weapon aiming arms, foot/terrain placement legs,
 * off-hand grips, or mechanical appendages):
 * - Clamps target distance to `[|L1 - L2| + 1e-4, L1 + L2 - 1e-4]` to prevent `Math.acos` `NaN` singularities.
 * - Supports both auto-flipping primary chains (`autoFlipFacing: true`) and facing-preserving
 *   secondary chains (`autoFlipFacing: false`), inverting the world-space bend direction when `facing === -1`.
 */
export function solveTwoBoneChain(params: TwoBoneSolveParams): IKSolveResult {
	const {
		constraintName,
		upperBoneName,
		lowerBoneName,
		upperLength: L1,
		lowerLength: L2,
		rootLocalX,
		rootLocalY,
		parentRotation,
		rigWorldX,
		rigWorldY,
		rigScaleY,
		targetWorldX,
		targetWorldY,
		bendDirection,
		autoFlipFacing = true,
		currentFacing = 1,
	} = params;

	// 1. Determine active horizontal facing (either driven by target X or preserved from currentFacing)
	const dxWorld = targetWorldX - rigWorldX;
	const dyWorld = targetWorldY - rigWorldY;
	const facing: 1 | -1 = autoFlipFacing
		? dxWorld < 0
			? -1
			: 1
		: currentFacing < 0
			? -1
			: 1;

	// World-space effective bend direction inverts when mirrored horizontally
	const effectiveBendDirection: 1 | -1 =
		facing === -1 ? (-bendDirection as 1 | -1) : bendDirection;

	// 2. Convert world target into root character space (where X is mirrored by facing)
	const sy = Math.abs(rigScaleY) > 1e-9 ? rigScaleY : 1;
	const localTargetX = dxWorld * facing;
	const localTargetY = dyWorld / sy;

	// 3. Law of Cosines with strict distance clamping [|L1 - L2| + 1e-4, L1 + L2 - 1e-4]
	const dx = localTargetX - rootLocalX;
	const dy = localTargetY - rootLocalY;
	const rawDist = Math.hypot(dx, dy);
	const minDist = Math.abs(L1 - L2) + 1e-4;
	const maxDist = Math.max(minDist, L1 + L2 - 1e-4);
	const clampedDist = clamp(rawDist, minDist, maxDist);

	const targetAngle = Math.atan2(dy, dx);
	const cosMid = clamp(
		(clampedDist * clampedDist - L1 * L1 - L2 * L2) / (2 * L1 * L2),
		-1,
		1,
	);

	// In PixiJS Y-down space, -bendDirection * acos(cosMid) bends the middle joint (elbow/knee)
	// in the configured direction. Because root scale.x = facing already reflects the local
	// coordinate frame horizontally, this local angle automatically corresponds to the inverted
	// world bend direction (`effectiveBendDirection`) when facing === -1.
	const lowerLocalRotation = -bendDirection * Math.acos(cosMid);
	const rootOffsetAngle = Math.atan2(
		L2 * Math.sin(lowerLocalRotation),
		L1 + L2 * Math.cos(lowerLocalRotation),
	);

	const upperWorldAngle = targetAngle - rootOffsetAngle;
	const upperLocalRotation = normalizeAngle(upperWorldAngle - parentRotation);

	// 4. Compute resulting joint positions in both local and world space
	const midLocalX = rootLocalX + L1 * Math.cos(upperWorldAngle);
	const midLocalY = rootLocalY + L1 * Math.sin(upperWorldAngle);
	const lowerAngle = upperWorldAngle + lowerLocalRotation;
	const endLocalX = midLocalX + L2 * Math.cos(lowerAngle);
	const endLocalY = midLocalY + L2 * Math.sin(lowerAngle);

	const rootLocal = { x: rootLocalX, y: rootLocalY };
	const midLocal = { x: midLocalX, y: midLocalY };
	const endLocal = { x: endLocalX, y: endLocalY };

	const rootWorld = {
		x: rigWorldX + rootLocalX * facing,
		y: rigWorldY + rootLocalY * sy,
	};
	const midWorld = {
		x: rigWorldX + midLocalX * facing,
		y: rigWorldY + midLocalY * sy,
	};
	const endWorld = {
		x: rigWorldX + endLocalX * facing,
		y: rigWorldY + endLocalY * sy,
	};
	const aimWorldAngle = Math.atan2(
		endWorld.y - rootWorld.y,
		endWorld.x - rootWorld.x,
	);

	return {
		constraintName,
		upperBone: upperBoneName,
		lowerBone: lowerBoneName,
		upperWorldAngle,
		upperLocalRotation,
		lowerLocalRotation,
		rootLocal,
		midLocal,
		endLocal,
		rootWorld,
		midWorld,
		endWorld,
		shoulderLocal: rootLocal,
		elbowLocal: midLocal,
		wristLocal: endLocal,
		shoulderWorld: rootWorld,
		elbowWorld: midWorld,
		wristWorld: endWorld,
		targetWorld: { x: targetWorldX, y: targetWorldY },
		aimWorldAngle,
		facing,
		effectiveBendDirection,
	};
}
