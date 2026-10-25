import type { OrthoRig } from "@crenet/orthorig";

export function bindDebugHud(
	rig: OrthoRig,
	onForceActionChange: (action: string | null) => void,
): void {
	const debugBtn = document.getElementById("btn-debug-toggle");
	debugBtn?.addEventListener("click", () => {
		rig.debugDraw = !rig.debugDraw;
		debugBtn.classList.toggle("active", rig.debugDraw);
		debugBtn.textContent = `Skeleton Debug: ${rig.debugDraw ? "ON" : "OFF"}`;
	});

	const speedSlider = document.getElementById(
		"slider-speed",
	) as HTMLInputElement | null;
	const speedLabel = document.getElementById("label-speed");
	speedSlider?.addEventListener("input", () => {
		const val = Number.parseFloat(speedSlider.value);
		rig.animationSpeed = val;
		if (speedLabel) {
			speedLabel.textContent = `${val.toFixed(2)}x`;
		}
	});

	const actionButtons: Array<{ id: string; action: string | null }> = [
		{ id: "btn-act-auto", action: null },
		{ id: "btn-act-idle", action: "Idle" },
		{ id: "btn-act-run", action: "Run" },
		{ id: "btn-act-jump", action: "Jump" },
		{ id: "btn-act-wall", action: "WallSlide" },
	];

	for (const item of actionButtons) {
		const btn = document.getElementById(item.id);
		btn?.addEventListener("click", () => {
			onForceActionChange(item.action);
			if (item.action) {
				rig.play(item.action, 0.12, true);
			}
			for (const other of actionButtons) {
				document
					.getElementById(other.id)
					?.classList.toggle("active", other.id === item.id);
			}
		});
	}
}

export function updateTelemetryHud(
	telemetryEl: HTMLElement | null,
	rig: OrthoRig,
	activeProjectiles: number,
	aimSource: "mouse" | "gamepad" = "mouse",
): void {
	if (!telemetryEl || !rig.ikResult) return;
	const aimDeg = ((rig.ikResult.aimWorldAngle * 180) / Math.PI).toFixed(1);
	telemetryEl.innerHTML = [
		`ACTION: <b>${rig.activeAction}</b> (${rig.playbackTime.toFixed(2)}s @ ${rig.animationSpeed.toFixed(2)}x)`,
		`FACING: <b>scale.x = ${rig.scale.x}</b> | BEND: <b>${rig.ikResult.effectiveBendDirection}</b>`,
		`AIM: <b>${aimDeg}° (${aimSource.toUpperCase()})</b> | SHOTS: <b>${activeProjectiles}</b>`,
		`UPPER_ARM_R: <b>${rig.ikResult.upperLocalRotation.toFixed(2)} rad</b> | FOREARM_R: <b>${rig.ikResult.lowerLocalRotation.toFixed(2)} rad</b>`,
	].join("<br/>");
}
