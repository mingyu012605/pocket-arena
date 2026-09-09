import { SOCKET_EVENTS } from "../../../../shared/protocol";
import type {
  GameStatePayload,
  GolfClubPoseSubmission,
  GolfSwingSubmission,
  PocketGolfGameStatePayload,
  PocketGolfPlayerStatePayload
} from "../../../../shared/protocol";
import { GOLF_CLUBS, clubById } from "../../../../shared/pocketGolf";
import { createButton } from "../../components/button";
import { emitWithAck, getSocket } from "../../networking/socket";
import type { CleanupFn } from "../../networking/router";
import "./pocketGolf.css";

interface PocketGolfPhoneOptions {
  nickname: string;
  color: string;
  playerNumber: number;
}

interface PocketGolfReadyOptions extends PocketGolfPhoneOptions {
  initialReady: boolean;
  onReadyChange: (ready: boolean) => Promise<void>;
}

type MotionMode = "not-started" | "checking" | "ready" | "denied" | "unavailable" | "touch";

interface MotionSample {
  at: number;
  gyro: number;
  alpha: number;
  beta: number;
  gamma: number;
  ax: number;
  ay: number;
  az: number;
  acceleration: number;
  pitch: number;
  roll: number;
  yaw: number;
}

type PermissionCapableDeviceMotionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState>;
};
type PermissionCapableDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>;
};
type SensorPermissionResult = { ok: true } | { ok: false; denied: "motion" | "orientation" };

const SAFETY_COPY =
  "Hold your phone securely. Use only a short, controlled golf motion. Make sure nobody or nothing is close to you. Never release or throw your phone.";
const SAFETY_STORAGE_KEY = "pocket-arena:golfSafetyAccepted";
const MOTION_STORAGE_KEY = "pocket-arena:golfMotionEnabled";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngleDelta(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

async function requestPhoneSensorPermissions(
  DeviceMotion: PermissionCapableDeviceMotionEvent | undefined,
  DeviceOrientation: PermissionCapableDeviceOrientationEvent | undefined
): Promise<SensorPermissionResult> {
  const motionRequest =
    typeof DeviceMotion?.requestPermission === "function" ? DeviceMotion.requestPermission() : Promise.resolve<PermissionState>("granted");
  const orientationRequest =
    typeof DeviceOrientation?.requestPermission === "function" ? DeviceOrientation.requestPermission() : Promise.resolve<PermissionState>("granted");
  const [motionPermission, orientationPermission] = await Promise.all([motionRequest, orientationRequest]);
  if (motionPermission !== "granted") return { ok: false, denied: "motion" };
  if (orientationPermission !== "granted") return { ok: false, denied: "orientation" };
  return { ok: true };
}

function formatMetres(value: number | undefined): string {
  return `${Math.round(value ?? 0)} m`;
}

function formatLie(player: PocketGolfPlayerStatePayload | undefined): string {
  return (player?.lie ?? "tee").replace(/-/g, " ");
}

function activePlayer(state: PocketGolfGameStatePayload | null): PocketGolfPlayerStatePayload | undefined {
  return state?.players.find((player) => player.active);
}

function swingId(playerNumber: number): string {
  return `golf-${playerNumber}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function mountPocketGolfReadyView(container: HTMLElement, opts: PocketGolfReadyOptions): CleanupFn {
  let safetyAccepted = window.localStorage.getItem(SAFETY_STORAGE_KEY) === "1";
  let motionMode: MotionMode = "not-started";
  let statusText = window.isSecureContext
    ? "Enable phone swing before you ready up."
    : "Open the HTTPS Cloudflare link on your phone to enable motion.";
  let playerReady = opts.initialReady;
  let readyBusy = false;
  let motionEvents = 0;
  let motionStartAt = 0;
  let sensorHz = 0;
  let peakGyro = 0;

  container.innerHTML = `<section class="golf-phone" style="--player-color:${opts.color}"></section>`;
  const root = container.querySelector<HTMLElement>(".golf-phone")!;

  function vibrate(pattern: number | number[]): void {
    navigator.vibrate?.(pattern);
  }

  function onMotion(event: DeviceMotionEvent): void {
    const now = performance.now();
    if (motionStartAt === 0) motionStartAt = now;
    motionEvents += 1;
    sensorHz = Math.round((motionEvents / Math.max(0.001, now - motionStartAt)) * 1000);
    const rotation = event.rotationRate;
    peakGyro = Math.max(peakGyro, Math.hypot(rotation?.alpha ?? 0, rotation?.beta ?? 0, rotation?.gamma ?? 0));
    if (motionMode !== "ready") {
      motionMode = "ready";
      statusText = "Phone swing enabled. You can ready up.";
      render();
      return;
    }
    const status = root.querySelector<HTMLElement>("#golf-ready-motion-status");
    if (status) status.textContent = `Phone swing enabled · ${sensorHz} Hz · peak ${Math.round(peakGyro)}`;
  }

  function onOrientation(): void {
    const now = performance.now();
    if (motionStartAt === 0) motionStartAt = now;
    motionEvents += 1;
    sensorHz = Math.round((motionEvents / Math.max(0.001, now - motionStartAt)) * 1000);
    if (motionMode !== "ready") {
      motionMode = "ready";
      statusText = "Phone swing enabled. You can ready up.";
      render();
      return;
    }
    const status = root.querySelector<HTMLElement>("#golf-ready-motion-status");
    if (status) status.textContent = `Phone swing enabled · ${sensorHz} Hz`;
  }

  function startMotionListener(): void {
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrientation);
    motionMode = "ready";
    statusText = "Phone swing enabled. Hold it like a short golf club after the host starts.";
    window.localStorage.setItem(MOTION_STORAGE_KEY, "1");
    motionEvents = 0;
    motionStartAt = 0;
    peakGyro = 0;
    window.setTimeout(() => {
      if (motionMode === "ready" && motionEvents === 0) {
        motionMode = "unavailable";
        statusText = "Permission opened, but no motion data arrived. You can still ready and use touch fallback.";
        render();
      }
    }, 1800);
  }

  async function enableMotion(): Promise<void> {
    motionMode = "checking";
    statusText = "Requesting phone motion access...";
    render();
    const DeviceMotion = window.DeviceMotionEvent as PermissionCapableDeviceMotionEvent | undefined;
    const DeviceOrientation = window.DeviceOrientationEvent as PermissionCapableDeviceOrientationEvent | undefined;
    try {
      if (!window.isSecureContext) {
        motionMode = "unavailable";
        statusText = "Motion is blocked on HTTP. Open the HTTPS Cloudflare room link on your phone.";
        render();
        return;
      }
      if (!DeviceMotion && !DeviceOrientation) {
        motionMode = "unavailable";
        statusText = "This browser does not expose motion sensors. You can use touch fallback.";
        render();
        return;
      }
      const permission = await requestPhoneSensorPermissions(DeviceMotion, DeviceOrientation);
      if (!permission.ok) {
        motionMode = "denied";
        statusText =
          permission.denied === "motion"
            ? "Motion access was denied. Change browser permission or use touch fallback."
            : "Phone angle access was denied. Change browser permission or use touch fallback.";
        render();
        return;
      }
      startMotionListener();
      vibrate(30);
      render();
    } catch {
      motionMode = "denied";
      statusText = "Motion permission failed. Check browser permission or use touch fallback.";
      render();
    }
  }

  async function setReady(nextReady: boolean): Promise<void> {
    if (readyBusy || !safetyAccepted) return;
    readyBusy = true;
    render();
    try {
      await opts.onReadyChange(nextReady);
      playerReady = nextReady;
    } finally {
      readyBusy = false;
      render();
    }
  }

  function motionButtonLabel(): string {
    if (motionMode === "ready") return "Phone Swing Enabled";
    if (motionMode === "checking") return "Checking Motion...";
    if (motionMode === "denied" || motionMode === "unavailable") return "Try Motion Again";
    return "Enable Phone Swing";
  }

  function canReady(): boolean {
    if (!safetyAccepted || readyBusy || motionMode === "checking") return false;
    return motionMode === "ready" || motionMode === "denied" || motionMode === "unavailable" || motionMode === "touch";
  }

  function render(): void {
    root.style.setProperty("--player-color", opts.color);
    root.innerHTML = `
      <header class="golf-phone-header">
        <strong>${opts.nickname}</strong>
        <span>P${opts.playerNumber} · golf swing</span>
      </header>
      <main class="golf-phone-card golf-ready-card">
        <h1>Golf Controller Check</h1>
        <div class="golf-phone-illustration" aria-hidden="true"><i></i></div>
        <p class="golf-safety-copy">${SAFETY_COPY}</p>
        <div class="golf-swing-guide">
          <strong>Before Ready</strong>
          <span>Enable motion here first. When the game starts, hold the phone like a short golf club; swing speed controls power and side movement or twist changes direction.</span>
        </div>
        <div class="golf-phone-shot-pill" id="golf-ready-motion-status">${statusText}</div>
        <div class="golf-control-grid">
          <button type="button" class="btn ${safetyAccepted ? "btn-secondary" : "btn-primary"}" id="golf-ready-safety">
            ${safetyAccepted ? "Area Clear" : "My area is clear"}
          </button>
          <button type="button" class="btn btn-primary" id="golf-ready-motion"${motionMode === "checking" || motionMode === "ready" ? " disabled" : ""}>
            ${motionButtonLabel()}
          </button>
        </div>
        <button type="button" class="btn btn-primary golf-ready-submit" id="golf-ready-submit"${!canReady() ? " disabled" : ""}>
          ${readyBusy ? "Saving..." : playerReady ? "Cancel Ready" : motionMode === "ready" ? "Ready" : "Ready with fallback"}
        </button>
        <p class="golf-ready-hint"${canReady() || !safetyAccepted ? " hidden" : ""}>Enable phone swing first. If your browser blocks it, fallback will unlock after the check.</p>
        <p class="hero-copy" ${playerReady ? "" : "hidden"}>Waiting for host...</p>
      </main>
    `;
    root.querySelector<HTMLButtonElement>("#golf-ready-safety")!.addEventListener("click", () => {
      safetyAccepted = true;
      window.localStorage.setItem(SAFETY_STORAGE_KEY, "1");
      vibrate(25);
      render();
    });
    root.querySelector<HTMLButtonElement>("#golf-ready-motion")!.addEventListener("click", () => void enableMotion());
    root.querySelector<HTMLButtonElement>("#golf-ready-submit")!.addEventListener("click", () => void setReady(!playerReady));
  }

  render();

  return () => {
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
  };
}

export function mountPocketGolfView(container: HTMLElement, opts: PocketGolfPhoneOptions): CleanupFn {
  const socket = getSocket();
  let state: PocketGolfGameStatePayload | null = null;
  let safetyAccepted = window.localStorage.getItem(SAFETY_STORAGE_KEY) === "1";
  let motionMode: MotionMode = "not-started";
  let statusText = "Motion has not been checked yet.";
  let aimDegrees = 0;
  let clubId = "7-iron";
  let touchPower = 0.72;
  let touchTiming = 0;
  let handedness: "right" | "left" = "right";
  let motionArmed = false;
  let armedAt = 0;
  let lastTurnSent = "";
  let motionSamples: MotionSample[] = [];
  let lastMotionAt = 0;
  let motionStartAt = 0;
  let motionEvents = 0;
  let sensorHz = 0;
  let orientationBase: { alpha: number; beta: number; gamma: number } | null = null;
  let lastOrientationPose: Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp"> | null = null;
  let lastOrientationAt = 0;
  let lastPoseVelocity = 0;
  let lastPoseSentAt = 0;
  let holdAimBaseDegrees = 0;
  let poseHeartbeat = 0;

  container.innerHTML = `<section class="golf-phone" style="--player-color:${opts.color}"></section>`;
  const root = container.querySelector<HTMLElement>(".golf-phone")!;

  function vibrate(pattern: number | number[]): void {
    navigator.vibrate?.(pattern);
  }

  function selfPlayer(): PocketGolfPlayerStatePayload | undefined {
    return state?.players.find((player) => player.playerNumber === opts.playerNumber);
  }

  function isActiveTurn(): boolean {
    return state?.activePlayerNumber === opts.playerNumber;
  }

  function sampleConfidence(): number {
    const peak = Math.max(...motionSamples.map((sample) => sample.gyro), 0);
    if (motionSamples.length < 5) return 0.18;
    const hzScore = sensorHz >= 15 ? 0.2 : sensorHz >= 8 ? 0.1 : 0;
    return clamp(0.22 + peak / 620 + Math.min(0.18, motionSamples.length / 100) + hzScore, 0, 1);
  }

  function peakGyro(): number {
    return Math.max(...motionSamples.map((sample) => sample.gyro), 0);
  }

  function peakSwingAcceleration(): number {
    return Math.max(...motionSamples.map((sample) => sample.acceleration), 0);
  }

  function averageSampleValue(selector: (sample: MotionSample) => number): number {
    return motionSamples.reduce((sum, sample) => sum + selector(sample), 0) / Math.max(1, motionSamples.length);
  }

  function signedPeakSampleValue(selector: (sample: MotionSample) => number): number {
    let peak = 0;
    for (const sample of motionSamples) {
      const value = selector(sample);
      if (Math.abs(value) > Math.abs(peak)) peak = value;
    }
    return peak;
  }

  function swingPowerEstimate(): number {
    const peak = peakGyro();
    const peakAccel = peakSwingAcceleration();
    const orientationKick = lastPoseVelocity * 0.36;
    const gyroPower = (peak - 10) / 170;
    const accelPower = peakAccel / 14;
    return clamp(Math.max(gyroPower + accelPower, orientationKick), 0, 1);
  }

  function updateSwingButtonVisual(): void {
    const button = root.querySelector<HTMLButtonElement>("#golf-hold-swing");
    if (!button) return;
    const power = swingPowerEstimate();
    button.style.setProperty("--swing-power", `${Math.round(power * 100)}%`);
    const value = button.querySelector<HTMLElement>("[data-swing-power]");
    if (value) value.textContent = `${Math.round(power * 100)}%`;
    const aim = root.querySelector<HTMLElement>("[data-aim-readout]");
    if (aim) aim.textContent = `Aim ${aimDegrees.toFixed(1)}°`;
  }

  function sendClubPose(pose: Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp">): void {
    if (!state || !isActiveTurn() || motionMode !== "ready") return;
    const now = performance.now();
    if (now - lastPoseSentAt < 42) return;
    lastPoseSentAt = now;
    socket.emit(SOCKET_EVENTS.GOLF_CLUB_POSE, {
      roundId: state.roundId,
      turnId: state.turnId,
      timestamp: Date.now(),
      ...pose,
      aimDegrees,
      armed: motionArmed
    } satisfies GolfClubPoseSubmission);
  }

  function fallbackArmedPose(): Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp"> {
    const heldSeconds = Math.max(0, (performance.now() - armedAt) / 1000);
    const waggle = Math.sin(heldSeconds * 7.5) * 0.08;
    return {
      aimDegrees,
      pitch: -0.52 + waggle,
      roll: 0,
      yaw: 0,
      swing: -0.82 + waggle,
      velocity: lastPoseVelocity,
      armed: motionArmed,
      handedness,
      source: "motion"
    };
  }

  function currentClubPose(): Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp"> {
    if (lastOrientationPose) return { ...lastOrientationPose, velocity: lastPoseVelocity, armed: motionArmed };
    const lastSample = motionSamples.at(-1);
    if (lastSample) return clubPoseFromMotion(lastSample);
    return fallbackArmedPose();
  }

  function stopPoseHeartbeat(): void {
    if (poseHeartbeat !== 0) window.clearInterval(poseHeartbeat);
    poseHeartbeat = 0;
  }

  function startPoseHeartbeat(): void {
    stopPoseHeartbeat();
    poseHeartbeat = window.setInterval(() => {
      if (!motionArmed) {
        stopPoseHeartbeat();
        return;
      }
      sendClubPose(currentClubPose());
    }, 55);
  }

  function aimFromPose(pose: Pick<GolfClubPoseSubmission, "roll" | "yaw" | "source">): number {
    if (!motionArmed) return aimDegrees;
    const twistDegrees = pose.source === "orientation" ? pose.yaw * 34 + pose.roll * 8 : pose.roll * 38;
    return clamp(holdAimBaseDegrees + twistDegrees, -28, 28);
  }

  function withLiveAim(pose: Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp">): Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp"> {
    const nextAim = aimFromPose(pose);
    if (motionArmed && Math.abs(nextAim - aimDegrees) > 0.15) {
      aimDegrees = nextAim;
      updateSwingButtonVisual();
    }
    return { ...pose, aimDegrees: nextAim };
  }

  function clubPoseFromOrientation(event: DeviceOrientationEvent): Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp"> {
    const alpha = event.alpha ?? orientationBase?.alpha ?? 0;
    const beta = event.beta ?? orientationBase?.beta ?? 0;
    const gamma = event.gamma ?? orientationBase?.gamma ?? 0;
    if (!orientationBase) orientationBase = { alpha, beta, gamma };
    const handed = handedness === "right" ? 1 : -1;
    const betaDelta = normalizeAngleDelta(beta - orientationBase.beta);
    const gammaDelta = (gamma - orientationBase.gamma) * handed;
    const alphaDelta = normalizeAngleDelta(alpha - orientationBase.alpha) * handed;
    const pose: Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp"> = {
      pitch: clamp(betaDelta / 78, -1, 1),
      roll: clamp(gammaDelta / 58, -1, 1),
      yaw: clamp(alphaDelta / 92, -1, 1),
      swing: clamp((betaDelta * 0.75 + lastPoseVelocity * 34) / 86, -1, 1),
      velocity: lastPoseVelocity,
      armed: motionArmed,
      handedness,
      source: "orientation" as const
    };
    return withLiveAim(pose);
  }

  function clubPoseFromMotion(sample: MotionSample): Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp"> {
    const handed = handedness === "right" ? 1 : -1;
    const pose: Omit<GolfClubPoseSubmission, "roundId" | "turnId" | "timestamp"> = {
      pitch: clamp(sample.beta / 280, -1, 1),
      roll: clamp((sample.gamma * handed) / 260, -1, 1),
      yaw: 0,
      swing: clamp((sample.beta * 0.7 + sample.gyro * 0.45) / 260, -1, 1),
      velocity: lastPoseVelocity,
      armed: motionArmed,
      handedness,
      source: "motion" as const
    };
    return withLiveAim(pose);
  }

  function motionSwing(): Omit<GolfSwingSubmission, "roundId" | "turnId" | "swingId" | "timestamp"> {
    const peak = Math.max(...motionSamples.map((sample) => sample.gyro), 0);
    const averageAccel = averageSampleValue((sample) => sample.acceleration);
    const peakRollIntent = signedPeakSampleValue((sample) => sample.roll);
    const peakYawIntent = signedPeakSampleValue((sample) => sample.yaw);
    const peakPitchIntent = signedPeakSampleValue((sample) => sample.pitch);
    const liveRollIntent = lastOrientationPose?.roll ?? 0;
    const liveYawIntent = lastOrientationPose?.yaw ?? 0;
    const livePitchIntent = lastOrientationPose?.pitch ?? 0;
    const rollIntent = Math.abs(peakRollIntent) > Math.abs(liveRollIntent) ? peakRollIntent : liveRollIntent;
    const yawIntent = Math.abs(peakYawIntent) > Math.abs(liveYawIntent) ? peakYawIntent : liveYawIntent;
    const pitchIntent = Math.abs(peakPitchIntent) > Math.abs(livePitchIntent) ? peakPitchIntent : livePitchIntent;
    const betaRateIntent = clamp(signedPeakSampleValue((sample) => sample.beta) / 180, -1, 1);
    const curveIntent = clamp(rollIntent * 0.42 + yawIntent * 0.34, -0.85, 0.85);
    const timingIntent = clamp(-betaRateIntent * 0.16, -0.28, 0.28);
    const smoothness = clamp(0.78 + Math.min(0.16, motionSamples.length / 180) - Math.max(0, averageAccel - 28) / 140, 0.58, 1);
    const confidence = Math.max(0.55, sampleConfidence());
    return {
      power: clamp(swingPowerEstimate(), peak > 28 || peakSwingAcceleration() > 1.8 || lastPoseVelocity > 0.16 ? 0.22 : 0, 1),
      timing: timingIntent,
      faceAngle: curveIntent,
      swingPath: clamp(curveIntent * 0.72 + rollIntent * 0.16, -1, 1),
      attackAngle: clamp(pitchIntent * 0.22 + Math.max(0, peakSwingAcceleration() - 3) / 36, -0.24, 0.42),
      smoothness,
      confidence,
      source: "motion",
      clubId,
      aimDeltaDegrees: aimDegrees
    };
  }

  async function sendAim(nextAim = aimDegrees, nextClub = clubId): Promise<void> {
    if (!state || !isActiveTurn()) return;
    aimDegrees = clamp(nextAim, -28, 28);
    clubId = nextClub;
    try {
      await emitWithAck(SOCKET_EVENTS.GOLF_AIM, {
        roundId: state.roundId,
        turnId: state.turnId,
        aimDeltaDegrees: aimDegrees,
        clubId
      });
    } catch (err) {
      statusText = (err as { message?: string }).message ?? "Aim was not accepted.";
      render();
    }
  }

  async function sendSwing(source: "touch" | "motion"): Promise<void> {
    if (!state || !isActiveTurn()) return;
    if (lastTurnSent === state.turnId) {
      statusText = "Swing already sent. Watch the host screen.";
      render();
      return;
    }
    const base =
      source === "motion"
        ? motionSwing()
        : {
            power: touchPower,
            timing: touchTiming,
            faceAngle: 0,
            swingPath: 0,
            attackAngle: clubId === "putter" ? -0.4 : 0.08,
            smoothness: 0.82,
            confidence: 0.88,
            source: "touch" as const,
            clubId,
            aimDeltaDegrees: aimDegrees
          };
    const payload: GolfSwingSubmission = {
      roundId: state.roundId,
      turnId: state.turnId,
      swingId: swingId(opts.playerNumber),
      timestamp: Date.now(),
      ...base
    };
    lastTurnSent = state.turnId;
    statusText = "Swing accepted locally. Waiting for the shot...";
    render();
    try {
      await emitWithAck(SOCKET_EVENTS.GOLF_SWING, payload);
      vibrate([30, 30, 60]);
    } catch (err) {
      lastTurnSent = "";
      statusText = (err as { message?: string }).message ?? "Swing was not accepted.";
      render();
    }
  }

  function onMotion(event: DeviceMotionEvent): void {
    const now = performance.now();
    if (motionStartAt === 0) motionStartAt = now;
    motionEvents += 1;
    sensorHz = Math.round((motionEvents / Math.max(0.001, now - motionStartAt)) * 1000);
    lastMotionAt = now;
    const rotation = event.rotationRate;
    const linear = event.acceleration;
    const gravity = event.accelerationIncludingGravity;
    const ax = linear?.x ?? 0;
    const ay = linear?.y ?? 0;
    const az = linear?.z ?? 0;
    const linearMagnitude = Math.hypot(ax, ay, az);
    const gravityDelta = Math.max(0, Math.hypot(gravity?.x ?? 0, gravity?.y ?? 0, gravity?.z ?? 0) - 9.8);
    const sample: MotionSample = {
      at: now,
      gyro: Math.hypot(rotation?.alpha ?? 0, rotation?.beta ?? 0, rotation?.gamma ?? 0),
      alpha: rotation?.alpha ?? 0,
      beta: rotation?.beta ?? 0,
      gamma: rotation?.gamma ?? 0,
      ax,
      ay,
      az,
      pitch: lastOrientationPose?.pitch ?? 0,
      roll: lastOrientationPose?.roll ?? 0,
      yaw: lastOrientationPose?.yaw ?? 0,
      acceleration: Math.max(linearMagnitude, gravityDelta)
    };
    motionSamples = [...motionSamples.filter((item) => now - item.at < 1050), sample];
    lastPoseVelocity = clamp(sample.gyro / 520, 0, 1);
    statusText = `Motion ready · ${sensorHz} Hz · peak ${Math.round(Math.max(...motionSamples.map((item) => item.gyro), 0))}`;
    sendClubPose(lastOrientationPose ? { ...lastOrientationPose, velocity: lastPoseVelocity } : clubPoseFromMotion(sample));
    if (motionArmed) updateSwingButtonVisual();
  }

  function onOrientation(event: DeviceOrientationEvent): void {
    const now = performance.now();
    const previousAt = lastOrientationAt;
    const previousPose = lastOrientationPose;
    const nextPose = clubPoseFromOrientation(event);
    if (previousPose && previousAt > 0) {
      const dt = Math.max(0.016, (now - previousAt) / 1000);
      const poseSpeed = Math.hypot(nextPose.pitch - previousPose.pitch, nextPose.roll - previousPose.roll, nextPose.yaw - previousPose.yaw) / dt;
      lastPoseVelocity = Math.max(lastPoseVelocity * 0.82, clamp(poseSpeed * 0.12, 0, 1));
      nextPose.velocity = lastPoseVelocity;
      nextPose.swing = clamp(nextPose.swing + lastPoseVelocity * 0.38, -1, 1);
    }
    lastMotionAt = now;
    lastOrientationAt = now;
    lastOrientationPose = nextPose;
    if (motionArmed) {
      const sample: MotionSample = {
        at: now,
        gyro: lastPoseVelocity * 520,
        alpha: nextPose.yaw * 260,
        beta: nextPose.pitch * 260,
        gamma: nextPose.roll * 260,
        ax: 0,
        ay: lastPoseVelocity * 12,
        az: 0,
        pitch: nextPose.pitch,
        roll: nextPose.roll,
        yaw: nextPose.yaw,
        acceleration: lastPoseVelocity * 12
      };
      motionSamples = [...motionSamples.filter((item) => now - item.at < 1050), sample];
      updateSwingButtonVisual();
    }
    if (motionMode === "ready") statusText = `Club following phone · ${sensorHz || "--"} Hz`;
    sendClubPose(lastOrientationPose);
  }

  function startMotionListener(): void {
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrientation);
    motionMode = "ready";
    statusText = "Phone swing ready. The club on the laptop follows your phone while it is your turn.";
    window.localStorage.setItem(MOTION_STORAGE_KEY, "1");
    motionSamples = [];
    motionEvents = 0;
    motionStartAt = 0;
    lastMotionAt = 0;
    lastOrientationAt = 0;
    lastPoseSentAt = 0;
    window.setTimeout(() => {
      if (motionMode === "ready" && lastMotionAt === 0) {
        motionMode = "unavailable";
        statusText = "No motion data arrived. Touch controls are ready.";
        render();
      }
    }, 1700);
  }

  async function enableMotion(armAfterReady = false): Promise<void> {
    motionMode = "checking";
    statusText = "Requesting phone motion access...";
    render();
    const DeviceMotion = window.DeviceMotionEvent as PermissionCapableDeviceMotionEvent | undefined;
    const DeviceOrientation = window.DeviceOrientationEvent as PermissionCapableDeviceOrientationEvent | undefined;
    try {
      if (!window.isSecureContext) {
        motionMode = "unavailable";
        statusText = "Motion needs HTTPS or localhost. Use touch controls here.";
        render();
        return;
      }
      if (!DeviceMotion && !DeviceOrientation) {
        motionMode = "unavailable";
        statusText = "This browser does not expose motion sensors. Touch controls are ready.";
        render();
        return;
      }
      const permission = await requestPhoneSensorPermissions(DeviceMotion, DeviceOrientation);
      if (!permission.ok) {
        motionMode = "denied";
        statusText = permission.denied === "motion" ? "Motion access was denied. Touch controls are ready." : "Phone angle access was denied. Touch controls are ready.";
        render();
        return;
      }
      startMotionListener();
      if (armAfterReady) {
        window.setTimeout(armMotionSwing, 80);
      }
      render();
    } catch {
      motionMode = "denied";
      statusText = "Motion permission failed. Touch controls are ready.";
      render();
    }
  }

  function calibrateMotion(): void {
    motionSamples = [];
    motionEvents = 0;
    motionStartAt = 0;
    lastMotionAt = 0;
    lastOrientationAt = 0;
    orientationBase = null;
    lastOrientationPose = null;
    lastPoseVelocity = 0;
    lastPoseSentAt = 0;
    holdAimBaseDegrees = aimDegrees;
    statusText = "Calibration reset. Hold the phone comfortably and keep it still.";
    vibrate(25);
    render();
  }

  function armMotionSwing(): void {
    if (motionMode !== "ready") return;
    motionArmed = true;
    armedAt = performance.now();
    motionSamples = [];
    lastPoseVelocity = 0;
    orientationBase = null;
    lastOrientationPose = null;
    lastOrientationAt = 0;
    holdAimBaseDegrees = aimDegrees;
    lastPoseSentAt = 0;
    statusText = "Hold the button, twist the phone to aim the blue line, then swing and release.";
    sendClubPose({
      aimDegrees,
      pitch: -0.72,
      roll: 0,
      yaw: 0,
      swing: -1,
      velocity: 0,
      armed: true,
      handedness,
      source: "motion"
    });
    startPoseHeartbeat();
    vibrate(35);
    render();
  }

  function holdSwingLabel(): string {
    if (motionArmed) return "SWING";
    if (motionMode === "ready") return "HOLD";
    if (motionMode === "checking") return "Checking Motion...";
    return "Enable";
  }

  function holdSwingDisabled(): boolean {
    return motionMode === "checking";
  }

  function releaseHoldSwing(sendIfValid = true): void {
    if (!motionArmed) return;
    const heldMs = performance.now() - armedAt;
    const hasSwing = motionSamples.length >= 3 && heldMs > 160 && (peakGyro() > 52 || swingPowerEstimate() > 0.11);
    motionArmed = false;
    stopPoseHeartbeat();
    if (sendIfValid && hasSwing) {
      void sendSwing("motion");
      return;
    }
    statusText = "Hold the big button, swing the phone, then release after the swing.";
    lastPoseSentAt = 0;
    sendClubPose({
      aimDegrees,
      pitch: 0,
      roll: 0,
      yaw: 0,
      swing: 0,
      velocity: 0,
      armed: false,
      handedness,
      source: "motion"
    });
    render();
  }

  function startHoldSwing(event: PointerEvent): void {
    event.preventDefault();
    if (lastTurnSent === state?.turnId || holdSwingDisabled()) return;
    if (motionMode !== "ready") {
      void enableMotion(false);
      return;
    }
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can fail on older mobile browsers; window-level listeners still release the hold.
    }
    const finish = () => releaseHoldSwing(true);
    const cancel = () => releaseHoldSwing(false);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    armMotionSwing();
  }

  function renderHeader(): string {
    const player = selfPlayer();
    return `
      <header class="golf-phone-header">
        <strong>${opts.nickname}</strong>
        <span>${player ? `P${opts.playerNumber} · ${formatLie(player)}` : "Pocket Golf"}</span>
      </header>
    `;
  }

  function renderSafety(): void {
    root.innerHTML = `
      ${renderHeader()}
      <main class="golf-phone-card golf-safety">
        <h1>Before You Swing</h1>
        <div class="golf-phone-illustration" aria-hidden="true"><i></i></div>
        <p class="golf-safety-copy">${SAFETY_COPY}</p>
        <div id="golf-safety-action"></div>
      </main>
    `;
    root.querySelector("#golf-safety-action")!.appendChild(
      createButton({
        label: "My area is clear",
        variant: "primary",
        onClick: () => {
          safetyAccepted = true;
          window.localStorage.setItem(SAFETY_STORAGE_KEY, "1");
          vibrate(25);
          render();
        }
      })
    );
  }

  function renderWaiting(): void {
    const active = activePlayer(state);
    const player = selfPlayer();
    root.innerHTML = `
      ${renderHeader()}
      <main class="golf-phone-card">
        <h1>${state ? `${active?.displayName ?? "Next player"} is taking a shot` : "Waiting for host"}</h1>
        <p>${state ? `Hole ${state.holeNumber} · ${state.holeName} · ${state.holeDifficulty} · Par ${state.par}` : "Pocket Golf will start from the host screen."}</p>
        <dl class="golf-phone-stats">
          <div><dt>Your distance</dt><dd>${formatMetres(player?.distanceToHole)}</dd></div>
          <div><dt>Your strokes</dt><dd>${player?.strokes ?? 0}</dd></div>
          <div><dt>Wind</dt><dd>${state ? `${state.wind.speed} km/h` : "--"}</dd></div>
        </dl>
      </main>
    `;
  }

  function renderActive(): void {
    if (!state) return renderWaiting();
    const player = selfPlayer();
    const recommended = clubById(state.recommendedClubId);
    root.innerHTML = `
      ${renderHeader()}
      <main class="golf-phone-card">
        <h1>Your Shot</h1>
        <p>Hole ${state.holeNumber} · ${state.holeDifficulty} · ${formatMetres(player?.distanceToHole)} to pin · Recommended ${recommended.displayName}</p>
        <div class="golf-phone-shot-pill">${motionArmed ? "Motion armed" : statusText}</div>
        <div class="golf-swing-guide">
          <strong>Phone swing</strong>
          <span>${motionMode === "ready" ? "Press and hold the big button, twist to aim the blue guide, swing your phone like a golf club, then release." : "Tap the big button once to enable motion. After it says READY, hold it to swing."} Speed sets power; side movement and twist set direction.</span>
        </div>
        <div class="golf-hold-zone">
          <button type="button" class="golf-hold-swing-button${motionArmed ? " is-armed" : ""}" id="golf-hold-swing"${holdSwingDisabled() ? " disabled" : ""}>
            <span>${holdSwingLabel()}</span>
            <strong data-swing-power>${motionArmed ? `${Math.round(swingPowerEstimate() * 100)}%` : motionMode === "ready" ? "READY" : "MOTION"}</strong>
            <small>${motionArmed ? "Release after swing" : motionMode === "ready" ? "Hold to start" : "Tap to enable"}</small>
          </button>
          <p class="golf-live-aim" data-aim-readout>Aim ${aimDegrees.toFixed(1)}°</p>
        </div>
        <label class="golf-meter">Club
          <select class="golf-club-select" id="golf-club">
            ${GOLF_CLUBS.map((club) => {
              const disabled = player && !club.allowedTerrain.includes(player.lie) ? " disabled" : "";
              const selected = club.id === clubId ? " selected" : "";
              return `<option value="${club.id}"${selected}${disabled}>${club.displayName}</option>`;
            }).join("")}
          </select>
        </label>
        <div class="golf-control-grid">
          <button type="button" class="btn btn-secondary" data-aim="-4">Aim Left</button>
          <button type="button" class="btn btn-secondary" data-aim="4">Aim Right</button>
        </div>
        <label class="golf-meter">Aim ${aimDegrees.toFixed(1)}°
          <input id="golf-aim" type="range" min="-28" max="28" step="1" value="${aimDegrees}">
        </label>
        <div class="golf-control-grid">
          <button type="button" class="btn ${handedness === "right" ? "btn-primary" : "btn-secondary"}" data-hand="right">Right handed</button>
          <button type="button" class="btn ${handedness === "left" ? "btn-primary" : "btn-secondary"}" data-hand="left">Left handed</button>
        </div>
        <div class="golf-control-grid golf-small-actions">
          <button type="button" class="btn btn-secondary" id="golf-calibrate">Calibrate</button>
          <button type="button" class="btn btn-secondary" id="golf-touch-swing">Tap fallback</button>
        </div>
        <details class="golf-motion-diagnostics">
          <summary>Motion diagnostics</summary>
          <pre>${[
            `mode: ${motionMode}`,
            `sensorHz: ${sensorHz}`,
            `samples: ${motionSamples.length}`,
            `confidence: ${sampleConfidence().toFixed(2)}`,
            `turnId: ${state.turnId}`,
            `lastSent: ${lastTurnSent || "none"}`
          ].join("\n")}</pre>
        </details>
      </main>
    `;

    root.querySelector<HTMLSelectElement>("#golf-club")!.addEventListener("change", (event) => {
      clubId = (event.target as HTMLSelectElement).value;
      void sendAim(aimDegrees, clubId);
      render();
    });
    root.querySelector<HTMLInputElement>("#golf-aim")!.addEventListener("input", (event) => {
      aimDegrees = Number((event.target as HTMLInputElement).value);
      void sendAim(aimDegrees, clubId);
      render();
    });
    root.querySelector<HTMLButtonElement>("#golf-hold-swing")!.addEventListener("pointerdown", startHoldSwing);
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-aim]")) {
      button.addEventListener("click", () => {
        void sendAim(aimDegrees + Number(button.dataset.aim), clubId);
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-hand]")) {
      button.addEventListener("click", () => {
        handedness = button.dataset.hand === "left" ? "left" : "right";
        orientationBase = null;
        lastOrientationPose = null;
        lastOrientationAt = 0;
        render();
      });
    }
    root.querySelector<HTMLButtonElement>("#golf-calibrate")!.addEventListener("click", calibrateMotion);
    root.querySelector<HTMLButtonElement>("#golf-touch-swing")!.addEventListener("click", () => void sendSwing("touch"));
  }

  function render(): void {
    root.style.setProperty("--player-color", opts.color);
    if (!safetyAccepted) {
      renderSafety();
      return;
    }
    if (!state || !isActiveTurn()) {
      renderWaiting();
      return;
    }
    renderActive();
  }

  const onGameState = (payload: GameStatePayload) => {
    if (payload.gameType !== "pocket-golf") return;
    const previousTurn = state?.turnId;
    state = payload;
    aimDegrees = payload.aimDegrees;
    clubId = payload.clubId;
    if (previousTurn !== payload.turnId) {
      lastTurnSent = "";
      motionArmed = false;
      stopPoseHeartbeat();
      motionSamples = [];
      orientationBase = null;
      lastOrientationPose = null;
      lastOrientationAt = 0;
      lastPoseVelocity = 0;
    }
    render();
  };

  socket.on(SOCKET_EVENTS.GAME_STATE, onGameState);
  void emitWithAck(SOCKET_EVENTS.GOLF_REQUEST_STATE, {}).catch(() => undefined);
  if (window.localStorage.getItem(MOTION_STORAGE_KEY) === "1" && window.isSecureContext) {
    startMotionListener();
  }
  render();

  return () => {
    stopPoseHeartbeat();
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    socket.off(SOCKET_EVENTS.GAME_STATE, onGameState);
  };
}
