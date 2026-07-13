import { MotionInputSource } from "./inputs/motion";
import type { MotionReading, MotionState } from "./inputs/motion";
import { RacingInputSource } from "./inputs/racingInput";
import { getSocket } from "../networking/socket";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type { GameStatePayload } from "../../../shared/protocol";
import { createButton } from "../components/button";
import type { CleanupFn } from "../networking/router";

interface VerificationState {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
}

interface RacingViewOptions {
  nickname: string;
  color: string;
  roundId: string;
  getRoundId?: () => string;
  playerNumber: number;
  preflight?: boolean;
  initialReady?: boolean;
  onReadyChange?: (ready: boolean) => Promise<void>;
}

const STATE_COPY: Record<MotionState, string> = {
  "insecure-context": "Motion controls need a secure connection. Open this page with HTTPS or localhost.",
  unavailable: "Motion sensors are not available in this browser.",
  "permission-required": "Tap Enable Motion to use your phone as a steering wheel.",
  "permission-denied": "Motion access was denied. Check browser permissions and reload.",
  "await-landscape": "Rotate your phone sideways to use it as a steering wheel.",
  "await-calibration": "Calibrating...",
  "sensor-timeout": "No motion data was detected. Check browser permissions or try recalibrating.",
  ready: ""
};

function setText(el: HTMLElement, text: string): void {
  el.textContent = text;
}

function isDevDiagnosticsEnabled(): boolean {
  return new URLSearchParams(window.location.search).get("dev") === "1";
}

export function mountRacingView(
  container: HTMLElement,
  opts: RacingViewOptions
): CleanupFn {
  container.innerHTML = `
    <div class="controller-screen racing-controller">
      <header class="controller-header">
        <span class="controller-nickname"></span>
        <span class="controller-status" id="racing-conn-indicator">●</span>
      </header>
      <p id="racing-state-copy" class="hero-copy"></p>
      <div id="racing-action-slot"></div>
      <div id="racing-calibration-slot"></div>
      <div id="racing-ready-slot" hidden>
        <div class="steering-wheel" id="steering-wheel">
          <div class="wheel-rim"><span class="wheel-spoke wheel-spoke-horizontal"></span><span class="wheel-spoke wheel-spoke-vertical"></span><span class="wheel-hub"></span></div>
        </div>
        <p class="steering-readout" id="steering-readout">Steering 0%</p>
        <div class="racing-telemetry">
          <div class="telemetry-bar"><span>Throttle</span><progress id="throttle-bar" max="1" value="0"></progress></div>
          <div class="telemetry-bar"><span>Brake</span><progress id="brake-bar" max="1" value="0"></progress></div>
          <p id="speed-readout">Speed: 0 km/h</p>
        </div>
        <div class="racing-verification" id="racing-verification" hidden>
          <p>Confirm motion before ready</p>
          <ul>
            <li data-check="left">Turn left</li>
            <li data-check="right">Turn right</li>
            <li data-check="throttle">Tilt forward</li>
            <li data-check="brake">Tilt backward</li>
          </ul>
          <div id="racing-ready-action"></div>
          <p class="safety-copy" id="racing-ready-help">Ready unlocks after all four motion checks pass.</p>
        </div>
        <button class="btn btn-secondary" id="recalibrate-button" type="button">Recalibrate</button>
        <p class="safety-copy">Hold phone securely.</p>
      </div>
      <details class="racing-dev-diagnostics" id="racing-dev-diagnostics" hidden>
        <summary>Diagnostics</summary>
        <pre id="racing-dev-readout"></pre>
        <div class="racing-dev-controls" id="racing-dev-controls"></div>
      </details>
    </div>
  `;

  const root = container.querySelector<HTMLDivElement>(".racing-controller")!;
  root.style.setProperty("--player-color", opts.color);
  const nicknameEl = container.querySelector<HTMLSpanElement>(".controller-nickname")!;
  const stateCopyEl = container.querySelector<HTMLParagraphElement>("#racing-state-copy")!;
  const actionSlot = container.querySelector<HTMLDivElement>("#racing-action-slot")!;
  const calibrationSlot = container.querySelector<HTMLDivElement>("#racing-calibration-slot")!;
  const readySlot = container.querySelector<HTMLDivElement>("#racing-ready-slot")!;
  const wheelRimEl = container.querySelector<HTMLDivElement>(".wheel-rim")!;
  const steeringReadout = container.querySelector<HTMLParagraphElement>("#steering-readout")!;
  const throttleBar = container.querySelector<HTMLProgressElement>("#throttle-bar")!;
  const brakeBar = container.querySelector<HTMLProgressElement>("#brake-bar")!;
  const speedEl = container.querySelector<HTMLParagraphElement>("#speed-readout")!;
  const recalibrateButton = container.querySelector<HTMLButtonElement>("#recalibrate-button")!;
  const verificationEl = container.querySelector<HTMLDivElement>("#racing-verification")!;
  const readyActionSlot = container.querySelector<HTMLDivElement>("#racing-ready-action")!;
  const readyHelpEl = container.querySelector<HTMLParagraphElement>("#racing-ready-help")!;
  const indicator = container.querySelector<HTMLSpanElement>("#racing-conn-indicator")!;
  const diagnostics = container.querySelector<HTMLDetailsElement>("#racing-dev-diagnostics")!;
  const diagnosticsReadout = container.querySelector<HTMLPreElement>("#racing-dev-readout")!;
  const diagnosticsControls = container.querySelector<HTMLDivElement>("#racing-dev-controls")!;

  setText(nicknameEl, opts.nickname);
  const motion = new MotionInputSource();
  const input = new RacingInputSource(opts.roundId);
  const devDiagnostics = isDevDiagnosticsEnabled();
  let lastReading: MotionReading = { steering: 0, throttle: 0, brake: 0 };
  let lastSendAt = 0;
  let packetsSent = 0;
  let serverSpeed = 0;
  let serverSteering = 0;
  let serverThrottle = 0;
  let serverBrake = 0;
  let verification: VerificationState = { left: false, right: false, throttle: false, brake: false };
  let playerReady = opts.initialReady ?? false;
  let readyBusy = false;
  let readyButton: HTMLButtonElement | null = null;
  if (devDiagnostics) diagnostics.hidden = false;

  function activeRoundId(): string {
    return opts.getRoundId?.() ?? opts.roundId;
  }

  function syncRoundId(): string {
    const roundId = activeRoundId();
    input.setRoundId(roundId);
    return roundId;
  }

  function isPreflightVerified(): boolean {
    return verification.left && verification.right && verification.throttle && verification.brake;
  }

  function updateDiagnostics(): void {
    if (!devDiagnostics) return;
    const orientation = screen.orientation as ScreenOrientation | undefined;
    const debug = motion.getDebugSnapshot();
    diagnosticsReadout.textContent = [
      `secureContext: ${window.isSecureContext}`,
      `motionState: ${motion.getState()}`,
      `permission: ${debug.permissionResult}`,
      `landscape: ${window.innerWidth > window.innerHeight}`,
      `orientationAngle: ${orientation?.angle ?? "unknown"}`,
      `landscapeMode: ${debug.orientationAngle === 270 ? "landscape-right" : debug.orientationAngle === 90 ? "landscape-left" : "unknown"}`,
      `calibration: ${motion.getCalibrationStep()}`,
      `calibrated: ${debug.calibrated}`,
      `rawAlpha: ${debug.rawAlpha ?? "null"}`,
      `rawBeta: ${debug.rawBeta ?? "null"}`,
      `rawGamma: ${debug.rawGamma ?? "null"}`,
      `normalizedRotation: ${debug.normalizedRotation.toFixed(2)}`,
      `normalizedPitch: ${debug.normalizedPitch.toFixed(2)}`,
      `sensorAgeMs: ${debug.lastEventAt === 0 ? "never" : Date.now() - debug.lastEventAt}`,
      `steering: ${lastReading.steering.toFixed(3)}`,
      `throttle: ${lastReading.throttle.toFixed(3)}`,
      `brake: ${lastReading.brake.toFixed(3)}`,
      `verification: left=${verification.left} right=${verification.right} throttle=${verification.throttle} brake=${verification.brake}`,
      `readyEnabled: ${!opts.preflight || isPreflightVerified()}`,
      `roundId: ${syncRoundId()}`,
      `sequence: ${input.getSequence()}`,
      `packetsSent: ${packetsSent}`,
      `lastSendMsAgo: ${lastSendAt === 0 ? "never" : Math.round(performance.now() - lastSendAt)}`,
      `socket: ${getSocket().connected ? "connected" : "disconnected"}`,
      `playerNumber: ${opts.playerNumber}`,
      `serverSpeedKmh: ${Math.round(serverSpeed * 3.6)}`,
      `serverSteering: ${serverSteering.toFixed(3)}`,
      `serverThrottle: ${serverThrottle.toFixed(3)}`,
      `serverBrake: ${serverBrake.toFixed(3)}`
    ].join("\n");
  }

  function updateVerification(reading: MotionReading): void {
    if (!opts.preflight) return;
    if (reading.steering < -0.28) verification.left = true;
    if (reading.steering > 0.28) verification.right = true;
    if (reading.throttle > 0.24) verification.throttle = true;
    if (reading.brake > 0.24) verification.brake = true;
    for (const item of verificationEl.querySelectorAll<HTMLLIElement>("[data-check]")) {
      const key = item.dataset.check as keyof VerificationState;
      item.classList.toggle("is-complete", verification[key]);
    }
    const verified = isPreflightVerified();
    if (readyButton) readyButton.disabled = readyBusy || (!playerReady && !verified);
    readyHelpEl.textContent = playerReady
      ? "You are ready. Keep your phone open until the race starts."
      : verified
        ? "Motion looks good. You can ready up."
        : "Ready unlocks after all four motion checks pass.";
  }

  async function setPlayerReady(nextReady: boolean): Promise<void> {
    if (!opts.onReadyChange || readyBusy) return;
    readyBusy = true;
    if (readyButton) readyButton.disabled = true;
    try {
      await opts.onReadyChange(nextReady);
      playerReady = nextReady;
      if (readyButton) readyButton.textContent = playerReady ? "Cancel Ready" : "Ready";
      updateVerification(lastReading);
    } finally {
      readyBusy = false;
      if (readyButton) readyButton.disabled = !playerReady && !isPreflightVerified();
    }
  }

  function renderReadyAction(): void {
    if (!opts.preflight) return;
    verificationEl.hidden = false;
    readyActionSlot.innerHTML = "";
    readyButton = createButton({
      label: playerReady ? "Cancel Ready" : "Ready",
      variant: "primary",
      onClick: () => void setPlayerReady(!playerReady)
    });
    readyButton.disabled = !playerReady && !isPreflightVerified();
    readyActionSlot.appendChild(readyButton);
    updateVerification(lastReading);
  }

  function clearPreflightReady(): void {
    if (opts.preflight && playerReady) void setPlayerReady(false);
  }

  function sendDevReading(reading: MotionReading): void {
    lastReading = reading;
    const roundId = syncRoundId();
    if (roundId) {
      input.send(reading);
      packetsSent += 1;
    }
    lastSendAt = performance.now();
    wheelRimEl.style.setProperty("--steer", String(reading.steering));
    throttleBar.value = reading.throttle;
    brakeBar.value = reading.brake;
    steeringReadout.textContent = `Steering ${Math.round(reading.steering * 100)}%`;
    updateVerification(reading);
    updateDiagnostics();
  }

  function appendCalibrationButton(label: string, body: string, onClick: () => void): void {
    const copy = document.createElement("p");
    copy.textContent = body;
    calibrationSlot.appendChild(copy);
    calibrationSlot.appendChild(createButton({ label, variant: "primary", onClick }));
  }

  function renderForState(state: MotionState): void {
    stateCopyEl.textContent = STATE_COPY[state];
    actionSlot.innerHTML = "";
    calibrationSlot.innerHTML = "";
    readySlot.hidden = state !== "ready";
    if (opts.preflight && state !== "ready") clearPreflightReady();

    if (state === "permission-required") {
      actionSlot.appendChild(
        createButton({ label: "Enable Motion", variant: "primary", onClick: () => void motion.requestPermission() })
      );
    } else if (state === "sensor-timeout") {
      actionSlot.appendChild(
        createButton({
          label: "Recalibrate",
          variant: "primary",
          onClick: () => {
            input.sendNeutral();
            motion.recalibrate();
          }
        })
      );
    } else if (state === "permission-denied") {
      actionSlot.appendChild(
        createButton({ label: "Reload", variant: "primary", onClick: () => window.location.reload() })
      );
    } else if (state === "await-calibration") {
      verification = { left: false, right: false, throttle: false, brake: false };
      updateVerification(lastReading);
      const step = motion.getCalibrationStep();
      if (step === "center") {
        appendCalibrationButton("Center", "Hold the phone comfortably like a steering wheel.", () => {
          motion.confirmCalibrationCenter();
          renderForState(motion.getState());
        });
      } else if (step === "confirm-right") {
        appendCalibrationButton("Next", "Turn the phone slightly right, then tap Next.", () => {
          motion.confirmCalibrationRight();
          renderForState(motion.getState());
        });
      } else if (step === "confirm-tilt") {
        appendCalibrationButton("Next", "Tilt the top edge away from you, then tap Next.", () => {
          motion.confirmCalibrationTilt();
          renderForState(motion.getState());
        });
      }
    } else if (state === "ready") {
      renderReadyAction();
    }
  }

  const offState = motion.onStateChange(renderForState);
  const offReading = motion.onReading((reading: MotionReading) => {
    lastReading = reading;
    const roundId = syncRoundId();
    if (roundId) {
      input.send(reading);
      packetsSent += 1;
    }
    lastSendAt = performance.now();
    wheelRimEl.style.setProperty("--steer", String(reading.steering));
    throttleBar.value = reading.throttle;
    brakeBar.value = reading.brake;
    steeringReadout.textContent = `Steering ${Math.round(reading.steering * 100)}%`;
    updateVerification(reading);
    updateDiagnostics();
  });

  const onRecalibrate = () => {
    const roundId = syncRoundId();
    if (roundId) {
      input.sendNeutral();
      packetsSent += 1;
    }
    clearPreflightReady();
    verification = { left: false, right: false, throttle: false, brake: false };
    updateVerification(lastReading);
    motion.recalibrate();
  };
  recalibrateButton.addEventListener("click", onRecalibrate);

  if (devDiagnostics) {
    const syntheticControls: Array<[string, MotionReading]> = [
      ["Throttle 1", { steering: 0, throttle: 1, brake: 0 }],
      ["Brake 1", { steering: 0, throttle: 0, brake: 1 }],
      ["Steer -1", { steering: -1, throttle: 0.5, brake: 0 }],
      ["Steer 1", { steering: 1, throttle: 0.5, brake: 0 }],
      ["Neutral", { steering: 0, throttle: 0, brake: 0 }]
    ];
    for (const [label, reading] of syntheticControls) {
      const button = createButton({ label, variant: "secondary", onClick: () => sendDevReading(reading) });
      button.type = "button";
      diagnosticsControls.appendChild(button);
    }
  }

  const socket = getSocket();
  let wasCollided = false;
  const onGameState = (payload: GameStatePayload) => {
    if (payload.gameType !== "racing") return;
    const self = payload.players.find((p) => p.playerNumber === opts.playerNumber);
    if (self) {
      serverSpeed = self.speed;
      serverSteering = self.steering ?? 0;
      serverThrottle = self.throttle ?? 0;
      serverBrake = self.brake ?? 0;
      speedEl.textContent = `Speed: ${Math.round(self.speed * 3.6)} km/h | Server steer ${Math.round(serverSteering * 100)}%`;
      updateDiagnostics();

      if (self.collided && !wasCollided) {
        navigator.vibrate?.(120);
        root.classList.add("is-collision-flash");
        window.setTimeout(() => root.classList.remove("is-collision-flash"), 220);
      }
      wasCollided = Boolean(self.collided);
    }
  };
  socket.on(SOCKET_EVENTS.GAME_STATE, onGameState);

  const onDisconnect = () => {
    const roundId = syncRoundId();
    if (roundId) {
      input.sendNeutral();
      packetsSent += 1;
    }
    indicator.classList.add("offline");
  };
  const onConnect = () => indicator.classList.remove("offline");
  const onBlur = () => {
    const roundId = syncRoundId();
    if (roundId) {
      input.sendNeutral();
      packetsSent += 1;
    }
    lastSendAt = performance.now();
    updateDiagnostics();
  };
  const onVisibility = () => {
    if (document.hidden) {
      const roundId = syncRoundId();
      if (roundId) {
        input.sendNeutral();
        packetsSent += 1;
      }
      lastSendAt = performance.now();
      updateDiagnostics();
    }
  };
  socket.on("disconnect", onDisconnect);
  socket.on("connect", onConnect);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);

  renderForState(motion.getState());
  updateDiagnostics();

  return () => {
    offState();
    offReading();
    recalibrateButton.removeEventListener("click", onRecalibrate);
    socket.off(SOCKET_EVENTS.GAME_STATE, onGameState);
    socket.off("disconnect", onDisconnect);
    socket.off("connect", onConnect);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    const roundId = syncRoundId();
    if (roundId) {
      input.sendNeutral();
      packetsSent += 1;
    }
    motion.destroy();
  };
}
