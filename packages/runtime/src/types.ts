import type { Container, Texture } from "pixi.js";

export interface OrthoRigMeta {
	version: string;
	sourceFile: string;
	fps: number;
	coordinateSystem: "pixi-y-down";
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
	bendDirection: 1 | -1;
	/** Whether this IK chain automatically flips the rig's horizontal facing (`scale.x = 1 | -1`) when the target crosses X=0 (defaults to `true`). */
	autoFlipFacing?: boolean;
}

export interface OrthoKeyframe {
	time: number;
	x: number;
	y: number;
	rotation: number;
	easing?: "linear" | "cubic-bezier";
	bezier?: [number, number, number, number];
}

export interface OrthoAnimationClip {
	duration: number;
	loop: boolean;
	tracks: Record<string, OrthoKeyframe[]>;
}

export interface OrthoRigSchema {
	meta: OrthoRigMeta;
	bones: OrthoBoneSpec[];
	slots: OrthoSlotSpec[];
	ik_constraints: OrthoIKConstraintSpec[];
	animations: Record<string, OrthoAnimationClip>;
}

export interface OrthoBoneNode {
	spec: OrthoBoneSpec;
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
	/** Chain root joint in world/stage space. */
	rootWorld: { x: number; y: number };
	/** Chain middle joint in world/stage space. */
	midWorld: { x: number; y: number };
	/** Chain end-effector tip in world/stage space. */
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

export interface OrthoRigOptions {
	/** Optional dictionary of loaded textures or shared atlas texture for `"sprite"` slots. */
	textures?: Record<string, Texture>;
	/** Optional shared atlas texture used when `slot.atlasRegion` is present. */
	atlasTexture?: Texture;
	/** Initial animation clip name to play on construction (defaults to `"Idle"` if present). */
	initialAnimation?: string;
	/** Whether to render the real-time neon green/magenta skeleton & IK debug overlay. */
	debugDraw?: boolean;
}
