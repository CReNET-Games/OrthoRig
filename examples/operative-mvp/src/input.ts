export interface SampledInputState {
	moveLeft: boolean;
	moveRight: boolean;
	jumpJustPressed: boolean;
	dashJustPressed: boolean;
	shootJustPressed: boolean;
	shootHeld: boolean;
	aimSource: "mouse" | "gamepad";
	aimTargetX: number;
	aimTargetY: number;
	gamepadConnected: boolean;
}

const STICK_MOVE_DEADZONE = 0.3;
const STICK_AIM_DEADZONE = 0.15;
const GAMEPAD_AIM_RADIUS = 160;

/**
 * Dual-Stick Gamepad + Keyboard/Mouse Input Controller (modeled after xtractvania).
 *
 * - Left Stick (`axes[0]`) / D-Pad (`buttons[14..15]`) / `A, D, ArrowLeft, ArrowRight`: Horizontal locomotion
 * - Right Stick (`axes[2..3]`) / Mouse Cursor: 360-degree 2-Bone IK weapon aiming
 * - `A / Cross` (`buttons[0]`), `D-Pad Up` (`buttons[12]`), `LB` (`buttons[4]`), or `Space / W / ArrowUp`: Jump / Double-Jump / Wall-Jump
 * - `B / Circle` (`buttons[1]`), `X / Square` (`buttons[2]`), `LT` (`buttons[6]`), or `Shift`: Directional Thruster Dash
 * - `RB / R1` (`buttons[5]`), `RT / R2` (`buttons[7]`), or Left Mouse Button: Fire Projectile
 */
export class InputController {
	private readonly keysPressed: Set<string> = new Set();
	private readonly keysJustPressed: Set<string> = new Set();
	private mousePressed: boolean = false;
	private mouseJustPressed: boolean = false;
	private mouseX: number = 0;
	private mouseY: number = 0;
	private lastAimSource: "mouse" | "gamepad" = "mouse";
	private lastGamepadAimAngle: number | undefined = undefined;
	private hasFocus: boolean = true;

	private prevGpJump: boolean = false;
	private prevGpDash: boolean = false;
	private prevGpShoot: boolean = false;

	constructor(
		canvas: HTMLCanvasElement,
		initialAimX: number,
		initialAimY: number,
	) {
		this.mouseX = initialAimX;
		this.mouseY = initialAimY;

		window.addEventListener("keydown", (e: KeyboardEvent) => {
			if (
				["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
					e.code,
				)
			) {
				e.preventDefault();
			}
			if (!e.repeat && !this.keysPressed.has(e.code)) {
				this.keysJustPressed.add(e.code);
			}
			this.keysPressed.add(e.code);
			this.lastAimSource = "mouse";
		});

		window.addEventListener("keyup", (e: KeyboardEvent) => {
			this.keysPressed.delete(e.code);
		});

		window.addEventListener("pointermove", (e: PointerEvent) => {
			this.mouseX = e.clientX;
			this.mouseY = e.clientY;
			this.lastAimSource = "mouse";
		});

		canvas.addEventListener("pointerdown", (e: PointerEvent) => {
			if (e.button === 0) {
				this.mouseX = e.clientX;
				this.mouseY = e.clientY;
				this.mousePressed = true;
				this.mouseJustPressed = true;
				this.lastAimSource = "mouse";
			}
		});

		window.addEventListener("pointerup", (e: PointerEvent) => {
			if (e.button === 0) {
				this.mousePressed = false;
			}
		});

		window.addEventListener("blur", () => {
			this.keysPressed.clear();
			this.keysJustPressed.clear();
			this.mousePressed = false;
			this.mouseJustPressed = false;
			this.hasFocus = false;
		});

		window.addEventListener("focus", () => {
			this.hasFocus = true;
		});
	}

	private getGamepad(): Gamepad | null {
		if (
			!this.hasFocus ||
			typeof navigator === "undefined" ||
			!navigator.getGamepads
		) {
			return null;
		}
		const gamepads = navigator.getGamepads();
		for (let i = 0; i < gamepads.length; i++) {
			const gp = gamepads[i];
			if (gp?.mapping === "standard") {
				return gp;
			}
		}
		for (let i = 0; i < gamepads.length; i++) {
			const gp = gamepads[i];
			if (gp) {
				return gp;
			}
		}
		return null;
	}

	/**
	 * Sample unified keyboard, mouse, and dual-stick gamepad state for the current frame.
	 */
	public sample(
		shoulderWorldX: number,
		shoulderWorldY: number,
		currentFacing: 1 | -1,
	): SampledInputState {
		const gp = this.getGamepad();

		// 1. Horizontal Movement (Left Stick X / D-Pad / A-D-Arrows)
		const gpLeft = gp
			? (gp.axes[0] ?? 0) < -STICK_MOVE_DEADZONE ||
				Boolean(gp.buttons[14]?.pressed)
			: false;
		const gpRight = gp
			? (gp.axes[0] ?? 0) > STICK_MOVE_DEADZONE ||
				Boolean(gp.buttons[15]?.pressed)
			: false;

		const moveLeft =
			this.keysPressed.has("KeyA") ||
			this.keysPressed.has("ArrowLeft") ||
			gpLeft;
		const moveRight =
			this.keysPressed.has("KeyD") ||
			this.keysPressed.has("ArrowRight") ||
			gpRight;

		// 2. Jump (A/Cross [0], D-Pad Up [12], LB [4] or Space/W/ArrowUp)
		const gpJump = gp
			? Boolean(
					gp.buttons[0]?.pressed ||
						gp.buttons[12]?.pressed ||
						gp.buttons[4]?.pressed,
				)
			: false;
		const gpJumpJustPressed = gpJump && !this.prevGpJump;
		this.prevGpJump = gpJump;

		const kbJumpJustPressed =
			this.keysJustPressed.has("Space") ||
			this.keysJustPressed.has("KeyW") ||
			this.keysJustPressed.has("ArrowUp");
		const jumpJustPressed = kbJumpJustPressed || gpJumpJustPressed;

		// 3. Dash (B/Circle [1], X/Square [2], LT [6] or Shift)
		const gpDash = gp
			? Boolean(
					gp.buttons[1]?.pressed ||
						gp.buttons[2]?.pressed ||
						gp.buttons[6]?.pressed,
				)
			: false;
		const gpDashJustPressed = gpDash && !this.prevGpDash;
		this.prevGpDash = gpDash;

		const kbDashJustPressed =
			this.keysJustPressed.has("ShiftLeft") ||
			this.keysJustPressed.has("ShiftRight");
		const dashJustPressed = kbDashJustPressed || gpDashJustPressed;

		// 4. Shoot (RB [5], RT [7] or Left Mouse)
		const gpShoot = gp
			? Boolean(gp.buttons[5]?.pressed || gp.buttons[7]?.pressed)
			: false;
		const gpShootJustPressed = gpShoot && !this.prevGpShoot;
		this.prevGpShoot = gpShoot;

		const shootJustPressed = this.mouseJustPressed || gpShootJustPressed;
		const shootHeld = this.mousePressed || gpShoot;

		// 5. Dual-Stick Aiming (Right Stick axes[2..3] vs Mouse Cursor)
		if (gp?.buttons.some((b) => b.pressed)) {
			this.lastAimSource = "gamepad";
		}

		const rx = gp?.axes[2] ?? 0;
		const ry = gp?.axes[3] ?? 0;
		if (gp && Math.hypot(rx, ry) > STICK_AIM_DEADZONE) {
			this.lastAimSource = "gamepad";
			this.lastGamepadAimAngle = Math.atan2(ry, rx);
		} else if (
			this.lastAimSource === "gamepad" &&
			this.lastGamepadAimAngle === undefined &&
			(gpLeft || gpRight)
		) {
			this.lastGamepadAimAngle = gpLeft ? Math.PI : 0;
		}

		let aimTargetX = this.mouseX;
		let aimTargetY = this.mouseY;

		if (this.lastAimSource === "gamepad") {
			const angle =
				this.lastGamepadAimAngle ?? (currentFacing === -1 ? Math.PI : 0);
			aimTargetX = shoulderWorldX + Math.cos(angle) * GAMEPAD_AIM_RADIUS;
			aimTargetY = shoulderWorldY + Math.sin(angle) * GAMEPAD_AIM_RADIUS;
		}

		this.keysJustPressed.clear();
		this.mouseJustPressed = false;

		return {
			moveLeft,
			moveRight,
			jumpJustPressed,
			dashJustPressed,
			shootJustPressed,
			shootHeld,
			aimSource: this.lastAimSource,
			aimTargetX,
			aimTargetY,
			gamepadConnected: gp !== null,
		};
	}
}
