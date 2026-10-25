# OrthoRig (`@crenet/orthorig`)

[![CI](https://github.com/CReNET-Games/OrthoRig/actions/workflows/ci.yml/badge.svg)](https://github.com/CReNET-Games/OrthoRig/actions/workflows/ci.yml)
[![IP & Similarity Scan](https://github.com/CReNET-Games/OrthoRig/actions/workflows/ip-check.yml/badge.svg)](https://github.com/CReNET-Games/OrthoRig/actions/workflows/ip-check.yml)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FCReNET-Games%2FOrthoRig.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FCReNET-Games%2FOrthoRig?ref=badge_shield)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

An open-source, MIT-licensed 2D orthographic skeletal animation compiler and **Analytic 2-Bone Inverse Kinematics (IK)** runtime bridging **Blender** (`bpy`) and **PixiJS v8** (TypeScript).

## Why OrthoRig?

Most 2D skeletal animation runtimes in the web ecosystem require proprietary editors and restrictive runtime licenses that prohibit open redistribution or derivative tooling.

**OrthoRig** provides a deterministic, zero-cost workflow: artists and engineers author 2D planar armatures and actions directly inside **Blender**, compile them into a schema-validated `.orthorig.json` asset, and render them in **PixiJS v8** using `@crenet/orthorig` with native scene-graph containers (`PIXI.Container`, `PIXI.Graphics`, and `PIXI.Sprite`).

## Monorepo Architecture

* **[`/schema/orthorig.schema.json`](./schema/orthorig.schema.json):** Formal JSON Schema (Draft 2020-12) defining the contract between the Blender compiler and the TypeScript runtime (`meta`, `bones`, `slots`, `ik_constraints`, `animations`).
* **[`/tools/blender/`](./tools/blender/README.md):** Headless Blender Python (`bpy`) scripts:
  * [`generate_demo_operative.py`](./tools/blender/generate_demo_operative.py) — procedural `.blend` rig & action builder (standing on the $Z = 0$ ground plane).
  * [`orthorig_compiler.py`](./tools/blender/orthorig_compiler.py) — headless `.blend` $\to$ `.orthorig.json` compiler & schema validator.
* **[`/packages/runtime/`](./packages/runtime/src/index.ts):** The standalone `@crenet/orthorig` TypeScript library (zero external dependencies beyond peer dependency `pixi.js ^8.0.0`).
* **[`/examples/operative-mvp/`](./examples/operative-mvp/src/main.ts):** Interactive Vite + TypeScript + PixiJS v8 fight-box demo with keyboard/mouse and dual-stick gamepad controls, wall-sliding, 360° 2-Bone IK aiming, projectile firing, and live debug controls.

## Live Demo

* **Hosted on GitHub Pages:** **[https://crenet-games.github.io/OrthoRig/](https://crenet-games.github.io/OrthoRig/)**
  *(Automatically built and deployed from `main` via [`.github/workflows/pages.yml`](./.github/workflows/pages.yml)).*
* **Run Locally:**
  ```bash
  make install
  make dev
  ```
  Open `http://localhost:5173` to test player locomotion (`A`/`D` or Left Stick run, `Space`/`A`/`LB` jump & double-jump, `Shift`/`B`/`LT` thruster dash, airborne wall-slide), 360° mouse or Right-Stick IK aiming, `LMB`/`RT`/`RB` projectile firing from the weapon barrel transform, and the real-time skeleton debug overlay.

## Library Usage (`@crenet/orthorig`)

```typescript
import { OrthoRig, type OrthoRigSchema } from "@crenet/orthorig";
import { Application } from "pixi.js";

const app = new Application();
await app.init({ width: 1280, height: 720 });
document.body.appendChild(app.canvas);

// 1. Load a compiled .orthorig.json asset
const response = await fetch("./assets/operative.orthorig.json");
const schema = (await response.json()) as OrthoRigSchema;

// 2. Instantiate OrthoRig and attach to the PixiJS stage
const rig = new OrthoRig(schema, {
	initialAnimation: "Idle",
	debugDraw: false,
});
rig.position.set(640, 400);
app.stage.addChild(rig);

// 3. Cross-fade between locomotion actions
rig.play("Run", 0.12);

// 4. Advance animation and solve 360° Analytic 2-Bone IK each tick
let aimTarget = { x: 800, y: 300 };
window.addEventListener("pointermove", (e) => {
	aimTarget = { x: e.clientX, y: e.clientY };
});

app.ticker.add((ticker) => {
	const dt = ticker.deltaMS / 1000;
	rig.update(dt, aimTarget.x, aimTarget.y);
});
```

## Compiling Rigs from Blender

```bash
# Generate the demo .blend file and compile it to .orthorig.json
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
