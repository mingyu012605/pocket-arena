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
