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

export interface MotionDebugSnapshot {
  rawAlpha: number | null;
  rawBeta: number | null;
  rawGamma: number | null;
  normalizedRotation: number;
  normalizedPitch: number;
  lastEventAt: number;
  orientationAngle: number;
  permissionResult: "not-requested" | "granted" | "denied" | "implicit";
  calibrated: boolean;
}

const LANDSCAPE_ANGLES = new Set([90, 270]);
const CALIBRATION_STORAGE_KEY = "pocket-arena:racingCalibration";

interface StoredCalibration {
  neutralRotation: number;
  neutralPitch: number;
  steeringSign: 1 | -1;
  throttleSign: 1 | -1;
}

interface MotionInputOptions {
  restoreCalibration?: boolean;
}

const STEERING_DEAD_ZONE_DEG = 2.5;
// Was 16: full steering lock at under 14 degrees of wrist tilt read as
// twitchy/oversensitive in real phone testing - widened so it takes a more
// deliberate tilt to reach full lock, giving finer control near center.
const STEERING_MAX_TILT_DEG = 26;
const THROTTLE_DEAD_ZONE_DEG = 8;
const THROTTLE_MAX_TILT_DEG = 30;
const SMOOTHING_FACTOR = 0.7;
const SENSOR_TIMEOUT_MS = 3000;
const STALE_READING_MS = 300;
const READING_INTERVAL_MS = 25; // ~40Hz

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
  private lastAlpha: number | null = null;
  private lastBeta: number | null = null;
  private lastGamma: number | null = null;
  private lastEventAt = 0;
  private permissionResult: MotionDebugSnapshot["permissionResult"] = "not-requested";
  private smoothedSteering = 0;
  private smoothedSigned = 0;
  private sensorTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readingHandle: ReturnType<typeof setInterval> | null = null;
  private stateListeners = new Set<(state: MotionState) => void>();
  private readingListeners = new Set<(reading: MotionReading) => void>();
  private readonly restoreCalibration: boolean;

  constructor(options: MotionInputOptions = {}) {
    this.restoreCalibration = options.restoreCalibration ?? false;
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

  getDebugSnapshot(): MotionDebugSnapshot {
    return {
      rawAlpha: this.lastAlpha,
      rawBeta: this.lastBeta,
      rawGamma: this.lastGamma,
      normalizedRotation: this.lastRawRotation,
      normalizedPitch: this.lastRawPitch,
      lastEventAt: this.lastEventAt,
      orientationAngle: this.orientationAngle(),
      permissionResult: this.permissionResult,
      calibrated: this.calibrationStep === "done"
    };
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
        this.permissionResult = result;
        if (result !== "granted") {
          this.setState("permission-denied");
          return;
        }
      } else {
        this.permissionResult = "implicit";
      }
      if (motionCtor && typeof motionCtor.requestPermission === "function") {
        const result = await motionCtor.requestPermission();
        if (result === "denied") this.permissionResult = "denied";
      }
    } catch {
      this.permissionResult = "denied";
      this.setState("permission-denied");
      return;
    }
    window.addEventListener("deviceorientation", this.handleOrientation);
    window.addEventListener("orientationchange", this.handleOrientationChange);
    window.addEventListener("resize", this.handleOrientationChange);
    this.checkLandscape();
  }

  private checkLandscape(): void {
    if (!this.isLandscape()) {
      this.setState("await-landscape");
      return;
    }
    const stored = this.restoreCalibration ? this.loadPersistedCalibration() : null;
    if (stored) {
      this.neutralRotation = stored.neutralRotation;
      this.neutralPitch = stored.neutralPitch;
      this.steeringSign = stored.steeringSign;
      this.throttleSign = stored.throttleSign;
      this.calibrationStep = "done";
      this.smoothedSteering = 0;
      this.smoothedSigned = 0;
      this.setState("ready");
      this.startReadingLoop();
      return;
    }
    this.setState("await-calibration");
    this.calibrationStep = "center";
  }

  private persistCalibration(): void {
    try {
      const data: StoredCalibration = {
        neutralRotation: this.neutralRotation,
        neutralPitch: this.neutralPitch,
        steeringSign: this.steeringSign,
        throttleSign: this.throttleSign
      };
      window.sessionStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // sessionStorage unavailable (private browsing, quota) - calibration just won't persist.
    }
  }

  private clearPersistedCalibration(): void {
    try {
      window.sessionStorage.removeItem(CALIBRATION_STORAGE_KEY);
    } catch {
      // sessionStorage unavailable - nothing persisted to clear.
    }
  }

  private loadPersistedCalibration(): StoredCalibration | null {
    try {
      const raw = window.sessionStorage.getItem(CALIBRATION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredCalibration>;
      if (
        typeof parsed.neutralRotation !== "number" ||
        typeof parsed.neutralPitch !== "number" ||
        (parsed.steeringSign !== 1 && parsed.steeringSign !== -1) ||
        (parsed.throttleSign !== 1 && parsed.throttleSign !== -1)
      ) {
        return null;
      }
      return parsed as StoredCalibration;
    } catch {
      return null;
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
    this.lastAlpha = event.alpha;
    this.lastBeta = event.beta;
    this.lastGamma = event.gamma;
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
    // armSensorTimeout (called once, at "center") only catches "zero events
    // ever arrived" — a sensor that fires once then goes silent (screen
    // lock, permission revoked mid-flow, browser throttling) would satisfy
    // that check yet still be dead by the time the user reaches this later,
    // user-paced step. Re-checking freshness here catches that case too.
    if (Date.now() - this.lastEventAt > STALE_READING_MS) {
      this.setState("sensor-timeout");
      return;
    }
    this.steeringSign = deriveSign(this.lastRawRotation, this.neutralRotation);
    this.calibrationStep = "confirm-tilt";
  }

  confirmCalibrationTilt(): void {
    if (this.state !== "await-calibration" || this.calibrationStep !== "confirm-tilt") return;
    if (Date.now() - this.lastEventAt > STALE_READING_MS) {
      this.setState("sensor-timeout");
      return;
    }
    this.throttleSign = deriveSign(this.lastRawPitch, this.neutralPitch);
    this.calibrationStep = "done";
    this.clearSensorTimeout();
    this.smoothedSteering = 0;
    this.smoothedSigned = 0;
    this.persistCalibration();
    this.setState("ready");
    this.startReadingLoop();
  }

  recalibrate(): void {
    this.stopReadingLoop();
    this.clearPersistedCalibration();
    this.smoothedSteering = 0;
    this.smoothedSigned = 0;
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
