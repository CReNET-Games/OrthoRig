import type { Graphics } from "pixi.js";
import type { IKSolveResult, OrthoBoneNode } from "./types";

const NEON_GREEN = 0x00ff66;
const NEON_MAGENTA = 0xff00ff;

/**
 * Render real-time bone vectors, pivot joints (neon green `0x00ff66`), and all active
 * IK target vectors (magenta `0xff00ff`) directly onto the rig's debug overlay.
 */
export function drawDebugSkeletonOverlay(
	g: Graphics,
	boneNodes: ReadonlyMap<string, OrthoBoneNode>,
	getBoneLocalTransform: (boneName: string) => {
		x: number;
		y: number;
		rotation: number;
	},
	ikResults: Iterable<IKSolveResult>,
	rigWorldX: number,
	rigWorldY: number,
	rigScaleY: number,
): void {
	g.clear();

	for (const node of boneNodes.values()) {
		const tf = getBoneLocalTransform(node.spec.name);
		const tipX = tf.x + node.spec.length * Math.cos(tf.rotation);
		const tipY = tf.y + node.spec.length * Math.sin(tf.rotation);

		g.moveTo(tf.x, tf.y)
			.lineTo(tipX, tipY)
			.stroke({ color: NEON_GREEN, width: 1.75, alpha: 0.9 });
		g.circle(tf.x, tf.y, 2.75).fill({ color: NEON_GREEN });
	}

	const sy = Math.abs(rigScaleY) > 1e-9 ? rigScaleY : 1;

	for (const ik of ikResults) {
		const { rootLocal, midLocal, endLocal, targetWorld, facing } = ik;
		const localTargetX = (targetWorld.x - rigWorldX) * facing;
		const localTargetY = (targetWorld.y - rigWorldY) / sy;

		// Magenta IK target vector from chain root to target
		g.moveTo(rootLocal.x, rootLocal.y)
			.lineTo(localTargetX, localTargetY)
			.stroke({ color: NEON_MAGENTA, width: 1.5, alpha: 0.85 });

		// Highlight IK chain joints in neon magenta
		g.circle(rootLocal.x, rootLocal.y, 3.5).fill({
			color: NEON_MAGENTA,
		});
		g.circle(midLocal.x, midLocal.y, 3.5).fill({ color: NEON_MAGENTA });
		g.circle(endLocal.x, endLocal.y, 3.5).fill({ color: NEON_MAGENTA });
		g.circle(localTargetX, localTargetY, 4.5).stroke({
			color: NEON_MAGENTA,
			width: 1.5,
		});
	}
}
