# Racing Foundation (Cycle 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete technical foundation and first playable race for
Pocket Arena's Racing game — real phone-motion steering/throttle/braking,
server-authoritative track-relative physics (real turning, not a lane
slide), full multiplayer lobby → countdown → race → results → rematch loop,
on a plain (non-polished) Three.js renderer that proves the whole loop works.

**Architecture:** Racing is a fully isolated vertical slice (own server
physics module, own client input module, own renderer) that plugs into the
existing Pocket Arena room/socket/renderer architecture via the same
extension points Controller Test uses (`GameRenderer<TState>`,
`room.gameType` dispatch, `game:end`/`game:start` lifecycle). Two existing
subsystems are refactored first, under a strict regression gate, so Racing
has a clean foundation to build on: the wire-level `game:state` payload
becomes a `gameType`-discriminated union, and per-game physics state moves
from `InternalPlayer.physics` onto a new `InternalRoom.gameState` field.

**Tech Stack:** Adds `three` (client) for the renderer. Everything else
reuses the existing stack: Socket.IO, Vite, TypeScript strict, vitest.

## Global Constraints

- **This is Cycle 1 of 2. Cycle 1 alone is not a finished Racing game** — it
  is the complete technical foundation and first playable race. Cycle 2
  (polished visuals/audio/AI/collision, planned separately after this cycle
  ships and is verified) is required before Racing is feature-complete. Do
  not describe Cycle 1's completion as "the Racing game is done."
- **No temporary/throwaway systems.** The track representation, race state
  shape, `GameRenderer` interface, camera-focus field, and AI/collision
  extension points built in this cycle are the same ones Cycle 2 builds on
  — Cycle 2 enhances the same classes/types, it does not replace them.
- **No touch buttons for racing gameplay.** Steering/throttle/brake come
  only from phone motion. Touch is only for setup (permission, calibrate,
  ready) and an explicitly `?dev=1`-gated desktop keyboard fallback.
- `MotionState` is exactly: `"insecure-context" | "unavailable" |
  "permission-required" | "permission-denied" | "await-landscape" |
  "await-calibration" | "sensor-timeout" | "ready"`.
- Calibration is guided and **sign-confirming**: center → confirm-right →
  confirm-tilt → done. It derives `steeringSign`/`throttleSign` from actual
  observed device behavior, never assumes a fixed sign convention.
- Steering dead zone 5°, max tilt 35°; throttle/brake dead zone 5°, max
  tilt 30°. Output normalized to steering `-1..1`, throttle `0..1`, brake
  `0..1`. Light smoothing (single-pole low-pass), not heavy — must not feel
  delayed.
- Motion readings are sent to the server at ~30Hz (`racing:input`, a
  dedicated event, not an overload of `input:action`).
- Server racing physics runs on a **fixed 60Hz timestep with an
  accumulator** (`PHYSICS_STEP = 1/60`), not naive wall-clock delta per
  callback. Network snapshots broadcast at 20Hz (every 3rd physics step).
- Physics is **track-relative (Frenet-style)**: `progress`, `lateralOffset`,
  `headingError`, `yawRate`, `speed` — cars turn and visibly rotate through
  curves. A model where the car only slides sideways while facing forward
  does not satisfy this plan.
- Server input timeout: no valid `racing:input` for 300ms → throttle/brake
  forced to 0, steering eased toward 0 (`steering *= 0.9` per tick, not an
  instant snap). Immediate (not gradual) reset on: controller disconnect,
  host disconnect, round end, round ID change, client-initiated
  recalibration.
- `game:state` is a `gameType`-discriminated union
  (`ControllerTestGameStatePayload | RacingGameStatePayload`) so the two
  games' snapshots can never be cross-consumed by the wrong renderer.
- Race-wide state lives on `InternalRoom.gameState` (an
  `InternalGameState` union), not scattered across `InternalPlayer` — this
  refactor must preserve Controller Test's existing behavior exactly
  (regression gate: existing Controller Test test suite passes unchanged in
  intent, plus a full manual playthrough).
- Full lifecycle: `lobby → countdown → in-progress → results → (rematch:
  countdown again) | (change game: lobby)`. Results and rematch reuse the
  existing `game:end`/`game:start`/ready-persistence primitives — no new
  lifecycle socket events.
- Single-lap racing only in this phase (`lap` field exists in the data
  model for future multi-lap, always `1` here). No car-to-car collision in
  this cycle (cars may overlap) — that is explicitly Cycle 2 scope.
  Single-player rooms are time-trial only in this cycle — AI opponents are
  Cycle 2 scope.
- No externally-sourced 3D models, textures, or audio files anywhere in
  this cycle (or Cycle 2) — see the design spec §7.4. This cycle's renderer
  uses procedural Three.js geometry/materials only.
- Track constants (starting values, from the design spec §6.1):
  `trackHalfWidth: 6, maxSpeed: 42, acceleration: 14, brakeForce: 22,
  coastDrag: 5, steeringResponsiveness: 2.4, yawDamping: 3.0,
  offTrackSlowFactor: 0.55`.
- Race safety timeout: 180 seconds after `startedAt` — any car still
  unfinished is marked `finished: true, finishTime: null` and the race
  transitions to results regardless.
- Source spec: `docs/superpowers/specs/2026-07-12-racing-motion-controller-design.md`
  — section references (`§N`) below point back to it.

---

### Task 1: Motion Input Module (pure math + full state machine)

**Files:**
- Create: `client/src/controller/inputs/motion.ts`
- Test: `client/src/controller/inputs/motion.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing new (browser globals only: `window.isSecureContext`,
  `DeviceOrientationEvent`, `DeviceMotionEvent`, `screen.orientation`).
- Produces: `MotionState`, `CalibrationStep`, `MotionReading` types;
  `isLandscapeAngle(angle)`, `normalizeAxes(beta, gamma, orientationAngle)`,
  `applyDeadZoneAndClamp(deltaDegrees, deadZoneDeg, maxTiltDeg)`,
  `smoothTowards(previous, target, smoothingFactor)`,
  `deriveSign(sample, neutral)`, `splitThrottleBrake(signedValue)` pure
  functions; `MotionInputSource` class with `getState()`,
  `getCalibrationStep()`, `onStateChange(listener)`, `onReading(listener)`,
  `requestPermission()`, `confirmCalibrationCenter()`,
  `confirmCalibrationRight()`, `confirmCalibrationTilt()`, `recalibrate()`,
  `destroy()` — consumed by Task 2 (debug view) and Task 10 (`racingView.ts`).

- [ ] **Step 1: Modify `vitest.config.ts`** to include client-side tests (this module's pure functions are the first client code with unit tests)

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "client/src/**/*.test.ts"]
  }
});
```

- [ ] **Step 2: Create `client/src/controller/inputs/motion.ts`**

```ts
export type MotionState =
  | "insecure-context"
  | "unavailable"
  | "permission-required"
  | "permission-denied"
  | "await-landscape"
  | "await-calibration"
  | "sensor-timeout"
  | "ready";

export type CalibrationStep = "center" | "confirm-right" | "confirm-tilt" | "done";

export interface MotionReading {
  steering: number; // -1..1
  throttle: number; // 0..1
  brake: number;    // 0..1
}

interface NormalizedAxes {
  rotation: number; // degrees, raw "wheel" axis before calibration
  pitch: number;    // degrees, raw "tilt" axis before calibration
}

const LANDSCAPE_ANGLES = new Set([90, 270]);

const STEERING_DEAD_ZONE_DEG = 5;
const STEERING_MAX_TILT_DEG = 35;
const THROTTLE_DEAD_ZONE_DEG = 5;
const THROTTLE_MAX_TILT_DEG = 30;
const SMOOTHING_FACTOR = 0.35;
const SENSOR_TIMEOUT_MS = 3000;
const STALE_READING_MS = 300;
const READING_INTERVAL_MS = 33; // ~30Hz

export function isLandscapeAngle(angle: number): boolean {
  return LANDSCAPE_ANGLES.has(((angle % 360) + 360) % 360);
}

export function normalizeAxes(beta: number, gamma: number, orientationAngle: number): NormalizedAxes {
  const angle = ((orientationAngle % 360) + 360) % 360;
  if (angle === 270) {
    return { rotation: beta, pitch: -gamma };
  }
  // Default / landscape-primary (angle === 90) convention. Any residual
  // per-device sign inconsistency is corrected by guided calibration
  // (steeringSign/throttleSign), not by this function.
  return { rotation: -beta, pitch: gamma };
}

export function applyDeadZoneAndClamp(deltaDegrees: number, deadZoneDeg: number, maxTiltDeg: number): number {
  const magnitude = Math.abs(deltaDegrees);
  if (magnitude <= deadZoneDeg) return 0;
  const range = maxTiltDeg - deadZoneDeg;
  const usable = Math.min(magnitude, maxTiltDeg) - deadZoneDeg;
  const normalized = range > 0 ? usable / range : 0;
  return Math.sign(deltaDegrees) * Math.min(1, normalized);
}

export function smoothTowards(previous: number, target: number, smoothingFactor: number): number {
  return previous + (target - previous) * smoothingFactor;
}

export function deriveSign(sample: number, neutral: number): 1 | -1 {
  return sample - neutral < 0 ? -1 : 1;
}

export function splitThrottleBrake(signedValue: number): { throttle: number; brake: number } {
  return signedValue > 0 ? { throttle: signedValue, brake: 0 } : { throttle: 0, brake: -signedValue };
}

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};
type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export class MotionInputSource {
  private state: MotionState;
  private calibrationStep: CalibrationStep = "center";
  private neutralRotation = 0;
  private neutralPitch = 0;
  private steeringSign: 1 | -1 = 1;
  private throttleSign: 1 | -1 = 1;
  private lastRawRotation = 0;
  private lastRawPitch = 0;
  private lastEventAt = 0;
  private smoothedSteering = 0;
  private smoothedSigned = 0;
  private sensorTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readingHandle: ReturnType<typeof setInterval> | null = null;
  private stateListeners = new Set<(state: MotionState) => void>();
  private readingListeners = new Set<(reading: MotionReading) => void>();

  constructor() {
    this.state = !window.isSecureContext
      ? "insecure-context"
      : typeof DeviceOrientationEvent === "undefined"
        ? "unavailable"
        : "permission-required";
  }

  getState(): MotionState {
    return this.state;
  }

  getCalibrationStep(): CalibrationStep {
    return this.calibrationStep;
  }

  onStateChange(listener: (state: MotionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onReading(listener: (reading: MotionReading) => void): () => void {
    this.readingListeners.add(listener);
    return () => this.readingListeners.delete(listener);
  }

  private setState(next: MotionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }

  async requestPermission(): Promise<void> {
    if (this.state !== "permission-required") return;
    const orientationCtor = DeviceOrientationEvent as DeviceOrientationEventWithPermission;
    const motionCtor =
      typeof DeviceMotionEvent !== "undefined" ? (DeviceMotionEvent as DeviceMotionEventWithPermission) : null;
    try {
      if (typeof orientationCtor.requestPermission === "function") {
        const result = await orientationCtor.requestPermission();
        if (result !== "granted") {
          this.setState("permission-denied");
          return;
        }
      }
      if (motionCtor && typeof motionCtor.requestPermission === "function") {
        await motionCtor.requestPermission();
      }
    } catch {
      this.setState("permission-denied");
      return;
    }
    window.addEventListener("deviceorientation", this.handleOrientation);
    window.addEventListener("orientationchange", this.handleOrientationChange);
    window.addEventListener("resize", this.handleOrientationChange);
    this.checkLandscape();
  }

  private checkLandscape(): void {
    if (this.isLandscape()) {
      this.setState("await-calibration");
      this.calibrationStep = "center";
    } else {
      this.setState("await-landscape");
    }
  }

  private isLandscape(): boolean {
    const orientation = screen.orientation as ScreenOrientation | undefined;
    if (orientation && typeof orientation.angle === "number") {
      return isLandscapeAngle(orientation.angle);
    }
    return window.innerWidth > window.innerHeight;
  }

  private orientationAngle(): number {
    const orientation = screen.orientation as ScreenOrientation | undefined;
    return orientation && typeof orientation.angle === "number" ? orientation.angle : 90;
  }

  private handleOrientationChange = (): void => {
    const landscape = this.isLandscape();
    if (!landscape && (this.state === "await-calibration" || this.state === "ready")) {
      this.stopReadingLoop();
      this.calibrationStep = "center";
      this.setState("await-landscape");
    } else if (landscape && this.state === "await-landscape") {
      this.setState("await-calibration");
      this.calibrationStep = "center";
    }
  };

  private handleOrientation = (event: DeviceOrientationEvent): void => {
    if (event.beta === null || event.gamma === null) return;
    const { rotation, pitch } = normalizeAxes(event.beta, event.gamma, this.orientationAngle());
    this.lastRawRotation = rotation;
    this.lastRawPitch = pitch;
    this.lastEventAt = Date.now();
  };

  confirmCalibrationCenter(): void {
    if (this.state !== "await-calibration" || this.calibrationStep !== "center") return;
    this.armSensorTimeout();
    this.neutralRotation = this.lastRawRotation;
    this.neutralPitch = this.lastRawPitch;
    this.calibrationStep = "confirm-right";
  }

  confirmCalibrationRight(): void {
    if (this.state !== "await-calibration" || this.calibrationStep !== "confirm-right") return;
    this.steeringSign = deriveSign(this.lastRawRotation, this.neutralRotation);
    this.calibrationStep = "confirm-tilt";
  }

  confirmCalibrationTilt(): void {
    if (this.state !== "await-calibration" || this.calibrationStep !== "confirm-tilt") return;
    this.throttleSign = deriveSign(this.lastRawPitch, this.neutralPitch);
    this.calibrationStep = "done";
    this.clearSensorTimeout();
    this.smoothedSteering = 0;
    this.smoothedSigned = 0;
    this.setState("ready");
    this.startReadingLoop();
  }

  recalibrate(): void {
    this.stopReadingLoop();
    this.calibrationStep = "center";
    this.setState(this.isLandscape() ? "await-calibration" : "await-landscape");
  }

  private armSensorTimeout(): void {
    this.clearSensorTimeout();
    const observedAt = this.lastEventAt;
    this.sensorTimeoutHandle = setTimeout(() => {
      if (this.lastEventAt === observedAt) {
        this.setState("sensor-timeout");
      }
    }, SENSOR_TIMEOUT_MS);
  }

  private clearSensorTimeout(): void {
    if (this.sensorTimeoutHandle !== null) {
      clearTimeout(this.sensorTimeoutHandle);
      this.sensorTimeoutHandle = null;
    }
  }

  private startReadingLoop(): void {
    this.stopReadingLoop();
    this.readingHandle = setInterval(() => this.emitReading(), READING_INTERVAL_MS);
  }

  private stopReadingLoop(): void {
    if (this.readingHandle !== null) {
      clearInterval(this.readingHandle);
      this.readingHandle = null;
    }
  }

  private emitReading(): void {
    const fresh = Date.now() - this.lastEventAt <= STALE_READING_MS;
    const rawSteer = fresh ? (this.lastRawRotation - this.neutralRotation) * this.steeringSign : 0;
    const rawSigned = fresh ? (this.lastRawPitch - this.neutralPitch) * this.throttleSign : 0;

    const targetSteering = applyDeadZoneAndClamp(rawSteer, STEERING_DEAD_ZONE_DEG, STEERING_MAX_TILT_DEG);
    const targetSigned = applyDeadZoneAndClamp(rawSigned, THROTTLE_DEAD_ZONE_DEG, THROTTLE_MAX_TILT_DEG);

    this.smoothedSteering = smoothTowards(this.smoothedSteering, targetSteering, SMOOTHING_FACTOR);
    this.smoothedSigned = smoothTowards(this.smoothedSigned, targetSigned, SMOOTHING_FACTOR);

    const { throttle, brake } = splitThrottleBrake(this.smoothedSigned);
    const reading: MotionReading = { steering: this.smoothedSteering, throttle, brake };
    for (const listener of this.readingListeners) listener(reading);
  }

  destroy(): void {
    this.stopReadingLoop();
    this.clearSensorTimeout();
    window.removeEventListener("deviceorientation", this.handleOrientation);
    window.removeEventListener("orientationchange", this.handleOrientationChange);
    window.removeEventListener("resize", this.handleOrientationChange);
  }
}
```

- [ ] **Step 3: Create `client/src/controller/inputs/motion.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  isLandscapeAngle,
  normalizeAxes,
  applyDeadZoneAndClamp,
  smoothTowards,
  deriveSign,
  splitThrottleBrake
} from "./motion";

describe("isLandscapeAngle", () => {
  it("treats 90 and 270 as landscape", () => {
    expect(isLandscapeAngle(90)).toBe(true);
    expect(isLandscapeAngle(270)).toBe(true);
  });
  it("treats 0 and 180 as not landscape", () => {
    expect(isLandscapeAngle(0)).toBe(false);
    expect(isLandscapeAngle(180)).toBe(false);
  });
});

describe("normalizeAxes", () => {
  it("maps landscape-primary (90) with rotation=-beta, pitch=gamma", () => {
    expect(normalizeAxes(10, 20, 90)).toEqual({ rotation: -10, pitch: 20 });
  });
  it("maps landscape-secondary (270) as the mirror of landscape-primary", () => {
    expect(normalizeAxes(10, 20, 270)).toEqual({ rotation: 10, pitch: -20 });
  });
});

describe("applyDeadZoneAndClamp", () => {
  it("returns 0 inside the dead zone", () => {
    expect(applyDeadZoneAndClamp(3, 5, 35)).toBe(0);
    expect(applyDeadZoneAndClamp(-4, 5, 35)).toBe(0);
  });
  it("maps the dead-zone-to-max range linearly to 0..1", () => {
    expect(applyDeadZoneAndClamp(20, 5, 35)).toBeCloseTo(0.5, 5);
  });
  it("clamps beyond max tilt to exactly +-1", () => {
    expect(applyDeadZoneAndClamp(90, 5, 35)).toBe(1);
    expect(applyDeadZoneAndClamp(-90, 5, 35)).toBe(-1);
  });
});

describe("smoothTowards", () => {
  it("converges toward the target without overshooting", () => {
    let value = 0;
    for (let i = 0; i < 20; i++) value = smoothTowards(value, 1, 0.35);
    expect(value).toBeGreaterThan(0.99);
    expect(value).toBeLessThanOrEqual(1);
  });
});

describe("deriveSign", () => {
  it("returns 1 when the sample increased from neutral", () => {
    expect(deriveSign(10, 5)).toBe(1);
  });
  it("returns -1 when the sample decreased from neutral", () => {
    expect(deriveSign(2, 5)).toBe(-1);
  });
});

describe("splitThrottleBrake", () => {
  it("routes positive values to throttle", () => {
    expect(splitThrottleBrake(0.6)).toEqual({ throttle: 0.6, brake: 0 });
  });
  it("routes negative values to brake as a positive magnitude", () => {
    expect(splitThrottleBrake(-0.4)).toEqual({ throttle: 0, brake: 0.4 });
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/src/controller/inputs/motion.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/controller/inputs/motion.ts client/src/controller/inputs/motion.test.ts vitest.config.ts
git commit -m "Add motion input module: permission/landscape/calibration state machine, pure axis math"
```

---

### Task 2: Motion Debug View

**Files:**
- Create: `client/src/pages/motionDebug.ts`
- Modify: `client/src/main.ts`

**Interfaces:**
- Consumes: `MotionInputSource`, `MotionState`, `MotionReading` from Task 1's
  `client/src/controller/inputs/motion.ts` (exact names, unchanged).
- Produces: `renderMotionDebugPage(ctx: RouteContext): CleanupFn | void`,
  registered at `/dev/motion-debug` — a standalone page with no room/socket
  dependency, letting the sensor pipeline be proven before any networking
  exists. Not linked from any UI; reached by typing the URL directly.

- [ ] **Step 1: Create `client/src/pages/motionDebug.ts`**

```ts
import { MotionInputSource } from "../controller/inputs/motion";
import type { MotionReading, MotionState } from "../controller/inputs/motion";
import { createButton } from "../components/button";
import type { CleanupFn, RouteContext } from "../networking/router";

const STATE_COPY: Record<MotionState, string> = {
  "insecure-context": "Motion controls need a secure connection — this page was opened over plain HTTP.",
  unavailable: "Motion sensors are not available in this browser.",
  "permission-required": "Tap Enable Motion to grant sensor access.",
  "permission-denied": "Motion access was denied. Check browser permissions and reload.",
  "await-landscape": "Rotate your phone sideways to use it as a steering wheel.",
  "await-calibration": "Calibrating…",
  "sensor-timeout": "No motion data was detected. Check browser permissions or try recalibrating.",
  ready: "Motion controls are live."
};

export function renderMotionDebugPage({ container }: RouteContext): CleanupFn | void {
  container.innerHTML = `
    <section class="page-section centered">
      <h1>Motion Debug</h1>
      <p id="motion-state-copy" class="hero-copy"></p>
      <div id="motion-action-slot"></div>
      <div id="motion-calibration-slot"></div>
      <pre id="motion-readout" class="motion-readout" hidden></pre>
    </section>
  `;

  const stateCopyEl = container.querySelector<HTMLParagraphElement>("#motion-state-copy")!;
  const actionSlot = container.querySelector<HTMLDivElement>("#motion-action-slot")!;
  const calibrationSlot = container.querySelector<HTMLDivElement>("#motion-calibration-slot")!;
  const readoutEl = container.querySelector<HTMLPreElement>("#motion-readout")!;

  const motion = new MotionInputSource();

  function renderForState(state: MotionState): void {
    stateCopyEl.textContent = STATE_COPY[state];
    actionSlot.innerHTML = "";
    calibrationSlot.innerHTML = "";
    readoutEl.hidden = state !== "ready";

    if (state === "permission-required") {
      actionSlot.appendChild(
        createButton({ label: "Enable Motion", variant: "primary", onClick: () => void motion.requestPermission() })
      );
    } else if (state === "sensor-timeout" || state === "permission-denied") {
      actionSlot.appendChild(
        createButton({ label: "Try Again", variant: "primary", onClick: () => motion.recalibrate() })
      );
    } else if (state === "await-calibration") {
      const step = motion.getCalibrationStep();
      if (step === "center") {
        calibrationSlot.innerHTML = `<p>Hold the phone comfortably like a steering wheel.</p>`;
        calibrationSlot.appendChild(
          createButton({ label: "Center", variant: "primary", onClick: () => { motion.confirmCalibrationCenter(); renderForState(motion.getState()); } })
        );
      } else if (step === "confirm-right") {
        calibrationSlot.innerHTML = `<p>Turn the phone slightly right, then tap Next.</p>`;
        calibrationSlot.appendChild(
          createButton({ label: "Next", variant: "primary", onClick: () => { motion.confirmCalibrationRight(); renderForState(motion.getState()); } })
        );
      } else if (step === "confirm-tilt") {
        calibrationSlot.innerHTML = `<p>Tilt the top edge away from you, then tap Next.</p>`;
        calibrationSlot.appendChild(
          createButton({ label: "Next", variant: "primary", onClick: () => { motion.confirmCalibrationTilt(); renderForState(motion.getState()); } })
        );
      }
    } else if (state === "ready") {
      calibrationSlot.appendChild(
        createButton({ label: "Recalibrate", variant: "secondary", onClick: () => motion.recalibrate() })
      );
    }
  }

  const offState = motion.onStateChange((state) => renderForState(state));
  const offReading = motion.onReading((reading: MotionReading) => {
    readoutEl.textContent = `steering: ${reading.steering.toFixed(2)}\nthrottle: ${reading.throttle.toFixed(2)}\nbrake:    ${reading.brake.toFixed(2)}`;
  });

  renderForState(motion.getState());

  return () => {
    offState();
    offReading();
    motion.destroy();
  };
}
```

- [ ] **Step 2: Modify `client/src/main.ts`** — register the debug route

```ts
import { renderMotionDebugPage } from "./pages/motionDebug";

registerRoute("/dev/motion-debug", renderMotionDebugPage);
```

(Add the import alongside the other page imports and the `registerRoute` call alongside the others, before `startRouter`.)

- [ ] **Step 3: Add a minimal style for the readout to `client/src/styles/components.css`**

```css
.motion-readout {
  font-family: ui-monospace, monospace;
  font-size: 1.1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1rem;
  text-align: left;
  white-space: pre;
}
```

- [ ] **Step 4: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification (sensor emulation or a real phone)**

Run: `npm run dev`, open `http://localhost:3000/dev/motion-debug` on a phone
over the printed Network URL (or in Chrome DevTools with the Sensors panel
open, "Orientation" set to a custom value, on `localhost` which counts as a
secure context). Confirm: on first load the page shows either "Enable
Motion" (iOS) or goes straight to the landscape/calibration flow (most
Android browsers). Grant permission if prompted. Rotate the device/emulator
to landscape — confirm the page shows the Center step. Tap through
Center → turn right → Next → tilt forward → Next — confirm it reaches
"Motion controls are live." and the readout shows live `steering` near 0 at
rest. Turn the phone left/right — confirm `steering` goes negative/positive
respectively (matching the calibration you just did). Tilt forward — confirm
`throttle` increases; tilt back — confirm `brake` increases. Tap
Recalibrate — confirm it returns to the Center step. Rotate back to portrait
while `ready` — confirm it drops back to the "Rotate your phone sideways…"
message.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/motionDebug.ts client/src/main.ts client/src/styles/components.css
git commit -m "Add motion debug page for manual sensor-pipeline verification"
```

---

### Task 3: Protocol — Discriminated `game:state` Union

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `server/games/controllerTest.ts`
- Modify: `client/src/games/controller-test/renderer.ts`
- Modify: `client/src/pages/hostLobby.ts`

**Interfaces:**
- Produces: `ControllerTestPlayerState`, `ControllerTestGameStatePayload`,
  `RacingPlayerState`, `RacingGameStatePayload`, `GameStatePayload` (now a
  union) from `shared/protocol.ts` — the `RacingGameStatePayload` variant is
  defined now (so the union exists) but not yet produced anywhere; Task 6
  is the first task that actually constructs one.
- This task changes Controller Test's wire payload shape (adds
  `gameType`/`roundId`, which it didn't carry before) but not its behavior —
  **regression gate**: existing Controller Test tests pass unchanged in
  intent, `npm run typecheck` clean, and a full manual Controller Test
  playthrough (host → QR → join → ready → start → countdown →
  JUMP/LEFT/RIGHT) behaves identically to before this task.

- [ ] **Step 1: Modify `shared/protocol.ts`** — replace the flat `GameStatePlayer`/`GameStatePayload` types

Replace:

```ts
export interface GameStatePlayer {
  playerNumber: number;
  x: number;
  y: number;
}
export interface GameStatePayload {
  roundId: string;
  players: GameStatePlayer[];
}
```

with:

```ts
export interface ControllerTestPlayerState {
  playerNumber: number;
  x: number;
  y: number;
}
export interface ControllerTestGameStatePayload {
  gameType: "controller-test";
  roundId: string;
  players: ControllerTestPlayerState[];
}

export interface RacingPlayerState {
  playerNumber: number;
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  rank: number;
  lap: number;
  finished: boolean;
  finishTime: number | null;
}
export interface RacingGameStatePayload {
  gameType: "racing";
  roundId: string;
  trackId: string;
  raceStatus: "countdown" | "racing" | "finished";
  players: RacingPlayerState[];
}

export type GameStatePayload = ControllerTestGameStatePayload | RacingGameStatePayload;
```

- [ ] **Step 2: Modify `server/games/controllerTest.ts`** — update the import and `toGameStatePayload`'s return shape

Replace:

```ts
import type { GameStatePayload } from "../../shared/protocol";
```

with:

```ts
import type { ControllerTestGameStatePayload } from "../../shared/protocol";
```

Replace:

```ts
export function toGameStatePayload(room: InternalRoom): GameStatePayload {
  return {
    roundId: room.roundId ?? "",
    players: room.players
      .filter((p) => p.connected)
      .map((p) => ({ playerNumber: p.playerNumber, x: p.physics.x, y: p.physics.y }))
  };
}
```

with:

```ts
export function toGameStatePayload(room: InternalRoom): ControllerTestGameStatePayload {
  return {
    gameType: "controller-test",
    roundId: room.roundId ?? "",
    players: room.players
      .filter((p) => p.connected)
      .map((p) => ({ playerNumber: p.playerNumber, x: p.physics.x, y: p.physics.y }))
  };
}
```

- [ ] **Step 3: Modify `client/src/games/controller-test/renderer.ts`** — update the import and generic parameter

Replace:

```ts
import type { GameStatePayload, PublicRoomState } from "../../../../shared/protocol";
```

with:

```ts
import type { ControllerTestGameStatePayload, PublicRoomState } from "../../../../shared/protocol";
```

Replace:

```ts
export class ControllerTestRenderer implements GameRenderer<GameStatePayload> {
```

with:

```ts
export class ControllerTestRenderer implements GameRenderer<ControllerTestGameStatePayload> {
```

Replace:

```ts
  applyState(state: GameStatePayload): void {
```

with:

```ts
  applyState(state: ControllerTestGameStatePayload): void {
```

- [ ] **Step 4: Modify `client/src/pages/hostLobby.ts`** — narrow the `game:state` handler on `gameType`

Replace:

```ts
  const onGameState = (payload: GameStatePayload) => {
    renderer?.applyState(payload);
  };
```

with:

```ts
  const onGameState = (payload: GameStatePayload) => {
    if (payload.gameType === "controller-test") renderer?.applyState(payload);
  };
```

- [ ] **Step 5: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all 4 existing suites still pass (18/19 tests — count may vary
slightly depending on which prior-session regression tests are present;
none should newly fail).

- [ ] **Step 7: Manual regression verification**

Run: `npm run dev`. Play a full Controller Test round (host → QR → join →
ready → start → countdown → JUMP/LEFT/RIGHT) exactly as before. Confirm
behavior is pixel-for-pixel identical to pre-this-task — this change is
purely a payload-shape change, nothing should look or feel different.

- [ ] **Step 8: Commit**

```bash
git add shared/protocol.ts server/games/controllerTest.ts client/src/games/controller-test/renderer.ts client/src/pages/hostLobby.ts
git commit -m "Make game:state a gameType-discriminated union (Controller Test unaffected in behavior)"
```

---

### Task 4: Refactor — Room-Level `InternalGameState`

**This is a scoped structural refactor of already-shipped, already-reviewed
code, done before any racing-specific logic exists, with its own regression
gate — read every current file fully before editing, do not assume line
numbers from this plan match exactly.**

**Files:**
- Modify: `server/types.ts`
- Modify: `server/rooms.ts`
- Modify: `server/games/controllerTest.ts`
- Modify: `server/games/controllerTest.test.ts`
- Modify: `server/socketHandlers.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ControllerTestPhysics`, `ControllerTestGameState`,
  `InternalGameState` (currently a type alias to just
  `ControllerTestGameState` — Task 6 extends it to a union once
  `RacingGameState` exists) from `server/types.ts`;
  `createControllerTestGameState(room): ControllerTestGameState` from
  `server/games/controllerTest.ts` — consumed by `server/socketHandlers.ts`
  (this task) and later racing wiring (Task 7) for the analogous
  `createRacingGameState`.
- `InternalPlayer` loses `physics`/`lastSequence` (moved into
  `ControllerTestPhysics`, keyed by `playerNumber` inside
  `room.gameState.players`); `InternalPlayer` now holds only identity/
  connection fields.
- **Regression gate:** `npm test` passes with the same test *intent* as
  before (fixtures/assertions updated to the new shape, not weakened),
  `npm run typecheck` is clean, and a full manual Controller Test
  playthrough behaves identically to before this task.

- [ ] **Step 1: Read the current files** — `server/types.ts`, `server/rooms.ts`, `server/games/controllerTest.ts`, `server/games/controllerTest.test.ts`, `server/socketHandlers.ts` — to confirm they match what this task assumes (they should, if Task 3 just landed) before making any edit.

- [ ] **Step 2: Replace `server/types.ts` entirely**

```ts
import type { Socket } from "socket.io";
import type { GameType, RoomStatus } from "../shared/protocol";

export interface ControllerTestPhysics {
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  direction: -1 | 0 | 1;
  lastSequence: number;
}
export interface ControllerTestGameState {
  gameType: "controller-test";
  players: Map<number, ControllerTestPhysics>;
}

export type InternalGameState = ControllerTestGameState;

export interface InternalPlayer {
  playerNumber: number;
  token: string;
  nickname: string | null;
  color: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
}

export interface InternalRoom {
  id: string;
  gameType: GameType;
  maxPlayers: number;
  hostToken: string;
  hostSocketId: string | null;
  status: RoomStatus;
  statusBeforeHostDisconnect: RoomStatus | null;
  roundId: string | null;
  countdownEndsAt: number | null;
  players: InternalPlayer[];
  gameState: InternalGameState | null;
  createdAt: number;
  hostGraceTimer: NodeJS.Timeout | null;
  countdownTimer: NodeJS.Timeout | null;
  physicsInterval: NodeJS.Timeout | null;
}

export type SocketSession =
  | { role: "host"; roomId: string }
  | { role: "controller"; roomId: string; playerNumber: number };

// socket.io's `Socket.data` is typed via a generic parameter that defaults to
// `any`; declaration-merging into `Socket`/`SocketData` directly either fails
// to compile (conflicts with the generic) or silently stays `any`. Verified
// empirically: parameterizing the generic directly is the only approach that
// actually narrows `socket.data.session` at compile time.
export type AppSocket = Socket<any, any, any, { session?: SocketSession }>;
```

- [ ] **Step 3: Modify `server/rooms.ts`** — drop the now-unused `ARENA` import, remove physics from `createPlayer`, add `gameState: null` to `createRoom`

Replace:

```ts
import { ARENA, PLAYER_COLORS } from "../shared/protocol";
```

with:

```ts
import { PLAYER_COLORS } from "../shared/protocol";
```

Replace:

```ts
function createPlayer(playerNumber: number): InternalPlayer {
  return {
    playerNumber,
    token: createToken(),
    nickname: null,
    color: PLAYER_COLORS[(playerNumber - 1) % PLAYER_COLORS.length] ?? "#22d3ee",
    socketId: null,
    connected: false,
    ready: false,
    lastSequence: -1,
    physics: { x: ARENA.width / 2, y: ARENA.groundY, vy: 0, grounded: true, direction: 0 }
  };
}
```

with:

```ts
function createPlayer(playerNumber: number): InternalPlayer {
  return {
    playerNumber,
    token: createToken(),
    nickname: null,
    color: PLAYER_COLORS[(playerNumber - 1) % PLAYER_COLORS.length] ?? "#22d3ee",
    socketId: null,
    connected: false,
    ready: false
  };
}
```

In `createRoom`, add `gameState: null,` to the returned object (immediately after `players,`):

```ts
  const room: InternalRoom = {
    id,
    gameType,
    maxPlayers,
    hostToken: createToken(),
    hostSocketId: null,
    status: "lobby",
    statusBeforeHostDisconnect: null,
    roundId: null,
    countdownEndsAt: null,
    players,
    gameState: null,
    createdAt: Date.now(),
    hostGraceTimer: null,
    countdownTimer: null,
    physicsInterval: null
  };
```

- [ ] **Step 4: Replace `server/games/controllerTest.ts` entirely**

```ts
import type { Server } from "socket.io";
import { ARENA, SOCKET_EVENTS } from "../../shared/protocol";
import type { ControllerTestGameStatePayload } from "../../shared/protocol";
import type { ControllerTestGameState, ControllerTestPhysics, InternalRoom } from "../types";
import { roomChannel } from "../rooms";

const TICK_MS = 50;

export function createControllerTestGameState(room: InternalRoom): ControllerTestGameState {
  const players = new Map<number, ControllerTestPhysics>();
  for (const player of room.players) {
    players.set(player.playerNumber, {
      x: ARENA.width / 2,
      y: ARENA.groundY,
      vy: 0,
      grounded: true,
      direction: 0,
      lastSequence: -1
    });
  }
  return { gameType: "controller-test", players };
}

export function stepPhysics(room: InternalRoom, deltaSeconds: number): void {
  if (room.gameState?.gameType !== "controller-test") return;
  for (const physics of room.gameState.players.values()) {
    physics.x += physics.direction * ARENA.moveSpeed * deltaSeconds;
    physics.x = Math.max(ARENA.playerRadius, Math.min(ARENA.width - ARENA.playerRadius, physics.x));

    physics.vy += ARENA.gravity * deltaSeconds;
    physics.y += physics.vy * deltaSeconds;
    if (physics.y >= ARENA.groundY) {
      physics.y = ARENA.groundY;
      physics.vy = 0;
      physics.grounded = true;
    }
  }
}

export function toGameStatePayload(room: InternalRoom): ControllerTestGameStatePayload {
  const gameState = room.gameState?.gameType === "controller-test" ? room.gameState : null;
  return {
    gameType: "controller-test",
    roundId: room.roundId ?? "",
    players: room.players
      .filter((p) => p.connected)
      .map((p) => {
        const physics = gameState?.players.get(p.playerNumber);
        return { playerNumber: p.playerNumber, x: physics?.x ?? 0, y: physics?.y ?? 0 };
      })
  };
}

export function startPhysicsLoop(io: Server, room: InternalRoom): void {
  if (room.physicsInterval) return;
  let lastTick = Date.now();
  room.physicsInterval = setInterval(() => {
    const now = Date.now();
    const deltaSeconds = (now - lastTick) / 1000;
    lastTick = now;
    stepPhysics(room, deltaSeconds);
    io.to(roomChannel(room.id)).volatile.emit(SOCKET_EVENTS.GAME_STATE, toGameStatePayload(room));
  }, TICK_MS);
}

export function stopPhysicsLoop(room: InternalRoom): void {
  if (room.physicsInterval) {
    clearInterval(room.physicsInterval);
    room.physicsInterval = null;
  }
}

export function resetAllDirections(room: InternalRoom): void {
  if (room.gameState?.gameType !== "controller-test") return;
  for (const physics of room.gameState.players.values()) physics.direction = 0;
}

export function resetPlayerDirection(room: InternalRoom, playerNumber: number): void {
  if (room.gameState?.gameType !== "controller-test") return;
  const physics = room.gameState.players.get(playerNumber);
  if (physics) physics.direction = 0;
}
```

- [ ] **Step 5: Replace `server/games/controllerTest.test.ts` entirely**

```ts
import { describe, expect, it } from "vitest";
import { ARENA } from "../../shared/protocol";
import type { ControllerTestGameState, InternalRoom } from "../types";
import { resetAllDirections, stepPhysics } from "./controllerTest";

function makeRoom(): InternalRoom {
  const gameState: ControllerTestGameState = {
    gameType: "controller-test",
    players: new Map([
      [1, { x: ARENA.width / 2, y: ARENA.groundY, vy: 0, grounded: true, direction: 0, lastSequence: 0 }]
    ])
  };
  return {
    id: "TEST1",
    gameType: "controller-test",
    maxPlayers: 1,
    hostToken: "h",
    hostSocketId: null,
    status: "in-progress",
    statusBeforeHostDisconnect: null,
    roundId: "r1",
    countdownEndsAt: null,
    createdAt: Date.now(),
    hostGraceTimer: null,
    countdownTimer: null,
    physicsInterval: null,
    gameState,
    players: [
      {
        playerNumber: 1,
        token: "t",
        nickname: "A",
        color: "#fff",
        socketId: "s1",
        connected: true,
        ready: true
      }
    ]
  };
}

function physicsOf(room: InternalRoom, playerNumber: number) {
  if (room.gameState?.gameType !== "controller-test") throw new Error("not a controller-test room");
  const physics = room.gameState.players.get(playerNumber);
  if (!physics) throw new Error(`no physics for player ${playerNumber}`);
  return physics;
}

describe("stepPhysics", () => {
  it("moves a player right and clamps at the arena bound", () => {
    const room = makeRoom();
    physicsOf(room, 1).direction = 1;
    for (let i = 0; i < 1000; i++) stepPhysics(room, 1 / 20);
    expect(physicsOf(room, 1).x).toBeLessThanOrEqual(ARENA.width - ARENA.playerRadius);
  });

  it("applies gravity so a jump arcs back down to the ground", () => {
    const room = makeRoom();
    const physics = physicsOf(room, 1);
    physics.vy = ARENA.jumpVelocity;
    physics.grounded = false;
    let leftGround = false;
    for (let i = 0; i < 200; i++) {
      stepPhysics(room, 1 / 20);
      if (physics.y < ARENA.groundY) leftGround = true;
    }
    expect(leftGround).toBe(true);
    expect(physics.grounded).toBe(true);
    expect(physics.y).toBe(ARENA.groundY);
  });

  it("resetAllDirections stops horizontal movement", () => {
    const room = makeRoom();
    physicsOf(room, 1).direction = 1;
    resetAllDirections(room);
    expect(physicsOf(room, 1).direction).toBe(0);
  });
});
```

- [ ] **Step 6: Modify `server/socketHandlers.ts`** — five changes

Replace the `controllerTest` import:

```ts
import { resetAllDirections, resetPlayerDirection, startPhysicsLoop, stopPhysicsLoop } from "./games/controllerTest";
```

with:

```ts
import {
  createControllerTestGameState,
  resetAllDirections,
  resetPlayerDirection,
  startPhysicsLoop,
  stopPhysicsLoop
} from "./games/controllerTest";
```

Replace `endRound`:

```ts
function endRound(room: InternalRoom): void {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  stopPhysicsLoop(room);
  room.status = "lobby";
  room.roundId = null;
  room.countdownEndsAt = null;
  resetAllDirections(room);
}
```

with:

```ts
function endRound(room: InternalRoom): void {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  stopPhysicsLoop(room);
  room.status = "lobby";
  room.roundId = null;
  room.countdownEndsAt = null;
  room.gameState = null;
}
```

In the `GAME_START` handler, add `room.gameState = createControllerTestGameState(room);` immediately after `room.countdownEndsAt = Date.now() + 3000;` and before `broadcastRoomState(io, room);`:

```ts
      room.roundId = createToken();
      room.status = "countdown";
      room.countdownEndsAt = Date.now() + 3000;
      room.gameState = createControllerTestGameState(room);
      broadcastRoomState(io, room);
      runCountdown(io, room);
      ack({ ok: true } as Ack<Record<string, never>>);
```

In the `CONTROLLER_LEAVE` handler, replace `player.physics.direction = 0;` with `resetPlayerDirection(room, player.playerNumber);`:

```ts
      const player = findPlayer(room, session.playerNumber);
      if (player) {
        player.nickname = null;
        player.connected = false;
        player.ready = false;
        player.socketId = null;
        resetPlayerDirection(room, player.playerNumber);
      }
```

Replace the `INPUT_ACTION` handler entirely:

```ts
    socket.on(SOCKET_EVENTS.INPUT_ACTION, (payload: InputActionPayload) => {
      const session = socket.data.session;
      if (!session || session.role !== "controller") return;
      const room = getRoom(session.roomId);
      // "countdown" is accepted alongside "in-progress": a room's roundId is fixed
      // for the whole countdown+in-progress span (see GAME_START/runCountdown), and
      // the physics tick doesn't start until "go" — so a direction/jump set during
      // the countdown just sits on the player's physics until the tick loop begins
      // consuming it, letting a pre-emptive hold take effect immediately at "go"
      // instead of being silently dropped and requiring a release-and-repress.
      if (!room || (room.status !== "in-progress" && room.status !== "countdown") || room.roundId !== payload.roundId) {
        return;
      }
      if (room.gameState?.gameType !== "controller-test") return;
      const physics = room.gameState.players.get(session.playerNumber);
      if (!physics || payload.sequence <= physics.lastSequence) return;
      physics.lastSequence = payload.sequence;
      switch (payload.action) {
        case "left-start":
          physics.direction = -1;
          break;
        case "right-start":
          physics.direction = 1;
          break;
        case "left-end":
          if (physics.direction === -1) physics.direction = 0;
          break;
        case "right-end":
          if (physics.direction === 1) physics.direction = 0;
          break;
        case "jump":
          if (physics.grounded) {
            physics.vy = ARENA.jumpVelocity;
            physics.grounded = false;
          }
          break;
      }
    });
```

(`findPlayer` remains used elsewhere in this file — do not remove its import.)

- [ ] **Step 7: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all suites pass. `server/rooms.test.ts` needs no changes (it never
touched `physics`) — if it fails, something else broke.

- [ ] **Step 9: Manual regression verification**

Run: `npm run dev`. Full Controller Test playthrough: host → QR → join →
ready → start → countdown → JUMP/LEFT/RIGHT. Also re-verify: pre-emptive
hold through the countdown still works (the comment-documented behavior in
`INPUT_ACTION` above), and a disconnect mid-game still stops that player's
movement immediately (no stuck input). Everything must behave exactly as
before this task — if anything differs, this refactor has a bug and must be
fixed before continuing.

- [ ] **Step 10: Commit**

```bash
git add server/types.ts server/rooms.ts server/games/controllerTest.ts server/games/controllerTest.test.ts server/socketHandlers.ts
git commit -m "Refactor: move Controller Test physics from InternalPlayer onto room-level InternalGameState"
```

---

### Task 5: Racing Protocol — `racing:input` Wired End-to-End (Inert Storage)

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `server/types.ts`
- Create: `server/games/racing.ts`
- Modify: `server/socketHandlers.ts`
- Modify: `server/socketHandlers.test.ts`

**Interfaces:**
- Produces: `RacingInputPayload`, `SOCKET_EVENTS.RACING_INPUT` from
  `shared/protocol.ts`; `RacingCarState`, `RacingGameState` from
  `server/types.ts` (extends `InternalGameState` to a union);
  `createRacingGameState(room): RacingGameState` from
  `server/games/racing.ts` — consumed by `server/socketHandlers.ts` (this
  task) and extended by Task 6 (physics) and Task 7 (lifecycle wiring).
- This task proves the input pipe works — validated `racing:input` values
  land on `room.gameState`. No physics tick consumes them yet (Task 6/7).

- [ ] **Step 1: Modify `shared/protocol.ts`** — add the racing input payload and event, immediately after `InputActionPayload`

```ts
export interface RacingInputPayload {
  steering: number; // -1..1
  throttle: number; // 0..1
  brake: number;    // 0..1
  sequence: number;
  roundId: string;
}
```

Add `RACING_INPUT: "racing:input",` to `SOCKET_EVENTS`, immediately after `INPUT_ACTION: "input:action",`.

- [ ] **Step 2: Modify `server/types.ts`** — add racing state types and extend `InternalGameState` to a union

Add, immediately after the `ControllerTestGameState` interface:

```ts
export interface RacingCarState {
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  yawRate: number;
  steering: number;
  throttle: number;
  brake: number;
  lastInputAt: number;
  lastSequence: number;
  rank: number;
  lap: number;
  finished: boolean;
  finishTime: number | null;
}
export interface RacingGameState {
  gameType: "racing";
  trackId: string;
  cars: Map<number, RacingCarState>;
  finishOrder: number[];
  focusedPlayerNumber: number | null;
  startedAt: number | null;
  endedAt: number | null;
}
```

Replace:

```ts
export type InternalGameState = ControllerTestGameState;
```

with:

```ts
export type InternalGameState = ControllerTestGameState | RacingGameState;
```

- [ ] **Step 3: Create `server/games/racing.ts`**

```ts
import type { InternalRoom, RacingCarState, RacingGameState } from "../types";

export const DEFAULT_TRACK_ID = "test-oval";

export function createRacingGameState(room: InternalRoom): RacingGameState {
  const cars = new Map<number, RacingCarState>();
  for (const player of room.players) {
    cars.set(player.playerNumber, {
      progress: 0,
      lateralOffset: 0,
      headingError: 0,
      speed: 0,
      yawRate: 0,
      steering: 0,
      throttle: 0,
      brake: 0,
      lastInputAt: Date.now(),
      lastSequence: -1,
      rank: player.playerNumber,
      lap: 1,
      finished: false,
      finishTime: null
    });
  }
  return {
    gameType: "racing",
    trackId: DEFAULT_TRACK_ID,
    cars,
    finishOrder: [],
    focusedPlayerNumber: room.players[0]?.playerNumber ?? null,
    startedAt: null,
    endedAt: null
  };
}
```

- [ ] **Step 4: Modify `server/socketHandlers.ts`** — construct the right `gameState` per `gameType`, and add the `RACING_INPUT` handler

Add to the type-only import block (alongside `InputActionPayload`):

```ts
  RacingInputPayload,
```

Add a new import:

```ts
import { createRacingGameState } from "./games/racing";
```

In the `GAME_START` handler, replace:

```ts
      room.gameState = createControllerTestGameState(room);
```

with:

```ts
      room.gameState = room.gameType === "racing" ? createRacingGameState(room) : createControllerTestGameState(room);
```

Add a new handler, immediately after the `INPUT_ACTION` handler:

```ts
    socket.on(SOCKET_EVENTS.RACING_INPUT, (payload: RacingInputPayload) => {
      const session = socket.data.session;
      if (!session || session.role !== "controller") return;
      const room = getRoom(session.roomId);
      if (!room || (room.status !== "in-progress" && room.status !== "countdown") || room.roundId !== payload.roundId) {
        return;
      }
      if (room.gameState?.gameType !== "racing") return;
      const car = room.gameState.cars.get(session.playerNumber);
      if (!car || payload.sequence <= car.lastSequence) return;
      car.lastSequence = payload.sequence;
      car.lastInputAt = Date.now();
      car.steering = Math.max(-1, Math.min(1, payload.steering));
      car.throttle = Math.max(0, Math.min(1, payload.throttle));
      car.brake = Math.max(0, Math.min(1, payload.brake));
    });
```

- [ ] **Step 5: Modify `server/socketHandlers.test.ts`** — add a test confirming the pipe works, and import `getRoom`

Add `getRoom` to the existing `import { registerSocketHandlers } from "./socketHandlers";`-adjacent imports — add a new import line:

```ts
import { getRoom } from "./rooms";
```

Add a new test, in the existing `describe("room lifecycle", ...)` block:

```ts
  it("stores validated racing:input values on the room's racing game state", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: tokenFromJoinUrl(created.slots[0]!.joinUrl),
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    let roundId: string | null = null;
    host.on(SOCKET_EVENTS.ROOM_STATE, (room: { roundId: string | null }) => {
      if (room.roundId) roundId = room.roundId;
    });
    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(roundId).not.toBeNull();

    p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: 0.5, throttle: 0.8, brake: 0, sequence: 1, roundId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const room = getRoom(created.roomId);
    expect(room?.gameState?.gameType).toBe("racing");
    if (room?.gameState?.gameType === "racing") {
      const car = room.gameState.cars.get(1);
      expect(car?.steering).toBe(0.5);
      expect(car?.throttle).toBe(0.8);
    }

    host.close();
    p1.close();
  });
```

- [ ] **Step 6: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run server/socketHandlers.test.ts`
Expected: all tests pass (including the new one).

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 9: Commit**

```bash
git add shared/protocol.ts server/types.ts server/games/racing.ts server/socketHandlers.ts server/socketHandlers.test.ts
git commit -m "Wire racing:input end-to-end: validated, stored on room-level racing game state"
```

---

### Task 6: Shared Track Definition + Server Racing Physics

**Files:**
- Create: `shared/racingTrack.ts`
- Test: `shared/racingTrack.test.ts`
- Modify: `server/games/racing.ts`
- Test: `server/games/racing.test.ts`

**Interfaces:**
- Consumes: `RacingCarState`, `RacingGameState`, `InternalRoom` from
  `server/types.ts` (Task 5); `createRacingGameState` (Task 5, unchanged).
- Produces: `TrackPoint`, `TrackDefinition`, `createTrack`,
  `centerlinePoint(track, progress)`, `centerlineTangentAngle(track,
  progress)`, `TEST_OVAL_TRACK` from `shared/racingTrack.ts` — importable
  from both server (physics) and client (Task 8's renderer), single source
  of truth for track shape. Produces `RACING` constants, `stepCar`,
  `stepPhysics`, `toGameStatePayload`, `startRacingPhysicsLoop`,
  `stopRacingPhysicsLoop`, `resetAllRacingInputs`, `resetCarInput` from
  `server/games/racing.ts` — consumed by `server/socketHandlers.ts` in
  Task 7. **Not wired into the socket lifecycle yet** — this task proves
  the physics model in isolation via direct unit tests; Task 7 wires
  `startRacingPhysicsLoop`/`stopRacingPhysicsLoop` into
  `game:start`/`game:end`/disconnect.

- [ ] **Step 1: Create `shared/racingTrack.ts`**

```ts
export interface TrackPoint {
  x: number;
  z: number;
}

export interface TrackDefinition {
  id: string;
  waypoints: TrackPoint[];
  trackLength: number;
  trackHalfWidth: number;
}

const TEST_OVAL_WAYPOINTS: TrackPoint[] = [
  { x: 0, z: 0 },
  { x: 60, z: -10 },
  { x: 100, z: -50 },
  { x: 100, z: -150 },
  { x: 60, z: -190 },
  { x: 0, z: -200 },
  { x: -60, z: -190 },
  { x: -100, z: -150 },
  { x: -100, z: -50 },
  { x: -60, z: -10 }
];

const SEGMENT_SAMPLES = 40;

function catmullRom(p0: TrackPoint, p1: TrackPoint, p2: TrackPoint, p3: TrackPoint, t: number): TrackPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const z =
    0.5 *
    (2 * p1.z +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return { x, z };
}

interface SampledCenterline {
  points: TrackPoint[];
  cumulativeLengths: number[];
}

function buildSampledCenterline(waypoints: TrackPoint[]): SampledCenterline {
  const points: TrackPoint[] = [];
  const n = waypoints.length;
  for (let i = 0; i < n; i++) {
    const p0 = waypoints[(i - 1 + n) % n]!;
    const p1 = waypoints[i]!;
    const p2 = waypoints[(i + 1) % n]!;
    const p3 = waypoints[(i + 2) % n]!;
    for (let s = 0; s < SEGMENT_SAMPLES; s++) {
      points.push(catmullRom(p0, p1, p2, p3, s / SEGMENT_SAMPLES));
    }
  }
  const cumulativeLengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const dist = Math.hypot(curr.x - prev.x, curr.z - prev.z);
    cumulativeLengths.push(cumulativeLengths[i - 1]! + dist);
  }
  return { points, cumulativeLengths };
}

const sampledCache = new Map<string, SampledCenterline>();

export function createTrack(id: string, waypoints: TrackPoint[], trackHalfWidth: number): TrackDefinition {
  const sampled = buildSampledCenterline(waypoints);
  sampledCache.set(id, sampled);
  const trackLength = sampled.cumulativeLengths[sampled.cumulativeLengths.length - 1]!;
  return { id, waypoints, trackLength, trackHalfWidth };
}

function sampledFor(track: TrackDefinition): SampledCenterline {
  let sampled = sampledCache.get(track.id);
  if (!sampled) {
    sampled = buildSampledCenterline(track.waypoints);
    sampledCache.set(track.id, sampled);
  }
  return sampled;
}

function wrapProgress(progress: number, trackLength: number): number {
  const wrapped = progress % trackLength;
  return wrapped < 0 ? wrapped + trackLength : wrapped;
}

function sampleIndexFor(progress: number, cumulativeLengths: number[]): number {
  for (let i = 0; i < cumulativeLengths.length - 1; i++) {
    if (cumulativeLengths[i + 1]! >= progress) return i;
  }
  return cumulativeLengths.length - 2;
}

export function centerlinePoint(track: TrackDefinition, progress: number): TrackPoint {
  const { points, cumulativeLengths } = sampledFor(track);
  const wrapped = wrapProgress(progress, track.trackLength);
  const index = sampleIndexFor(wrapped, cumulativeLengths);
  const nextIndex = (index + 1) % points.length;
  const segStart = cumulativeLengths[index]!;
  const segEnd = index + 1 < cumulativeLengths.length ? cumulativeLengths[index + 1]! : track.trackLength;
  const span = segEnd - segStart || 1;
  const t = Math.min(1, Math.max(0, (wrapped - segStart) / span));
  const a = points[index]!;
  const b = points[nextIndex]!;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function centerlineTangentAngle(track: TrackDefinition, progress: number): number {
  const ahead = centerlinePoint(track, progress + 1);
  const behind = centerlinePoint(track, progress - 1);
  return Math.atan2(ahead.x - behind.x, -(ahead.z - behind.z));
}

export const TEST_OVAL_TRACK = createTrack("test-oval", TEST_OVAL_WAYPOINTS, 6);
```

- [ ] **Step 2: Create `shared/racingTrack.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "./racingTrack";

describe("TEST_OVAL_TRACK", () => {
  it("has a positive track length", () => {
    expect(TEST_OVAL_TRACK.trackLength).toBeGreaterThan(0);
  });

  it("wraps progress past trackLength back to the start region", () => {
    const atStart = centerlinePoint(TEST_OVAL_TRACK, 0);
    const wrapped = centerlinePoint(TEST_OVAL_TRACK, TEST_OVAL_TRACK.trackLength);
    expect(wrapped.x).toBeCloseTo(atStart.x, 0);
    expect(wrapped.z).toBeCloseTo(atStart.z, 0);
  });

  it("produces a finite tangent angle at any progress", () => {
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, TEST_OVAL_TRACK.trackLength / 4);
    expect(Number.isFinite(angle)).toBe(true);
  });

  it("moves to a different point as progress increases", () => {
    const a = centerlinePoint(TEST_OVAL_TRACK, 0);
    const b = centerlinePoint(TEST_OVAL_TRACK, TEST_OVAL_TRACK.trackLength / 2);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Modify `server/games/racing.ts`** — add physics, append after the existing `createRacingGameState` function

```ts
import type { Server } from "socket.io";
import { SOCKET_EVENTS } from "../../shared/protocol";
import type { RacingGameStatePayload, RacingPlayerState } from "../../shared/protocol";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../shared/racingTrack";
import type { TrackDefinition } from "../../shared/racingTrack";
import { roomChannel } from "../rooms";
```

(add these imports to the top of the file, alongside the existing `import type { InternalRoom, RacingCarState, RacingGameState } from "../types";`)

Append, after `createRacingGameState`:

```ts
const PHYSICS_STEP = 1 / 60;
const BROADCAST_EVERY_N_STEPS = 3; // 60 / 3 = 20Hz
const MAX_STEPS_PER_CALLBACK = 5;
const INPUT_TIMEOUT_MS = 300;
const STEERING_DECAY = 0.9;
const MAX_HEADING_ERROR = Math.PI * (80 / 180);

export const RACING = {
  trackHalfWidth: 6,
  maxSpeed: 42,
  acceleration: 14,
  brakeForce: 22,
  coastDrag: 5,
  steeringResponsiveness: 2.4,
  yawDamping: 3.0,
  offTrackSlowFactor: 0.55
} as const;

function trackFor(_room: InternalRoom): TrackDefinition {
  return TEST_OVAL_TRACK; // single track in Cycle 1; room.gameState.trackId names it for the client
}

function applyInputTimeout(car: RacingCarState, now: number): void {
  if (now - car.lastInputAt > INPUT_TIMEOUT_MS) {
    car.throttle = 0;
    car.brake = 0;
    car.steering *= STEERING_DECAY;
  }
}

export function stepCar(track: TrackDefinition, car: RacingCarState, dt: number): void {
  car.yawRate += (car.steering * RACING.steeringResponsiveness - car.yawRate * RACING.yawDamping) * dt;
  car.headingError += car.yawRate * dt;
  car.headingError = Math.max(-MAX_HEADING_ERROR, Math.min(MAX_HEADING_ERROR, car.headingError));

  if (car.throttle > 0) {
    car.speed += car.throttle * RACING.acceleration * dt;
  } else if (car.brake > 0) {
    car.speed -= car.brake * RACING.brakeForce * dt;
  } else {
    car.speed -= RACING.coastDrag * dt;
  }
  car.speed = Math.max(0, Math.min(RACING.maxSpeed, car.speed));

  car.progress += car.speed * Math.cos(car.headingError) * dt;
  car.lateralOffset += car.speed * Math.sin(car.headingError) * dt;

  const maxOffset = track.trackHalfWidth * 1.6;
  car.lateralOffset = Math.max(-maxOffset, Math.min(maxOffset, car.lateralOffset));
  if (Math.abs(car.lateralOffset) > track.trackHalfWidth) {
    car.speed *= RACING.offTrackSlowFactor;
  }

  if (car.progress < 0) car.progress += track.trackLength;
  if (car.progress >= track.trackLength && !car.finished) {
    car.finished = true;
  }
}

function updateRanks(gameState: RacingGameState): void {
  const entries = [...gameState.cars.entries()].sort(([, a], [, b]) => b.progress - a.progress);
  entries.forEach(([, car], index) => {
    car.rank = index + 1;
  });
}

export function stepPhysics(room: InternalRoom, dt: number): void {
  if (room.gameState?.gameType !== "racing") return;
  const track = trackFor(room);
  const now = Date.now();
  for (const car of room.gameState.cars.values()) {
    if (car.finished) continue;
    applyInputTimeout(car, now);
    stepCar(track, car, dt);
  }
  updateRanks(room.gameState);
}

export function toGameStatePayload(room: InternalRoom): RacingGameStatePayload {
  const gameState = room.gameState?.gameType === "racing" ? room.gameState : null;
  const players: RacingPlayerState[] = gameState
    ? [...gameState.cars.entries()].map(([playerNumber, car]) => ({
        playerNumber,
        progress: car.progress,
        lateralOffset: car.lateralOffset,
        headingError: car.headingError,
        speed: car.speed,
        rank: car.rank,
        lap: car.lap,
        finished: car.finished,
        finishTime: car.finishTime
      }))
    : [];
  const allFinished = players.length > 0 && players.every((p) => p.finished);
  return {
    gameType: "racing",
    roundId: room.roundId ?? "",
    trackId: gameState?.trackId ?? TEST_OVAL_TRACK.id,
    raceStatus: room.status === "countdown" ? "countdown" : allFinished ? "finished" : "racing",
    players
  };
}

export function startRacingPhysicsLoop(io: Server, room: InternalRoom): void {
  if (room.physicsInterval) return;
  if (room.gameState?.gameType === "racing") room.gameState.startedAt = Date.now();
  let accumulator = 0;
  let lastTick = Date.now();
  let stepCount = 0;
  room.physicsInterval = setInterval(() => {
    const now = Date.now();
    accumulator += (now - lastTick) / 1000;
    lastTick = now;
    let steps = 0;
    while (accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_CALLBACK) {
      stepPhysics(room, PHYSICS_STEP);
      accumulator -= PHYSICS_STEP;
      steps += 1;
      stepCount += 1;
    }
    if (steps > 0 && stepCount % BROADCAST_EVERY_N_STEPS === 0) {
      io.to(roomChannel(room.id)).volatile.emit(SOCKET_EVENTS.GAME_STATE, toGameStatePayload(room));
    }
  }, Math.round(PHYSICS_STEP * 1000));
}

export function stopRacingPhysicsLoop(room: InternalRoom): void {
  if (room.physicsInterval) {
    clearInterval(room.physicsInterval);
    room.physicsInterval = null;
  }
}

export function resetAllRacingInputs(room: InternalRoom): void {
  if (room.gameState?.gameType !== "racing") return;
  for (const car of room.gameState.cars.values()) {
    car.steering = 0;
    car.throttle = 0;
    car.brake = 0;
  }
}

export function resetCarInput(room: InternalRoom, playerNumber: number): void {
  if (room.gameState?.gameType !== "racing") return;
  const car = room.gameState.cars.get(playerNumber);
  if (car) {
    car.steering = 0;
    car.throttle = 0;
    car.brake = 0;
  }
}
```

- [ ] **Step 4: Create `server/games/racing.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { TEST_OVAL_TRACK } from "../../shared/racingTrack";
import { RACING, stepCar } from "./racing";
import type { RacingCarState } from "../types";

function makeCar(overrides: Partial<RacingCarState> = {}): RacingCarState {
  return {
    progress: 0,
    lateralOffset: 0,
    headingError: 0,
    speed: 0,
    yawRate: 0,
    steering: 0,
    throttle: 0,
    brake: 0,
    lastInputAt: Date.now(),
    lastSequence: 0,
    rank: 1,
    lap: 1,
    finished: false,
    finishTime: null,
    ...overrides
  };
}

describe("stepCar", () => {
  it("accelerates forward and increases progress under full throttle with no steering", () => {
    const car = makeCar({ throttle: 1 });
    for (let i = 0; i < 120; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.speed).toBeGreaterThan(0);
    expect(car.progress).toBeGreaterThan(0);
    expect(car.lateralOffset).toBeCloseTo(0, 1);
  });

  it("turns: sustained steering with speed increases heading error and lateral offset, not just progress", () => {
    const car = makeCar({ throttle: 1, speed: RACING.maxSpeed / 2, steering: 1 });
    for (let i = 0; i < 60; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(Math.abs(car.headingError)).toBeGreaterThan(0);
    expect(Math.abs(car.lateralOffset)).toBeGreaterThan(0);
  });

  it("slows down when off track", () => {
    const onTrack = makeCar({ speed: RACING.maxSpeed, lateralOffset: 0 });
    const offTrack = makeCar({ speed: RACING.maxSpeed, lateralOffset: TEST_OVAL_TRACK.trackHalfWidth + 1 });
    stepCar(TEST_OVAL_TRACK, onTrack, 1 / 60);
    stepCar(TEST_OVAL_TRACK, offTrack, 1 / 60);
    expect(offTrack.speed).toBeLessThan(onTrack.speed);
  });

  it("coasts to a stop with no throttle or brake", () => {
    const car = makeCar({ speed: 10 });
    for (let i = 0; i < 300; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.speed).toBe(0);
  });

  it("clamps speed to RACING.maxSpeed", () => {
    const car = makeCar({ throttle: 1 });
    for (let i = 0; i < 600; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.speed).toBeLessThanOrEqual(RACING.maxSpeed);
  });

  it("marks the car finished once progress reaches the track length", () => {
    const car = makeCar({ progress: TEST_OVAL_TRACK.trackLength - 0.001, throttle: 1, speed: RACING.maxSpeed });
    stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.finished).toBe(true);
  });
});
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run shared/racingTrack.test.ts server/games/racing.test.ts`
Expected: 4 + 6 = 10 passed.

- [ ] **Step 6: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all suites pass (Task 6 adds tests only, doesn't touch anything wired into the live socket lifecycle yet — `startRacingPhysicsLoop` is not called from anywhere outside this module until Task 7).

- [ ] **Step 8: Commit**

```bash
git add shared/racingTrack.ts shared/racingTrack.test.ts server/games/racing.ts server/games/racing.test.ts
git commit -m "Add shared track spline and server racing physics: track-relative turning, fixed 60Hz timestep"
```

---

### Task 7: Multiplayer Wiring — Countdown, Rank, Finish, Results, Rematch

**Files:**
- Modify: `server/games/racing.ts`
- Modify: `server/socketHandlers.ts`
- Modify: `server/games/racing.test.ts`
- Modify: `server/socketHandlers.test.ts`

**Interfaces:**
- Consumes: everything from Task 5/6 (`createRacingGameState`, `stepPhysics`,
  `startRacingPhysicsLoop`, `stopRacingPhysicsLoop`, `resetAllRacingInputs`,
  `resetCarInput`, `toGameStatePayload`) unchanged; `toPublicRoomState` from
  `server/rooms.ts` (already exists, unchanged signature).
- Produces: `checkRaceCompletion(io, room, now): boolean` from
  `server/games/racing.ts` — called every physics tick from inside
  `startRacingPhysicsLoop`; also directly unit-testable. Wires
  `startRacingPhysicsLoop`/`stopRacingPhysicsLoop`/`resetAllRacingInputs`/
  `resetCarInput` into `server/socketHandlers.ts`'s `runCountdown`,
  `endRound`, and both branches of the `disconnect` handler, branching on
  `room.gameType`.
- Design note for Task 9/11 (client): once `room.status` becomes
  `"results"`, `game:state` broadcasts stop (the physics loop is stopped).
  The client must retain the last-received `RacingGameStatePayload` (which
  already carries each player's final `rank`/`finished`/`finishTime`) to
  render the results screen — no new wire fields are needed. "Rematch" and
  "Return to Lobby" both call the existing `game:end`, which works
  unconditionally from any status (including `"results"`) and does not
  reset `player.ready`, so a host can press Start Game again immediately if
  everyone stayed readied up.

- [ ] **Step 1: Modify `server/games/racing.ts`** — set `finishTime` on natural finish, add race-completion detection

Add the import (extend the existing `import { roomChannel } from "../rooms";` line):

```ts
import { roomChannel, toPublicRoomState } from "../rooms";
```

Add a new constant alongside the existing ones:

```ts
const RACE_SAFETY_TIMEOUT_MS = 180_000;
```

Replace `stepPhysics`:

```ts
export function stepPhysics(room: InternalRoom, dt: number): void {
  if (room.gameState?.gameType !== "racing") return;
  const track = trackFor(room);
  const now = Date.now();
  for (const car of room.gameState.cars.values()) {
    if (car.finished) continue;
    applyInputTimeout(car, now);
    stepCar(track, car, dt);
  }
  updateRanks(room.gameState);
}
```

with:

```ts
export function stepPhysics(room: InternalRoom, dt: number): void {
  if (room.gameState?.gameType !== "racing") return;
  const track = trackFor(room);
  const now = Date.now();
  const startedAt = room.gameState.startedAt ?? now;
  for (const car of room.gameState.cars.values()) {
    if (car.finished) continue;
    applyInputTimeout(car, now);
    stepCar(track, car, dt);
    if (car.finished) car.finishTime = now - startedAt;
  }
  updateRanks(room.gameState);
}
```

Add, immediately after `stepPhysics`:

```ts
export function checkRaceCompletion(io: Server, room: InternalRoom, now: number): boolean {
  if (room.gameState?.gameType !== "racing") return false;
  const gameState = room.gameState;
  const startedAt = gameState.startedAt ?? now;
  const allFinished = room.players.length > 0 && [...gameState.cars.values()].every((c) => c.finished);
  const timedOut = now - startedAt > RACE_SAFETY_TIMEOUT_MS;
  if (!allFinished && !timedOut) return false;

  if (timedOut) {
    for (const car of gameState.cars.values()) {
      if (!car.finished) {
        car.finished = true;
        car.finishTime = null;
      }
    }
  }
  gameState.finishOrder = [...gameState.cars.entries()]
    .sort(([, a], [, b]) => b.progress - a.progress)
    .map(([playerNumber]) => playerNumber);
  gameState.endedAt = now;
  stopRacingPhysicsLoop(room);
  room.status = "results";
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.ROOM_STATE, toPublicRoomState(room));
  return true;
}
```

Replace the body of `startRacingPhysicsLoop`'s interval callback (add the completion check at the end):

```ts
  room.physicsInterval = setInterval(() => {
    const now = Date.now();
    accumulator += (now - lastTick) / 1000;
    lastTick = now;
    let steps = 0;
    while (accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_CALLBACK) {
      stepPhysics(room, PHYSICS_STEP);
      accumulator -= PHYSICS_STEP;
      steps += 1;
      stepCount += 1;
    }
    if (steps > 0 && stepCount % BROADCAST_EVERY_N_STEPS === 0) {
      io.to(roomChannel(room.id)).volatile.emit(SOCKET_EVENTS.GAME_STATE, toGameStatePayload(room));
    }
    checkRaceCompletion(io, room, now);
  }, Math.round(PHYSICS_STEP * 1000));
```

- [ ] **Step 2: Modify `server/socketHandlers.ts`** — branch physics start/stop/reset by `room.gameType`

Replace the racing import Task 5 added:

```ts
import { createRacingGameState } from "./games/racing";
```

with:

```ts
import {
  createRacingGameState,
  resetAllRacingInputs,
  resetCarInput,
  startRacingPhysicsLoop,
  stopRacingPhysicsLoop
} from "./games/racing";
```

In `runCountdown`'s `emitNext`, replace:

```ts
      broadcastRoomState(io, room);
      startPhysicsLoop(io, room);
      return;
```

with:

```ts
      broadcastRoomState(io, room);
      if (room.gameType === "racing") startRacingPhysicsLoop(io, room);
      else startPhysicsLoop(io, room);
      return;
```

Replace `endRound`:

```ts
function endRound(room: InternalRoom): void {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  stopPhysicsLoop(room);
  room.status = "lobby";
  room.roundId = null;
  room.countdownEndsAt = null;
  room.gameState = null;
}
```

with:

```ts
function endRound(room: InternalRoom): void {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  if (room.gameType === "racing") stopRacingPhysicsLoop(room);
  else stopPhysicsLoop(room);
  room.status = "lobby";
  room.roundId = null;
  room.countdownEndsAt = null;
  room.gameState = null;
}
```

In the `disconnect` handler's host branch, replace:

```ts
        stopPhysicsLoop(room);
        room.status = "host-disconnected";
        resetAllDirections(room);
```

with:

```ts
        if (room.gameType === "racing") {
          stopRacingPhysicsLoop(room);
          resetAllRacingInputs(room);
        } else {
          stopPhysicsLoop(room);
          resetAllDirections(room);
        }
        room.status = "host-disconnected";
```

In the `disconnect` handler's controller branch, replace:

```ts
          resetPlayerDirection(room, player.playerNumber);
```

with:

```ts
          if (room.gameType === "racing") resetCarInput(room, player.playerNumber);
          else resetPlayerDirection(room, player.playerNumber);
```

In the `CONTROLLER_LEAVE` handler, replace:

```ts
        resetPlayerDirection(room, player.playerNumber);
```

with:

```ts
        if (room.gameType === "racing") resetCarInput(room, player.playerNumber);
        else resetPlayerDirection(room, player.playerNumber);
```

- [ ] **Step 3: Modify `server/games/racing.test.ts`**

`describe`/`expect`/`it` are already imported from `vitest` (Task 6, Step 4)
— leave that line as-is. Replace:

```ts
import { RACING, stepCar } from "./racing";
```

with:

```ts
import { RACING, checkRaceCompletion, createRacingGameState, stepCar } from "./racing";
```

Add two new imports, alongside the existing `import { TEST_OVAL_TRACK } from "../../shared/racingTrack";`:

```ts
import type { Server } from "socket.io";
import { createRoom, findPlayer } from "../rooms";
```

Append, at the end of the file, a new `describe` block. Each test keeps a
locally-typed `gameState` reference and asserts through it rather than
re-reading `room.gameState` after calling `checkRaceCompletion` (which
takes the whole mutable `room`, so TypeScript can no longer assume
`room.gameState`'s narrowed type after that call):

```ts
function fakeIo(): Server {
  return { to: () => ({ emit: () => {}, volatile: { emit: () => {} } }) } as unknown as Server;
}

describe("checkRaceCompletion", () => {
  it("transitions the room to results once every car has finished", () => {
    const room = createRoom("racing", 1);
    findPlayer(room, 1)!.connected = true;
    findPlayer(room, 1)!.ready = true;
    room.status = "in-progress";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.startedAt = Date.now() - 1000;
    gameState.cars.get(1)!.finished = true;
    gameState.cars.get(1)!.finishTime = 1000;

    const finished = checkRaceCompletion(fakeIo(), room, Date.now());

    expect(finished).toBe(true);
    expect(room.status).toBe("results");
    expect(gameState.finishOrder).toEqual([1]);
  });

  it("does nothing while a car is still racing and the safety timeout has not elapsed", () => {
    const room = createRoom("racing", 1);
    room.status = "in-progress";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.startedAt = Date.now();

    const finished = checkRaceCompletion(fakeIo(), room, Date.now());

    expect(finished).toBe(false);
    expect(room.status).toBe("in-progress");
  });

  it("force-finishes every unfinished car with a null finishTime after the safety timeout", () => {
    const room = createRoom("racing", 2);
    room.status = "in-progress";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.startedAt = Date.now() - 181_000;
    gameState.cars.get(1)!.finished = true;
    gameState.cars.get(1)!.finishTime = 5000;

    checkRaceCompletion(fakeIo(), room, Date.now());

    const car2 = gameState.cars.get(2)!;
    expect(car2.finished).toBe(true);
    expect(car2.finishTime).toBeNull();
  });
});
```

- [ ] **Step 4: Add a test to `server/socketHandlers.test.ts`** confirming a racing room's `game:start` reaches `in-progress`

```ts
  it("starts a racing room through countdown to in-progress", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: tokenFromJoinUrl(created.slots[0]!.joinUrl),
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 3200));
    const room = getRoom(created.roomId);
    expect(room?.status).toBe("in-progress");
    expect(room?.gameState?.gameType).toBe("racing");

    host.close();
    p1.close();
  }, 8000);
```

- [ ] **Step 5: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run server/games/racing.test.ts server/socketHandlers.test.ts`
Expected: all pass.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 8: Commit**

```bash
git add server/games/racing.ts server/socketHandlers.ts server/games/racing.test.ts server/socketHandlers.test.ts
git commit -m "Wire racing physics into the room lifecycle: countdown/results/rematch, finish detection, safety timeout"
```

---

### Task 8: Basic Technical Three.js Renderer

**Files:**
- Modify: `package.json` (add `three`, `@types/three`)
- Create: `client/src/games/racing/renderer.ts`

**Interfaces:**
- Consumes: `TEST_OVAL_TRACK`, `centerlinePoint`, `centerlineTangentAngle`
  from `shared/racingTrack.ts` (Task 6) — same source of truth the server
  physics uses, so the rendered track shape and the physics track shape can
  never diverge. `RacingGameStatePayload`, `RacingPlayerState`,
  `PublicRoomState` from `shared/protocol.ts`.
- Produces: `RacingRenderer implements GameRenderer<RacingGameStatePayload>`
  with `mount`/`applyState`/`render`/`destroy` (the same four-method
  contract `ControllerTestRenderer` implements) plus
  `setFocusedPlayer(playerNumber)` — consumed by Task 9's `hostLobby.ts`
  wiring. This is deliberately plain (colored box cars, a textured ribbon
  track, no scenery/particles/audio) — Cycle 2 enhances this *same* class,
  it is not replaced.

- [ ] **Step 1: Modify `package.json`** — add Three.js to `devDependencies` (bundled by Vite at build time, never touched by the server at runtime — same category as `socket.io-client`)

Add to `devDependencies`:

```json
    "@types/three": "^0.170.0",
    "three": "^0.170.0",
```

- [ ] **Step 2: Install the new dependency**

Run: `npm install`
Expected: installs cleanly.

- [ ] **Step 3: Create `client/src/games/racing/renderer.ts`**

```ts
import * as THREE from "three";
import type { GameRenderer } from "../gameRenderer";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";
import type { PublicRoomState, RacingGameStatePayload, RacingPlayerState } from "../../../../shared/protocol";

interface CarFrame {
  progress: number;
  lateralOffset: number;
  headingError: number;
}
interface Snapshot {
  time: number;
  players: Map<number, CarFrame>;
}

const RENDER_DELAY_MS = 50; // matches the 20Hz broadcast interval (see Controller Test's proven interpolation tuning)
const TRACK_SAMPLES = 240;

function buildTrackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#3a3f4b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8ecf9";
  ctx.fillRect(0, 0, 6, canvas.height);
  ctx.fillRect(canvas.width - 6, 0, 6, canvas.height);
  ctx.fillStyle = "#fbbf24";
  for (let y = 0; y < canvas.height; y += 32) {
    ctx.fillRect(canvas.width / 2 - 3, y, 6, 18);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 40);
  return texture;
}

function buildTrackMesh(): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;

  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const progress = (i / TRACK_SAMPLES) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    positions.push(center.x + nx * halfWidth, 0, center.z + nz * halfWidth);
    positions.push(center.x - nx * halfWidth, 0, center.z - nz * halfWidth);
    uvs.push(0, i / TRACK_SAMPLES);
    uvs.push(1, i / TRACK_SAMPLES);
  }
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ map: buildTrackTexture() });
  return new THREE.Mesh(geometry, material);
}

function buildCarMesh(color: string): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 3.2), new THREE.MeshStandardMaterial({ color }));
  body.position.y = 0.5;
  group.add(body);
  const wheelGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: "#1a1a1a" });
  const offsets: Array<[number, number]> = [
    [0.9, 1.1],
    [-0.9, 1.1],
    [0.9, -1.1],
    [-0.9, -1.1]
  ];
  for (const [x, z] of offsets) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.35, z);
    group.add(wheel);
  }
  return group;
}

export class RacingRenderer implements GameRenderer<RacingGameStatePayload> {
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private cars = new Map<number, THREE.Group>();
  private colors = new Map<number, string>();
  private snapshots: Snapshot[] = [];
  private focusedPlayerNumber: number;
  private container: HTMLElement | null = null;

  constructor(room: PublicRoomState) {
    for (const player of room.players) this.colors.set(player.playerNumber, player.color);
    this.focusedPlayerNumber = room.players[0]?.playerNumber ?? 1;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b0f1e");

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#dfe9ff", "#101425", 1.1));
    const sun = new THREE.DirectionalLight("#ffffff", 1.2);
    sun.position.set(60, 120, 40);
    scene.add(sun);

    scene.add(buildTrackMesh());

    for (const [playerNumber, color] of this.colors) {
      const car = buildCarMesh(color);
      scene.add(car);
      this.cars.set(playerNumber, car);
    }

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
  }

  applyState(state: RacingGameStatePayload): void {
    const players = new Map<number, CarFrame>(
      state.players.map((p: RacingPlayerState) => [
        p.playerNumber,
        { progress: p.progress, lateralOffset: p.lateralOffset, headingError: p.headingError }
      ])
    );
    this.snapshots.push({ time: performance.now(), players });
    if (this.snapshots.length > 2) this.snapshots.shift();
  }

  render(_timestamp: number): void {
    const { scene, camera, renderer } = this;
    if (!scene || !camera || !renderer) return;

    const positions = this.interpolate();
    let focused: { x: number; z: number; angle: number } | null = null;

    for (const [playerNumber, car] of this.cars) {
      const pos = positions.get(playerNumber);
      if (!pos) continue;
      const center = centerlinePoint(TEST_OVAL_TRACK, pos.progress);
      const trackAngle = centerlineTangentAngle(TEST_OVAL_TRACK, pos.progress);
      const nx = Math.cos(trackAngle);
      const nz = Math.sin(trackAngle);
      const x = center.x + nx * pos.lateralOffset;
      const z = center.z + nz * pos.lateralOffset;
      const angle = trackAngle + pos.headingError;
      car.position.set(x, 0, z);
      car.rotation.y = -angle;
      if (playerNumber === this.focusedPlayerNumber) focused = { x, z, angle };
    }

    if (focused) {
      const behindX = focused.x - Math.sin(focused.angle) * 12;
      const behindZ = focused.z - Math.cos(focused.angle) * 12;
      camera.position.set(behindX, 7, behindZ);
      camera.lookAt(focused.x, 1, focused.z);
    }

    renderer.render(scene, camera);
  }

  setFocusedPlayer(playerNumber: number): void {
    this.focusedPlayerNumber = playerNumber;
  }

  private interpolate(): Map<number, CarFrame> {
    if (this.snapshots.length === 0) return new Map();
    if (this.snapshots.length === 1) return this.snapshots[0]!.players;
    const [prev, next] = this.snapshots as [Snapshot, Snapshot];
    const renderTime = performance.now() - RENDER_DELAY_MS;
    const span = next.time - prev.time || 1;
    const t = Math.min(1, Math.max(0, (renderTime - prev.time) / span));
    const result = new Map<number, CarFrame>();
    for (const [playerNumber, nextFrame] of next.players) {
      const prevFrame = prev.players.get(playerNumber) ?? nextFrame;
      result.set(playerNumber, {
        progress: prevFrame.progress + (nextFrame.progress - prevFrame.progress) * t,
        lateralOffset: prevFrame.lateralOffset + (nextFrame.lateralOffset - prevFrame.lateralOffset) * t,
        headingError: prevFrame.headingError + (nextFrame.headingError - prevFrame.headingError) * t
      });
    }
    return result;
  }

  destroy(): void {
    this.renderer?.dispose();
    if (this.renderer && this.container) this.container.removeChild(this.renderer.domElement);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.cars.clear();
    this.container = null;
  }
}
```

- [ ] **Step 4: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the build** (confirms Three.js bundles correctly through Vite)

Run: `npm run build`
Expected: succeeds; `dist/client/assets/` includes a larger JS chunk than
before (Three.js adds real bundle weight — that's expected).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json client/src/games/racing/renderer.ts
git commit -m "Add basic technical Three.js racing renderer: track ribbon, colored cars, chase camera"
```

(This task has no standalone manual-verification step — `RacingRenderer` is
not mounted anywhere yet. Task 9 wires it into `hostLobby.ts`, at which
point it becomes visible and verifiable.)

---

### Task 9: `hostLobby.ts` Wiring — Renderer Selection, HUD, Results Screen

**Files:**
- Modify: `client/src/pages/hostLobby.ts`
- Modify: `client/src/styles/components.css`

**Interfaces:**
- Consumes: `RacingRenderer` (Task 8); `GameStatePayload` (now a union,
  Task 3); `PublicRoomState` (unchanged shape, `status` can now
  meaningfully be `"results"`).
- Produces: `hostLobby.ts` mounts `ControllerTestRenderer` or
  `RacingRenderer` based on `room.gameType`, shows a results screen when
  `room.status === "results"`, and reuses the existing `game:end` call for
  both "Rematch" (stay on this page) and the existing "Leave Room" action
  (unchanged) for "Change Game".

- [ ] **Step 1: Read the current `client/src/pages/hostLobby.ts` in full** before editing — it has been touched by Tasks 6, 9, and 11 of the original v1 plan; confirm it matches the structure this step assumes.

- [ ] **Step 2: Modify `client/src/pages/hostLobby.ts`**

Add imports:

```ts
import { RacingRenderer } from "../games/racing/renderer";
import type { RacingGameStatePayload, RacingPlayerState } from "../../../shared/protocol";
```

Replace the renderer type and construction. Replace:

```ts
  let renderer: ControllerTestRenderer | null = null;
```

with:

```ts
  let renderer: ControllerTestRenderer | RacingRenderer | null = null;
  let lastRacingState: RacingGameStatePayload | null = null;
```

Replace `startGameView`:

```ts
  function startGameView(room: PublicRoomState): void {
    gridEl.hidden = true;
    footerEl.hidden = true;
    gameSectionEl.hidden = false;
    gameSectionEl.innerHTML = `<div class="countdown-overlay" id="countdown"></div>`;
    renderer = new ControllerTestRenderer(room);
    renderer.mount(gameSectionEl);
    const loop = (t: number) => {
      renderer?.render(t);
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  }
```

with:

```ts
  function startGameView(room: PublicRoomState): void {
    gridEl.hidden = true;
    footerEl.hidden = true;
    gameSectionEl.hidden = false;
    gameSectionEl.innerHTML = `<div class="countdown-overlay" id="countdown"></div>`;
    renderer = room.gameType === "racing" ? new RacingRenderer(room) : new ControllerTestRenderer(room);
    renderer.mount(gameSectionEl);
    const loop = (t: number) => {
      renderer?.render(t);
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  }
```

Replace the `onGameState` handler:

```ts
  const onGameState = (payload: GameStatePayload) => {
    if (payload.gameType === "controller-test") renderer?.applyState(payload);
  };
```

with:

```ts
  const onGameState = (payload: GameStatePayload) => {
    if (payload.gameType === "controller-test" && renderer instanceof ControllerTestRenderer) {
      renderer.applyState(payload);
    } else if (payload.gameType === "racing") {
      lastRacingState = payload;
      if (renderer instanceof RacingRenderer) renderer.applyState(payload);
    }
  };
```

Add a results screen. Replace the top of `renderRoom` — replace:

```ts
  function renderRoom(room: PublicRoomState): void {
    if (room.status === "host-disconnected") {
```

with:

```ts
  function renderRoom(room: PublicRoomState): void {
    if (room.status === "results") {
      gridEl.hidden = true;
      gameSectionEl.hidden = true;
      reconnectingEl.hidden = true;
      renderResultsScreen(room);
      lastStatus = room.status;
      return;
    }
    footerEl.hidden = false;
    if (room.status === "host-disconnected") {
```

Add the `renderResultsScreen` function, immediately before `renderRoom`:

```ts
  function renderResultsScreen(room: PublicRoomState): void {
    footerEl.innerHTML = "";
    const players: RacingPlayerState[] = lastRacingState?.players ?? [];
    const ranked = [...players].sort((a, b) => a.rank - b.rank);
    const rows = ranked
      .map((p) => {
        const nickname = room.players.find((rp) => rp.playerNumber === p.playerNumber)?.nickname ?? `Player ${p.playerNumber}`;
        const time = p.finishTime !== null ? `${(p.finishTime / 1000).toFixed(2)}s` : "DNF";
        return `<li>#${p.rank} — ${nickname} — ${time}</li>`;
      })
      .join("");
    footerEl.innerHTML = `<div class="results-panel"><h2>Results</h2><ol class="results-list">${rows}</ol></div>`;
    const rematchButton = createButton({
      label: "Rematch",
      variant: "primary",
      onClick: async () => {
        await emitWithAck(SOCKET_EVENTS.GAME_END, {});
      }
    });
    const changeGameButton = createButton({
      label: "Change Game",
      variant: "secondary",
      onClick: async () => {
        await emitWithAck(SOCKET_EVENTS.GAME_END, {});
        navigate("/host");
      }
    });
    footerEl.querySelector(".results-panel")!.appendChild(rematchButton);
    footerEl.querySelector(".results-panel")!.appendChild(changeGameButton);
    footerEl.hidden = false;
  }
```

- [ ] **Step 3: Add results-screen styles to `client/src/styles/components.css`**

```css
.results-panel {
  text-align: center;
  width: 100%;
}
.results-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0;
  display: grid;
  gap: 0.5rem;
}
.results-list li {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
}
```

- [ ] **Step 4: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Create a 1-player Controller Test room and confirm it
still renders and plays exactly as before (regression check on the
`renderer instanceof` branching). Then create a 1-player Racing room (not
yet reachable through the normal catalog UI — Task 12 flips that; for now,
temporarily edit `client/src/games/catalog.ts`'s `racing` entry's
`playable` to `true` locally, uncommitted, to reach it, then revert the
edit before committing anything else) and confirm: the lobby leads to a
countdown, then a 3D scene renders with a track ribbon and one colored box
"car" sitting at the start line, camera positioned behind it. The car will
not move yet (no controller input exists until Task 10) — that's expected.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/hostLobby.ts client/src/styles/components.css
git commit -m "Wire RacingRenderer into hostLobby.ts: renderer selection by gameType, results screen"
```

---

### Task 10: Phone Racing Controller Screen

**Files:**
- Create: `client/src/controller/inputs/racingInput.ts`
- Create: `client/src/controller/racingView.ts`
- Create: `client/src/styles/racing.css`

**Interfaces:**
- Consumes: `MotionInputSource`, `MotionState`, `MotionReading` (Task 1);
  `SOCKET_EVENTS.RACING_INPUT`, `RacingInputPayload`, `GameStatePayload`
  (Task 5/3); `getSocket` (existing).
- Produces: `RacingInputSource` class (`send(reading)`, `sendNeutral()`)
  from `client/src/controller/inputs/racingInput.ts`;
  `mountRacingView(container, opts): CleanupFn` from
  `client/src/controller/racingView.ts` — consumed by Task 11's `join.ts`
  wiring. No touch steering/throttle/brake controls anywhere in this file —
  motion is the only gameplay input, matching the global constraint.

- [ ] **Step 1: Create `client/src/controller/inputs/racingInput.ts`**

```ts
import { getSocket } from "../../networking/socket";
import { SOCKET_EVENTS } from "../../../../shared/protocol";
import type { RacingInputPayload } from "../../../../shared/protocol";
import type { MotionReading } from "./motion";

export class RacingInputSource {
  private sequence = 0;
  private roundId: string;

  constructor(roundId: string) {
    this.roundId = roundId;
  }

  send(reading: MotionReading): void {
    const socket = getSocket();
    if (!socket.connected) return;
    this.sequence += 1;
    socket.emit(SOCKET_EVENTS.RACING_INPUT, {
      steering: reading.steering,
      throttle: reading.throttle,
      brake: reading.brake,
      sequence: this.sequence,
      roundId: this.roundId
    } satisfies RacingInputPayload);
  }

  sendNeutral(): void {
    this.send({ steering: 0, throttle: 0, brake: 0 });
  }
}
```

- [ ] **Step 2: Create `client/src/controller/racingView.ts`**

```ts
import { MotionInputSource } from "./inputs/motion";
import type { MotionReading, MotionState } from "./inputs/motion";
import { RacingInputSource } from "./inputs/racingInput";
import { getSocket } from "../networking/socket";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type { GameStatePayload } from "../../../shared/protocol";
import { createButton } from "../components/button";
import type { CleanupFn } from "../networking/router";

const STATE_COPY: Record<MotionState, string> = {
  "insecure-context": "Motion controls need a secure connection — this page was opened over plain HTTP.",
  unavailable: "Motion sensors are not available in this browser.",
  "permission-required": "Tap Enable Motion to use your phone as a steering wheel.",
  "permission-denied": "Motion access was denied. Check browser permissions and reload.",
  "await-landscape": "Rotate your phone sideways to use it as a steering wheel.",
  "await-calibration": "Calibrating…",
  "sensor-timeout": "No motion data was detected. Check browser permissions or try recalibrating.",
  ready: ""
};

export function mountRacingView(
  container: HTMLElement,
  opts: { nickname: string; color: string; roundId: string; playerNumber: number }
): CleanupFn {
  container.innerHTML = `
    <div class="controller-screen racing-controller" style="--player-color:${opts.color}">
      <header class="controller-header">
        <span class="controller-nickname">${opts.nickname}</span>
        <span class="controller-status" id="racing-conn-indicator">●</span>
      </header>
      <p id="racing-state-copy" class="hero-copy"></p>
      <div id="racing-action-slot"></div>
      <div id="racing-calibration-slot"></div>
      <div id="racing-ready-slot" hidden>
        <div class="steering-wheel" id="steering-wheel">
          <div class="wheel-rim"><span class="wheel-hub"></span></div>
        </div>
        <div class="racing-telemetry">
          <div class="telemetry-bar"><span>Throttle</span><progress id="throttle-bar" max="1" value="0"></progress></div>
          <div class="telemetry-bar"><span>Brake</span><progress id="brake-bar" max="1" value="0"></progress></div>
          <p id="speed-readout">Speed: 0 km/h</p>
        </div>
        <button class="btn btn-secondary" id="recalibrate-button" type="button">Recalibrate</button>
        <p class="hero-copy">Hold phone securely.</p>
      </div>
    </div>
  `;

  const stateCopyEl = container.querySelector<HTMLParagraphElement>("#racing-state-copy")!;
  const actionSlot = container.querySelector<HTMLDivElement>("#racing-action-slot")!;
  const calibrationSlot = container.querySelector<HTMLDivElement>("#racing-calibration-slot")!;
  const readySlot = container.querySelector<HTMLDivElement>("#racing-ready-slot")!;
  const wheelRimEl = container.querySelector<HTMLDivElement>(".wheel-rim")!;
  const throttleBar = container.querySelector<HTMLProgressElement>("#throttle-bar")!;
  const brakeBar = container.querySelector<HTMLProgressElement>("#brake-bar")!;
  const speedEl = container.querySelector<HTMLParagraphElement>("#speed-readout")!;
  const recalibrateButton = container.querySelector<HTMLButtonElement>("#recalibrate-button")!;
  const indicator = container.querySelector<HTMLSpanElement>("#racing-conn-indicator")!;

  const motion = new MotionInputSource();
  const input = new RacingInputSource(opts.roundId);

  function renderForState(state: MotionState): void {
    stateCopyEl.textContent = STATE_COPY[state];
    actionSlot.innerHTML = "";
    calibrationSlot.innerHTML = "";
    readySlot.hidden = state !== "ready";

    if (state === "permission-required") {
      actionSlot.appendChild(
        createButton({ label: "Enable Motion", variant: "primary", onClick: () => void motion.requestPermission() })
      );
    } else if (state === "sensor-timeout" || state === "permission-denied") {
      actionSlot.appendChild(
        createButton({ label: "Try Again", variant: "primary", onClick: () => motion.recalibrate() })
      );
    } else if (state === "await-calibration") {
      const step = motion.getCalibrationStep();
      if (step === "center") {
        calibrationSlot.innerHTML = `<p>Hold the phone comfortably like a steering wheel.</p>`;
        calibrationSlot.appendChild(
          createButton({
            label: "Center",
            variant: "primary",
            onClick: () => {
              motion.confirmCalibrationCenter();
              renderForState(motion.getState());
            }
          })
        );
      } else if (step === "confirm-right") {
        calibrationSlot.innerHTML = `<p>Turn the phone slightly right, then tap Next.</p>`;
        calibrationSlot.appendChild(
          createButton({
            label: "Next",
            variant: "primary",
            onClick: () => {
              motion.confirmCalibrationRight();
              renderForState(motion.getState());
            }
          })
        );
      } else if (step === "confirm-tilt") {
        calibrationSlot.innerHTML = `<p>Tilt the top edge away from you, then tap Next.</p>`;
        calibrationSlot.appendChild(
          createButton({
            label: "Next",
            variant: "primary",
            onClick: () => {
              motion.confirmCalibrationTilt();
              renderForState(motion.getState());
            }
          })
        );
      }
    }
  }

  const offState = motion.onStateChange(renderForState);
  const offReading = motion.onReading((reading: MotionReading) => {
    input.send(reading);
    wheelRimEl.style.setProperty("--steer", String(reading.steering));
    throttleBar.value = reading.throttle;
    brakeBar.value = reading.brake;
  });

  recalibrateButton.addEventListener("click", () => motion.recalibrate());

  const socket = getSocket();
  const onGameState = (payload: GameStatePayload) => {
    if (payload.gameType !== "racing") return;
    const self = payload.players.find((p) => p.playerNumber === opts.playerNumber);
    if (self) speedEl.textContent = `Speed: ${Math.round(self.speed * 3.6)} km/h`;
  };
  socket.on(SOCKET_EVENTS.GAME_STATE, onGameState);

  const onDisconnect = () => {
    input.sendNeutral();
    indicator.classList.add("offline");
  };
  const onConnect = () => indicator.classList.remove("offline");
  const onBlur = () => input.sendNeutral();
  const onVisibility = () => {
    if (document.hidden) input.sendNeutral();
  };
  socket.on("disconnect", onDisconnect);
  socket.on("connect", onConnect);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);

  renderForState(motion.getState());

  return () => {
    offState();
    offReading();
    socket.off(SOCKET_EVENTS.GAME_STATE, onGameState);
    socket.off("disconnect", onDisconnect);
    socket.off("connect", onConnect);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    input.sendNeutral();
    motion.destroy();
  };
}
```

- [ ] **Step 3: Create `client/src/styles/racing.css`**

```css
.racing-controller {
  align-items: center;
  text-align: center;
}
.steering-wheel {
  width: 220px;
  height: 220px;
  margin: 1.5rem auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wheel-rim {
  --steer: 0;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  border: 14px solid var(--player-color, var(--color-cyan));
  position: relative;
  transform: rotate(calc(var(--steer, 0) * 90deg));
}
.wheel-hub {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--player-color, var(--color-cyan));
  transform: translate(-50%, -50%);
}
.racing-telemetry {
  width: 100%;
  max-width: 260px;
  margin: 0 auto 1rem;
}
.telemetry-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.telemetry-bar span {
  width: 70px;
  text-align: right;
  color: var(--color-text-dim);
}
.telemetry-bar progress {
  flex: 1;
  height: 12px;
}
```

- [ ] **Step 4: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/controller/inputs/racingInput.ts client/src/controller/racingView.ts client/src/styles/racing.css
git commit -m "Add phone racing controller screen: motion-driven wheel/telemetry, no touch gameplay controls"
```

(Not reachable from the app yet — Task 11 wires it into `join.ts`.)

---

### Task 11: `join.ts` Wiring — Mount Racing Controller by `gameType`

**Files:**
- Modify: `client/src/pages/join.ts`

**Interfaces:**
- Consumes: `mountRacingView` (Task 10); `room.gameType` from
  `PublicRoomState` (already present, unchanged).
- Produces: the phone join flow now mounts `mountRacingView` instead of
  `mountControllerView` when `room.gameType === "racing"` — this is the
  task that makes a phone actually reachable as a racing controller and
  completes the full milestone loop end-to-end.

- [ ] **Step 1: Read the current `client/src/pages/join.ts` in full** before editing — confirm it matches the structure this step assumes.

- [ ] **Step 2: Modify `client/src/pages/join.ts`**

Add imports:

```ts
import { mountRacingView } from "../controller/racingView";
import "../styles/racing.css";
```

Replace:

```ts
    } else if (isPlaying) {
      section.innerHTML = `<div class="countdown-overlay" id="phone-countdown"></div><div id="controller-mount"></div>`;
      controllerCleanup = mountControllerView(section.querySelector("#controller-mount")!, {
        nickname: self.nickname ?? "Player",
        color: self.color,
        roundId: room.roundId ?? ""
      });
    } else {
```

with:

```ts
    } else if (isPlaying) {
      section.innerHTML = `<div class="countdown-overlay" id="phone-countdown"></div><div id="controller-mount"></div>`;
      const mountEl = section.querySelector<HTMLElement>("#controller-mount")!;
      controllerCleanup =
        room.gameType === "racing"
          ? mountRacingView(mountEl, {
              nickname: self.nickname ?? "Player",
              color: self.color,
              roundId: room.roundId ?? "",
              playerNumber: Number(playerNumber)
            })
          : mountControllerView(mountEl, {
              nickname: self.nickname ?? "Player",
              color: self.color,
              roundId: room.roundId ?? ""
            });
    } else {
```

- [ ] **Step 3: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. As in Task 9's verification, temporarily flip
`racing`'s `playable` to `true` in `catalog.ts` (uncommitted). Host a
1-player Racing room; join from a phone (or a second tab) — confirm the
join flow reaches the motion permission/landscape/calibration screens
exactly like Task 2's debug page, then "ready", then after Start Game and
the countdown, the phone shows the steering wheel + telemetry (no touch
LEFT/RIGHT/accelerator/brake buttons anywhere). Turning the phone should
move the on-screen wheel graphic; the host's 3D view (from Task 9) shows
the car — full movement confirmation is Task 12's job once everything is
wired together and racing is live in the catalog. Revert the temporary
`catalog.ts` edit before committing.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/join.ts
git commit -m "Mount the racing controller view instead of Controller Test's for racing rooms"
```

---

### Task 12: Enable Racing + Full Cycle 1 Verification

**Files:**
- Modify: `client/src/games/catalog.ts`
- Modify: `README.md` (only if verification surfaces an inaccuracy)

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: nothing new — this is the sign-off task for Cycle 1. Flips
  Racing's catalog entry to `playable: true`, then runs the complete
  verification checklist against the real app (dev and production builds).

- [ ] **Step 1: Modify `client/src/games/catalog.ts`** — enable Racing

Replace the `racing` entry:

```ts
  {
    id: "racing",
    title: "Racing",
    description: "Tilt, boost, and drift to the line.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: false,
    icon: "🏎️"
  }
```

with:

```ts
  {
    id: "racing",
    title: "Racing",
    description: "Steer with your phone like a wheel, tilt to throttle and brake — real motion control, real turning physics.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: true,
    icon: "🏎️"
  }
```

- [ ] **Step 2: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full automated test suite**

Run: `npm test`
Expected: every suite passes —
`shared/protocol.test.ts`, `shared/racingTrack.test.ts`,
`server/rooms.test.ts`, `server/socketHandlers.test.ts`,
`server/games/controllerTest.test.ts`, `server/games/racing.test.ts`,
`client/src/controller/inputs/motion.test.ts`.

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: succeeds with no errors. Fix any build error directly (this is
explicitly this task's job, same as the original v1 plan's final task) —
common culprits at this point: a Three.js import that isn't tree-shaking
cleanly, or a stray type-only import missing `import type`.

- [ ] **Step 5: Smoke-test the production server**

Run: `npm start`
Expected: the same `Local:`/`Network:`/`QR codes will use:` banner as dev.
Open the printed Local URL — the landing page renders. Navigate to
`/dev/motion-debug` — confirms static routing still works for the debug
page too.

- [ ] **Step 6: Full manual verification — Controller Test regression**

With the production server still running (or `npm run dev`, either is
fine for this step), play a complete Controller Test round exactly as in
the original v1 project's final checklist: host → QR → join → ready →
start → countdown → JUMP/LEFT/RIGHT moves the circle. **This must work
identically to before any racing work began** — if anything regressed,
stop and fix it before continuing; the `InternalGameState` refactor
(Task 4) is the most likely source of a regression if one exists.

- [ ] **Step 7: Full manual verification — Racing, the Cycle 1 exit bar**

On a phone on the same Wi-Fi (using the printed Network URL — motion
sensors require a secure context or `localhost`; if testing without a real
phone, use Chrome DevTools' Sensors panel exactly as in Task 2):

1. Host a Racing room (now reachable directly from `/host` — no more
   temporary catalog edits needed).
2. Join from the phone. Confirm the motion setup flow: permission →
   landscape → guided calibration (center → confirm-right → confirm-tilt) →
   ready, exactly as verified in isolation in Task 2.
3. Ready up on the phone, press Start Game on the host. Confirm a synced
   3-2-1 countdown on both devices.
4. Confirm the host's 3D view shows the track and the car. Turn the phone
   like a wheel — confirm the car **visibly turns and changes heading**,
   not just slides sideways while facing forward (this is the core
   correctness bar from the design spec — a lane-runner would fail this
   check). Tilt forward — confirm the car accelerates; tilt back — confirm
   it brakes/slows. Steer off the track edge — confirm the car slows down
   (off-track penalty).
5. Confirm the phone's speed readout updates from the server (not a local
   guess).
6. For a 1-player room, confirm the race is a time trial (no other cars,
   `rank` is 1) and finishes when the car completes the lap (or after the
   180-second safety timeout if you don't want to wait for a full lap —
   both paths should reach the results screen).
7. Confirm the results screen shows on the host: final ranking, finish
   time (or "DNF" if force-finished by timeout), player colors. Press
   **Rematch** — confirm it returns to the lobby with the player still
   marked ready (if they stayed readied up) and Start Game usable again
   immediately. Start a second race — confirm it works. Then press
   **Change Game** from a fresh results screen — confirm it returns to
   `/host`.
8. Multiplayer (2 phones/tabs): confirm both cars render, both respond
   independently to their own phone's motion, and live rank updates as one
   car pulls ahead (check the host's leaderboard/HUD area).
9. Stuck-input protection: during a race, tilt the phone to full throttle
   and then background the browser tab (switch apps/tabs) without
   releasing — confirm the car's throttle drops to 0 within ~300ms
   server-side (visible as the car coasting/slowing, not continuing to
   accelerate forever). Disconnect a player mid-race (close their tab) —
   confirm their car's input resets immediately rather than continuing to
   move on its own.
10. Host disconnect mid-race: close and reopen the host tab (or simulate
    the disconnect) — confirm the phone shows "Reconnecting to Host…" and
    the race pauses (physics loop stopped), and reconnecting returns
    everyone to a working lobby (consistent with the existing Controller
    Test host-disconnect behavior from the original project).

- [ ] **Step 8: Check `README.md` for accuracy**

Read the current `README.md`. If Racing needs any mention (e.g., a note
that motion controls require HTTPS or `localhost` for real devices, and
that Racing is currently a technical prototype — Cycle 2 pending), add a
short, accurate note. Do not overstate what Racing currently is.

- [ ] **Step 9: Commit**

```bash
git add client/src/games/catalog.ts README.md
git commit -m "Enable Racing in the game catalog; complete Cycle 1 (Racing Foundation) verification"
```

(Omit `README.md` from the `git add` if Step 8 required no changes.)

- [ ] **Step 10: Write the Cycle 1 completion report**

Do not describe Racing as finished. State explicitly, as the closing line
of whatever report/summary is produced for this plan's completion: **"Cycle
1 (Racing Foundation) is complete and verified. Racing is playable with
real motion control and real track-relative turning physics, but this is
the technical foundation, not the finished game. The next required step is
Cycle 2 (Polished Racing Vertical Slice) — full visual presentation, audio,
AI opponents, and car collision — planned separately in
`docs/superpowers/plans/2026-07-12-racing-polished-slice-implementation.md`
after this cycle is implemented and verified."**

---

## Plan Self-Review

**Spec coverage:** Every requirement from
`docs/superpowers/specs/2026-07-12-racing-motion-controller-design.md`'s
Cycle 1 scope (§12) maps to a task — §4 motion state machine/calibration →
Tasks 1–2; §3 protocol discriminated union → Task 3; §5 room-level game
state → Task 4; §3 `racing:input` → Task 5; §6.1–6.2 track-relative
physics/60Hz-20Hz split → Task 6; §6.3 rank (no collision this cycle),
§6.4 input timeout, §9 results/rematch → Task 7; §7.1 technical renderer →
Task 8; §7.2 camera/HUD, results screen → Task 9; §8 phone controller
screen → Task 10; full loop wiring → Task 11; §10 time-trial, catalog
enablement, full verification → Task 12. §11 (HTTPS/secure-context) is
covered by `insecure-context` in Task 1's state machine and re-verified in
Task 12 Step 7. All 10 items from the user's pre-plan self-review checklist
are implemented in a specific task, cross-referenced above.

**Placeholder scan:** No task contains "TBD", unshown code, or "add
appropriate X" language. The two places behavior is intentionally deferred
to a later task (Task 5's `RACING_INPUT` handler storing values with no
physics consuming them yet; Task 6's physics existing but not wired into
the socket lifecycle) are explicitly called out as sequencing, with the
consuming task named — the same pattern proven across the original v1
plan.

**Type consistency:** Verified `RacingCarState`/`RacingGameState`/
`RacingInputPayload`/`RacingGameStatePayload`/`RacingPlayerState` field
names (`progress`, `lateralOffset`, `headingError`, `speed`, `yawRate`,
`steering`, `throttle`, `brake`, `rank`, `lap`, `finished`, `finishTime`)
are used identically from Task 5 through Task 12. `startRacingPhysicsLoop`/
`stopRacingPhysicsLoop`/`resetAllRacingInputs`/`resetCarInput`/
`checkRaceCompletion` (Task 6/7) match exactly what Task 7's
`socketHandlers.ts` edits import and call. `RacingRenderer`'s constructor
signature (`room: PublicRoomState`) and `setFocusedPlayer` match how
Task 9 constructs and could later call it. `mountRacingView`'s options
shape (`nickname, color, roundId, playerNumber`) matches exactly what
Task 11's `join.ts` edit passes. `TEST_OVAL_TRACK`/`centerlinePoint`/
`centerlineTangentAngle` (Task 6, `shared/racingTrack.ts`) are imported
with identical names and signatures by both `server/games/racing.ts`
(Task 6/7) and `client/src/games/racing/renderer.ts` (Task 8) — confirmed
single source of truth, no divergent duplicate track math.

**Dependency order check:** No task imports a symbol before the task that
creates it. Task 5 introduces `RacingCarState`/`RacingGameState` before
Task 6 needs them for physics. Task 6's physics functions are not called
from `socketHandlers.ts` until Task 7. Task 8's renderer is not mounted
until Task 9. Task 10's controller view is not reachable until Task 11.
Task 12 is strictly last, flipping the catalog flag only once every prior
task's work is in place — a user cannot reach a half-built Racing room at
any earlier point, since the catalog gate stays closed until Task 12
(Tasks 9 and 11's manual verification steps use a temporary, uncommitted
local edit to reach Racing early for their own testing, explicitly
reverted before committing — the catalog stays `playable: false` in every
actual commit before Task 12).

## Execution Handoff

Plan complete and saved to
`docs/superpowers/plans/2026-07-12-racing-foundation-implementation.md`.
Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per
task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using
executing-plans, batch execution with checkpoints.

Which approach?
