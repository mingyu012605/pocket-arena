import { MotionInputSource } from "./inputs/motion";
import type { MotionReading, MotionState } from "./inputs/motion";
import { RacingInputSource } from "./inputs/racingInput";
import { getSocket } from "../networking/socket";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type { GameStatePayload } from "../../../shared/protocol";
import { createButton } from "../components/button";
import type { CleanupFn } from "../networking/router";

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
  opts: { nickname: string; color: string; roundId: string; playerNumber: number }
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
        <button class="btn btn-secondary" id="recalibrate-button" type="button">Recalibrate</button>
        <p class="safety-copy">Hold phone securely.</p>
      </div>
      <details class="racing-dev-diagnostics" id="racing-dev-diagnostics" hidden>
        <summary>Diagnostics</summary>
        <pre id="racing-dev-readout"></pre>
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
  const indicator = container.querySelector<HTMLSpanElement>("#racing-conn-indicator")!;
  const diagnostics = container.querySelector<HTMLDetailsElement>("#racing-dev-diagnostics")!;
  const diagnosticsReadout = container.querySelector<HTMLPreElement>("#racing-dev-readout")!;

  setText(nicknameEl, opts.nickname);
  const motion = new MotionInputSource();
  const input = new RacingInputSource(opts.roundId);
  const devDiagnostics = isDevDiagnosticsEnabled();
  let lastReading: MotionReading = { steering: 0, throttle: 0, brake: 0 };
  let lastSendAt = 0;
  let serverSpeed = 0;
  if (devDiagnostics) diagnostics.hidden = false;

  function updateDiagnostics(): void {
    if (!devDiagnostics) return;
    const orientation = screen.orientation as ScreenOrientation | undefined;
    diagnosticsReadout.textContent = [
      `secureContext: ${window.isSecureContext}`,
      `motionState: ${motion.getState()}`,
      `landscape: ${window.innerWidth > window.innerHeight}`,
      `orientationAngle: ${orientation?.angle ?? "unknown"}`,
      `calibration: ${motion.getCalibrationStep()}`,
      `steering: ${lastReading.steering.toFixed(3)}`,
      `throttle: ${lastReading.throttle.toFixed(3)}`,
      `brake: ${lastReading.brake.toFixed(3)}`,
      `sequence: ${input.getSequence()}`,
      `lastSendMsAgo: ${lastSendAt === 0 ? "never" : Math.round(performance.now() - lastSendAt)}`,
      `socket: ${getSocket().connected ? "connected" : "disconnected"}`,
      `serverSpeedKmh: ${Math.round(serverSpeed * 3.6)}`
    ].join("\n");
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
    }
  }

  const offState = motion.onStateChange(renderForState);
  const offReading = motion.onReading((reading: MotionReading) => {
    lastReading = reading;
    input.send(reading);
    lastSendAt = performance.now();
    wheelRimEl.style.setProperty("--steer", String(reading.steering));
    throttleBar.value = reading.throttle;
    brakeBar.value = reading.brake;
    steeringReadout.textContent = `Steering ${Math.round(reading.steering * 100)}%`;
    updateDiagnostics();
  });

  const onRecalibrate = () => {
    input.sendNeutral();
    motion.recalibrate();
  };
  recalibrateButton.addEventListener("click", onRecalibrate);

  const socket = getSocket();
  const onGameState = (payload: GameStatePayload) => {
    if (payload.gameType !== "racing") return;
    const self = payload.players.find((p) => p.playerNumber === opts.playerNumber);
    if (self) {
      serverSpeed = self.speed;
      speedEl.textContent = `Speed: ${Math.round(self.speed * 3.6)} km/h`;
      updateDiagnostics();
    }
  };
  socket.on(SOCKET_EVENTS.GAME_STATE, onGameState);

  const onDisconnect = () => {
    input.sendNeutral();
    indicator.classList.add("offline");
  };
  const onConnect = () => indicator.classList.remove("offline");
  const onBlur = () => {
    input.sendNeutral();
    lastSendAt = performance.now();
    updateDiagnostics();
  };
  const onVisibility = () => {
    if (document.hidden) {
      input.sendNeutral();
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
    input.sendNeutral();
    motion.destroy();
  };
}
