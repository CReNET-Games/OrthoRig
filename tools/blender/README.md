# OrthoRig Blender Pipeline (`/tools/blender`)

Headless Blender Python (`bpy`) tooling for authoring, packing, and compiling 2D planar armatures into `.orthorig.json` skeletal assets and `.atlas.png` spritesheets for the `@crenet/orthorig` runtime.

## Licensing & Legal Boundary (MIT / GPLv3 Compatibility)

While the **OrthoRig** repository, the `.orthorig.json` schema/output files, the baked `.atlas.png` spritesheets, and the `@crenet/orthorig` TypeScript runtime are licensed under the **MIT License** (`Copyright (c) 2026 Crenet Games`), the Python scripts in `/tools/blender/` directly import and execute against Blender's `bpy` Python API.

* **Blender Scripts (`/tools/blender/*.py`):** Because Blender's `bpy` API is licensed under the GNU General Public License (GPLv3), these Python scripts are distributed as **GPLv3-compatible** when executed inside the Blender runtime environment.
* **Compiled Output (`*.orthorig.json`, `*.atlas.png`) & Runtime (`@crenet/orthorig`):** The data and image files produced by the compiler and the TypeScript runtime library do not link against or include any `bpy` code and remain **100% pure, unrestricted MIT**. You may freely bundle `.orthorig.json` assets, `.atlas.png` textures, and `@crenet/orthorig` in commercial, proprietary, or open-source games without any GPL obligations.

---

## Scripts

### 1. `generate_demo_operative.py`
Procedurally constructs the 2D planar `OperativeRig` armature in the Blender `X-Z` plane (`Z`-up, standing on `Z = 0`) with:
* **11 Bones:** `root`, `torso`, `head`, `upper_arm_l`, `forearm_l`, `upper_arm_r`, `forearm_r`, `thigh_l`, `shin_l`, `thigh_r`, `shin_r`.
* **4 Named Socket `EMPTY` Objects:** `socket_muzzle` (`forearm_r`), `socket_offhand_grip` (`forearm_r`), `socket_head_top` (`head`), and `socket_thruster` (`torso`).
* **14 Bone-Parented Cutout Meshes:** Arranged with `Y`-depth draw order (`y_depth`) and the 4-color High-Gloss Survival palette (`#0A0B0E`, `#F4F6F8`, `#00F0FF`, `#FF2A54`).
* **2-Bone IK & 1-Bone Look-At Constraints:**
  * `right_arm_aim` (`upper_arm_r` $\to$ `forearm_r`, `ik_target = "aim_cursor"`, `auto_flip_facing = True`).
  * `left_arm_grip` (`upper_arm_l` $\to$ `forearm_l`, `ik_target = "offhand_grip"`, `ik_target_socket = "offhand_grip"`, `auto_flip_facing = False`).
  * `head_look_at` (`head`, `look_at_target = "aim_cursor"`, `look_at_mix = 0.55`, `[-0.65, 0.65]` rad).
* **5 Authored Blender Actions:** `Idle`, `Run` (with `footstep_r` and `footstep_l` pose markers), `Jump` (with `jump_launch` pose marker), `WallSlide`, and `Recoil` (non-looping 4-frame additive kick).

```bash
blender -b -P tools/blender/generate_demo_operative.py
```
Outputs: `examples/operative-mvp/assets/source/operative_demo.blend`

### 2. `orthorig_compiler.py`
Headless compiler that reads any `.blend` file containing an OrthoRig armature:
1. Evaluates the armature in `REST` pose and converts Blender 3D `Z`-up `(X, Z)` coordinates into PixiJS 2D `Y`-down `(X, -Z)` coordinates (converting Blender `Y` depth via `zIndex = round(-y_depth * 1000)`).
2. Exports bone-parented `EMPTY` objects into `sockets` (stripping any leading `socket_` prefix from the object name).
3. Exports bone-parented `MESH` cutout slots and invokes `orthorig_spritesheet_baker.py` to bake `<output_base>.atlas.png` and populate `atlasRegion` on each slot.
4. Extracts 2-Bone IK (`ik_constraints`) and 1-Bone Look-At (`look_at_constraints`) custom properties from PoseBones, sorting primary auto-flipping chains ahead of secondary socket-tracking chains.
5. Samples all Blender Actions into local bone keyframe tracks (`tracks`) and exports `action.pose_markers` into `events`.
6. Validates the compiled dictionary against `/schema/orthorig.schema.json` (Draft 2020-12) and writes the `.orthorig.json` file.

```bash
blender -b examples/operative-mvp/assets/source/operative_demo.blend \
  -P tools/blender/orthorig_compiler.py -- \
  examples/operative-mvp/public/assets/operative.orthorig.json
```

### 3. `orthorig_spritesheet_baker.py`
Pure-Python RGBA PNG spritesheet packer used by `orthorig_compiler.py`. Packs all cutout slots into horizontal shelves with configurable transparent border padding (`padding_px = 4`), encodes the PNG using standard-library `zlib` and `struct`, and returns `{ texture, x, y, width, height }` `atlasRegion` rects for every slot.

---

## Blender Custom Property Reference for Technical Artists

### Bone / PoseBone Custom Properties
* `y_depth` (`float`, default `-0.05`): Controls bone `zIndex` (`round(-y_depth * 1000)`).
* **2-Bone IK (set on the upper PoseBone of a 2-bone chain):**
  * `ik_role = "upper"` (required to register a 2-bone chain)
  * `ik_lower_bone = "<lower_bone_name>"` (required)
  * `ik_chain_name = "<constraint_name>"` (default `f"ik_{bone.name}"`)
  * `ik_target = "<target_name>"` (default `"aim_cursor"`)
  * `ik_target_socket = "<socket_name>"` (optional; automatically targets a named socket on the rig unless overridden by `rig.setIKTarget`)
  * `bend_dir = 1 | -1` (default `1`)
  * `auto_flip_facing = True | False` (default `True`; set `False` on secondary chains like off-hand grips or legs)
  * `ik_mix = 0.0..1.0` (default `1.0`)
* **1-Bone Look-At (set on the tracked PoseBone):**
  * `look_at_target = "<target_name>"` (required to register a Look-At constraint)
  * `look_at_name = "<constraint_name>"` (default `f"look_at_{bone.name}"`)
  * `look_at_mix = 0.0..1.0` (default `1.0`)
  * `look_at_min_angle = <radians>` (optional lower clamp relative to rest pose)
  * `look_at_max_angle = <radians>` (optional upper clamp relative to rest pose)

### Socket `EMPTY` Custom Properties
Parent an `EMPTY` object to the Armature (`parent_type = 'BONE'`, `parent_bone = '<bone_name>'`):
* `socket_name` (`str`, optional): Defaults to `obj.name` with any leading `socket_` prefix stripped.
* `socket_x`, `socket_y` (`float`): Local offset along and perpendicular to the parent bone in PixiJS `Y`-down space.
* `socket_rotation` (`float`, radians): Local rotation offset relative to the parent bone.

### Action Custom Properties & Pose Markers
* `loop` (`bool`): Whether the clip loops continuously on playback (`True` for `Idle`/`Run`/`WallSlide`, `False` for `Jump`/`Recoil`).
* `frame_end` (`int`): Explicit end frame of the clip (`duration = frame_end / fps`).
* **Pose Markers (`action.pose_markers`):** Any pose marker added to an Action is exported as `{ "name": marker.name, "time": marker.frame / fps }` and emitted at runtime via `rig.onAnimationEvent(...)`.
