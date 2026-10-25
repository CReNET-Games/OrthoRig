# OrthoRig Blender Pipeline (`/tools/blender`)

Headless Blender Python (`bpy`) tooling for authoring and compiling 2D planar armatures into `.orthorig.json` skeletal assets for the `@crenet/orthorig` runtime.

## Licensing & Legal Boundary (MIT / GPLv3 Compatibility)

While the **OrthoRig** repository, the `.orthorig.json` schema/output files, and the `@crenet/orthorig` TypeScript runtime are licensed under the **MIT License** (`Copyright (c) 2026 Crenet Games`), the Python scripts in `/tools/blender/` directly import and execute against Blender's `bpy` Python API.

* **Blender Scripts (`/tools/blender/*.py`):** Because Blender's `bpy` API is licensed under the GNU General Public License (GPLv3), these Python scripts are distributed as **GPLv3-compatible** when executed inside the Blender runtime environment.
* **Compiled Output (`*.orthorig.json`) & Runtime (`@crenet/orthorig`):** The data files produced by the compiler and the TypeScript runtime library do not link against or include any `bpy` code and remain **100% pure, unrestricted MIT**. You may freely bundle `.orthorig.json` assets and `@crenet/orthorig` in commercial, proprietary, or open-source games without any GPL obligations.

---

## Scripts

### 1. `generate_demo_operative.py`
Procedurally constructs the 2D planar `OperativeRig` armature in the Blender `X-Z` plane (`Z`-up) with an orthographic camera, 11 bones (`root`, `torso`, `head`, `upper_arm_l`, `forearm_l`, `upper_arm_r`, `forearm_r`, `thigh_l`, `shin_l`, `thigh_r`, `shin_r`), bone-parented 2D cutout meshes with `Y`-depth draw order, custom 2-bone IK properties (`ik_target = "aim_cursor"`, `bend_dir = 1`), and 4 keyframed Blender Actions (`Idle`, `Run`, `Jump`, `WallSlide`).

```bash
blender -b -P tools/blender/generate_demo_operative.py
```
Outputs: `examples/operative-mvp/assets/source/operative_demo.blend`

### 2. `orthorig_compiler.py`
Headless compiler that reads any `.blend` file containing an OrthoRig armature, converts Blender 3D `Z`-up `(X, Z)` coordinates into PixiJS 2D `Y`-down `(X, -Z)` coordinates (using Blender `Y` depth for `zIndex`), validates the compiled structure against `/schema/orthorig.schema.json`, and writes the `.orthorig.json` output.

```bash
blender -b examples/operative-mvp/assets/source/operative_demo.blend \
  -P tools/blender/orthorig_compiler.py -- \
  examples/operative-mvp/public/assets/operative.orthorig.json
```
