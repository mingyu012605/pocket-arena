export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const MAX_ACCELERATION = 20;

export function computeAcceleration(
  speed: number,
  previousSpeed: number,
  previousAcceleration: number,
  dtSeconds: number,
  maxAcceleration: number
): number {
  if (dtSeconds <= 0) return 0;
  const raw = (speed - previousSpeed) / dtSeconds;
  const smoothed = previousAcceleration + (raw - previousAcceleration) * 0.12;
  return clamp(smoothed, -maxAcceleration, maxAcceleration);
}

export function computeDriftAmount(headingError: number): number {
  return clamp((Math.abs(headingError) - 0.12) / 0.35, 0, 1);
}

export interface ImpactThresholds {
  speedDropThreshold: number;
  minSpeed: number;
  maxSteering: number;
}

export const DEFAULT_IMPACT_THRESHOLDS: ImpactThresholds = {
  speedDropThreshold: 4,
  minSpeed: 3,
  maxSteering: 0.5
};

export function detectImpact(
  speed: number,
  previousSpeed: number,
  steering: number,
  cooldownRemaining: number,
  thresholds: ImpactThresholds = DEFAULT_IMPACT_THRESHOLDS
): { isImpact: boolean; impactStrength: number } {
  const speedDrop = previousSpeed - speed;
  const isImpact =
    speedDrop > thresholds.speedDropThreshold &&
    previousSpeed > thresholds.minSpeed &&
    Math.abs(steering) < thresholds.maxSteering &&
    cooldownRemaining <= 0;
  return { isImpact, impactStrength: isImpact ? clamp(speedDrop / 20, 0, 1) : 0 };
}

export const HARD_LANDING_IMPACT_THRESHOLD = 0.45;

export function classifyLanding(impactStrength: number): "soft" | "hard" {
  return impactStrength >= HARD_LANDING_IMPACT_THRESHOLD ? "hard" : "soft";
}

export type DriverPose = "celebration" | "collision" | "airtime" | "drift" | "steering";

export interface DriverInput {
  steering: number;
  speed: number;
  acceleration: number;
  driftAmount: number;
  impactStrength: number;
  airborne: boolean;
  finished: boolean;
  deltaTime: number;
}

export function resolveActivePose(input: DriverInput): DriverPose {
  if (input.finished) return "celebration";
  if (input.impactStrength > 0) return "collision";
  if (input.airborne) return "airtime";
  if (input.driftAmount > 0) return "drift";
  return "steering";
}

export type FaceState = "neutral" | "excited" | "startled";

export function resolveFaceState(pose: DriverPose): FaceState {
  if (pose === "collision") return "startled";
  if (pose === "drift" || pose === "airtime") return "excited";
  return "neutral";
}
