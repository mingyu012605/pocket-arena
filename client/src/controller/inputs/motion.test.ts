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
    expect(applyDeadZoneAndClamp(7, 8, 35)).toBe(0);
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
