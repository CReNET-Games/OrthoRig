import type {
	OrthoAnimationClip,
	OrthoKeyframe,
	OrthoRigSchema,
} from "./types.js";

/**
 * Wrap an angle in radians to `(-PI, PI]`.
 */
export function normalizeAngle(radians: number): number {
	return Math.atan2(Math.sin(radians), Math.cos(radians));
}

/**
 * Clamp a numeric value to `[min, max]`.
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Parse a `#RRGGBB` hex string to a 24-bit integer color.
 */
export function parseHexColor(
	hex: string,
	fallback: number = 0x0a0b0e,
): number {
	const cleaned = hex.trim().replace(/^#/, "");
	const parsed = Number.parseInt(cleaned, 16);
	return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Evaluate a 1D Cubic-Bezier easing curve `cubic-bezier(x1, y1, x2, y2)` at normalized time `t in [0, 1]`.
 */
export function evaluateCubicBezier(
	t: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	if (x1 === y1 && x2 === y2) return t;

	const sampleCurveX = (u: number): number =>
		(1 - 3 * x2 + 3 * x1) * u * u * u + (3 * x2 - 6 * x1) * u * u + 3 * x1 * u;
	const sampleCurveY = (u: number): number =>
		(1 - 3 * y2 + 3 * y1) * u * u * u + (3 * y2 - 6 * y1) * u * u + 3 * y1 * u;
	const sampleCurveDerivativeX = (u: number): number =>
		3 * (1 - 3 * x2 + 3 * x1) * u * u + 2 * (3 * x2 - 6 * x1) * u + 3 * x1;

	// Newton-Raphson iteration to solve u for x(u) = t
	let u = t;
	for (let i = 0; i < 6; i++) {
		const err = sampleCurveX(u) - t;
		if (Math.abs(err) < 1e-6) break;
		const d = sampleCurveDerivativeX(u);
		if (Math.abs(d) < 1e-6) break;
		u = clamp(u - err / d, 0, 1);
	}

	return clamp(sampleCurveY(u), 0, 1);
}

/**
 * Interpolate a bone keyframe track at `timeSeconds` using binary search and linear or cubic-bezier easing.
 */
export function interpolateTrack(
	keyframes: readonly OrthoKeyframe[],
	timeSeconds: number,
): { x: number; y: number; rotation: number } {
	if (keyframes.length === 0) {
		return { x: 0, y: 0, rotation: 0 };
	}
	if (keyframes.length === 1 || timeSeconds <= keyframes[0].time) {
		const first = keyframes[0];
		return { x: first.x, y: first.y, rotation: first.rotation };
	}
	const last = keyframes[keyframes.length - 1];
	if (timeSeconds >= last.time) {
		return { x: last.x, y: last.y, rotation: last.rotation };
	}

	let low = 0;
	let high = keyframes.length - 1;
	while (low + 1 < high) {
		const mid = (low + high) >> 1;
		if (keyframes[mid].time <= timeSeconds) {
			low = mid;
		} else {
			high = mid;
		}
	}

	const k0 = keyframes[low];
	const k1 = keyframes[high];
	const span = k1.time - k0.time;
	let alpha = span > 1e-9 ? clamp((timeSeconds - k0.time) / span, 0, 1) : 0;

	if (k0.easing === "cubic-bezier") {
		const [x1, y1, x2, y2] = k0.bezier ?? [0.42, 0.0, 0.58, 1.0];
		alpha = evaluateCubicBezier(alpha, x1, y1, x2, y2);
	}

	const x = k0.x + (k1.x - k0.x) * alpha;
	const y = k0.y + (k1.y - k0.y) * alpha;
	const dRot = normalizeAngle(k1.rotation - k0.rotation);
	const rotation = k0.rotation + dRot * alpha;

	return { x, y, rotation };
}

/**
 * Uniformly scale all spatial coordinates (`bones`, `sockets`, `slots`, and `animations` keyframe translations)
 * in a compiled `OrthoRigSchema` while preserving unscaled `slot.atlasRegion` texture pixel coordinates
 * and crisp `1.5px` procedural outline strokes.
 */
export function scaleOrthoRigSchema(
	schema: OrthoRigSchema,
	scale: number,
): OrthoRigSchema {
	const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
	const scaledAnimations: Record<string, OrthoAnimationClip> = {};
	for (const [clipName, clip] of Object.entries(schema.animations)) {
		const scaledTracks: Record<string, OrthoKeyframe[]> = {};
		for (const [boneName, keyframes] of Object.entries(clip.tracks)) {
			scaledTracks[boneName] = keyframes.map((kf) => ({
				...kf,
				x: kf.x * s,
				y: kf.y * s,
			}));
		}
		scaledAnimations[clipName] = {
			...clip,
			tracks: scaledTracks,
		};
	}

	return {
		...schema,
		bones: schema.bones.map((b) => ({
			...b,
			length: b.length * s,
			restX: b.restX * s,
			restY: b.restY * s,
		})),
		sockets: schema.sockets
			? schema.sockets.map((sock) => ({
					...sock,
					x: sock.x * s,
					y: sock.y * s,
				}))
			: undefined,
		slots: schema.slots.map((slot) => ({
			...slot,
			width: slot.width * s,
			height: slot.height * s,
			offsetX: slot.offsetX * s,
			offsetY: slot.offsetY * s,
			points: slot.points ? slot.points.map((p) => p * s) : undefined,
		})),
		animations: scaledAnimations,
	};
}
