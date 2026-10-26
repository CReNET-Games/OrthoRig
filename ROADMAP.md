# OrthoRig Roadmap (`@crenet/orthorig`)

This document outlines the forward-looking roadmap and upcoming architectural milestones for **`CReNET-Games/OrthoRig`** (`@crenet/orthorig`).

> **Shipped Baseline (`v0.1.0` – `v0.3.0`):**
> The core Blender-to-PixiJS v8 compiler, Draft 2020-12 JSON Schema, Analytic $O(1)$ 2-Bone IK & 1-Bone Look-At solvers, Named Sockets (`attachToSocket`, `getSocketWorldTransform` with `relativeTo`), Timeline Events (`onAnimationEvent`), Layered & Additive Animation Blending (`playLayer`), Automated PNG Spritesheet Baker (`*.atlas.png`), Schema/Container Scaling (`scaleOrthoRigSchema`), Aim-by-Angle (`updateWithAimAngle`), and Single-Call Bundle Loader (`loadOrthoRigBundle`) are **complete and shipped**. See [`README.md`](./README.md) and [`CHANGELOG.md`](./CHANGELOG.md) for current usage.

---

## Upcoming & Future Milestones

### 1. Hand-Painted Texture & Multi-Map Spritesheet Baking (Albedo + Normal + Emissive)
* **Goal:** Extend `tools/blender/orthorig_spritesheet_baker.py` beyond flat/bordered vector cutouts to pack UV-mapped raster textures (`ShaderNodeTexImage`) and orthographic Blender Workbench/Eevee render passes directly from `.blend` materials.
* **Key Capabilities:**
  * Pack hand-painted or textured Blender slot meshes into `<name>.atlas.png` with automatic UV island unwrapping and bleed-margin dilation (extruding edge pixels into `padding_px`).
  * Optional secondary atlas pages (`<name>.normal.png`, `<name>.emissive.png`) for 2D dynamic normal-mapped lighting and emissive bloom in PixiJS custom shaders.

### 2. Procedural Secondary Motion (2D Spring / Jiggle / Pendulum Bones)
* **Goal:** Bring reactive physical motion to capes, ponytails, antennas, holsters, and dangling cables without requiring hand-keyed animations for every movement velocity.
* **Key Capabilities:**
  * Export bone custom properties (`spring_stiffness`, `spring_damping`, `spring_gravity`, `spring_min_angle`, `spring_max_angle`) into `spring_constraints` in `/schema/orthorig.schema.json`.
  * Evaluate a deterministic, framerate-independent 1D angular verlet/critically-damped spring solver in `@crenet/orthorig` driven by character root velocity/acceleration deltas.

### 3. Terrain / Stair Foot-Placement IK & Pelvis Elevation Solver
* **Goal:** Provide a turnkey 2-legged ground adaptation helper on top of `solveTwoBoneIK(..., autoFlipFacing: false)` for uneven slopes, stairs, and ledges.
* **Key Capabilities:**
  * Accept left/right ground contact heights and surface normals from the game's physics raycaster.
  * Automatically lower the `root` (pelvis) bone by `min(footDeltaL, footDeltaR)` so neither leg hyper-extends on steep slopes, solve 2-Bone IK for both legs, and align foot bone rotations to the terrain normal.

### 4. Slot Variant Swapping ("Skins" & Cosmetic Loadouts)
* **Goal:** Support swapping body-part visuals (e.g., intact vs. cracked visor, armor tier variants, faction colorways, or open-hand vs. closed-fist cutouts) within the rig's sorted slot stack.
* **How Slot Swapping Differs from Named Sockets (`attachToSocket`):**
  * **Named Sockets *(Already Implemented)*:** External `PIXI.Container` mount points parented to a bone (`muzzle`, `offhand_grip`, `head_top`, `thruster`). Best for modular equipment, weapons, particle emitters, and lights attached from game code.
  * **Slot Variant Swapping *(Future)*:** Internal lookup tables (`skins` / `slotVariants` in `.orthorig.json`) that switch which `atlasRegion` or polygon geometry an existing body-part slot (`slot_head_visor`, `slot_torso_plate`) renders via `rig.setSkin("recon_mk2")` or `rig.setSlotVariant("slot_head_visor", "damaged")`.

### 5. Per-Bone Hitboxes & Procedural Hit-React Impulses
* **Goal:** Enable localized limb hit detection (headshots, limb armor breaks, shield blocks) and zero-allocation physical hit reactions.
* **Key Capabilities:**
  * Export bone-parented bounding shapes (`hitboxes`) from Blender into `.orthorig.json` and expose a fast `rig.raycastBones(x0, y0, x1, y1)` / `rig.queryPointHit(worldX, worldY)` query in `@crenet/orthorig`.
  * Add `rig.applyBoneImpulse(boneName, deltaAngleRadians, decaySeconds)` to layer instantaneous angular knockback onto a struck bone (e.g., `head` or `torso` flinching when hit) prior to the IK pass.

### 6. Interactive Blender N-Panel Authoring Add-on & Live Browser Hot-Reload
* **Goal:** Replace manual Blender Custom Property typing with a dedicated **OrthoRig** sidebar panel (`VIEW3D_PT_orthorig`) inside Blender's 3D Viewport.
* **Key Capabilities:**
  * One-click operators: *"Configure 2-Bone IK Chain"*, *"Add Named Socket Empty"*, *"Add 1-Bone Look-At"*, *"Assign Slot Y-Depth Layer"*, and *"Validate Rig against Schema"*.
  * Watch-mode WebSocket bridge (`make watch-rig`) that automatically recompiles `.orthorig.json` + `.atlas.png` on `.blend` save and hot-reloads the live PixiJS preview in the browser.

### 7. 2D Skinned Mesh & Free-Form Deformation Slots (`PIXI.MeshSimple`)
* **Goal:** Support continuous multi-bone mesh deformation for soft cloth, coats, organic creatures, and flexible tubing where rigid cutout joints would show seams.
* **Key Capabilities:**
  * Export 2D triangulated mesh vertices, UVs, and Blender `vertex_groups` bone weights (`up to 4 bones per vertex`) into `slot.shapeType = "mesh"`.
  * Deform vertices on CPU or vertex shader into `PIXI.MeshSimple` buffers each tick.

### 8. Compact Binary Format (`.orthorig.bin`) & Shared-Pose Crowd Instancing
* **Goal:** Scale to 100+ simultaneous skeletal entities in horde/extraction scenarios with minimal memory and CPU footprint.
* **Key Capabilities:**
  * Optional quantized binary track encoding (`Float16` keyframe tables) alongside `.orthorig.json`.
  * Shared animation pose evaluation cache for off-screen or crowd-batched entities sharing the same clip timestamp.
