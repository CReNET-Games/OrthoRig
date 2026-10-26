# OrthoRig (`@crenet/orthorig`)

[![CI](https://github.com/CReNET-Games/OrthoRig/actions/workflows/ci.yml/badge.svg)](https://github.com/CReNET-Games/OrthoRig/actions/workflows/ci.yml)
[![IP & Similarity Scan](https://github.com/CReNET-Games/OrthoRig/actions/workflows/ip-check.yml/badge.svg)](https://github.com/CReNET-Games/OrthoRig/actions/workflows/ip-check.yml)
[![FOSSA Status](https://app.fossa.com/api/projects/custom%2B63939%2Fgithub.com%2FCReNET-Games%2FOrthoRig.svg?type=shield)](https://app.fossa.com/projects/custom%2B63939%2Fgithub.com%2FCReNET-Games%2FOrthoRig?ref=badge_shield)
[![npm version](https://img.shields.io/npm/v/@crenet/orthorig.svg)](https://www.npmjs.com/package/@crenet/orthorig)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

An open-source, MIT-licensed 2D orthographic skeletal animation compiler and **Analytic 2-Bone Inverse Kinematics (IK)** runtime bridging **Blender** (`bpy`) and **PixiJS v8** (TypeScript).

## Why OrthoRig?

Most 2D skeletal animation runtimes in the web ecosystem require proprietary editors and restrictive runtime licenses that prohibit open redistribution or derivative tooling.

**OrthoRig** provides a deterministic, zero-cost workflow: artists and engineers author 2D planar armatures, sockets, and actions directly inside **Blender**, compile them into a schema-validated `.orthorig.json` asset (plus an automatically baked `.atlas.png` spritesheet), and render them in **PixiJS v8** using `@crenet/orthorig` with native scene-graph containers (`PIXI.Container`, `PIXI.Graphics`, and `PIXI.Sprite`).

## Key Features

* **Analytic $O(1)$ 2-Bone IK & 1-Bone Look-At Solvers:**
  * Law of Cosines 2-Bone IK with strict reach clamping ($[|L_1 - L_2| + 10^{-4}, L_1 + L_2 - 10^{-4}]$), automatic horizontal root-flip (`scale.x = -1`), FK $\leftrightarrow$ IK `mix` blending ($[0, 1]$), and socket-driven secondary chains (such as two-handed weapon grips and foot placement).
  * 1-Bone Look-At solver with clamped rotational limits (`[minAngle, maxAngle]`) for head/visor tracking.
* **Named Sockets & Child Attachments (`rig.attachToSocket`, `rig.getSocketWorldTransform`):**
  * Exported from Blender `EMPTY` objects parented to bones (`muzzle`, `offhand_grip`, `head_top`, `thruster`) for exact projectile spawning and modular `PIXI.Container` attachments.
* **Layered & Additive Animation Blending (`rig.playLayer`):**
  * Play base locomotion (`Idle`, `Run`, `Jump`, `WallSlide`) on Layer `0` while blending additive or masked upper-body actions (`Recoil`) on Layer `1+`.
* **Timeline Events (`rig.onAnimationEvent`):**
  * Exported from Blender `action.pose_markers` (`footstep_r`, `footstep_l`, `jump_launch`) for frame-accurate audio and cosmetic particle cues.
* **Automated Spritesheet Atlas Baker:**
  * Compiles cutout slots into a packed RGBA PNG spritesheet (`*.atlas.png`) with `atlasRegion` metadata and runtime switching (`rig.setAtlasMode(true | false)`).

See **[`ROADMAP.md`](./ROADMAP.md)** for architectural details on completed milestones, the design distinction between **Named Sockets** and **Slot Variant Swapping**, and intentionally deferred scope (such as 2D weighted mesh deformation).

---

## Artist & Programmer Collaboration Guide: How Blender Naming Affects Gameplay

In OrthoRig, names and custom properties authored in Blender compile directly into the identifiers used by game programmers in TypeScript. Following these conventions ensures assets drop into gameplay code without manual glue changes.

### 1. Coordinate System & Draw Order (`zIndex`)

| Blender (`Z`-Up Orthographic) | Compiled `.orthorig.json` / PixiJS v8 (`Y`-Down) | Notes for Artists |
| :--- | :--- | :--- |
| **`X` axis** (Left / Right) | **`x = +X`** (`+X` faces right by default) | Author characters facing **right (`+X`)** in Rest Pose so horizontal aiming flips (`scale.x = -1`) mirror cleanly. |
| **`Z` axis** (Up / Down) | **`y = -Z`** (`Z = 0` is the ground plane) | Place the character's feet on **`Z = 0`**. A pelvis at `Z = +64` in Blender becomes `restY = -64` above the ground origin `(0, 0)` in PixiJS. |
| **`Y` axis** (Depth toward camera) | **`zIndex = round(-y_depth * 1000)`** | More negative `Y` values (`-0.25`) are closer to the front orthographic camera and render **in front of** less negative `Y` values (`-0.02`). |

### 2. Naming & Custom Property Contract

| Blender Element | Naming / Property Convention in Blender | Gameplay / Programmer Effect in `@crenet/orthorig` |
| :--- | :--- | :--- |
| **Bones** (`Bone` / `PoseBone`) | Lowercase snake_case: `root`, `torso`, `head`, `upper_arm_r`, `forearm_r`, `upper_arm_l`, `forearm_l`, `thigh_l`, `shin_l`, `thigh_r`, `shin_r` | Exposed in `rig.bones.get("<bone>")`, `rig.getBoneWorldTransform("<bone>")`, and `boneMask: ["torso", "head"]` in `rig.playLayer(...)`. |
| **Named Sockets** (`EMPTY` parented to Armature Bone) | Object name `socket_<name>` (e.g. `socket_muzzle`, `socket_offhand_grip`, `socket_head_top`, `socket_thruster`) or custom property `socket_name`. | Compiler strips the `socket_` prefix. Programmers attach objects via `rig.attachToSocket("muzzle", vfx)` or query world transforms via `rig.getSocketWorldTransform("muzzle")` to spawn projectiles. |
| **Cutout Slots** (`MESH` parented to Armature Bone) | Object name `slot_<part>` (e.g. `slot_torso_plate`, `slot_weapon_body`) or custom property `slot_name`. | Exposed in `rig.slots.get("slot_torso_plate")` and used as keys when passing custom artwork textures in `new OrthoRig(schema, { textures })`. |
| **Primary 2-Bone Aim IK** (Custom props on upper `PoseBone`, e.g. `upper_arm_r`) | `ik_role = "upper"`<br>`ik_lower_bone = "forearm_r"`<br>`ik_chain_name = "right_arm_aim"`<br>`ik_target = "aim_cursor"`<br>`bend_dir = 1` (or `-1`)<br>`auto_flip_facing = True`<br>`ik_mix = 1.0` | Drives the 2-bone chain toward the `"aim_cursor"` target passed to `rig.update(dt, aimX, aimY)` or `rig.setIKTarget(x, y, "aim_cursor")`. Because `auto_flip_facing = True`, aiming behind `rig.x` automatically flips the character (`rig.scale.x = -1`) and inverts the elbow bend direction. |
| **Secondary / Socket-Driven 2-Bone IK** (Custom props on upper `PoseBone`, e.g. `upper_arm_l`) | `ik_role = "upper"`<br>`ik_lower_bone = "forearm_l"`<br>`ik_chain_name = "left_arm_grip"`<br>`ik_target = "offhand_grip"`<br>`ik_target_socket = "offhand_grip"`<br>`auto_flip_facing = False` | Automatically pins the off-hand wrist to the `"offhand_grip"` socket on the weapon every frame without flipping character facing. Programmers can toggle it at runtime via `rig.setConstraintMix("left_arm_grip", 0 \| 1)` or override it with `rig.setIKTarget(x, y, "offhand_grip")`. |
| **1-Bone Look-At Constraint** (Custom props on `PoseBone`, e.g. `head`) | `look_at_name = "head_look_at"`<br>`look_at_target = "aim_cursor"`<br>`look_at_mix = 0.55`<br>`look_at_min_angle = -0.65`<br>`look_at_max_angle = 0.65` | Rotates the single bone toward `"aim_cursor"` clamped within `[minAngle, maxAngle]` radians relative to its rest rotation, blended by `mix`. |
| **Actions (Base & Layered)** (`bpy.data.actions`) | Action names (`Idle`, `Run`, `Jump`, `WallSlide`, `Recoil`) + custom properties `loop` (`True`/`False`) and `frame_end` (`int`). | Programmers trigger base locomotion with `rig.play("Run", 0.12)` and secondary overlays/impulses with `rig.playLayer(1, "Recoil", { mode: "additive" })`. **Note for Additive Actions:** Frame `0` is treated as the neutral baseline pose; the runtime applies `(pose(t) - pose(0)) * weight` on top of Layer `0`. |
| **Timeline Events** (`action.pose_markers`) | Pose markers added in the Action Editor (`footstep_r`, `footstep_l`, `jump_launch`). | Exported as `{ name, time }` (in seconds) and emitted via `rig.onAnimationEvent((ev) => ...)`. Use pose markers for **cosmetic/audio cues** (footstep dust, SFX); keep gameplay authority (hitboxes, cooldowns, damage) in game code. |

---

## How Spritesheet Atlas Generation Works

When you compile a `.blend` file with [`tools/blender/orthorig_compiler.py`](./tools/blender/orthorig_compiler.py), it automatically invokes [`tools/blender/orthorig_spritesheet_baker.py`](./tools/blender/orthorig_spritesheet_baker.py) to produce a packed RGBA PNG spritesheet alongside the `.orthorig.json` file:

1. **Output Naming Convention:**
   * Compiling `<name>.orthorig.json` (e.g. `operative.orthorig.json`) automatically generates `<name>.atlas.png` (`operative.atlas.png`) in the same directory and sets `"meta": { "atlasTexture": "operative.atlas.png" }`.
2. **Shelf Bin-Packing & Bleed Padding:**
   * Every slot's cutout geometry (`width`, `height`, `colorHex`, `strokeColorHex`) is rasterized and packed left-to-right into horizontal shelves (`max_atlas_width = 256 * scale_factor`) with transparent border padding (`padding_px = 4` by default) so adjacent sub-textures never bleed during GPU rotation or bilinear filtering.
   * The final atlas height is rounded up to a multiple of `16` pixels for clean GPU texture alignment.
3. **Zero-Dependency Deterministic PNG Encoding:**
   * The baker encodes the RGBA8888 pixel buffer directly into a compressed PNG (`IHDR`, `IDAT`, `IEND`) using Python's built-in `zlib` and `struct` modules—no external Pillow or ImageMagick installation is required in headless Blender or CI.
4. **Per-Slot `atlasRegion` Metadata:**
   * Each slot entry in `.orthorig.json` receives an `atlasRegion` rect:
     ```json
     "atlasRegion": {
       "texture": "operative.atlas.png",
       "x": 4,
       "y": 4,
       "width": 16,
       "height": 22
     }
     ```
5. **Three Ways to Render Slots at Runtime in `@crenet/orthorig`:**
   * **Procedural Vector Cutouts (Default):** Omit `preferAtlasSprites` (or pass `false`) to render crisp `PIXI.Graphics` polygons/rectangles directly from the slot data.
   * **Baked Spritesheet Atlas (`PIXI.Sprite`):** Pass `{ atlasTexture, preferAtlasSprites: true }` to `new OrthoRig(...)`—or toggle at any time via `rig.setAtlasMode(true, atlasTexture)`—to slice `PIXI.Texture` frames from the shared `.atlas.png` spritesheet.
   * **Custom Per-Slot Textures:** Pass `{ textures: { slot_weapon_body: customTexture } }` to override specific slots with custom hand-painted `PIXI.Texture` assets.

---

## Monorepo Architecture

* **[`/schema/orthorig.schema.json`](./schema/orthorig.schema.json):** Formal JSON Schema (Draft 2020-12) defining the contract between the Blender compiler and the TypeScript runtime (`meta`, `bones`, `sockets`, `slots`, `ik_constraints`, `look_at_constraints`, `animations`).
* **[`/tools/blender/`](./tools/blender/README.md):** Headless Blender Python (`bpy`) scripts:
  * [`generate_demo_operative.py`](./tools/blender/generate_demo_operative.py) — procedural `.blend` rig, socket, & action builder (standing on the $Z = 0$ ground plane).
  * [`orthorig_compiler.py`](./tools/blender/orthorig_compiler.py) — headless `.blend` $\to$ `.orthorig.json` compiler & schema validator.
  * [`orthorig_spritesheet_baker.py`](./tools/blender/orthorig_spritesheet_baker.py) — automated RGBA PNG spritesheet packer.
* **[`/packages/runtime/`](./packages/runtime/src/index.ts):** The standalone `@crenet/orthorig` TypeScript library (zero external dependencies beyond peer dependency `pixi.js ^8.0.0`).
* **[`/examples/operative-mvp/`](./examples/operative-mvp/src/main.ts):** Interactive Vite + TypeScript + PixiJS v8 fight-box demo with keyboard/mouse and dual-stick gamepad controls, two-handed IK weapon grip, additive recoil, muzzle socket projectile firing, footstep timeline events, and live debug controls.

## Live Demo

* **Hosted on GitHub Pages:** **[https://crenet-games.github.io/OrthoRig/](https://crenet-games.github.io/OrthoRig/)**
  *(Automatically built and deployed from `main` via [`.github/workflows/pages.yml`](./.github/workflows/pages.yml)).*
* **Run Locally:**
  ```bash
  make install
  make dev
  ```
  Open `http://localhost:5173` to test player locomotion (`A`/`D` or Left Stick run, `Space`/`A`/`LB` jump & double-jump, `Shift`/`B`/`LT` thruster dash, airborne wall-slide), 360° mouse or Right-Stick IK aiming, `LMB`/`RT`/`RB` projectile firing from the `muzzle` socket with additive recoil, and the real-time skeleton debug HUD.

## Library Usage (`@crenet/orthorig`)

```bash
npm install @crenet/orthorig
```

```typescript
import { loadOrthoRigBundle, OrthoRig } from "@crenet/orthorig";
import { Application, Container } from "pixi.js";

const app = new Application();
await app.init({ width: 1280, height: 720 });
document.body.appendChild(app.canvas);

// 1. Load compiled .orthorig.json + sibling .atlas.png (with optional uniform scale) in one call
const { schema, atlasTexture } = await loadOrthoRigBundle(
	"./assets/operative.orthorig.json",
	{ scale: 0.3 },
);

// 2. Instantiate OrthoRig and attach to an entity container or stage
const entitiesLayer = new Container();
app.stage.addChild(entitiesLayer);

const playerContainer = new Container();
playerContainer.position.set(640, 400);
entitiesLayer.addChild(playerContainer);

const rig = new OrthoRig(schema, {
	initialAnimation: "Idle",
	atlasTexture,
	preferAtlasSprites: true, // Toggle at any time via rig.setAtlasMode(false)
	debugDraw: false,
});
playerContainer.addChild(rig);

// 3. Attach custom child containers to named sockets & subscribe to timeline events
const muzzleVfx = new Container();
rig.attachToSocket("muzzle", muzzleVfx);

rig.onAnimationEvent((ev) => {
	if (ev.name.startsWith("footstep")) {
		// Trigger cosmetic footstep dust or audio cue
	}
});

// 4. Cross-fade base locomotion on Layer 0 & trigger additive Recoil on Layer 1
rig.play("Run", 0.12);
rig.playLayer(1, "Recoil", { mode: "additive", loop: false, weight: 1.0 });

// 5. Advance animation and solve 360° Analytic 2-Bone IK + 1-Bone Look-At each tick
//    using either cursor coordinates (`rig.update(dt, targetX, targetY)`) or an aim angle in radians:
app.ticker.add((ticker) => {
	const dt = ticker.deltaMS / 1000;
	const aimAngleRadians = -0.25;
	rig.updateWithAimAngle(dt, aimAngleRadians, rig.facing);

	// Read exact socket transform in world space or relative to `entitiesLayer`
	const muzzle = rig.getSocketWorldTransform("muzzle", entitiesLayer);
});
```

## Compiling Rigs from Blender

```bash
# Generate the demo .blend file and compile it to .orthorig.json + .atlas.png
make build-rig

# Or run the compiler directly against any .blend file:
blender -b examples/operative-mvp/assets/source/operative_demo.blend \
  -P tools/blender/orthorig_compiler.py -- \
  examples/operative-mvp/public/assets/operative.orthorig.json
```

## Development

Use the root [`Makefile`](./Makefile) to build, lint, test, and verify clean-room IP compliance:

```bash
make install    # Install workspace dependencies
make build      # Build @crenet/orthorig and examples/operative-mvp
make lint       # Run Biome linter & formatter check
make lint-fix   # Auto-fix lint and formatting issues
make ip-check   # Run Clean-Room IP, license & token-shingle similarity audit
make test       # Run Vitest unit & schema validation suite
make dev        # Start interactive fight-box demo server
```

## Licensing

* **Repository, `.orthorig.json` Assets & `@crenet/orthorig` Runtime:** [MIT License](./LICENSE) (`Copyright (c) 2026 Crenet Games`).
* **Blender Scripts (`/tools/blender/`):** Distributed as GPLv3-compatible when executed inside Blender's `bpy` environment; compiled `.orthorig.json` outputs and `@crenet/orthorig` remain unrestricted MIT (see [`tools/blender/README.md`](./tools/blender/README.md)).
