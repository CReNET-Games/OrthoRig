#!/usr/bin/env python3
"""
OrthoRig Headless Blender-to-JSON Compiler (tools/blender/orthorig_compiler.py)

Usage:
    blender -b examples/operative-mvp/assets/source/operative_demo.blend \
      -P tools/blender/orthorig_compiler.py -- \
      examples/operative-mvp/public/assets/operative.orthorig.json

Responsibilities:
1. Reads the armature (`OperativeRig`), bone-parented cutout mesh planes/materials,
   custom IK properties (`ik_target`, `bend_dir`), and Blender Actions.
2. Converts Blender 3D Z-up (X, Z) coordinates into PixiJS 2D Y-down (X, -Z)
   coordinates, using Blender's Y depth for `zIndex`.
3. Validates the compiled output against `/schema/orthorig.schema.json`
   (Draft 2020-12) and writes `operative.orthorig.json`.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import bpy

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SCHEMA_PATH = PROJECT_ROOT / "schema" / "orthorig.schema.json"
DEFAULT_OUTPUT_PATH = (
    PROJECT_ROOT
    / "examples"
    / "operative-mvp"
    / "public"
    / "assets"
    / "operative.orthorig.json"
)


def clean_float(val: float, digits: int = 5) -> float:
    r = round(float(val), digits)
    return 0.0 if abs(r) < 1e-9 else r


def normalize_angle(rad: float) -> float:
    return math.atan2(math.sin(rad), math.cos(rad))


def y_depth_to_z_index(y_depth: float) -> int:
    """Convert Blender Y-depth (where more negative Y is closer to front camera) to integer zIndex."""
    return int(round(-float(y_depth) * 1000.0))


def assign_action_compatible(arm_obj: bpy.types.Object, action: bpy.types.Action) -> None:
    if arm_obj.animation_data is None:
        arm_obj.animation_data_create()
    anim_data = arm_obj.animation_data
    anim_data.action = action
    if hasattr(action, "slots"):
        slot = action.slots[0] if len(action.slots) > 0 else None
        if slot is None:
            try:
                slot = action.slots.new(id_type="OBJECT", name=arm_obj.name)
            except TypeError:
                slot = action.slots.new("OBJECT", arm_obj.name)
        if slot is not None and hasattr(anim_data, "action_slot"):
            anim_data.action_slot = slot


def extract_bone_pose_pixi(
    arm_obj: bpy.types.Object,
    bone_order: List[str],
    reference_poses: Optional[Dict[str, Dict[str, float]]] = None,
) -> Dict[str, Dict[str, float]]:
    """
    Evaluate all PoseBones at the current scene frame in Blender X-Z space (Z-up)
    and convert into PixiJS X-Y space (Y-down) relative to each bone's parent.
    """
    world_data: Dict[str, Dict[str, float]] = {}
    for bname in bone_order:
        pbone = arm_obj.pose.bones[bname]
        hx = float(pbone.head.x)
        hy = float(-pbone.head.z)
        tx = float(pbone.tail.x)
        ty = float(-pbone.tail.z)
        dx = tx - hx
        dy = ty - hy
        world_data[bname] = {
            "worldX": hx,
            "worldY": hy,
            "worldRotation": math.atan2(dy, dx),
            "length": math.hypot(dx, dy),
        }

    local_data: Dict[str, Dict[str, float]] = {}
    for bname in bone_order:
        pbone = arm_obj.pose.bones[bname]
        parent_name = pbone.parent.name if pbone.parent else None
        w = world_data[bname]

        if parent_name is None:
            local_x = w["worldX"]
            local_y = w["worldY"]
            local_rot = w["worldRotation"]
        else:
            pw = world_data[parent_name]
            dx = w["worldX"] - pw["worldX"]
            dy = w["worldY"] - pw["worldY"]
            cos_p = math.cos(pw["worldRotation"])
            sin_p = math.sin(pw["worldRotation"])
            local_x = dx * cos_p + dy * sin_p
            local_y = -dx * sin_p + dy * cos_p
            local_rot = normalize_angle(w["worldRotation"] - pw["worldRotation"])

        if reference_poses is not None and bname in reference_poses:
            ref_rot = reference_poses[bname]["rotation"]
            local_rot = ref_rot + normalize_angle(local_rot - ref_rot)

        local_data[bname] = {
            "x": clean_float(local_x, 5),
            "y": clean_float(local_y, 5),
            "rotation": clean_float(local_rot, 6),
            "length": clean_float(w["length"], 5),
            "worldX": clean_float(w["worldX"], 5),
            "worldY": clean_float(w["worldY"], 5),
            "worldRotation": clean_float(w["worldRotation"], 6),
        }

    return local_data


def get_action_keyframe_frames(action: bpy.types.Action, default_end: int) -> List[int]:
    """Collect distinct integer keyframe frames authored on an Action."""
    frames_set = {0, default_end}
    fcurves = getattr(action, "fcurves", None)
    if fcurves:
        for fc in fcurves:
            for kp in fc.keyframe_points:
                frames_set.add(int(round(kp.co[0])))
    elif hasattr(action, "layers"):
        for layer in action.layers:
            for strip in getattr(layer, "strips", []):
                for bag in getattr(strip, "channelbags", []):
                    for fc in getattr(bag, "fcurves", []):
                        for kp in fc.keyframe_points:
                            frames_set.add(int(round(kp.co[0])))
    return sorted(frames_set)


def compile_blend_to_orthorig() -> Dict[str, Any]:
    scene = bpy.context.scene
    fps = float(scene.render.fps or 24)

    arm_obj = bpy.data.objects.get("OperativeRig")
    if arm_obj is None:
        arm_objs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
        if not arm_objs:
            raise RuntimeError("No Armature object found in the Blender file.")
        arm_obj = arm_objs[0]

    bone_order = [b.name for b in arm_obj.data.bones]

    # 1. Evaluate Rest Pose
    arm_obj.data.pose_position = "REST"
    bpy.context.view_layer.update()
    rest_poses = extract_bone_pose_pixi(arm_obj, bone_order)

    bones_list: List[Dict[str, Any]] = []
    for bname in bone_order:
        pbone = arm_obj.pose.bones[bname]
        parent_name = pbone.parent.name if pbone.parent else None
        rp = rest_poses[bname]
        y_depth = float(pbone.get("y_depth", pbone.bone.get("y_depth", -0.05)))
        bones_list.append(
            {
                "name": bname,
                "parent": parent_name,
                "length": rp["length"],
                "restX": rp["x"],
                "restY": rp["y"],
                "restRotation": rp["rotation"],
                "zIndex": y_depth_to_z_index(y_depth),
            }
        )

    # 2. Extract Cutout Slot Meshes
    mesh_objs = [
        o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm_obj
    ]
    slots_list: List[Dict[str, Any]] = []
    for mesh_obj in mesh_objs:
        slot_name = str(mesh_obj.get("slot_name", mesh_obj.name))
        bone_name = str(mesh_obj.get("bone_name", mesh_obj.parent_bone))
        shape_type = str(mesh_obj.get("shape_type", "rect"))
        color_hex = str(mesh_obj.get("color_hex", "#F4F6F8"))
        stroke_hex = str(mesh_obj.get("stroke_color_hex", "#0A0B0E"))
        offset_x = clean_float(float(mesh_obj.get("offset_x", 0.0)), 4)
        offset_y = clean_float(float(mesh_obj.get("offset_y", 0.0)), 4)
        width = clean_float(float(mesh_obj.get("width", 10.0)), 4)
        height = clean_float(float(mesh_obj.get("height", 10.0)), 4)
        y_depth = float(mesh_obj.get("y_depth", 0.0))

        slots_list.append(
            {
                "name": slot_name,
                "bone": bone_name,
                "shapeType": shape_type,
                "width": width,
                "height": height,
                "colorHex": color_hex,
                "strokeColorHex": stroke_hex,
                "offsetX": offset_x,
                "offsetY": offset_y,
                "zIndex": y_depth_to_z_index(y_depth),
            }
        )

    slots_list.sort(key=lambda s: s["zIndex"])

    # 3. Extract Custom 2-Bone IK Constraints from PoseBones
    ik_constraints: List[Dict[str, Any]] = []
    for bname in bone_order:
        pbone = arm_obj.pose.bones[bname]
        if pbone.get("ik_role") == "upper" and pbone.get("ik_lower_bone"):
            chain_name = str(pbone.get("ik_chain_name", f"ik_{bname}"))
            lower_bone = str(pbone["ik_lower_bone"])
            target = str(pbone.get("ik_target", "aim_cursor"))
            bend_dir = int(pbone.get("bend_dir", 1))
            ik_constraints.append(
                {
                    "name": chain_name,
                    "chain": [bname, lower_bone],
                    "target": target,
                    "bendDirection": 1 if bend_dir >= 0 else -1,
                }
            )

    # 4. Sample Actions into Keyframe Tracks
    arm_obj.data.pose_position = "POSE"
    animations: Dict[str, Any] = {}

    for action in sorted(bpy.data.actions, key=lambda a: a.name):
        frame_end = int(action.get("frame_end", round(action.frame_range[1])))
        if frame_end <= 0:
            frame_end = 24
        loop = bool(action.get("loop", action.name != "Jump"))
        assign_action_compatible(arm_obj, action)

        key_frames = get_action_keyframe_frames(action, frame_end)
        tracks: Dict[str, List[Dict[str, Any]]] = {b: [] for b in bone_order}

        for frame in key_frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            poses = extract_bone_pose_pixi(arm_obj, bone_order, rest_poses)
            t_sec = clean_float(frame / fps, 5)
            for bname in bone_order:
                bp = poses[bname]
                tracks[bname].append(
                    {
                        "time": t_sec,
                        "x": bp["x"],
                        "y": bp["y"],
                        "rotation": bp["rotation"],
                    }
                )

        animations[action.name] = {
            "duration": clean_float(frame_end / fps, 5),
            "loop": loop,
            "tracks": tracks,
        }

    blend_name = Path(bpy.data.filepath).name if bpy.data.filepath else "operative_demo.blend"

    return {
        "meta": {
            "version": "1.0.0",
            "sourceFile": blend_name,
            "fps": fps,
            "coordinateSystem": "pixi-y-down",
        },
        "bones": bones_list,
        "slots": slots_list,
        "ik_constraints": ik_constraints,
        "animations": animations,
    }


def validate_against_schema(data: Dict[str, Any], schema_path: Path) -> None:
    """
    Validate compiled `.orthorig.json` payload against `/schema/orthorig.schema.json`.
    Uses `jsonschema` if installed, plus deterministic structural contract checks.
    """
    schema = json.loads(schema_path.read_text(encoding="utf-8"))

    try:
        import jsonschema  # type: ignore
        jsonschema.validate(instance=data, schema=schema)
    except ImportError:
        pass

    # Deterministic structural validation enforcing orthorig.schema.json rules
    for req_key in schema["required"]:
        if req_key not in data:
            raise ValueError(f"Schema validation failed: missing top-level '{req_key}'")

    meta = data["meta"]
    if meta.get("coordinateSystem") != "pixi-y-down":
        raise ValueError("Schema validation failed: meta.coordinateSystem must be 'pixi-y-down'")
    if not re.match(r"^[0-9]+\.[0-9]+\.[0-9]+$", str(meta.get("version", ""))):
        raise ValueError("Schema validation failed: invalid meta.version")

    bone_names = set()
    for bone in data["bones"]:
        for k in ["name", "parent", "length", "restX", "restY", "restRotation", "zIndex"]:
            if k not in bone:
                raise ValueError(f"Schema validation failed: bone missing '{k}'")
        bone_names.add(bone["name"])

    for slot in data["slots"]:
        for k in ["name", "bone", "shapeType", "width", "height", "colorHex", "offsetX", "offsetY", "zIndex"]:
            if k not in slot:
                raise ValueError(f"Schema validation failed: slot missing '{k}'")
        if slot["bone"] not in bone_names:
            raise ValueError(f"Schema validation failed: slot '{slot['name']}' references unknown bone '{slot['bone']}'")
        if slot["shapeType"] not in ("rect", "polygon", "sprite"):
            raise ValueError(f"Schema validation failed: invalid shapeType '{slot['shapeType']}'")
        if not re.match(r"^#[0-9A-Fa-f]{6}$", str(slot["colorHex"])):
            raise ValueError(f"Schema validation failed: invalid colorHex '{slot['colorHex']}'")

    for ik in data["ik_constraints"]:
        for k in ["name", "chain", "target", "bendDirection"]:
            if k not in ik:
                raise ValueError(f"Schema validation failed: ik_constraint missing '{k}'")
        if len(ik["chain"]) != 2 or ik[" bendDirection" if " bendDirection" in ik else "bendDirection"] not in (1, -1):
            raise ValueError(f"Schema validation failed: invalid ik_constraint '{ik['name']}'")

    if not data["animations"]:
        raise ValueError("Schema validation failed: animations cannot be empty")
    for anim_name, clip in data["animations"].items():
        for k in ["duration", "loop", "tracks"]:
            if k not in clip:
                raise ValueError(f"Schema validation failed: animation '{anim_name}' missing '{k}'")


def parse_output_path() -> Path:
    if "--" in sys.argv:
        idx = sys.argv.index("--")
        if idx + 1 < len(sys.argv):
            return Path(sys.argv[idx + 1]).resolve()
    return DEFAULT_OUTPUT_PATH


def main() -> None:
    out_path = parse_output_path()
    print(f"[OrthoRig Compiler] Compiling active Blender file -> {out_path}")
    payload = compile_blend_to_orthorig()
    validate_against_schema(payload, SCHEMA_PATH)
    print(f"[OrthoRig Compiler] Validated output against schema: {SCHEMA_PATH}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"[OrthoRig Compiler] Wrote {out_path} "
        f"({len(payload['bones'])} bones, {len(payload['slots'])} slots, "
        f"{len(payload['ik_constraints'])} IK constraints, {len(payload['animations'])} actions)"
    )


if __name__ == "__main__":
    main()
