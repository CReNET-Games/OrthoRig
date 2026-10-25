# OrthoRig Roadmap & Architecture Scope

This document tracks implemented milestones and intentionally deferred features for **`@crenet/orthorig`** (`CReNET-Games/OrthoRig`).

---

## Completed Milestones

### Milestone 1 — Core Compiler, Analytic 2-Bone IK & Fight-Box MVP
* **Formal JSON Schema (`/schema/orthorig.schema.json`):** Draft 2020-12 contract bridging headless Blender (`bpy`) and PixiJS v8.
* **Headless Blender Pipeline (`/tools/blender/`):** Procedural rig generator (`generate_demo_operative.py`) and compiler (`orthorig_compiler.py`) converting Blender `X-Z` (`Z`-up) armatures, slots, and Actions into PixiJS `X-Y` (`Y`-down).
* **Deterministic $O(1)$ Law of Cosines 2-Bone IK (`solveTwoBoneChain`):** Reach clamping to $[|L_1 - L_2| + 10^{-4}, L_1 + L_2 - 10^{-4}]$, zero `NaN` singularities, and automatic horizontal root-flip (`scale.x = -1`) when aiming behind the spine.

### Milestone 2 — Named Multi-Target IK, FK/IK `mix` & 1-Bone Look-At Constraints
* **Named Multi-Target IK (`rig.setIKTarget`, `targetSocket`):**
  * Supports simultaneous primary aim chains (`right_arm_aim` tracking `"aim_cursor"`) and secondary non-flipping chains (`autoFlipFacing: false`), including automatic socket-driven off-hand weapon grips (`left_arm_grip` tracking `"offhand_grip"` on `forearm_r`) and procedural foot placement.
* **FK $\leftrightarrow$ IK Blend Weight (`mix` $\in [0, 1]$):**
  * Smooth shortest-arc angular blending between animated FK poses and solved Analytic IK via `rig.setConstraintMix(constraintName, mix)`.
* **1-Bone Look-At Solver (`solveLookAtConstraint`, `look_at_constraints`):**
  * Single-bone target tracking with clamped local angle limits (`[minAngle, maxAngle]`) around rest rotation (e.g., `head` tracking `"aim_cursor"`).

### Milestone 3 — Named Sockets, Child Attachments & Timeline Events
* **Named Sockets (`sockets`, `rig.getSocket`, `rig.attachToSocket`, `rig.getSocketWorldTransform`):**
  * Exported from Blender `EMPTY` objects parented to armature bones (`muzzle`, `offhand_grip`, `head_top`, `thruster`).
  * Allows gameplay systems to spawn projectiles from exact muzzle transforms or mount dynamic `PIXI.Container` children (weapons, muzzle flashes, lights, particle emitters).
* **Timeline Events (`events`, `rig.onAnimationEvent`):**
  * Exported from Blender `action.pose_markers` (`footstep_r`, `footstep_l`, `jump_launch`) for cosmetic/audio feedback cues without coupling gameplay authority to animation frames.

### Milestone 4 — Layered & Additive Animation Blending (`rig.playLayer`, `rig.stopLayer`)
* **Multi-Layer Playback:**
  * Base locomotion (`Idle`, `Run`, `Jump`, `WallSlide`) runs on Layer `0` while upper-body or impulse actions (`Recoil`) blend on Layer `1+` in `"additive"` or `"override"` mode (with optional `boneMask`), evaluated prior to the final IK pass.

### Milestone 5 — Automated Blender Spritesheet Atlas Baker
* **Headless PNG Atlas Packing (`tools/blender/orthorig_spritesheet_baker.py`):**
  * Automatically packs cutout slots into a padded RGBA PNG spritesheet (`*.atlas.png`) alongside `.orthorig.json` and populates `atlasRegion` coordinates on every slot, with runtime switching via `rig.setAtlasMode(true | false)`.

---

## Intentionally Deferred / Future Scope

### 1. 2D Skinned Mesh / Free-Form Deformation (FFD) Slots (`PIXI.MeshSimple`)
* **Status:** Deferred (Not currently needed).
* **Context:** Rigid cutout slots (`PIXI.Graphics` and `PIXI.Sprite`) attached to hierarchical bones + sockets cover articulated characters, armor plates, and modular weapons with minimal CPU/GPU overhead. Multi-bone weighted 2D mesh skinning (for soft cloth, capes, or flexible tubing exported from Blender `vertex_groups`) is deferred until a game asset requires continuous mesh deformation.

### 2. Built-In Slot Variant Swapping ("Skins") vs. Named Sockets
* **Status:** Deferred in favor of **Named Sockets (`attachToSocket`)**.
* **Design Distinction:**
  * **Named Sockets (`rig.attachToSocket("muzzle", container)`)** are external transform mount points parented to a bone. Gameplay code can attach, swap, or remove any `PIXI.Container` hierarchy (weapons, backpacks, VFX, lights) at runtime without baking every equipment permutation into `.orthorig.json`.
  * **Slot Variant Swapping** would store multiple alternative cutout geometries/sprites inside each slot definition in `.orthorig.json` (e.g., `slot_head_visor` having `"default"`, `"cracked"`, and `"nightvision"` sub-entries). If cosmetic body-part skin tables are needed in the future, they can be added as an optional `skins` map in `/schema/orthorig.schema.json`.
