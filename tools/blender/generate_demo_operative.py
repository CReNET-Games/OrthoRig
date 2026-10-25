#!/usr/bin/env python3
"""
OrthoRig Procedural Blender Rig Builder (tools/blender/generate_demo_operative.py)

Usage:
    blender -b -P tools/blender/generate_demo_operative.py

Responsibilities:
1. Clears the default scene and sets up an Orthographic camera looking at the X-Z plane.
2. Constructs `OperativeRig` in the X-Z plane with 11 bones:
   `root`, `torso`, `head`, `upper_arm_l`, `forearm_l`, `upper_arm_r`, `forearm_r`,
   `thigh_l`, `shin_l`, `thigh_r`, `shin_r`.
3. Generates 2D cutout mesh planes parented to each bone, styled in the
   "High-Gloss Survival" palette (#0A0B0E Void Black, #F4F6F8 Stark White,
   #00F0FF Operative Cyan, #FF2A54 Threat Red), offsetting Y-depth for draw order.
4. Attaches custom properties on `upper_arm_r` / `forearm_r` defining the 2-bone
   IK chain (`ik_target = "aim_cursor"`, `bend_dir = 1`).
5. Programmatically authors 4 distinct Blender Actions (`Idle`, `Run`, `Jump`, `WallSlide`)
   using sine/cosine keyframe curves with Blender 4.x/5.x ActionSlot compatibility.
6. Saves the file to `examples/operative-mvp/assets/source/operative_demo.blend`.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List, Tuple

import bpy
import mathutils

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BLEND_OUTPUT_PATH = (
    PROJECT_ROOT
    / "examples"
    / "operative-mvp"
    / "assets"
    / "source"
    / "operative_demo.blend"
)

FPS = 24

PALETTE = {
    "VOID_BLACK": "#0A0B0E",
    "STARK_WHITE": "#F4F6F8",
    "OPERATIVE_CYAN": "#00F0FF",
    "THREAT_RED": "#FF2A54",
}

# 11-bone 2D planar hierarchy in Blender X-Z space (Y=0), standing on the Z=0 ground plane (0, 0, 0).
# Bone z_depth values define the baseline draw order (more negative Y = closer to front camera = higher zIndex).
BONE_SPECS: List[Dict[str, Any]] = [
    {
        "name": "root",
        "parent": None,
        "head": (0.0, 0.0, 64.0),
        "tail": (10.0, 0.0, 64.0),
        "connected": False,
        "y_depth": -0.050,
    },
    {
        "name": "torso",
        "parent": "root",
        "head": (0.0, 0.0, 64.0),
        "tail": (0.0, 0.0, 106.0),
        "connected": False,
        "y_depth": -0.060,
    },
    {
        "name": "head",
        "parent": "torso",
        "head": (0.0, 0.0, 106.0),
        "tail": (0.0, 0.0, 130.0),
        "connected": True,
        "y_depth": -0.070,
    },
    {
        "name": "upper_arm_l",
        "parent": "torso",
        "head": (0.0, 0.0, 100.0),
        "tail": (0.0, 0.0, 76.0),
        "connected": False,
        "y_depth": -0.005,
    },
    {
        "name": "forearm_l",
        "parent": "upper_arm_l",
        "head": (0.0, 0.0, 76.0),
        "tail": (14.0, 0.0, 68.0),
        "connected": True,
        "y_depth": -0.008,
    },
    {
        "name": "upper_arm_r",
        "parent": "torso",
        "head": (0.0, 0.0, 100.0),
        "tail": (26.0, 0.0, 100.0),
        "connected": False,
        "y_depth": -0.100,
    },
    {
        "name": "forearm_r",
        "parent": "upper_arm_r",
        "head": (26.0, 0.0, 100.0),
        "tail": (54.0, 0.0, 100.0),
        "connected": True,
        "y_depth": -0.110,
    },
    {
        "name": "thigh_l",
        "parent": "root",
        "head": (0.0, 0.0, 64.0),
        "tail": (0.0, 0.0, 32.0),
        "connected": False,
        "y_depth": -0.010,
    },
    {
        "name": "shin_l",
        "parent": "thigh_l",
        "head": (0.0, 0.0, 32.0),
        "tail": (0.0, 0.0, 0.0),
        "connected": True,
        "y_depth": -0.020,
    },
    {
        "name": "thigh_r",
        "parent": "root",
        "head": (0.0, 0.0, 64.0),
        "tail": (0.0, 0.0, 32.0),
        "connected": False,
        "y_depth": -0.030,
    },
    {
        "name": "shin_r",
        "parent": "thigh_r",
        "head": (0.0, 0.0, 32.0),
        "tail": (0.0, 0.0, 0.0),
        "connected": True,
        "y_depth": -0.040,
    },
]

# Cutout 2D mesh planes parented to bones.
# More negative y_depth = closer to front orthographic camera (-Y) = higher zIndex (int(round(-y_depth * 1000))).
SLOT_SPECS: List[Dict[str, Any]] = [
    {
        "name": "slot_upper_arm_l",
        "bone": "upper_arm_l",
        "shape_type": "rect",
        "offset_x": 12.0,
        "offset_y": 0.0,
        "width": 24.0,
        "height": 9.0,
        "y_depth": -0.005,
        "color": PALETTE["VOID_BLACK"],
        "stroke": PALETTE["STARK_WHITE"],
    },
    {
        "name": "slot_forearm_l",
        "bone": "forearm_l",
        "shape_type": "rect",
        "offset_x": 8.0,
        "offset_y": 0.0,
        "width": 18.0,
        "height": 8.0,
        "y_depth": -0.008,
        "color": PALETTE["VOID_BLACK"],
        "stroke": PALETTE["OPERATIVE_CYAN"],
    },
    {
        "name": "slot_thigh_l",
        "bone": "thigh_l",
        "shape_type": "rect",
        "offset_x": 16.0,
        "offset_y": 0.0,
        "width": 32.0,
        "height": 11.0,
        "y_depth": -0.010,
        "color": PALETTE["VOID_BLACK"],
        "stroke": PALETTE["STARK_WHITE"],
    },
    {
        "name": "slot_shin_l",
        "bone": "shin_l",
        "shape_type": "rect",
        "offset_x": 16.0,
        "offset_y": 0.0,
        "width": 32.0,
        "height": 9.0,
        "y_depth": -0.020,
        "color": PALETTE["VOID_BLACK"],
        "stroke": PALETTE["OPERATIVE_CYAN"],
    },
    {
        "name": "slot_thigh_r",
        "bone": "thigh_r",
        "shape_type": "rect",
        "offset_x": 16.0,
        "offset_y": 0.0,
        "width": 32.0,
        "height": 12.0,
        "y_depth": -0.030,
        "color": PALETTE["STARK_WHITE"],
        "stroke": PALETTE["VOID_BLACK"],
    },
    {
        "name": "slot_shin_r",
        "bone": "shin_r",
        "shape_type": "rect",
        "offset_x": 16.0,
        "offset_y": 0.0,
        "width": 32.0,
        "height": 9.5,
        "y_depth": -0.040,
        "color": PALETTE["VOID_BLACK"],
        "stroke": PALETTE["STARK_WHITE"],
    },
    {
        "name": "slot_root_belt",
        "bone": "root",
        "shape_type": "rect",
        "offset_x": 0.0,
        "offset_y": -2.0,
        "width": 20.0,
        "height": 10.0,
        "y_depth": -0.050,
        "color": PALETTE["VOID_BLACK"],
        "stroke": PALETTE["STARK_WHITE"],
    },
    {
        "name": "slot_torso_plate",
        "bone": "torso",
        "shape_type": "rect",
        "offset_x": 21.0,
        "offset_y": 0.0,
        "width": 42.0,
        "height": 22.0,
        "y_depth": -0.060,
        "color": PALETTE["STARK_WHITE"],
        "stroke": PALETTE["VOID_BLACK"],
    },
    {
        "name": "slot_torso_thruster",
        "bone": "torso",
        "shape_type": "rect",
        "offset_x": 25.0,
        "offset_y": -9.0,
        "width": 16.0,
        "height": 6.0,
        "y_depth": -0.065,
        "color": PALETTE["OPERATIVE_CYAN"],
        "stroke": PALETTE["VOID_BLACK"],
    },
    {
        "name": "slot_head_helmet",
        "bone": "head",
        "shape_type": "rect",
        "offset_x": 12.0,
        "offset_y": 0.0,
        "width": 24.0,
        "height": 20.0,
        "y_depth": -0.070,
        "color": PALETTE["VOID_BLACK"],
        "stroke": PALETTE["STARK_WHITE"],
    },
    {
        "name": "slot_head_visor",
        "bone": "head",
        "shape_type": "rect",
        "offset_x": 13.0,
        "offset_y": 6.0,
        "width": 7.0,
        "height": 13.0,
        "y_depth": -0.075,
        "color": PALETTE["OPERATIVE_CYAN"],
        "stroke": PALETTE["VOID_BLACK"],
    },
    {
        "name": "slot_upper_arm_r",
        "bone": "upper_arm_r",
        "shape_type": "rect",
        "offset_x": 13.0,
        "offset_y": 0.0,
        "width": 26.0,
        "height": 9.5,
        "y_depth": -0.100,
        "color": PALETTE["STARK_WHITE"],
        "stroke": PALETTE["VOID_BLACK"],
    },
    {
        "name": "slot_forearm_r_carbine",
        "bone": "forearm_r",
        "shape_type": "rect",
        "offset_x": 18.0,
        "offset_y": 0.0,
        "width": 38.0,
        "height": 8.5,
        "y_depth": -0.110,
        "color": PALETTE["VOID_BLACK"],
        "stroke": PALETTE["STARK_WHITE"],
    },
    {
        "name": "slot_weapon_threat_accent",
        "bone": "forearm_r",
        "shape_type": "rect",
        "offset_x": 25.0,
        "offset_y": -1.5,
        "width": 24.0,
        "height": 3.5,
        "y_depth": -0.115,
        "color": PALETTE["THREAT_RED"],
        "stroke": PALETTE["VOID_BLACK"],
    },
]


def hex_to_rgba_float(hex_color: str, alpha: float = 1.0) -> Tuple[float, float, float, float]:
    h = hex_color.lstrip("#")
    return (
        int(h[0:2], 16) / 255.0,
        int(h[2:4], 16) / 255.0,
        int(h[4:6], 16) / 255.0,
        alpha,
    )


def setup_scene_and_ortho_camera() -> None:
    """Clear default scene and configure an Orthographic camera looking at the X-Z plane."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = 48

    cam_data = bpy.data.cameras.new(name="OrthoRigCamera")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 180.0
    cam_obj = bpy.data.objects.new(name="OrthoRigCamera", object_data=cam_data)
    bpy.context.collection.objects.link(cam_obj)
    # Position along -Y looking toward +Y at the X-Z plane (+X right, +Z up), centered on the operative (Z=0..130)
    cam_obj.location = (0.0, -200.0, 66.0)
    cam_obj.rotation_euler = (math.pi * 0.5, 0.0, 0.0)
    scene.camera = cam_obj


def create_operative_armature() -> bpy.types.Object:
    """Construct the 11-bone 2D planar `OperativeRig` armature in the X-Z plane."""
    arm_data = bpy.data.armatures.new("OperativeRig")
    arm_obj = bpy.data.objects.new("OperativeRig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)

    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = arm_data.edit_bones

    created: Dict[str, bpy.types.EditBone] = {}
    for spec in BONE_SPECS:
        eb = edit_bones.new(spec["name"])
        eb.head = spec["head"]
        eb.tail = spec["tail"]
        if spec["parent"] is not None:
            eb.parent = created[spec["parent"]]
            eb.use_connect = bool(spec["connected"])
        # Align local Z axis along global +Y so planar rotations happen purely on local Z
        eb.align_roll((0.0, 1.0, 0.0))
        eb["y_depth"] = float(spec["y_depth"])
        created[spec["name"]] = eb

    bpy.ops.object.mode_set(mode="OBJECT")

    for spec in BONE_SPECS:
        pbone = arm_obj.pose.bones[spec["name"]]
        pbone.rotation_mode = "XYZ"
        pbone["y_depth"] = float(spec["y_depth"])

    # Attach custom properties on upper_arm_r / forearm_r defining the 2-bone IK chain
    arm_obj.pose.bones["upper_arm_r"]["ik_chain_name"] = "right_arm_aim"
    arm_obj.pose.bones["upper_arm_r"]["ik_role"] = "upper"
    arm_obj.pose.bones["upper_arm_r"]["ik_lower_bone"] = "forearm_r"
    arm_obj.pose.bones["upper_arm_r"]["ik_target"] = "aim_cursor"
    arm_obj.pose.bones["upper_arm_r"]["bend_dir"] = 1

    arm_obj.pose.bones["forearm_r"]["ik_chain_name"] = "right_arm_aim"
    arm_obj.pose.bones["forearm_r"]["ik_role"] = "lower"
    arm_obj.pose.bones["forearm_r"]["ik_upper_bone"] = "upper_arm_r"
    arm_obj.pose.bones["forearm_r"]["ik_target"] = "aim_cursor"
    arm_obj.pose.bones["forearm_r"]["bend_dir"] = 1

    return arm_obj


def create_cutout_slots(arm_obj: bpy.types.Object) -> List[bpy.types.Object]:
    """Generate 2D cutout mesh planes parented to each bone in the High-Gloss Survival palette."""
    bpy.context.view_layer.update()
    created_meshes: List[bpy.types.Object] = []

    for spec in SLOT_SPECS:
        slot_name = spec["name"]
        bone_name = spec["bone"]
        offset_x = float(spec["offset_x"])
        offset_y = float(spec["offset_y"])
        width = float(spec["width"])
        height = float(spec["height"])
        y_depth = float(spec["y_depth"])
        color_hex = str(spec["color"])
        stroke_hex = str(spec["stroke"])

        pbone = arm_obj.pose.bones[bone_name]
        hx, _, hz = pbone.head
        tx, _, tz = pbone.tail
        theta_pixi = math.atan2(-(tz - hz), tx - hx)
        cos_t = math.cos(theta_pixi)
        sin_t = math.sin(theta_pixi)

        hw = width * 0.5
        hh = height * 0.5
        local_corners = [
            (offset_x - hw, offset_y - hh),
            (offset_x + hw, offset_y - hh),
            (offset_x + hw, offset_y + hh),
            (offset_x - hw, offset_y + hh),
        ]

        world_verts: List[Tuple[float, float, float]] = []
        for lx, ly in local_corners:
            wx_pixi = hx + (lx * cos_t - ly * sin_t)
            wy_pixi = (-hz) + (lx * sin_t + ly * cos_t)
            world_verts.append((wx_pixi, y_depth, -wy_pixi))

        mesh = bpy.data.meshes.new(slot_name)
        mesh.from_pydata(world_verts, [], [(0, 1, 2, 3)])
        mesh.update()

        mesh_obj = bpy.data.objects.new(slot_name, mesh)
        bpy.context.collection.objects.link(mesh_obj)

        mesh_obj["slot_name"] = slot_name
        mesh_obj["bone_name"] = bone_name
        mesh_obj["shape_type"] = str(spec["shape_type"])
        mesh_obj["color_hex"] = color_hex
        mesh_obj["stroke_color_hex"] = stroke_hex
        mesh_obj["offset_x"] = offset_x
        mesh_obj["offset_y"] = offset_y
        mesh_obj["width"] = width
        mesh_obj["height"] = height
        mesh_obj["y_depth"] = y_depth

        mat = bpy.data.materials.new(name=f"Mat_{slot_name}")
        mat.use_nodes = True
        rgba = hex_to_rgba_float(color_hex)
        mat.diffuse_color = rgba
        if mat.node_tree:
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Base Color"].default_value = rgba
        mesh.materials.append(mat)

        mesh_obj.parent = arm_obj
        mesh_obj.parent_type = "BONE"
        mesh_obj.parent_bone = bone_name
        bone_parent_matrix = (
            arm_obj.matrix_world
            @ pbone.matrix
            @ mathutils.Matrix.Translation((0.0, pbone.bone.length, 0.0))
        )
        mesh_obj.matrix_parent_inverse = bone_parent_matrix.inverted()
        created_meshes.append(mesh_obj)

    bpy.context.view_layer.update()
    return created_meshes


def assign_action_compatible(arm_obj: bpy.types.Object, action: bpy.types.Action) -> None:
    """Assign Action and ActionSlot with full Blender 4.x / 5.x compatibility."""
    if arm_obj.animation_data is None:
        arm_obj.animation_data_create()
    anim_data = arm_obj.animation_data
    anim_data.action = action

    if hasattr(action, "slots"):
        slot = None
        if len(action.slots) > 0:
            slot = action.slots[0]
        else:
            try:
                slot = action.slots.new(id_type="OBJECT", name=arm_obj.name)
            except TypeError:
                slot = action.slots.new("OBJECT", arm_obj.name)
        if slot is not None and hasattr(anim_data, "action_slot"):
            anim_data.action_slot = slot


def set_linear_fcurves(action: bpy.types.Action) -> None:
    if hasattr(action, "fcurves"):
        for fcurve in action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "LINEAR"
    elif hasattr(action, "layers"):
        for layer in action.layers:
            for strip in getattr(layer, "strips", []):
                for bag in getattr(strip, "channelbags", []):
                    for fcurve in getattr(bag, "fcurves", []):
                        for kp in fcurve.keyframe_points:
                            kp.interpolation = "LINEAR"


def author_actions(arm_obj: bpy.types.Object) -> None:
    """Author 4 distinct Blender Actions: `Idle`, `Run`, `Jump`, and `WallSlide`."""
    action_configs = {
        "Idle": {"frame_end": 48, "step": 6, "loop": True},
        "Run": {"frame_end": 24, "step": 3, "loop": True},
        "Jump": {"frame_end": 36, "step": 3, "loop": False},
        "WallSlide": {"frame_end": 36, "step": 4, "loop": True},
    }

    pbones = arm_obj.pose.bones

    for action_name, cfg in action_configs.items():
        action = bpy.data.actions.new(name=action_name)
        action.use_fake_user = True
        action["loop"] = bool(cfg["loop"])
        action["frame_end"] = int(cfg["frame_end"])
        assign_action_compatible(arm_obj, action)

        frame_end = int(cfg["frame_end"])
        step = int(cfg["step"])
        frames = list(range(0, frame_end + 1, step))
        if frames[-1] != frame_end:
            frames.append(frame_end)

        for frame in frames:
            t_norm = frame / float(frame_end)
            phi = 2.0 * math.pi * t_norm

            for pbone in pbones:
                pbone.location = (0.0, 0.0, 0.0)
                pbone.rotation_euler = (0.0, 0.0, 0.0)

            if action_name == "Idle":
                bounce_z = 1.6 * math.sin(phi)
                pbones["root"].location = (bounce_z, 0.0, 0.0)
                pbones["torso"].rotation_euler = (0.0, 0.0, 0.035 * math.sin(phi))
                pbones["head"].rotation_euler = (0.0, 0.0, -0.025 * math.sin(phi + 0.3))
                pbones["upper_arm_l"].rotation_euler = (0.0, 0.0, 0.06 * math.cos(phi))
                pbones["forearm_l"].rotation_euler = (0.0, 0.0, -0.05 * math.sin(phi))
                pbones["thigh_l"].rotation_euler = (0.0, 0.0, -0.05 * math.sin(phi))
                pbones["shin_l"].rotation_euler = (0.0, 0.0, 0.10 * math.sin(phi))
                pbones["thigh_r"].rotation_euler = (0.0, 0.0, 0.04 * math.sin(phi))
                pbones["shin_r"].rotation_euler = (0.0, 0.0, 0.08 * math.sin(phi))
                pbones["upper_arm_r"].rotation_euler = (0.0, 0.0, 0.06 * math.sin(phi))
                pbones["forearm_r"].rotation_euler = (0.0, 0.0, -0.08 * math.sin(phi))

            elif action_name == "Run":
                bounce_z = 4.2 * math.sin(2.0 * phi)
                pbones["root"].location = (bounce_z, 0.0, 0.0)
                pbones["torso"].rotation_euler = (0.0, 0.0, 0.15 + 0.05 * math.sin(2.0 * phi))
                pbones["head"].rotation_euler = (0.0, 0.0, -0.10 - 0.03 * math.sin(2.0 * phi))
                pbones["upper_arm_l"].rotation_euler = (0.0, 0.0, -0.45 * math.sin(phi))
                pbones["forearm_l"].rotation_euler = (0.0, 0.0, -0.25 - 0.20 * math.cos(phi))
                pbones["thigh_r"].rotation_euler = (0.0, 0.0, -0.68 * math.sin(phi))
                pbones["shin_r"].rotation_euler = (
                    0.0,
                    0.0,
                    0.45 + 0.42 * math.sin(phi - math.pi / 3.0),
                )
                pbones["thigh_l"].rotation_euler = (0.0, 0.0, -0.68 * math.sin(phi + math.pi))
                pbones["shin_l"].rotation_euler = (
                    0.0,
                    0.0,
                    0.45 + 0.42 * math.sin(phi + math.pi - math.pi / 3.0),
                )
                pbones["upper_arm_r"].rotation_euler = (0.0, 0.0, 0.25 * math.sin(phi + math.pi))
                pbones["forearm_r"].rotation_euler = (0.0, 0.0, -0.20 - 0.10 * math.sin(phi))

            elif action_name == "Jump":
                half_phi = math.pi * t_norm
                jump_z = 18.0 * math.sin(half_phi) - 3.0 * math.sin(phi)
                pbones["root"].location = (jump_z, 0.0, 0.0)
                pbones["torso"].rotation_euler = (0.0, 0.0, 0.18 * math.sin(phi))
                pbones["head"].rotation_euler = (0.0, 0.0, -0.12 * math.sin(half_phi))
                pbones["upper_arm_l"].rotation_euler = (0.0, 0.0, 0.40 * math.sin(half_phi))
                pbones["forearm_l"].rotation_euler = (0.0, 0.0, -0.30 * math.sin(half_phi))
                pbones["thigh_r"].rotation_euler = (0.0, 0.0, -0.58 * math.sin(half_phi))
                pbones["shin_r"].rotation_euler = (0.0, 0.0, 0.78 * math.sin(half_phi))
                pbones["thigh_l"].rotation_euler = (0.0, 0.0, 0.22 * math.sin(half_phi))
                pbones["shin_l"].rotation_euler = (0.0, 0.0, 0.65 * math.sin(half_phi))
                pbones["upper_arm_r"].rotation_euler = (0.0, 0.0, -0.20 * math.sin(half_phi))
                pbones["forearm_r"].rotation_euler = (0.0, 0.0, -0.25 * math.sin(half_phi))

            elif action_name == "WallSlide":
                # Braced wall-slide pose: torso angled slightly away from wall, one knee high
                slide_jitter = 1.0 * math.sin(phi)
                pbones["root"].location = (slide_jitter, 0.0, 0.0)
                pbones["torso"].rotation_euler = (0.0, 0.0, -0.12 + 0.02 * math.sin(phi))
                pbones["head"].rotation_euler = (0.0, 0.0, 0.15 + 0.02 * math.cos(phi))
                pbones["upper_arm_l"].rotation_euler = (0.0, 0.0, 0.85 + 0.04 * math.sin(phi))
                pbones["forearm_l"].rotation_euler = (0.0, 0.0, 0.35)
                pbones["thigh_r"].rotation_euler = (0.0, 0.0, -0.75 + 0.03 * math.sin(phi))
                pbones["shin_r"].rotation_euler = (0.0, 0.0, 0.90)
                pbones["thigh_l"].rotation_euler = (0.0, 0.0, 0.10 + 0.03 * math.cos(phi))
                pbones["shin_l"].rotation_euler = (0.0, 0.0, 0.25)
                pbones["upper_arm_r"].rotation_euler = (0.0, 0.0, 0.10 * math.sin(phi))
                pbones["forearm_r"].rotation_euler = (0.0, 0.0, -0.15)

            for pbone in pbones:
                pbone.keyframe_insert(data_path="location", frame=frame)
                pbone.keyframe_insert(data_path="rotation_euler", frame=frame)

        set_linear_fcurves(action)

    assign_action_compatible(arm_obj, bpy.data.actions["Idle"])
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()


def main() -> None:
    print("[OrthoRig] Generating procedural demo operative in Blender...")
    setup_scene_and_ortho_camera()
    arm_obj = create_operative_armature()
    create_cutout_slots(arm_obj)
    author_actions(arm_obj)

    BLEND_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUTPUT_PATH))
    print(f"[OrthoRig] Saved Blender source file: {BLEND_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
