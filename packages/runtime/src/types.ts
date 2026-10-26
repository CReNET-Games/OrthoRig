import type { Container, Texture } from "pixi.js";

export interface OrthoRigMeta {
	version: string;
	sourceFile: string;
	fps: number;
	coordinateSystem: "pixi-y-down";
	atlasTexture?: string;
}

export interface OrthoBoneSpec {
	name: string;
	parent: string | null;
	length: number;
	restX: number;
	restY: number;
	restRotation: number;
	zIndex: number;
}

export interface OrthoSocketSpec {
	name: string;
	bone: string;
	x: number;
	y: number;
	rotation: number;
}

export interface OrthoAtlasRegion {
	texture?: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface OrthoSlotSpec {
	name: string;
	bone: string;
	shapeType: "rect" | "polygon" | "sprite";
	width: number;
	height: number;
	colorHex: string;
	strokeColorHex?: string;
	offsetX: number;
	offsetY: number;
	rotation?: number;
	zIndex: number;
	points?: number[];
	atlasRegion?: OrthoAtlasRegion;
}

export interface OrthoIKConstraintSpec {
	name: string;
	chain: [string, string];
	target: string;
	/** Optional named socket whose world position acts as the default target when no explicit world target is set. */
	targetSocket?: string;
	bendDirection: 1 | -1;
	/** Whether this IK chain automatically flips the rig's horizontal facing (`scale.x = ±|scale.x|`) when the target crosses X=0 (defaults to `true`). */
	autoFlipFacing?: boolean;
	/** FK-to-IK blend weight in `[0, 1]` (`1.0` = full IK, `0.0` = pure FK animation). Defaults to `1.0`. */
	mix?: number;
}

export interface OrthoLookAtConstraintSpec {
	name: string;
	bone: string;
	target: string;
	/** FK-to-LookAt blend weight in `[0, 1]` (defaults to `1.0`). */
	mix?: number;
	/** Minimum local rotation offset from rest pose in radians. */
	minAngle?: number;
	/** Maximum local rotation offset from rest pose in radians. */
	maxAngle?: number;
}

export interface OrthoKeyframe {
	time: number;
	x: number;
	y: number;
	rotation: number;
	easing?: "linear" | "cubic-bezier";
	bezier?: [number, number, number, number];
}

export interface OrthoTimelineEventSpec {
	name: string;
	time: number;
}

export interface OrthoAnimationClip {
	duration: number;
	loop: boolean;
	events?: OrthoTimelineEventSpec[];
	tracks: Record<string, OrthoKeyframe[]>;
}

export interface OrthoRigSchema {
	meta: OrthoRigMeta;
	bones: OrthoBoneSpec[];
	sockets?: OrthoSocketSpec[];
	slots: OrthoSlotSpec[];
	ik_constraints: OrthoIKConstraintSpec[];
	look_at_constraints?: OrthoLookAtConstraintSpec[];
	animations: Record<string, OrthoAnimationClip>;
}

export interface OrthoBoneNode {
	spec: OrthoBoneSpec;
	container: Container;
}

export interface OrthoSocketNode {
	spec: OrthoSocketSpec;
	container: Container;
}

export interface IKSolveResult {
	constraintName: string;
	upperBone: string;
	lowerBone: string;
	upperWorldAngle: number;
	upperLocalRotation: number;
	lowerLocalRotation: number;
	/** Chain root joint (e.g. shoulder or hip) in local character space. */
	rootLocal: { x: number; y: number };
	/** Chain middle joint (e.g. elbow or knee) in local character space. */
	midLocal: { x: number; y: number };
	/** Chain end-effector tip (e.g. wrist or ankle) in local character space. */
	endLocal: { x: number; y: number };
	/** Chain root joint in parent/world space. */
	rootWorld: { x: number; y: number };
	/** Chain middle joint in parent/world space. */
	midWorld: { x: number; y: number };
	/** Chain end-effector tip in parent/world space. */
	endWorld: { x: number; y: number };
	/** Alias for `rootLocal` (shoulder/hip). */
	shoulderLocal: { x: number; y: number };
	/** Alias for `midLocal` (elbow/knee). */
	elbowLocal: { x: number; y: number };
	/** Alias for `endLocal` (wrist/ankle). */
	wristLocal: { x: number; y: number };
	/** Alias for `rootWorld` (shoulder/hip). */
	shoulderWorld: { x: number; y: number };
	/** Alias for `midWorld` (elbow/knee). */
	elbowWorld: { x: number; y: number };
	/** Alias for `endWorld` (wrist/ankle). */
	wristWorld: { x: number; y: number };
	targetWorld: { x: number; y: number };
	aimWorldAngle: number;
	facing: 1 | -1;
	effectiveBendDirection: 1 | -1;
	mix: number;
}

export interface LookAtSolveResult {
	constraintName: string;
	bone: string;
	localRotation: number;
	worldAngle: number;
	mix: number;
}

export interface BoneWorldTransform {
	x: number;
	y: number;
	rotation: number;
	tipX: number;
	tipY: number;
	dirX: number;
	dirY: number;
}

export interface SocketWorldTransform {
	x: number;
	y: number;
	rotation: number;
	dirX: number;
	dirY: number;
	scaleX: 1 | -1;
}

export interface OrthoAnimationEvent {
	name: string;
	time: number;
	action: string;
	layer: number;
}

export type OrthoAnimationEventListener = (event: OrthoAnimationEvent) => void;

export interface OrthoLayerPlayOptions {
	/** Blend mode: `"override"` interpolates toward the layer pose; `"additive"` adds delta from frame 0 of the clip. Defaults to `"additive"` for layers > 0. */
	mode?: "override" | "additive";
	/** Layer blend weight in `[0, 1]` (default `1.0`). */
	weight?: number;
	/** Fade-in transition duration in seconds (default `0.06`). */
	transitionDuration?: number;
	/** Override clip loop flag. */
	loop?: boolean;
	/** Optional subset of bone names affected by this layer. */
	boneMask?: string[];
	/** Restart from `t = 0` if already playing on this layer (default `true` for non-looping clips). */
	forceRestart?: boolean;
}

export interface OrthoRigOptions {
	/** Optional uniform scale factor applied to the schema geometry (`bones`, `sockets`, `slots`, `animations`) on construction. */
	scale?: number;
	/** Optional dictionary of loaded textures or shared atlas texture for `"sprite"` slots. */
	textures?: Record<string, Texture>;
	/** Optional shared atlas texture used when `slot.atlasRegion` is present. */
	atlasTexture?: Texture;
	/** Force all slots that have an `atlasRegion` to render as `PIXI.Sprite` when `atlasTexture` is supplied (default `false`). */
	preferAtlasSprites?: boolean;
	/** Initial animation clip name to play on construction (defaults to `"Idle"` if present). */
	initialAnimation?: string;
	/** Whether to render the real-time neon green/magenta skeleton & IK debug overlay. */
	debugDraw?: boolean;
}

export interface OrthoRigBundleLoadOptions {
	/** Optional uniform scale factor applied to the loaded schema via `scaleOrthoRigSchema`. */
	scale?: number;
	/** Whether to automatically load `schema.meta.atlasTexture` via PixiJS `Assets.load` (default `true`). */
	loadAtlas?: boolean;
	/** Optional explicit URL override for the atlas texture. */
	atlasUrl?: string;
	/** If `true`, rethrows errors when loading `meta.atlasTexture` fails instead of falling back to `undefined` (default `false`). */
	strictAtlas?: boolean;
	/** Custom `fetch` implementation (defaults to `globalThis.fetch`). */
	fetch?: typeof globalThis.fetch;
	/** Custom texture loader implementation (defaults to `(url) => Assets.load<Texture>(url)`). */
	loadTexture?: (url: string) => Promise<Texture>;
}

export interface OrthoRigLoadedBundle {
	schema: OrthoRigSchema;
	atlasTexture?: Texture;
	atlasUrl?: string;
}
