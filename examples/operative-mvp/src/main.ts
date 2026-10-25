import { OrthoRig, type OrthoRigSchema } from "@crenet/orthorig";
import { Application, Container, Graphics } from "pixi.js";
import {
	buildArenaPlatforms,
	drawReticle,
	OPERATIVE_CYAN,
	renderArena,
	STARK_WHITE,
	THREAT_RED,
	VOID_BLACK,
} from "./arena";
import { bindDebugHud, updateTelemetryHud } from "./hud";
import { InputController } from "./input";

interface Projectile {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	graphics: Graphics;
}

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	color: number;
}

// Operative physics constants (character origin (0,0) is at the ground/feet; head top is at y - 130)
const HALF_WIDTH = 16;
const TOP_OFFSET = 128;
const BOTTOM_OFFSET = 0;
const GRAVITY = 1550;
const MOVE_SPEED = 320;
const JUMP_VELOCITY = -620;
const DOUBLE_JUMP_VELOCITY = -540;
const WALL_SLIDE_MAX_FALL = 135;
const DASH_SPEED = 780;
const DASH_DURATION = 0.16;
const DASH_COOLDOWN = 0.45;
const PROJECTILE_SPEED = 1150;
const FIRE_COOLDOWN = 0.14;

async function bootstrap(): Promise<void> {
	const host = document.getElementById("app") ?? document.body;
	const telemetryEl = document.getElementById("telemetry");

	const app = new Application();
	await app.init({
		width: window.innerWidth,
		height: window.innerHeight,
		backgroundColor: VOID_BLACK,
		antialias: true,
		resolution: window.devicePixelRatio || 1,
		autoDensity: true,
	});
	host.appendChild(app.canvas);

	const response = await fetch(
		`${import.meta.env.BASE_URL}assets/operative.orthorig.json`,
	);
	const schema = (await response.json()) as OrthoRigSchema;

	const arenaLayer = new Graphics();
	const fxLayer = new Graphics();
	const projectileLayer = new Container();
	const reticleGraphics = new Graphics();

	app.stage.addChild(arenaLayer);
	app.stage.addChild(fxLayer);
	app.stage.addChild(projectileLayer);

	const rig = new OrthoRig(schema, {
		initialAnimation: "Idle",
		debugDraw: true,
	});
	app.stage.addChild(rig);
	app.stage.addChild(reticleGraphics);

	let platforms = buildArenaPlatforms(app.screen.width, app.screen.height);
	renderArena(arenaLayer, app.screen.width, app.screen.height, platforms);

	// Player locomotion state
	let px = app.screen.width * 0.5;
	let py = app.screen.height - 64 - BOTTOM_OFFSET;
	let vx = 0;
	let vy = 0;
	let grounded = true;
	let jumpsRemaining = 2;
	let wallSliding = false;
	let wallDir: -1 | 0 | 1 = 0;
	let dashTimer = 0;
	let dashCooldown = 0;
	let dashDir: -1 | 1 = 1;
	let fireCooldown = 0;
	let forcedAction: string | null = null;

	const input = new InputController(app.canvas, px + 180, py - 100);
	const projectiles: Projectile[] = [];
	const sparks: Spark[] = [];

	const spawnSparks = (
		x: number,
		y: number,
		color: number,
		count: number = 8,
	): void => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 60 + Math.random() * 220;
			sparks.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				life: 0.22 + Math.random() * 0.15,
				maxLife: 0.35,
				color,
			});
		}
	};

	const fireProjectile = (): void => {
		// Spawn projectile directly from the gun barrel (forearm_r tip) world transform
		const barrel = rig.getBoneWorldTransform("forearm_r");
		const g = new Graphics();
		g.moveTo(-10, 0)
			.lineTo(10, 0)
			.stroke({ color: THREAT_RED, width: 3.5, alpha: 0.95 });
		g.moveTo(-6, 0)
			.lineTo(10, 0)
			.stroke({ color: STARK_WHITE, width: 1.5, alpha: 1.0 });

		g.position.set(barrel.tipX, barrel.tipY);
		g.rotation = barrel.rotation;
		projectileLayer.addChild(g);

		projectiles.push({
			x: barrel.tipX,
			y: barrel.tipY,
			vx: barrel.dirX * PROJECTILE_SPEED,
			vy: barrel.dirY * PROJECTILE_SPEED,
			life: 1.5,
			graphics: g,
		});

		spawnSparks(barrel.tipX, barrel.tipY, OPERATIVE_CYAN, 6);
	};

	window.addEventListener("resize", () => {
		app.renderer.resize(window.innerWidth, window.innerHeight);
		platforms = buildArenaPlatforms(app.screen.width, app.screen.height);
		renderArena(arenaLayer, app.screen.width, app.screen.height, platforms);
	});

	bindDebugHud(rig, (action) => {
		forcedAction = action;
	});

	app.ticker.add((ticker) => {
		const dt = Math.min(ticker.deltaMS / 1000, 0.05);

		const currentFacing: 1 | -1 = rig.scale.x < 0 ? -1 : 1;
		const sampled = input.sample(px, py - 100, currentFacing);
		const { moveLeft, moveRight, aimTargetX, aimTargetY, aimSource } = sampled;
		const inputDir = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);

		// Jump / Wall-Jump / Double-Jump
		if (sampled.jumpJustPressed) {
			if (grounded) {
				vy = JUMP_VELOCITY;
				grounded = false;
				jumpsRemaining = 1;
				spawnSparks(px, py + BOTTOM_OFFSET, OPERATIVE_CYAN, 8);
			} else if (wallSliding && wallDir !== 0) {
				vy = JUMP_VELOCITY * 0.95;
				vx = -wallDir * MOVE_SPEED * 1.15;
				wallSliding = false;
				jumpsRemaining = 1;
				spawnSparks(px + wallDir * HALF_WIDTH, py - 50, OPERATIVE_CYAN, 10);
			} else if (jumpsRemaining > 0) {
				vy = DOUBLE_JUMP_VELOCITY;
				jumpsRemaining--;
				spawnSparks(px, py + BOTTOM_OFFSET * 0.5, OPERATIVE_CYAN, 10);
			}
		}

		// Directional Thruster Dash
		if (sampled.dashJustPressed && dashCooldown <= 0) {
			if (moveLeft) {
				dashDir = -1;
			} else if (moveRight) {
				dashDir = 1;
			} else {
				dashDir = aimTargetX < px ? -1 : 1;
			}
			dashTimer = DASH_DURATION;
			dashCooldown = DASH_COOLDOWN;
			vy = 0;
			spawnSparks(px, py - 74, OPERATIVE_CYAN, 14);
		}

		if (dashCooldown > 0) {
			dashCooldown = Math.max(0, dashCooldown - dt);
		}
		if (fireCooldown > 0) {
			fireCooldown = Math.max(0, fireCooldown - dt);
		}

		if (dashTimer > 0) {
			dashTimer = Math.max(0, dashTimer - dt);
			vx = dashDir * DASH_SPEED;
			vy = 0;
			spawnSparks(px - dashDir * 12, py - 79, OPERATIVE_CYAN, 1);
		} else {
			vx = inputDir * MOVE_SPEED;
			vy += GRAVITY * dt;
		}

		// Horizontal movement & wall collision check
		const nextX = px + vx * dt;
		wallDir = 0;
		let resolvedX = nextX;

		for (const p of platforms) {
			const overlapsY =
				py + BOTTOM_OFFSET > p.y + 4 && py - TOP_OFFSET < p.y + p.height - 4;
			if (!overlapsY) continue;

			if (vx > 0 && px + HALF_WIDTH <= p.x + 2 && nextX + HALF_WIDTH >= p.x) {
				resolvedX = p.x - HALF_WIDTH;
				if (p.isWall) wallDir = 1;
			} else if (
				vx < 0 &&
				px - HALF_WIDTH >= p.x + p.width - 2 &&
				nextX - HALF_WIDTH <= p.x + p.width
			) {
				resolvedX = p.x + p.width + HALF_WIDTH;
				if (p.isWall) wallDir = -1;
			}
		}
		px = resolvedX;

		// Vertical movement & floor/platform collision check
		const nextY = py + vy * dt;
		grounded = false;
		let resolvedY = nextY;

		for (const p of platforms) {
			const overlapsX =
				px + HALF_WIDTH > p.x + 2 && px - HALF_WIDTH < p.y + p.width
					? px - HALF_WIDTH < p.x + p.width - 2
					: false;
			if (!overlapsX) continue;

			// Landing on top of platform
			if (
				vy >= 0 &&
				py + BOTTOM_OFFSET <= p.y + 8 &&
				nextY + BOTTOM_OFFSET >= p.y
			) {
				resolvedY = p.y - BOTTOM_OFFSET;
				vy = 0;
				grounded = true;
				jumpsRemaining = 2;
			} else if (
				p.isWall &&
				vy < 0 &&
				py - TOP_OFFSET >= p.y + p.height - 8 &&
				nextY - TOP_OFFSET <= p.y + p.height
			) {
				resolvedY = p.y + p.height + TOP_OFFSET;
				vy = 0;
			}
		}
		py = resolvedY;

		// Wall-slide check when airborne and pressing into a wall
		wallSliding =
			!grounded &&
			wallDir !== 0 &&
			vy > 0 &&
			((wallDir === 1 && moveRight) || (wallDir === -1 && moveLeft));

		if (wallSliding && vy > WALL_SLIDE_MAX_FALL) {
			vy = WALL_SLIDE_MAX_FALL;
			if (Math.random() < 0.35) {
				spawnSparks(px + wallDir * HALF_WIDTH, py - 52, OPERATIVE_CYAN, 1);
			}
		}

		// Drive OrthoRig locomotion state machine (unless overridden in debug UI)
		if (forcedAction === null) {
			let targetAction = "Idle";
			if (wallSliding) {
				targetAction = "WallSlide";
			} else if (!grounded) {
				targetAction = "Jump";
			} else if (Math.abs(vx) > 10) {
				targetAction = "Run";
			}
			rig.play(targetAction, 0.12);
		}

		rig.position.set(px, py);
		rig.update(dt, aimTargetX, aimTargetY);

		// Fire projectile (after IK update so barrel transform matches current frame's aim)
		if (sampled.shootJustPressed || (sampled.shootHeld && fireCooldown <= 0)) {
			fireProjectile();
			fireCooldown = FIRE_COOLDOWN;
		}

		// Update projectiles
		for (let i = projectiles.length - 1; i >= 0; i--) {
			const proj = projectiles[i];
			proj.x += proj.vx * dt;
			proj.y += proj.vy * dt;
			proj.life -= dt;
			proj.graphics.position.set(proj.x, proj.y);

			let hit = false;
			for (const p of platforms) {
				if (
					proj.x >= p.x &&
					proj.x <= p.x + p.width &&
					proj.y >= p.y &&
					proj.y <= p.y + p.height
				) {
					hit = true;
					break;
				}
			}

			if (
				hit ||
				proj.life <= 0 ||
				proj.x < -50 ||
				proj.x > app.screen.width + 50 ||
				proj.y < -50 ||
				proj.y > app.screen.height + 50
			) {
				if (hit) {
					spawnSparks(proj.x, proj.y, THREAT_RED, 10);
				}
				projectileLayer.removeChild(proj.graphics);
				proj.graphics.destroy();
				projectiles.splice(i, 1);
			}
		}

		// Update sparks & thruster particles
		fxLayer.clear();
		for (let i = sparks.length - 1; i >= 0; i--) {
			const s = sparks[i];
			s.x += s.vx * dt;
			s.y += s.vy * dt;
			s.life -= dt;
			if (s.life <= 0) {
				sparks.splice(i, 1);
				continue;
			}
			const alpha = Math.max(0, s.life / s.maxLife);
			fxLayer.circle(s.x, s.y, 2).fill({ color: s.color, alpha });
		}

		drawReticle(reticleGraphics, aimTargetX, aimTargetY);
		updateTelemetryHud(telemetryEl, rig, projectiles.length, aimSource);
	});
}

void bootstrap();
