import { describe, expect, it } from "vitest";
import {
  HARD_LANDING_IMPACT_THRESHOLD,
  DEFAULT_IMPACT_THRESHOLDS,
  clamp,
  classifyLanding,
  computeAcceleration,
  computeDriftAmount,
  detectImpact,
  resolveActivePose,
  resolveFaceState
} from "./character";
import type { DriverInput } from "./character";

function driverInput(overrides: Partial<DriverInput> = {}): DriverInput {
  return {
    steering: 0,
    speed: 0,
    acceleration: 0,
    driftAmount: 0,
    impactStrength: 0,
    airborne: false,
    finished: false,
    deltaTime: 1 / 60,
    ...overrides
  };
}

describe("clamp", () => {
  it("clamps below the minimum", () => {
    expect(clamp(-5, 0, 1)).toBe(0);
  });

  it("clamps above the maximum", () => {
    expect(clamp(5, 0, 1)).toBe(1);
  });

  it("passes through values already in range", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe("computeAcceleration", () => {
  it("smooths a sudden speed increase toward the raw acceleration over repeated calls", () => {
    let smoothed = 0;
    smoothed = computeAcceleration(10, 0, smoothed, 1, 20);
    expect(smoothed).toBeCloseTo(10 * 0.12, 5);
    smoothed = computeAcceleration(10, 10, smoothed, 1, 20);
    expect(smoothed).toBeLessThan(10 * 0.12);
    expect(smoothed).toBeGreaterThan(0);
  });

  it("clamps to the max magnitude even for a huge instantaneous speed jump", () => {
    const smoothed = computeAcceleration(1000, 0, 0, 0.001, 20);
    expect(smoothed).toBeLessThanOrEqual(20);
  });

  it("clamps to the negative max magnitude for a huge braking event", () => {
    const smoothed = computeAcceleration(0, 1000, 0, 0.001, 20);
    expect(smoothed).toBeGreaterThanOrEqual(-20);
  });

  it("returns 0 for a zero time delta rather than dividing by zero", () => {
    expect(computeAcceleration(10, 0, 0, 0, 20)).toBe(0);
  });
});

describe("computeDriftAmount", () => {
  it("is 0 at and below the 0.12 threshold", () => {
    expect(computeDriftAmount(0)).toBe(0);
    expect(computeDriftAmount(0.12)).toBe(0);
    expect(computeDriftAmount(-0.1)).toBe(0);
  });

  it("ramps linearly between 0.12 and 0.47", () => {
    expect(computeDriftAmount(0.12 + 0.35 / 2)).toBeCloseTo(0.5, 5);
  });

  it("saturates at 1 for large heading error", () => {
    expect(computeDriftAmount(5)).toBe(1);
  });

  it("is symmetric for negative heading error", () => {
    expect(computeDriftAmount(-0.47)).toBeCloseTo(computeDriftAmount(0.47), 5);
  });
});

describe("detectImpact", () => {
  it("flags an impact on a large sudden speed drop while going mostly straight", () => {
    const result = detectImpact(2, 15, 0.05, 0, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(true);
    expect(result.impactStrength).toBeGreaterThan(0);
    expect(result.impactStrength).toBeLessThanOrEqual(1);
  });

  it("does not flag normal braking (speed drop below threshold)", () => {
    const result = detectImpact(13, 15, 0, 0, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(false);
    expect(result.impactStrength).toBe(0);
  });

  it("does not flag a hard turn even with a big speed drop (steering too large)", () => {
    const result = detectImpact(2, 15, 0.9, 0, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(false);
  });

  it("does not flag while still under cooldown from a previous impact", () => {
    const result = detectImpact(2, 15, 0.05, 0.2, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(false);
  });

  it("does not flag a drop starting from a low previous speed", () => {
    const result = detectImpact(0, 3, 0.05, 0, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(false);
  });
});

describe("classifyLanding", () => {
  it("classifies impact strength below the hard-landing threshold as soft", () => {
    expect(classifyLanding(HARD_LANDING_IMPACT_THRESHOLD - 0.01)).toBe("soft");
  });

  it("classifies impact strength at or above the hard-landing threshold as hard", () => {
    expect(classifyLanding(HARD_LANDING_IMPACT_THRESHOLD)).toBe("hard");
    expect(classifyLanding(1)).toBe("hard");
  });
});

describe("resolveActivePose", () => {
  it("returns steering as the default pose", () => {
    expect(resolveActivePose(driverInput())).toBe("steering");
  });

  it("returns drift when driftAmount is above 0", () => {
    expect(resolveActivePose(driverInput({ driftAmount: 0.4 }))).toBe("drift");
  });

  it("returns airtime when airborne, overriding drift", () => {
    expect(resolveActivePose(driverInput({ airborne: true, driftAmount: 0.9 }))).toBe("airtime");
  });

  it("returns collision when impactStrength is above 0, overriding airtime", () => {
    expect(resolveActivePose(driverInput({ airborne: true, impactStrength: 0.6 }))).toBe("collision");
  });

  it("returns celebration when finished, overriding everything else", () => {
    expect(
      resolveActivePose(driverInput({ finished: true, impactStrength: 0.9, airborne: true, driftAmount: 1 }))
    ).toBe("celebration");
  });
});

describe("resolveFaceState", () => {
  it("maps drift and airtime to excited", () => {
    expect(resolveFaceState("drift")).toBe("excited");
    expect(resolveFaceState("airtime")).toBe("excited");
  });

  it("maps collision to startled", () => {
    expect(resolveFaceState("collision")).toBe("startled");
  });

  it("maps steering and celebration to neutral", () => {
    expect(resolveFaceState("steering")).toBe("neutral");
    expect(resolveFaceState("celebration")).toBe("neutral");
  });
});
