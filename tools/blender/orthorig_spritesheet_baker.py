#!/usr/bin/env python3
"""
OrthoRig Automated Spritesheet Atlas Baker (tools/blender/orthorig_spritesheet_baker.py)

Packs OrthoRig cutout slot specifications into a single RGBA PNG spritesheet atlas
with transparent padding and populates `atlasRegion` (`{ texture, x, y, width, height }`)
on each slot in the compiled `.orthorig.json` payload.

Uses pure Python `zlib` + `struct` PNG encoding so it executes deterministically
inside headless Blender (`bpy`) or standalone Python without external image libraries.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path
from typing import Any, Dict, List, Tuple


def hex_to_rgba_bytes(hex_color: str, alpha: int = 255) -> Tuple[int, int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return (244, 246, 248, alpha)
    return (
        int(h[0:2], 16),
        int(h[2:4], 16),
        int(h[4:6], 16),
        alpha,
    )


def encode_rgba_png(width: int, height: int, rgba_bytes: bytes) -> bytes:
    """Encode raw row-major RGBA8888 bytes into a valid PNG image buffer."""
    stride = width * 4
    raw_scanlines = bytearray()
    for y in range(height):
        raw_scanlines.append(0)  # Filter type 0 (None)
        row_start = y * stride
        raw_scanlines.extend(rgba_bytes[row_start : row_start + stride])

    def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw_scanlines), level=9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + make_chunk(b"IHDR", ihdr)
        + make_chunk(b"IDAT", idat)
        + make_chunk(b"IEND", b"")
    )


def bake_slots_to_atlas(
    slots: List[Dict[str, Any]],
    atlas_output_path: Path,
    scale_factor: int = 2,
    padding_px: int = 4,
) -> Dict[str, Dict[str, Any]]:
    """
    Rasterize all cutout slots into a packed RGBA spritesheet PNG at `atlas_output_path`
    and return a map of `slot_name -> atlasRegion` in unscaled pixel coordinates.
    """
    scale = max(1, int(scale_factor))
    pad = max(2, int(padding_px))

    # Compute pixel dimensions for each slot and pack into rows (shelf bin-packing)
    max_atlas_width = 256 * scale
    current_x = pad
    current_y = pad
    row_height = 0
    packed_items: List[Dict[str, Any]] = []

    for slot in slots:
        w_unscaled = max(2, int(math.ceil(float(slot["width"]))))
        h_unscaled = max(2, int(math.ceil(float(slot["height"]))))
        w_px = w_unscaled * scale
        h_px = h_unscaled * scale

        if current_x + w_px + pad > max_atlas_width and current_x > pad:
            current_x = pad
            current_y += row_height + pad
            row_height = 0

        packed_items.append(
            {
                "slot": slot,
                "x": current_x,
                "y": current_y,
                "w_px": w_px,
                "h_px": h_px,
            }
        )
        current_x += w_px + pad
        row_height = max(row_height, h_px)

    atlas_width = max_atlas_width
    atlas_height = max(64, current_y + row_height + pad)
    # Round height up to next multiple of 16 for clean GPU texture alignment
    atlas_height = ((atlas_height + 15) // 16) * 16

    canvas = bytearray(atlas_width * atlas_height * 4)
    stroke_px = max(1, int(round(1.5 * scale)))
    atlas_filename = atlas_output_path.name
    regions: Dict[str, Dict[str, Any]] = {}

    for item in packed_items:
        slot = item["slot"]
        rx = item["x"]
        ry = item["y"]
        rw = item["w_px"]
        rh = item["h_px"]

        fill_rgba = hex_to_rgba_bytes(str(slot.get("colorHex", "#0A0B0E")), 255)
        stroke_rgba = hex_to_rgba_bytes(str(slot.get("strokeColorHex", "#F4F6F8")), 240)

        for ly in range(rh):
            py = ry + ly
            row_offset = py * atlas_width * 4
            is_border_y = ly < stroke_px or ly >= (rh - stroke_px)
            for lx in range(rw):
                px = rx + lx
                idx = row_offset + px * 4
                is_border = is_border_y or lx < stroke_px or lx >= (rw - stroke_px)
                c = stroke_rgba if is_border else fill_rgba
                canvas[idx] = c[0]
                canvas[idx + 1] = c[1]
                canvas[idx + 2] = c[2]
                canvas[idx + 3] = c[3]

        region = {
            "texture": atlas_filename,
            "x": rx,
            "y": ry,
            "width": rw,
            "height": rh,
        }
        slot["atlasRegion"] = region
        regions[str(slot["name"])] = region

    png_bytes = encode_rgba_png(atlas_width, atlas_height, bytes(canvas))
    atlas_output_path.parent.mkdir(parents=True, exist_ok=True)
    atlas_output_path.write_bytes(png_bytes)
    return regions
