import type { Graphics } from "pixi.js";
import type { IKSolveResult, OrthoBoneNode, OrthoSocketNode } from "./types.js";

const NEON_GREEN = 0x00ff66;
const NEON_MAGENTA = 0xff00ff;
const NEON_CYAN = 0x00f0ff;

/**
 * Render real-time bone vectors, pivot joints (neon green `0x00ff66`), named sockets
 * (cyan `0x00f0ff`), and all active IK target vectors (magenta `0xff00ff`) directly
 * onto the rig's debug overlay.
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
	socketNodes?: ReadonlyMap<string, OrthoSocketNode>,
	rigScaleX: number = 1,
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

	if (socketNodes) {
		for (const socketNode of socketNodes.values()) {
			const boneTf = getBoneLocalTransform(socketNode.spec.bone);
			const cosR = Math.cos(boneTf.rotation);
			const sinR = Math.sin(boneTf.rotation);
			const sx = boneTf.x + socketNode.spec.x * cosR - socketNode.spec.y * sinR;
			const sy = boneTf.y + socketNode.spec.x * sinR + socketNode.spec.y * cosR;
			g.circle(sx, sy, 3.0).stroke({
				color: NEON_CYAN,
				width: 1.5,
				alpha: 0.95,
			});
		}
	}

	const absScaleX = Math.abs(rigScaleX) > 1e-9 ? Math.abs(rigScaleX) : 1;
	const sy = Math.abs(rigScaleY) > 1e-9 ? rigScaleY : 1;

	for (const ik of ikResults) {
		const { rootLocal, midLocal, endLocal, targetWorld, facing } = ik;
		const signedScaleX = facing * absScaleX;
		const localTargetX = (targetWorld.x - rigWorldX) / signedScaleX;
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
