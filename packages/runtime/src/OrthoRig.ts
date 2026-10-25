import { Container, Graphics, type Sprite, type Texture } from "pixi.js";
import { drawDebugSkeletonOverlay } from "./debugOverlay";
import { solveTwoBoneChain } from "./ikSolver";
import {
	clamp,
	evaluateCubicBezier,
	interpolateTrack,
	normalizeAngle,
	parseHexColor,
} from "./math";
import { createSlotAttachment } from "./slotBuilder";
import type {
	BoneWorldTransform,
	IKSolveResult,
	OrthoAnimationClip,
	OrthoBoneNode,
	OrthoKeyframe,
	OrthoRigOptions,
	OrthoRigSchema,
} from "./types";

export type * from "./types";
export {
	clamp,
	evaluateCubicBezier,
	interpolateTrack,
	normalizeAngle,
	parseHexColor,
};

/**
 * `@crenet/orthorig` — 2D Orthographic Skeletal Animation & Analytic 2-Bone IK Runtime for PixiJS v8.
 */
export class OrthoRig extends Container {
	public readonly schema: OrthoRigSchema;
	public readonly boneNodes: Map<string, OrthoBoneNode> = new Map();
	public readonly bones: Map<string, Container> = new Map();
	public readonly slots: Map<string, Graphics | Sprite> = new Map();

	/** Animation playback speed multiplier (`1.0` = normal speed, `0.0` = paused). */
	public animationSpeed: number = 1.0;

	private _debugDraw: boolean = false;
	private readonly debugGraphics: Graphics;

	private currentActionName: string | null = null;
	private currentClip: OrthoAnimationClip | null = null;
	private currentTime: number = 0;
	private isLooping: boolean = true;
	private isPlaying: boolean = false;

	// Cross-fade transition state
	private transitionFromPose: Map<
		string,
		{ x: number; y: number; rotation: number }
	> | null = null;
	private transitionDuration: number = 0;
	private transitionElapsed: number = 0;

	// IK targets keyed by constraint target name (e.g. `"aim_cursor"`, `"foot_l_ground"`, etc.)
	private readonly ikTargetsWorld: Map<string, { x: number; y: number }> =
		new Map();
	private readonly ikResults: Map<string, IKSolveResult> = new Map();
	private ikEnabled: boolean = true;
	private lastIKResult: IKSolveResult | null = null;

	constructor(schema: OrthoRigSchema, options: OrthoRigOptions = {}) {
		super();
		this.schema = schema;
		this.label = "OrthoRig";
		this.sortableChildren = true;

		this.buildBoneHierarchy();
		this.buildSlotAttachments(options.textures, options.atlasTexture);

		this.debugGraphics = new Graphics();
		this.debugGraphics.label = "OrthoRig_DebugOverlay";
		this.debugGraphics.zIndex = 10_000;
		this.addChild(this.debugGraphics);

		this.debugDraw = options.debugDraw ?? false;

		const defaultAction =
			options.initialAnimation ??
			(schema.animations.Idle ? "Idle" : Object.keys(schema.animations)[0]);
		if (defaultAction && schema.animations[defaultAction]) {
			this.play(defaultAction, 0);
		}
	}

	/**
	 * Toggle real-time bone vectors, pivot joints, and IK target overlay (neon green / magenta).
	 */
	public get debugDraw(): boolean {
		return this._debugDraw;
	}

	public set debugDraw(value: boolean) {
		this._debugDraw = value;
		this.debugGraphics.visible = value;
		if (value) {
			this.renderDebugOverlay();
		} else {
			this.debugGraphics.clear();
		}
	}

	/**
	 * Currently playing animation action name (`"Idle"`, `"Run"`, `"Jump"`, `"WallSlide"`).
	 */
	public get activeAction(): string | null {
		return this.currentActionName;
	}

	/**
	 * Current animation playback time in seconds.
	 */
	public get playbackTime(): number {
		return this.currentTime;
	}

	/**
	 * Most recent 2-Bone IK solution computed on this tick.
	 */
	public get ikResult(): IKSolveResult | null {
		return this.lastIKResult;
	}

	private buildBoneHierarchy(): void {
		for (const spec of this.schema.bones) {
			const c = new Container();
			c.label = `Bone_${spec.name}`;
			c.sortableChildren = true;
			c.position.set(spec.restX, spec.restY);
			c.rotation = spec.restRotation;
			c.zIndex = spec.zIndex;

			this.boneNodes.set(spec.name, { spec, container: c });
			this.bones.set(spec.name, c);
		}

		for (const spec of this.schema.bones) {
			const node = this.boneNodes.get(spec.name)!;
			if (spec.parent === null) {
				this.addChild(node.container);
			} else {
				const parentNode = this.boneNodes.get(spec.parent);
				if (parentNode) {
					parentNode.container.addChild(node.container);
				} else {
					this.addChild(node.container);
				}
			}
		}
	}

	private buildSlotAttachments(
		textures?: Record<string, Texture>,
		atlasTexture?: Texture,
	): void {
		const sortedSlots = [...this.schema.slots].sort(
			(a, b) => a.zIndex - b.zIndex,
		);

		for (const slot of sortedSlots) {
			const boneNode = this.boneNodes.get(slot.bone);
			if (!boneNode) continue;

			const displayObj = createSlotAttachment(slot, textures, atlasTexture);
			boneNode.container.addChild(displayObj);
			this.slots.set(slot.name, displayObj);
		}
	}

	/**
	 * Play an animation clip by name with optional cross-fade blending duration (in seconds).
	 *
	 * @param actionName Name of the action in `schema.animations` (`"Idle"`, `"Run"`, `"Jump"`, `"WallSlide"`).
	 * @param transitionDuration Cross-fade blend duration in seconds (default `0.12`, `0` for instant snap).
	 * @param forceRestart If true, restarts playback from `t = 0` even if `actionName` is already active.
	 */
	public play(
		actionName: string,
		transitionDuration: number = 0.12,
		forceRestart: boolean = false,
	): void {
		const clip = this.schema.animations[actionName];
		if (!clip) {
			throw new Error(
				`[@crenet/orthorig] Unknown action "${actionName}". Available: ${Object.keys(
					this.schema.animations,
				).join(", ")}`,
			);
		}

		if (this.currentActionName === actionName && !forceRestart) {
			return;
		}

		if (transitionDuration > 0 && this.currentActionName !== null) {
			const snapshot = new Map<
				string,
				{ x: number; y: number; rotation: number }
			>();
			for (const [bname, node] of this.boneNodes.entries()) {
				snapshot.set(bname, {
					x: node.container.x,
					y: node.container.y,
					rotation: node.container.rotation,
				});
			}
			this.transitionFromPose = snapshot;
			this.transitionDuration = transitionDuration;
			this.transitionElapsed = 0;
		} else {
			this.transitionFromPose = null;
			this.transitionDuration = 0;
			this.transitionElapsed = 0;
		}

		this.currentActionName = actionName;
		this.currentClip = clip;
		this.currentTime = 0;
		this.isLooping = clip.loop;
		this.isPlaying = true;

		this.sampleClipPose(0);
		this.solveAllIKConstraints();
		if (this._debugDraw) {
			this.renderDebugOverlay();
		}
	}

	/**
	 * Set the world/stage target coordinates for an IK target name (defaults to `"aim_cursor"`).
	 */
	public setIKTarget(
		worldX: number,
		worldY: number,
		targetName: string = "aim_cursor",
	): void {
		this.ikTargetsWorld.set(targetName, { x: worldX, y: worldY });
	}

	/**
	 * Enable or disable IK constraint evaluation.
	 */
	public setIKEnabled(enabled: boolean): void {
		this.ikEnabled = enabled;
	}

	/**
	 * Advance animation tracks, apply cross-fade blending, execute the Analytic 2-Bone IK solver
	 * after the animation track update, and refresh the debug overlay if enabled.
	 */
	public update(
		deltaSeconds: number,
		primaryTargetWorldX?: number,
		primaryTargetWorldY?: number,
	): void {
		if (
			typeof primaryTargetWorldX === "number" &&
			typeof primaryTargetWorldY === "number"
		) {
			const defaultTargetName =
				this.schema.ik_constraints[0]?.target ?? "aim_cursor";
			this.ikTargetsWorld.set(defaultTargetName, {
				x: primaryTargetWorldX,
				y: primaryTargetWorldY,
			});
		}

		const scaledDt =
			Math.max(0, deltaSeconds) * Math.max(0, this.animationSpeed);

		// 1. Advance & sample animation track
		if (this.isPlaying && this.currentClip) {
			const duration = this.currentClip.duration;
			if (duration > 0) {
				this.currentTime += scaledDt;
				if (this.currentTime >= duration) {
					if (this.isLooping) {
						this.currentTime %= duration;
					} else {
						this.currentTime = duration;
						this.isPlaying = false;
					}
				}
			}

			let blendWeight = 1.0;
			if (this.transitionFromPose && this.transitionDuration > 0) {
				this.transitionElapsed += Math.max(0, deltaSeconds);
				blendWeight = clamp(
					this.transitionElapsed / this.transitionDuration,
					0,
					1,
				);
				if (blendWeight >= 1.0) {
					this.transitionFromPose = null;
				}
			}

			this.sampleClipPose(this.currentTime, blendWeight);
		}

		// 2. Execute Analytic 2-Bone IK Solver AFTER animation track update
		if (this.ikEnabled) {
			this.solveAllIKConstraints();
		}

		// 3. Render real-time debug overlay if enabled
		if (this._debugDraw) {
			this.renderDebugOverlay();
		}
	}

	private sampleClipPose(timeSeconds: number, blendWeight: number = 1.0): void {
		if (!this.currentClip) return;

		for (const [boneName, keyframes] of Object.entries(
			this.currentClip.tracks,
		)) {
			const node = this.boneNodes.get(boneName);
			if (!node || !keyframes || keyframes.length === 0) continue;

			const sampled = interpolateTrack(keyframes, timeSeconds);

			if (this.transitionFromPose && blendWeight < 1.0) {
				const from = this.transitionFromPose.get(boneName);
				if (from) {
					const x = from.x + (sampled.x - from.x) * blendWeight;
					const y = from.y + (sampled.y - from.y) * blendWeight;
					const dRot = normalizeAngle(sampled.rotation - from.rotation);
					const rotation = from.rotation + dRot * blendWeight;
					node.container.position.set(x, y);
					node.container.rotation = rotation;
					continue;
				}
			}

			node.container.position.set(sampled.x, sampled.y);
			node.container.rotation = sampled.rotation;
		}
	}

	/**
	 * Interpolate a bone track at `timeSeconds` using linear or cubic-bezier easing.
	 */
	public static interpolateTrack(
		keyframes: readonly OrthoKeyframe[],
		timeSeconds: number,
	): { x: number; y: number; rotation: number } {
		return interpolateTrack(keyframes, timeSeconds);
	}

	/**
	 * Compute a bone's position and rotation in unscaled root character space
	 * by walking its ancestor chain (`root -> ... -> bone`).
	 */
	public getBoneLocalCharacterTransform(boneName: string): {
		x: number;
		y: number;
		rotation: number;
		parentRotation: number;
	} {
		const chain: OrthoBoneNode[] = [];
		let curr = this.boneNodes.get(boneName);
		while (curr) {
			chain.push(curr);
			curr = curr.spec.parent
				? this.boneNodes.get(curr.spec.parent)
				: undefined;
		}
		chain.reverse();

		let x = 0;
		let y = 0;
		let rotation = 0;
		let parentRotation = 0;

		for (const node of chain) {
			const lx = node.container.x;
			const ly = node.container.y;
			const cosR = Math.cos(rotation);
			const sinR = Math.sin(rotation);
			x += lx * cosR - ly * sinR;
			y += lx * sinR + ly * cosR;
			parentRotation = rotation;
			rotation += node.container.rotation;
		}

		return { x, y, rotation, parentRotation };
	}

	/**
	 * Compute a bone's world/stage transform (head position, tip position, world angle, and unit direction),
	 * suitable for spawning projectiles or attaching effects at a bone tip.
	 */
	public getBoneWorldTransform(boneName: string): BoneWorldTransform {
		const node = this.boneNodes.get(boneName);
		if (!node) {
			throw new Error(`[@crenet/orthorig] Unknown bone "${boneName}"`);
		}
		const localTf = this.getBoneLocalCharacterTransform(boneName);
		const localTipX = localTf.x + node.spec.length * Math.cos(localTf.rotation);
		const localTipY = localTf.y + node.spec.length * Math.sin(localTf.rotation);

		const sx = this.scale.x;
		const sy = this.scale.y;

		const worldX = this.x + localTf.x * sx;
		const worldY = this.y + localTf.y * sy;
		const worldTipX = this.x + localTipX * sx;
		const worldTipY = this.y + localTipY * sy;

		const dx = worldTipX - worldX;
		const dy = worldTipY - worldY;
		const len = Math.hypot(dx, dy) || 1;
		const rotation = Math.atan2(dy, dx);

		return {
			x: worldX,
			y: worldY,
			rotation,
			tipX: worldTipX,
			tipY: worldTipY,
			dirX: dx / len,
			dirY: dy / len,
		};
	}

	private solveAllIKConstraints(): void {
		for (const constraint of this.schema.ik_constraints) {
			const target = this.ikTargetsWorld.get(constraint.target);
			if (target) {
				this.solveTwoBoneIK(
					target.x,
					target.y,
					constraint.chain[0],
					constraint.chain[1],
					constraint.bendDirection,
					constraint.name,
					constraint.autoFlipFacing ?? true,
				);
			}
		}
	}

	/**
	 * Deterministic $O(1)$ Analytic 2-Bone IK Solver using the Law of Cosines.
	 *
	 * Solves any 2-bone chain (`[upperBoneName, lowerBoneName]`) toward `(targetWorldX, targetWorldY)`.
	 * Set `autoFlipFacing = false` for non-aim chains (such as foot/terrain IK or off-hand grips)
	 * that should preserve the character's current horizontal `scale.x` facing.
	 */
	public solveTwoBoneIK(
		targetWorldX: number,
		targetWorldY: number,
		upperBoneName: string = "upper_arm_r",
		lowerBoneName: string = "forearm_r",
		bendDirection: 1 | -1 = 1,
		constraintName: string = "right_arm_aim",
		autoFlipFacing: boolean = true,
	): IKSolveResult {
		const upperNode = this.boneNodes.get(upperBoneName);
		const lowerNode = this.boneNodes.get(lowerBoneName);
		if (!upperNode || !lowerNode) {
			throw new Error(
				`[@crenet/orthorig] IK bones "${upperBoneName}" and/or "${lowerBoneName}" not found.`,
			);
		}

		const currentFacing: 1 | -1 = this.scale.x < 0 ? -1 : 1;
		const rootTf = this.getBoneLocalCharacterTransform(upperBoneName);
		const result = solveTwoBoneChain({
			constraintName,
			upperBoneName,
			lowerBoneName,
			upperLength: upperNode.spec.length,
			lowerLength: lowerNode.spec.length,
			rootLocalX: rootTf.x,
			rootLocalY: rootTf.y,
			parentRotation: rootTf.parentRotation,
			rigWorldX: this.x,
			rigWorldY: this.y,
			rigScaleY: this.scale.y,
			targetWorldX,
			targetWorldY,
			bendDirection,
			autoFlipFacing,
			currentFacing,
		});

		if (autoFlipFacing) {
			this.scale.x = result.facing;
		}
		upperNode.container.rotation = result.upperLocalRotation;
		lowerNode.container.rotation = result.lowerLocalRotation;
		this.ikResults.set(constraintName, result);
		this.lastIKResult = result;
		return result;
	}

	private renderDebugOverlay(): void {
		drawDebugSkeletonOverlay(
			this.debugGraphics,
			this.boneNodes,
			(boneName) => this.getBoneLocalCharacterTransform(boneName),
			this.ikResults.values(),
			this.x,
			this.y,
			this.scale.y,
		);
	}
}
