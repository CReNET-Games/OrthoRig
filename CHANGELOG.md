# Changelog

## [0.3.0](https://github.com/CReNET-Games/OrthoRig/compare/v0.2.0...v0.3.0) (2026-10-26)


### Features

* **runtime:** add aim-by-angle helpers, scene-graph world transforms, and bundle loader ([574218c](https://github.com/CReNET-Games/OrthoRig/commit/574218c0361461f6506e4c026c4180c416f323a9))
* **runtime:** add loadOrthoRigBundle and OrthoRig.fromUrl asset loader helpers ([574218c](https://github.com/CReNET-Games/OrthoRig/commit/574218c0361461f6506e4c026c4180c416f323a9))
* **runtime:** add scaleOrthoRigSchema and preserve non-unit scale in 2-Bone IK and Look-At solvers ([d9834df](https://github.com/CReNET-Games/OrthoRig/commit/d9834df31456be0b85969f2495ff181bc9fc1745))
* **runtime:** add updateWithAimAngle, setAimDirection, and setIKTargetAngle with vertical deadzone ([574218c](https://github.com/CReNET-Games/OrthoRig/commit/574218c0361461f6506e4c026c4180c416f323a9))
* **runtime:** support relativeTo container space in getSocketWorldTransform and getBoneWorldTransform ([574218c](https://github.com/CReNET-Games/OrthoRig/commit/574218c0361461f6506e4c026c4180c416f323a9))


### Bug Fixes

* **runtime:** emit explicit .js extensions in ESM build output for NodeNext and Vitest ([886852a](https://github.com/CReNET-Games/OrthoRig/commit/886852a78b05098104327436197af4d644c22009))

## [0.2.0](https://github.com/CReNET-Games/OrthoRig/compare/v0.1.0...v0.2.0) (2026-10-25)


### Features

* **demo:** add two-handed IK grip, muzzle socket VFX, additive recoil, footstep events, and atlas toggle ([9f4349f](https://github.com/CReNET-Games/OrthoRig/commit/9f4349f027d05186d04b6ebb3f80064e4c59f2a4))
* **runtime:** add multi-target IK, look-at solver, sockets, timeline events, layered blending, and atlas mode ([14cfbfb](https://github.com/CReNET-Games/OrthoRig/commit/14cfbfb0fc2561014339789b6505f2afe36dd44d))
* **schema,blender:** add sockets, look-at constraints, timeline events, and spritesheet baker ([fd9c56d](https://github.com/CReNET-Games/OrthoRig/commit/fd9c56d71ef6b1a480b90b052bc3c904ba628adc))

## [0.1.0](https://github.com/CReNET-Games/OrthoRig/compare/v0.0.1...v0.1.0) (2026-10-25)


### Features

* **blender:** add procedural operative generator and headless .orthorig.json compiler ([03477ea](https://github.com/CReNET-Games/OrthoRig/commit/03477ea7cdbb895f7795dac434d27e0ef10e7a5d))
* **demo:** add interactive operative-mvp fight-box arena, dual-stick gamepad input, and debug HUD ([4a6dff3](https://github.com/CReNET-Games/OrthoRig/commit/4a6dff38afd1ec068da9fa468285fb7d02a7dafe))
* **runtime:** implement @crenet/orthorig PixiJS v8 runtime and 2-bone IK solver ([0989d57](https://github.com/CReNET-Games/OrthoRig/commit/0989d57e76985cf59c078b8e2fd3e9b536647a1a))
