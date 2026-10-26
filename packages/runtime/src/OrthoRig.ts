import {
	Assets,
	Container,
	Graphics,
	type Sprite,
	type Texture,
} from "pixi.js";
import { drawDebugSkeletonOverlay } from "./debugOverlay.js";
import { solveLookAtConstraint, solveTwoBoneChain } from "./ikSolver.js";
import {
	clamp,
	evaluateCubicBezier,
	interpolateTrack,
	normalizeAngle,
	parseHexColor,
	scaleOrthoRigSchema,
} from "./math.js";
import { createSlotAttachment } from "./slotBuilder.js";
import type {
	BoneWorldTransform,
	IKSolveResult,
	LookAtSolveResult,
	OrthoAnimationClip,
	OrthoAnimationEventListener,
	OrthoBoneNode,
	OrthoKeyframe,
	OrthoLayerPlayOptions,
	OrthoRigBundleLoadOptions,
	OrthoRigLoadedBundle,
	OrthoRigOptions,
	OrthoRigSchema,
	OrthoSocketNode,
	SocketWorldTransform,
} from "./types.js";

export type * from "./types.js";
export {
	clamp,
	evaluateCubicBezier,
	interpolateTrack,
	normalizeAngle,
	parseHexColor,
	scaleOrthoRigSchema,
};

interface AnimationLayerState {
	layerIndex: number;
	actionName: string;
	clip: OrthoAnimationClip;
	time: number;
	loop: boolean;
	playing: boolean;
	mode: "override" | "additive";
	weight: number;
	transitionDuration: number;
	transitionElapsed: number;
	fadeOutDuration: number;
	fadeOutElapsed: number;
	fadingOut: boolean;
	boneMask: Set<string> | null;
}

/**
 * Fetch a compiled `.orthorig.json` schema from `schemaUrl`, optionally scale its spatial geometry,
 * and automatically load its sibling `meta.atlasTexture` PNG via PixiJS `Assets.load`.
 */
export async function loadOrthoRigBundle(
	schemaUrl: string,
	options: OrthoRigBundleLoadOptions = {},
): Promise<OrthoRigLoadedBundle> {
	const fetchFn = options.fetch ?? globalThis.fetch;
	const res = await fetchFn(schemaUrl);
	if (!res.ok) {
		throw new Error(
			`[@crenet/orthorig] Failed to load schema from "${schemaUrl}" (HTTP ${res.status})`,
		);
	}
	const rawSchema = (await res.json()) as OrthoRigSchema;
	const schema =
		typeof options.scale === "number" && options.scale !== 1
			? scaleOrthoRigSchema(rawSchema, options.scale)
			: rawSchema;

	let atlasTexture: Texture | undefined;
	let atlasUrl: string | undefined;

	if (
		options.loadAtlas !== false &&
		(options.atlasUrl || schema.meta?.atlasTexture)
	) {
		const rawAtlasPath = options.atlasUrl ?? schema.meta.atlasTexture!;
		if (/^(https?:|data:|blob:|\/)/.test(rawAtlasPath)) {
			atlasUrl = rawAtlasPath;
		} else {
			const slashIdx = schemaUrl.lastIndexOf("/");
			const baseDir = slashIdx >= 0 ? schemaUrl.slice(0, slashIdx + 1) : "";
			atlasUrl = `${baseDir}${rawAtlasPath}`;
		}

		const loadTextureFn =
			options.loadTexture ?? ((url: string) => Assets.load<Texture>(url));
		try {
			atlasTexture = await loadTextureFn(atlasUrl);
		} catch (err) {
			if (options.strictAtlas) {
				throw err;
			}
			atlasTexture = undefined;
		}
	}

	return {
		schema,
		atlasTexture,
		atlasUrl,
	};
}

/**
 * Alias for `loadOrthoRigBundle`.
 */
export const loadOrthoRigAssets = loadOrthoRigBundle;

/**
 * `@crenet/orthorig` — 2D Orthographic Skeletal Animation & Analytic 2-Bone IK Runtime for PixiJS v8.
 */
export class OrthoRig extends Container {
	public readonly schema: OrthoRigSchema;
	public readonly boneNodes: Map<string, OrthoBoneNode> = new Map();
	public readonly bones: Map<string, Container> = new Map();
	public readonly socketNodes: Map<string, OrthoSocketNode> = new Map();
	public readonly sockets: Map<string, Container> = new Map();
	public readonly slots: Map<string, Graphics | Sprite> = new Map();

	/** Animation playback speed multiplier (`1.0` = normal speed, `0.0` = paused). */
	public animationSpeed: number = 1.0;

	private _facing: 1 | -1 = 1;
	private _debugDraw: boolean = false;
	private readonly debugGraphics: Graphics;
	private slotTextures?: Record<string, Texture>;
	private atlasTexture?: Texture;
	private preferAtlasSprites: boolean = false;

	private currentActionName: string | null = null;
	private currentClip: OrthoAnimationClip | null = null;
	private currentTime: number = 0;
	private isLooping: boolean = true;
	private isPlaying: boolean = false;

	// Cross-fade transition state on Base Layer (Layer 0)
	private transitionFromPose: Map<
		string,
		{ x: number; y: number; rotation: number }
	> | null = null;
	private transitionDuration: number = 0;
	private transitionElapsed: number = 0;

	// Secondary animation layers (Layer 1+) for additive kicks or masked upper-body actions
	private readonly layers: Map<number, AnimationLayerState> = new Map();

	// Timeline event listeners
	private readonly eventListeners: Set<OrthoAnimationEventListener> = new Set();

	// IK targets keyed by constraint target name (e.g. `"aim_cursor"`, `"foot_l_ground"`, etc.)
	private readonly ikTargetsWorld: Map<
		string,
		{ x: number; y: number; mix?: number; facingOverride?: 1 | -1 }
	> = new Map();
	private readonly constraintMixOverrides: Map<string, number> = new Map();
	private readonly ikResults: Map<string, IKSolveResult> = new Map();
	private readonly lookAtResults: Map<string, LookAtSolveResult> = new Map();
	private ikEnabled: boolean = true;
	private lastIKResult: IKSolveResult | null = null;

	constructor(schema: OrthoRigSchema, options: OrthoRigOptions = {}) {
		super();
		this.schema =
			typeof options.scale === "number" && options.scale !== 1
				? scaleOrthoRigSchema(schema, options.scale)
				: schema;
		this.label = "OrthoRig";
		this.sortableChildren = true;
		this.slotTextures = options.textures;
		this.atlasTexture = options.atlasTexture;
		this.preferAtlasSprites = options.preferAtlasSprites ?? false;

		this.buildBoneHierarchy();
		this.buildSocketHierarchy();
		this.buildSlotAttachments(
			this.slotTextures,
			this.atlasTexture,
			this.preferAtlasSprites,
		);

		this.debugGraphics = new Graphics();
		this.debugGraphics.label = "OrthoRig_DebugOverlay";
		this.debugGraphics.zIndex = 10_000;
		this.addChild(this.debugGraphics);

		this.debugDraw = options.debugDraw ?? false;

		const defaultAction =
			options.initialAnimation ??
			(this.schema.animations.Idle
				? "Idle"
				: Object.keys(this.schema.animations)[0]);
		if (defaultAction && this.schema.animations[defaultAction]) {
			this.play(defaultAction, 0);
		}
	}

	/**
	 * Static helper to load a `.orthorig.json` schema and its sibling `.atlas.png` texture.
	 */
	public static loadBundle(
		schemaUrl: string,
		options?: OrthoRigBundleLoadOptions,
	): Promise<OrthoRigLoadedBundle> {
		return loadOrthoRigBundle(schemaUrl, options);
	}

	/**
	 * Static helper to load a `.orthorig.json` bundle from `schemaUrl` and instantiate an `OrthoRig` in one call.
	 */
	public static async fromUrl(
		schemaUrl: string,
		options: OrthoRigOptions & OrthoRigBundleLoadOptions = {},
	): Promise<OrthoRig> {
		const bundle = await loadOrthoRigBundle(schemaUrl, options);
		const resolvedAtlas = options.atlasTexture ?? bundle.atlasTexture;
		return new OrthoRig(bundle.schema, {
			...options,
			scale: undefined,
			atlasTexture: resolvedAtlas,
			preferAtlasSprites: options.preferAtlasSprites ?? Boolean(resolvedAtlas),
		});
	}

	/**
	 * Alias for `OrthoRig.fromUrl`.
	 */
	public static load(
		schemaUrl: string,
		options?: OrthoRigOptions & OrthoRigBundleLoadOptions,
	): Promise<OrthoRig> {
		return OrthoRig.fromUrl(schemaUrl, options);
	}

	/**
	 * Current horizontal facing (`1` = right, `-1` = left), independent of `|this.scale.x|`.
	 * Setting `rig.facing` flips `this.scale.x`'s sign while preserving `Math.abs(this.scale.x)`.
	 */
	public get facing(): 1 | -1 {
		if (Math.abs(this.scale.x) > 1e-9) {
			return this.scale.x < 0 ? -1 : 1;
		}
		return this._facing;
	}

	public set facing(dir: 1 | -1) {
		const sign: 1 | -1 = dir < 0 ? -1 : 1;
		this._facing = sign;
		const absScaleX = Math.abs(this.scale.x) || 1;
		this.scale.x = sign * absScaleX;
	}

	/**
	 * Toggle real-time bone vectors, pivot joints, sockets, and IK target overlay.
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
	 * Method alias for toggling the real-time skeleton debug overlay.
	 */
	public setDebugDraw(enabled: boolean): void {
		this.debugDraw = enabled;
	}

	/**
	 * Currently playing base-layer animation action name (`"Idle"`, `"Run"`, `"Jump"`, `"WallSlide"`).
	 */
	public get activeAction(): string | null {
		return this.currentActionName;
	}

	/**
	 * Current base-layer animation playback time in seconds.
	 */
	public get playbackTime(): number {
		return this.currentTime;
	}

	/**
	 * Most recent primary 2-Bone IK solution computed on this tick.
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

	private buildSocketHierarchy(): void {
		if (!this.schema.sockets) return;
		for (const spec of this.schema.sockets) {
			const boneNode = this.boneNodes.get(spec.bone);
			if (!boneNode) continue;

			const c = new Container();
			c.label = `Socket_${spec.name}`;
			c.position.set(spec.x, spec.y);
			c.rotation = spec.rotation;
			c.zIndex = 500;
			boneNode.container.addChild(c);

			this.socketNodes.set(spec.name, { spec, container: c });
			this.sockets.set(spec.name, c);
		}
	}

	private buildSlotAttachments(
		textures?: Record<string, Texture>,
		atlasTexture?: Texture,
		preferAtlasSprites: boolean = false,
	): void {
		for (const existing of this.slots.values()) {
			existing.parent?.removeChild(existing);
			existing.destroy();
		}
		this.slots.clear();

		const sortedSlots = [...this.schema.slots].sort(
			(a, b) => a.zIndex - b.zIndex,
		);

		for (const slot of sortedSlots) {
			const boneNode = this.boneNodes.get(slot.bone);
			if (!boneNode) continue;

			const displayObj = createSlotAttachment(
				slot,
				textures,
				atlasTexture,
				preferAtlasSprites,
			);
			boneNode.container.addChild(displayObj);
			this.slots.set(slot.name, displayObj);
		}
	}

	/**
	 * Switch between procedural vector cutouts (`preferAtlasSprites = false`) and
	 * baked PNG spritesheet slots (`preferAtlasSprites = true`) at runtime.
	 */
	public setAtlasMode(
		preferAtlasSprites: boolean,
		atlasTexture?: Texture,
	): void {
		if (atlasTexture) {
			this.atlasTexture = atlasTexture;
		}
		this.preferAtlasSprites = preferAtlasSprites;
		this.buildSlotAttachments(
			this.slotTextures,
			this.atlasTexture,
			this.preferAtlasSprites,
		);
	}

	/**
	 * Retrieve a named socket container (`"muzzle"`, `"offhand_grip"`, `"head_top"`, etc.).
	 */
	public getSocket(socketName: string): Container | undefined {
		return this.sockets.get(socketName);
	}

	/**
	 * Attach a child `PIXI.Container` (weapon rig, muzzle flash, particle emitter, light) to a named socket.
	 */
	public attachToSocket(socketName: string, child: Container): Container {
		const socket = this.sockets.get(socketName);
		if (!socket) {
			throw new Error(`[@crenet/orthorig] Unknown socket "${socketName}"`);
		}
		socket.addChild(child);
		return child;
	}

	/**
	 * Detach a specific child (or all children when `child` is omitted) from a named socket.
	 */
	public detachFromSocket(socketName: string, child?: Container): void {
		const socket = this.sockets.get(socketName);
		if (!socket) return;
		if (child) {
			if (child.parent === socket) {
				socket.removeChild(child);
			}
		} else {
			socket.removeChildren();
		}
	}

	/**
	 * Compute a named socket's position and rotation in unscaled root character space.
	 */
	public getSocketLocalCharacterTransform(socketName: string): {
		x: number;
		y: number;
		rotation: number;
	} {
		const socketNode = this.socketNodes.get(socketName);
		if (!socketNode) {
			throw new Error(`[@crenet/orthorig] Unknown socket "${socketName}"`);
		}
		const boneTf = this.getBoneLocalCharacterTransform(socketNode.spec.bone);
		const cosR = Math.cos(boneTf.rotation);
		const sinR = Math.sin(boneTf.rotation);
		const x = boneTf.x + socketNode.spec.x * cosR - socketNode.spec.y * sinR;
		const y = boneTf.y + socketNode.spec.x * sinR + socketNode.spec.y * cosR;
		const rotation = normalizeAngle(boneTf.rotation + socketNode.spec.rotation);
		return { x, y, rotation };
	}

	/**
	 * Transform a point from this rig's unscaled local character space through the PixiJS scene graph
	 * up to `relativeTo` (or up to the root stage/world space when `relativeTo` is omitted).
	 */
	private transformLocalPointToSpace(
		localX: number,
		localY: number,
		relativeTo?: Container,
	): { x: number; y: number } {
		let x = localX;
		let y = localY;
		let curr: Container | null = this;

		while (curr && curr !== relativeTo) {
			const sx = curr.scale?.x ?? 1;
			const sy = curr.scale?.y ?? 1;
			const rot = curr.rotation ?? 0;
			const cosR = Math.cos(rot);
			const sinR = Math.sin(rot);
			const scaledX = x * sx;
			const scaledY = y * sy;
			x = (curr.x ?? 0) + scaledX * cosR - scaledY * sinR;
			y = (curr.y ?? 0) + scaledX * sinR + scaledY * cosR;
			curr = curr.parent ?? null;
		}

		// If relativeTo was specified and is not a direct ancestor of this rig, transform from global space down into relativeTo
		if (relativeTo && curr !== relativeTo) {
			const targetChain: Container[] = [];
			let node: Container | null = relativeTo;
			while (node) {
				targetChain.push(node);
				node = node.parent ?? null;
			}
			targetChain.reverse();
			for (const ancestor of targetChain) {
				const dx = x - (ancestor.x ?? 0);
				const dy = y - (ancestor.y ?? 0);
				const rot = ancestor.rotation ?? 0;
				const cosR = Math.cos(-rot);
				const sinR = Math.sin(-rot);
				const rx = dx * cosR - dy * sinR;
				const ry = dx * sinR + dy * cosR;
				const sx = ancestor.scale?.x || 1;
				const sy = ancestor.scale?.y || 1;
				x = rx / sx;
				y = ry / sy;
			}
		}

		return { x, y };
	}

	/**
	 * Compute a named socket's world/stage transform (or transform in `relativeTo` container space),
	 * including `x`, `y`, `rotation`, unit direction `dirX`/`dirY`, and `scaleX`.
	 */
	public getSocketWorldTransform(
		socketName: string,
		relativeTo?: Container,
	): SocketWorldTransform {
		const localTf = this.getSocketLocalCharacterTransform(socketName);
		const origin = this.transformLocalPointToSpace(
			localTf.x,
			localTf.y,
			relativeTo,
		);
		const tip = this.transformLocalPointToSpace(
			localTf.x + Math.cos(localTf.rotation),
			localTf.y + Math.sin(localTf.rotation),
			relativeTo,
		);

		const dirX = tip.x - origin.x;
		const dirY = tip.y - origin.y;
		const len = Math.hypot(dirX, dirY) || 1;
		const ndx = dirX / len;
		const ndy = dirY / len;
		const rotation = Math.atan2(ndy, ndx);

		return {
			x: origin.x,
			y: origin.y,
			rotation,
			dirX: ndx,
			dirY: ndy,
			scaleX: this.facing,
		};
	}

	/**
	 * Subscribe to timeline animation events (e.g. `"footstep_l"`, `"footstep_r"`, `"jump_launch"`).
	 * Returns an unsubscribe callback.
	 */
	public onAnimationEvent(listener: OrthoAnimationEventListener): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	private dispatchTimelineEvents(
		actionName: string,
		clip: OrthoAnimationClip,
		layerIndex: number,
		prevTime: number,
		nextTime: number,
		wrapped: boolean,
	): void {
		if (
			this.eventListeners.size === 0 ||
			!clip.events ||
			clip.events.length === 0
		) {
			return;
		}

		for (const ev of clip.events) {
			const hit = wrapped
				? (ev.time > prevTime && ev.time <= clip.duration) ||
					(ev.time >= 0 && ev.time <= nextTime)
				: ev.time > prevTime && ev.time <= nextTime;
			if (hit) {
				for (const listener of this.eventListeners) {
					listener({
						name: ev.name,
						time: ev.time,
						action: actionName,
						layer: layerIndex,
					});
				}
			}
		}
	}

	/**
	 * Play an animation clip on the base locomotion layer (Layer 0) with optional cross-fade duration.
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
		this.applySecondaryLayers(0);
		this.solveAllIKConstraints();
		if (this._debugDraw) {
			this.renderDebugOverlay();
		}
	}

	/**
	 * Play an animation clip on a secondary overlay or additive layer (`layerIndex >= 1`).
	 *
	 * Layer `0` delegates directly to `this.play(...)`.
	 */
	public playLayer(
		layerIndex: number,
		actionName: string,
		options: OrthoLayerPlayOptions = {},
	): void {
		if (layerIndex <= 0) {
			this.play(
				actionName,
				options.transitionDuration ?? 0.12,
				options.forceRestart ?? false,
			);
			return;
		}

		const clip = this.schema.animations[actionName];
		if (!clip) {
			throw new Error(
				`[@crenet/orthorig] Unknown action "${actionName}". Available: ${Object.keys(
					this.schema.animations,
				).join(", ")}`,
			);
		}

		const existing = this.layers.get(layerIndex);
		const loop = options.loop ?? clip.loop;
		const forceRestart = options.forceRestart ?? !loop;
		if (
			existing &&
			existing.actionName === actionName &&
			existing.playing &&
			!existing.fadingOut &&
			!forceRestart
		) {
			return;
		}

		const transitionDuration = Math.max(0, options.transitionDuration ?? 0.04);
		this.layers.set(layerIndex, {
			layerIndex,
			actionName,
			clip,
			time: 0,
			loop,
			playing: true,
			mode: options.mode ?? "additive",
			weight: clamp(options.weight ?? 1.0, 0, 1),
			transitionDuration,
			transitionElapsed: 0,
			fadeOutDuration: 0,
			fadeOutElapsed: 0,
			fadingOut: false,
			boneMask: options.boneMask ? new Set(options.boneMask) : null,
		});
	}

	/**
	 * Stop a secondary animation layer (`layerIndex >= 1`) with optional fade-out duration.
	 */
	public stopLayer(layerIndex: number, fadeOutDuration: number = 0): void {
		const layer = this.layers.get(layerIndex);
		if (!layer) return;
		if (fadeOutDuration <= 0) {
			this.layers.delete(layerIndex);
			return;
		}
		layer.fadingOut = true;
		layer.fadeOutDuration = fadeOutDuration;
		layer.fadeOutElapsed = 0;
	}

	/**
	 * Set the world/parent target coordinates (and optional FK-to-IK `mix` in `[0, 1]`) for an IK target name.
	 */
	public setIKTarget(
		worldX: number,
		worldY: number,
		targetName: string = "aim_cursor",
		mix?: number,
	): void {
		const prev = this.ikTargetsWorld.get(targetName);
		this.ikTargetsWorld.set(targetName, {
			x: worldX,
			y: worldY,
			mix: typeof mix === "number" ? clamp(mix, 0, 1) : prev?.mix,
			facingOverride: undefined,
		});
	}

	/**
	 * Project an IK target ray from the constraint's root bone (e.g. shoulder `upper_arm_r`) along `angleRadians`
	 * with a `1e-4` vertical deadzone on `Math.cos(angleRadians)` so aiming straight up/down (`±PI/2`)
	 * preserves `fallbackFacing` (or current `this.facing`) without floating-point sign jitter.
	 */
	public setIKTargetAngle(
		angleRadians: number,
		targetName: string = "aim_cursor",
		distance: number = 1000,
		fallbackFacing?: 1 | -1,
		mix?: number,
	): { x: number; y: number } {
		const cosA = Math.cos(angleRadians);
		const sinA = Math.sin(angleRadians);
		const constraint =
			this.schema.ik_constraints.find((c) => c.target === targetName) ??
			this.schema.ik_constraints[0];
		const autoFlip = constraint?.autoFlipFacing ?? true;

		let effectiveFacing: 1 | -1 = this.facing;
		if (autoFlip) {
			if (Math.abs(cosA) <= 1e-4) {
				if (fallbackFacing === 1 || fallbackFacing === -1) {
					effectiveFacing = fallbackFacing;
				}
			} else {
				effectiveFacing = cosA < 0 ? -1 : 1;
			}
			this.facing = effectiveFacing;
		}

		const upperBoneName = constraint?.chain[0] ?? "upper_arm_r";
		const rootLocal = this.boneNodes.has(upperBoneName)
			? this.getBoneLocalCharacterTransform(upperBoneName)
			: { x: 0, y: 0 };

		const rootParentX = this.x + rootLocal.x * this.scale.x;
		const rootParentY = this.y + rootLocal.y * this.scale.y;
		const dirX = Math.abs(cosA) <= 1e-4 ? 0 : cosA;
		const targetX = rootParentX + dirX * distance;
		const targetY = rootParentY + sinA * distance;

		const prev = this.ikTargetsWorld.get(targetName);
		this.ikTargetsWorld.set(targetName, {
			x: targetX,
			y: targetY,
			mix: typeof mix === "number" ? clamp(mix, 0, 1) : prev?.mix,
			facingOverride: effectiveFacing,
		});

		return { x: targetX, y: targetY };
	}

	/**
	 * Convenience helper to set the primary `"aim_cursor"` IK direction from an angle in radians.
	 */
	public setAimDirection(
		angleRadians: number,
		fallbackFacing?: 1 | -1,
		distance: number = 1000,
	): { x: number; y: number } {
		return this.setIKTargetAngle(
			angleRadians,
			"aim_cursor",
			distance,
			fallbackFacing,
		);
	}

	/**
	 * Advance animations and solve 360° Analytic 2-Bone IK + 1-Bone Look-At toward an `aimAngleRadians`
	 * ray (with automatic `1e-4` vertical deadzone and `fallbackFacing` preservation) in a single call.
	 */
	public updateWithAimAngle(
		deltaSeconds: number,
		aimAngleRadians: number,
		fallbackFacing?: 1 | -1,
		distance: number = 1000,
	): void {
		this.setAimDirection(aimAngleRadians, fallbackFacing, distance);
		this.update(deltaSeconds);
	}

	/**
	 * Clear an explicit world-space IK target override (allowing `targetSocket` constraints to resume socket tracking).
	 */
	public clearIKTarget(targetName: string): void {
		this.ikTargetsWorld.delete(targetName);
	}

	/**
	 * Set the FK-to-IK or FK-to-LookAt blend weight (`mix` in `[0, 1]`) for a specific constraint by name.
	 */
	public setConstraintMix(constraintName: string, mix: number): void {
		this.constraintMixOverrides.set(constraintName, clamp(mix, 0, 1));
	}

	/**
	 * Get the active `mix` weight (`[0, 1]`) for a named constraint.
	 */
	public getConstraintMix(constraintName: string): number {
		const override = this.constraintMixOverrides.get(constraintName);
		if (typeof override === "number") return override;
		const ikSpec = this.schema.ik_constraints.find(
			(c) => c.name === constraintName,
		);
		if (ikSpec) return ikSpec.mix ?? 1.0;
		const lookSpec = this.schema.look_at_constraints?.find(
			(c) => c.name === constraintName,
		);
		return lookSpec?.mix ?? 1.0;
	}

	/**
	 * Retrieve the most recent 2-Bone IK result for a specific constraint name.
	 */
	public getIKResult(constraintName: string): IKSolveResult | undefined {
		return this.ikResults.get(constraintName);
	}

	/**
	 * Retrieve the most recent 1-Bone Look-At result for a specific constraint name.
	 */
	public getLookAtResult(
		constraintName: string,
	): LookAtSolveResult | undefined {
		return this.lookAtResults.get(constraintName);
	}

	/**
	 * Enable or disable IK constraint evaluation.
	 */
	public setIKEnabled(enabled: boolean): void {
		this.ikEnabled = enabled;
	}

	/**
	 * Advance animation tracks, evaluate layered/additive blends, fire timeline events,
	 * execute the Analytic 2-Bone IK & 1-Bone Look-At solvers, and refresh the debug overlay.
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
			const prev = this.ikTargetsWorld.get(defaultTargetName);
			this.ikTargetsWorld.set(defaultTargetName, {
				x: primaryTargetWorldX,
				y: primaryTargetWorldY,
				mix: prev?.mix,
				facingOverride: undefined,
			});
		}

		const clampedDt = Math.max(0, deltaSeconds);
		const scaledDt = clampedDt * Math.max(0, this.animationSpeed);

		// 1. Advance & sample Base Layer (Layer 0) animation track
		if (this.isPlaying && this.currentClip && this.currentActionName) {
			const duration = this.currentClip.duration;
			const prevTime = this.currentTime;
			let wrapped = false;

			if (duration > 0) {
				this.currentTime += scaledDt;
				if (this.currentTime >= duration) {
					if (this.isLooping) {
						this.currentTime %= duration;
						wrapped = true;
					} else {
						this.currentTime = duration;
						this.isPlaying = false;
					}
				}
			}

			let blendWeight = 1.0;
			if (this.transitionFromPose && this.transitionDuration > 0) {
				this.transitionElapsed += clampedDt;
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
			if (scaledDt > 0) {
				this.dispatchTimelineEvents(
					this.currentActionName,
					this.currentClip,
					0,
					prevTime,
					this.currentTime,
					wrapped,
				);
			}
		}

		// 2. Advance & blend Secondary Animation Layers (Layer 1+)
		this.applySecondaryLayers(scaledDt, clampedDt);

		// 3. Execute Analytic 2-Bone IK & 1-Bone Look-At Solvers AFTER animation layers
		if (this.ikEnabled) {
			this.solveAllIKConstraints();
		}

		// 4. Render real-time debug overlay if enabled
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

	private applySecondaryLayers(
		scaledDt: number,
		unscaledDt: number = scaledDt,
	): void {
		if (this.layers.size === 0) return;

		const sortedLayerIndices = [...this.layers.keys()].sort((a, b) => a - b);
		for (const idx of sortedLayerIndices) {
			const layer = this.layers.get(idx);
			if (!layer) continue;

			const prevTime = layer.time;
			let wrapped = false;
			if (layer.playing && layer.clip.duration > 0) {
				layer.time += scaledDt;
				if (layer.time >= layer.clip.duration) {
					if (layer.loop) {
						layer.time %= layer.clip.duration;
						wrapped = true;
					} else {
						layer.time = layer.clip.duration;
						layer.playing = false;
					}
				}
			}

			let fadeIn = 1.0;
			if (layer.transitionDuration > 0) {
				layer.transitionElapsed += unscaledDt;
				fadeIn = clamp(
					layer.transitionElapsed / layer.transitionDuration,
					0,
					1,
				);
			}

			let fadeOut = 1.0;
			if (layer.fadingOut) {
				layer.fadeOutElapsed += unscaledDt;
				fadeOut =
					layer.fadeOutDuration > 0
						? clamp(1.0 - layer.fadeOutElapsed / layer.fadeOutDuration, 0, 1)
						: 0;
				if (fadeOut <= 0) {
					this.layers.delete(idx);
					continue;
				}
			}

			const effectiveWeight = layer.weight * fadeIn * fadeOut;
			if (effectiveWeight > 0) {
				for (const [boneName, keyframes] of Object.entries(layer.clip.tracks)) {
					if (layer.boneMask && !layer.boneMask.has(boneName)) continue;
					const node = this.boneNodes.get(boneName);
					if (!node || !keyframes || keyframes.length === 0) continue;

					const sampled = interpolateTrack(keyframes, layer.time);
					if (layer.mode === "additive") {
						const ref0 = interpolateTrack(keyframes, 0);
						const dx = sampled.x - ref0.x;
						const dy = sampled.y - ref0.y;
						const dRot = normalizeAngle(sampled.rotation - ref0.rotation);
						node.container.position.set(
							node.container.x + dx * effectiveWeight,
							node.container.y + dy * effectiveWeight,
						);
						node.container.rotation = normalizeAngle(
							node.container.rotation + dRot * effectiveWeight,
						);
					} else {
						const x =
							node.container.x +
							(sampled.x - node.container.x) * effectiveWeight;
						const y =
							node.container.y +
							(sampled.y - node.container.y) * effectiveWeight;
						const dRot = normalizeAngle(
							sampled.rotation - node.container.rotation,
						);
						node.container.position.set(x, y);
						node.container.rotation = normalizeAngle(
							node.container.rotation + dRot * effectiveWeight,
						);
					}
				}
			}

			if (scaledDt > 0) {
				this.dispatchTimelineEvents(
					layer.actionName,
					layer.clip,
					idx,
					prevTime,
					layer.time,
					wrapped,
				);
			}

			if (!layer.playing && !layer.loop && !layer.fadingOut) {
				this.layers.delete(idx);
			}
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
	 * Compute a bone's world/stage transform (or transform in `relativeTo` container space),
	 * including head position, tip position, world angle, and unit direction.
	 */
	public getBoneWorldTransform(
		boneName: string,
		relativeTo?: Container,
	): BoneWorldTransform {
		const node = this.boneNodes.get(boneName);
		if (!node) {
			throw new Error(`[@crenet/orthorig] Unknown bone "${boneName}"`);
		}
		const localTf = this.getBoneLocalCharacterTransform(boneName);
		const localTipX = localTf.x + node.spec.length * Math.cos(localTf.rotation);
		const localTipY = localTf.y + node.spec.length * Math.sin(localTf.rotation);

		const head = this.transformLocalPointToSpace(
			localTf.x,
			localTf.y,
			relativeTo,
		);
		const tip = this.transformLocalPointToSpace(
			localTipX,
			localTipY,
			relativeTo,
		);

		const dx = tip.x - head.x;
		const dy = tip.y - head.y;
		const len = Math.hypot(dx, dy) || 1;
		const rotation = Math.atan2(dy, dx);

		return {
			x: head.x,
			y: head.y,
			rotation,
			tipX: tip.x,
			tipY: tip.y,
			dirX: dx / len,
			dirY: dy / len,
		};
	}

	private solveAllIKConstraints(): void {
		for (const constraint of this.schema.ik_constraints) {
			const explicitTarget = this.ikTargetsWorld.get(constraint.target);
			let targetX: number | undefined = explicitTarget?.x;
			let targetY: number | undefined = explicitTarget?.y;

			if (
				(typeof targetX !== "number" || typeof targetY !== "number") &&
				constraint.targetSocket &&
				this.socketNodes.has(constraint.targetSocket)
			) {
				// Evaluate targetSocket in this.parent space so it matches this.x / this.y
				const socketParentTf = this.getSocketWorldTransform(
					constraint.targetSocket,
					this.parent ?? undefined,
				);
				targetX = socketParentTf.x;
				targetY = socketParentTf.y;
			}

			if (typeof targetX !== "number" || typeof targetY !== "number") {
				continue;
			}

			const mix =
				this.constraintMixOverrides.get(constraint.name) ??
				explicitTarget?.mix ??
				constraint.mix ??
				1.0;

			if (mix <= 0) {
				this.ikResults.delete(constraint.name);
				continue;
			}

			if (
				(constraint.autoFlipFacing ?? true) &&
				explicitTarget?.facingOverride
			) {
				this.facing = explicitTarget.facingOverride;
			}

			this.solveTwoBoneIK(
				targetX,
				targetY,
				constraint.chain[0],
				constraint.chain[1],
				constraint.bendDirection,
				constraint.name,
				explicitTarget?.facingOverride
					? false
					: (constraint.autoFlipFacing ?? true),
				mix,
			);
		}

		const primaryName = this.schema.ik_constraints[0]?.name;
		if (primaryName && this.ikResults.has(primaryName)) {
			this.lastIKResult = this.ikResults.get(primaryName) ?? null;
		}

		if (this.schema.look_at_constraints) {
			for (const lookSpec of this.schema.look_at_constraints) {
				const target = this.ikTargetsWorld.get(lookSpec.target);
				if (!target) continue;

				const mix =
					this.constraintMixOverrides.get(lookSpec.name) ??
					target.mix ??
					lookSpec.mix ??
					1.0;
				if (mix <= 0) {
					this.lookAtResults.delete(lookSpec.name);
					continue;
				}

				const boneNode = this.boneNodes.get(lookSpec.bone);
				if (!boneNode) continue;

				const boneTf = this.getBoneLocalCharacterTransform(lookSpec.bone);
				const currentFacing: 1 | -1 = this.facing;
				const lookResult = solveLookAtConstraint({
					constraintName: lookSpec.name,
					boneName: lookSpec.bone,
					boneLocalX: boneTf.x,
					boneLocalY: boneTf.y,
					parentRotation: boneTf.parentRotation,
					restRotation: boneNode.spec.restRotation,
					fkLocalRotation: boneNode.container.rotation,
					rigWorldX: this.x,
					rigWorldY: this.y,
					rigScaleX: Math.abs(this.scale.x) || 1,
					rigScaleY: this.scale.y,
					currentFacing,
					targetWorldX: target.x,
					targetWorldY: target.y,
					mix,
					minAngle: lookSpec.minAngle,
					maxAngle: lookSpec.maxAngle,
				});
				boneNode.container.rotation = lookResult.localRotation;
				this.lookAtResults.set(lookSpec.name, lookResult);
			}
		}
	}

	/**
	 * Deterministic $O(1)$ Analytic 2-Bone IK Solver using the Law of Cosines.
	 *
	 * Solves any 2-bone chain (`[upperBoneName, lowerBoneName]`) toward `(targetWorldX, targetWorldY)`.
	 * Set `autoFlipFacing = false` for non-aim chains (such as foot/terrain IK or off-hand grips)
	 * that should preserve the character's current horizontal facing.
	 */
	public solveTwoBoneIK(
		targetWorldX: number,
		targetWorldY: number,
		upperBoneName: string = "upper_arm_r",
		lowerBoneName: string = "forearm_r",
		bendDirection: 1 | -1 = 1,
		constraintName: string = "right_arm_aim",
		autoFlipFacing: boolean = true,
		mix: number = 1.0,
	): IKSolveResult {
		const upperNode = this.boneNodes.get(upperBoneName);
		const lowerNode = this.boneNodes.get(lowerBoneName);
		if (!upperNode || !lowerNode) {
			throw new Error(
				`[@crenet/orthorig] IK bones "${upperBoneName}" and/or "${lowerBoneName}" not found.`,
			);
		}

		const currentFacing: 1 | -1 = this.facing;
		const absScaleX = Math.abs(this.scale.x) || 1;
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
			rigScaleX: absScaleX,
			rigScaleY: this.scale.y,
			targetWorldX,
			targetWorldY,
			bendDirection,
			autoFlipFacing,
			currentFacing,
			mix,
			fkUpperLocalRotation: upperNode.container.rotation,
			fkLowerLocalRotation: lowerNode.container.rotation,
		});

		if (autoFlipFacing) {
			this.facing = result.facing;
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
			this.socketNodes,
			Math.abs(this.scale.x) || 1,
		);
	}
}
