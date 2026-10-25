import { Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { parseHexColor } from "./math";
import type { OrthoSlotSpec } from "./types";

/**
 * Draw procedural `rect` or `polygon` cutout geometry onto a `PIXI.Graphics` slot node.
 */
export function drawProceduralSlot(g: Graphics, slot: OrthoSlotSpec): void {
	const fill = parseHexColor(slot.colorHex, 0x0a0b0e);
	const stroke = parseHexColor(slot.strokeColorHex ?? "#F4F6F8", 0xf4f6f8);

	if (slot.shapeType === "polygon" && slot.points && slot.points.length >= 6) {
		g.poly(slot.points, true)
			.fill({ color: fill })
			.stroke({ color: stroke, width: 1.5, alpha: 0.92 });
	} else {
		const hw = slot.width * 0.5;
		const hh = slot.height * 0.5;
		g.rect(slot.offsetX - hw, slot.offsetY - hh, slot.width, slot.height)
			.fill({ color: fill })
			.stroke({ color: stroke, width: 1.5, alpha: 0.92 });
	}
}

/**
 * Construct a `PIXI.Graphics` (procedural prototyping) or `PIXI.Sprite` (texture/atlas production)
 * display object for a slot specification.
 */
export function createSlotAttachment(
	slot: OrthoSlotSpec,
	textures?: Record<string, Texture>,
	atlasTexture?: Texture,
	preferAtlasSprites: boolean = false,
): Graphics | Sprite {
	const explicitTex = textures?.[slot.name];
	const useAtlasRegion =
		Boolean(slot.atlasRegion && atlasTexture) &&
		(slot.shapeType === "sprite" || preferAtlasSprites);

	if (slot.shapeType === "sprite" || explicitTex || useAtlasRegion) {
		let tex = explicitTex ?? Texture.WHITE;
		if (!explicitTex && slot.atlasRegion && atlasTexture) {
			tex = new Texture({
				source: atlasTexture.source,
				frame: new Rectangle(
					slot.atlasRegion.x,
					slot.atlasRegion.y,
					slot.atlasRegion.width,
					slot.atlasRegion.height,
				),
			});
		}
		const sprite = new Sprite(tex);
		sprite.label = `Slot_${slot.name}`;
		sprite.anchor.set(0.5, 0.5);
		sprite.position.set(slot.offsetX, slot.offsetY);
		sprite.width = slot.width;
		sprite.height = slot.height;
		sprite.rotation = slot.rotation ?? 0;
		sprite.zIndex = slot.zIndex;
		return sprite;
	}

	const g = new Graphics();
	g.label = `Slot_${slot.name}`;
	g.zIndex = slot.zIndex;
	drawProceduralSlot(g, slot);
	return g;
}
