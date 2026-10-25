import type { Graphics } from "pixi.js";

export interface PlatformRect {
	x: number;
	y: number;
	width: number;
	height: number;
	isWall?: boolean;
}

export const VOID_BLACK = 0x0a0b0e;
export const STARK_WHITE = 0xf4f6f8;
export const OPERATIVE_CYAN = 0x00f0ff;
export const THREAT_RED = 0xff2a54;

export function buildArenaPlatforms(w: number, h: number): PlatformRect[] {
	const floorY = h - 64;
	const wallThickness = 44;

	return [
		// Main floor
		{ x: 0, y: floorY, width: w, height: 80 },
		// Left and right climbable walls
		{ x: 36, y: 90, width: wallThickness, height: floorY - 90, isWall: true },
		{
			x: w - 36 - wallThickness,
			y: 90,
			width: wallThickness,
			height: floorY - 90,
			isWall: true,
		},
		// Elevated platforms
		{ x: w * 0.22, y: floorY - 140, width: 220, height: 18 },
		{ x: w * 0.58, y: floorY - 140, width: 220, height: 18 },
		{ x: w * 0.38, y: floorY - 280, width: 260, height: 18 },
		// Center pillar wall for wall-sliding tests
		{
			x: w * 0.5 - 18,
			y: floorY - 430,
			width: 36,
			height: 150,
			isWall: true,
		},
	];
}

export function renderArena(
	arenaLayer: Graphics,
	w: number,
	h: number,
	platforms: readonly PlatformRect[],
): void {
	arenaLayer.clear();

	// Atmospheric background grid
	const gridStep = 48;
	for (let gx = 0; gx < w; gx += gridStep) {
		arenaLayer
			.moveTo(gx, 0)
			.lineTo(gx, h)
			.stroke({ color: STARK_WHITE, alpha: 0.035, width: 1 });
	}
	for (let gy = 0; gy < h; gy += gridStep) {
		arenaLayer
			.moveTo(0, gy)
			.lineTo(w, gy)
			.stroke({ color: STARK_WHITE, alpha: 0.035, width: 1 });
	}

	// Platforms & walls
	for (const p of platforms) {
		arenaLayer
			.rect(p.x, p.y, p.width, p.height)
			.fill({ color: 0x11141a, alpha: 0.95 })
			.stroke({ color: STARK_WHITE, alpha: 0.28, width: 1.5 });

		// Cyan top edge strip on platforms / vertical sensor strip on walls
		if (p.isWall) {
			arenaLayer
				.moveTo(p.x + p.width, p.y + 4)
				.lineTo(p.x + p.width, p.y + p.height - 4)
				.moveTo(p.x, p.y + 4)
				.lineTo(p.x, p.y + p.height - 4)
				.stroke({ color: OPERATIVE_CYAN, alpha: 0.55, width: 2 });
		} else {
			arenaLayer
				.moveTo(p.x + 2, p.y)
				.lineTo(p.x + Math.min(p.width - 2, 64), p.y)
				.stroke({ color: OPERATIVE_CYAN, alpha: 0.85, width: 2 });
		}
	}
}

export function drawReticle(
	reticleGraphics: Graphics,
	mouseX: number,
	mouseY: number,
): void {
	reticleGraphics.clear();
	reticleGraphics
		.circle(mouseX, mouseY, 7)
		.stroke({ color: OPERATIVE_CYAN, width: 1.5, alpha: 0.9 });
	reticleGraphics
		.moveTo(mouseX - 12, mouseY)
		.lineTo(mouseX + 12, mouseY)
		.moveTo(mouseX, mouseY - 12)
		.lineTo(mouseX, mouseY + 12)
		.stroke({ color: STARK_WHITE, width: 1, alpha: 0.75 });
}
