import { describe, expect, it } from "vitest";
import type { GolfSwingSubmission } from "./protocol";
import {
  GOLF_PHYSICS_STEP,
  clubById,
  normalizeGolfSwingSubmission,
  recommendGolfClub,
  simulateGolfShot
} from "./pocketGolf";

const baseSwing = {
  swingId: "swing-1",
  turnId: "turn-1",
  roundId: "round-1",
  timestamp: 1,
  power: 0.82,
  timing: 0.04,
  faceAngle: 0,
  swingPath: 0,
  attackAngle: 0.05,
  smoothness: 0.86,
  confidence: 0.9,
  source: "touch" as const
};

describe("Pocket Golf swing normalization", () => {
  it("clamps unsafe or non-finite swing values", () => {
    const normalized = normalizeGolfSwingSubmission({
      ...baseSwing,
      power: 9,
      timing: -8,
      faceAngle: Number.NaN,
      swingPath: 4,
      attackAngle: -3,
      smoothness: 2,
      confidence: -2,
      source: "motion"
    } satisfies GolfSwingSubmission);
    expect(normalized.power).toBe(1);
    expect(normalized.timing).toBe(-1);
    expect(normalized.faceAngle).toBe(0);
    expect(normalized.swingPath).toBe(1);
    expect(normalized.attackAngle).toBe(-1);
    expect(normalized.smoothness).toBe(1);
    expect(normalized.confidence).toBe(0);
    expect(normalized.source).toBe("motion");
  });

  it("uses the same normalized output shape for touch and motion swings", () => {
    const touch = normalizeGolfSwingSubmission({ ...baseSwing, source: "touch" });
    const motion = normalizeGolfSwingSubmission({ ...baseSwing, swingId: "motion-1", source: "motion" });
    expect(Object.keys(touch).sort()).toEqual(Object.keys(motion).sort());
    expect(touch.source).toBe("touch");
    expect(motion.source).toBe("motion");
  });
});

describe("Pocket Golf physics", () => {
  it("uses a fixed physics timestep", () => {
    expect(GOLF_PHYSICS_STEP).toBeCloseTo(1 / 60, 8);
  });

  it("eventually stops and reports shot statistics", () => {
    const shot = simulateGolfShot({
      club: clubById("7-iron"),
      swing: baseSwing,
      aimDegrees: 0,
      distanceToHole: 145,
      terrain: "tee",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 260,
      outOfBoundsX: 999
    });
    expect(shot.trajectory.length).toBeGreaterThan(3);
    expect(shot.stats.totalDistance).toBeGreaterThan(35);
    expect(shot.stats.maximumBallSpeed).toBeGreaterThan(5);
    expect(shot.stats.distanceToHole).toBeGreaterThanOrEqual(0);
    expect(shot.penalty).toBeNull();
  });

  it("moves the ball left or right from face angle, swing path, and timing", () => {
    const straight = simulateGolfShot({
      club: clubById("7-iron"),
      swing: { ...baseSwing, faceAngle: 0, swingPath: 0, timing: 0 },
      aimDegrees: 0,
      distanceToHole: 145,
      terrain: "tee",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 260,
      outOfBoundsX: 999
    });
    const right = simulateGolfShot({
      club: clubById("7-iron"),
      swing: { ...baseSwing, faceAngle: 0.7, swingPath: 0.5, timing: 0.35 },
      aimDegrees: 0,
      distanceToHole: 145,
      terrain: "tee",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 260,
      outOfBoundsX: 999
    });
    const left = simulateGolfShot({
      club: clubById("7-iron"),
      swing: { ...baseSwing, faceAngle: -0.7, swingPath: -0.5, timing: -0.35 },
      aimDegrees: 0,
      distanceToHole: 145,
      terrain: "tee",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 260,
      outOfBoundsX: 999
    });

    expect(right.stats.lateralError).toBeGreaterThan(straight.stats.lateralError + 10);
    expect(left.stats.lateralError).toBeLessThan(straight.stats.lateralError - 10);
    expect(right.stats.shotShape).not.toBe("straight");
    expect(left.stats.shotShape).not.toBe("straight");
  });

  it("changes distance when terrain friction and bounce change", () => {
    const fairway = simulateGolfShot({
      club: clubById("7-iron"),
      swing: baseSwing,
      aimDegrees: 0,
      distanceToHole: 145,
      terrain: "fairway",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 145
    });
    const deepRough = simulateGolfShot({
      club: clubById("7-iron"),
      swing: baseSwing,
      aimDegrees: 0,
      distanceToHole: 145,
      terrain: "deep-rough",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 145
    });
    expect(deepRough.stats.totalDistance).toBeLessThan(fairway.stats.totalDistance);
    expect(deepRough.stats.finalTerrain).not.toBe("water");
  });

  it("detects water penalties", () => {
    const shot = simulateGolfShot({
      club: clubById("7-iron"),
      swing: baseSwing,
      aimDegrees: 0,
      distanceToHole: 145,
      terrain: "tee",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 145,
      waterZones: [{ xMin: -12, xMax: 12, zMin: 12, zMax: 110 }]
    });
    expect(shot.penalty).toBe("water");
    expect(shot.stats.finalTerrain).toBe("water");
  });

  it("uses hole-specific bunker zones for harder courses", () => {
    const shot = simulateGolfShot({
      club: clubById("putter"),
      swing: { ...baseSwing, power: 0, attackAngle: 0 },
      aimDegrees: 0,
      distanceToHole: 80,
      terrain: "tee",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 80,
      bunkerZones: [{ xMin: -2, xMax: 2, zMin: -2, zMax: 2 }]
    });
    expect(shot.penalty).toBeNull();
    expect(shot.stats.finalTerrain).toBe("bunker");
  });

  it("detects out-of-bounds penalties", () => {
    const shot = simulateGolfShot({
      club: clubById("driver"),
      swing: { ...baseSwing, faceAngle: 1, swingPath: 1, timing: 1 },
      aimDegrees: 28,
      distanceToHole: 230,
      terrain: "tee",
      wind: { speed: 0, directionDegrees: 90 },
      holeDistance: 230,
      outOfBoundsX: 8
    });
    expect(shot.penalty).toBe("out-of-bounds");
    expect(shot.stats.finalTerrain).toBe("out-of-bounds");
  });

  it("keeps putter shots from behaving like driver shots", () => {
    const shot = simulateGolfShot({
      club: clubById("putter"),
      swing: { ...baseSwing, power: 1, attackAngle: 1 },
      aimDegrees: 0,
      distanceToHole: 24,
      terrain: "green",
      wind: { speed: 20, directionDegrees: 90 },
      holeDistance: 24
    });
    expect(shot.stats.totalDistance).toBeLessThan(45);
    expect(shot.stats.maximumHeight).toBeLessThan(1.5);
  });

  it("lets arcade bumpers alter a rolling ball path", () => {
    const openShot = simulateGolfShot({
      club: clubById("putter"),
      swing: { ...baseSwing, power: 0.55, timing: 0, attackAngle: -0.4 },
      aimDegrees: 0,
      distanceToHole: 30,
      terrain: "green",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 30,
      outOfBoundsX: 999
    });
    const bumperShot = simulateGolfShot({
      club: clubById("putter"),
      swing: { ...baseSwing, power: 0.55, timing: 0, attackAngle: -0.4 },
      aimDegrees: 0,
      distanceToHole: 30,
      terrain: "green",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 30,
      outOfBoundsX: 999,
      arcadeObstacles: [{ kind: "bumper", x: 0, z: 4, radius: 1.4, strength: 1 }]
    });

    expect(openShot.end.z).toBeGreaterThan(6);
    expect(bumperShot.end.z).toBeLessThan(openShot.end.z - 4);
    expect(bumperShot.holed).toBe(false);
  });

  it("captures short putts in the cup at the phone fallback power", () => {
    const shot = simulateGolfShot({
      club: clubById("putter"),
      swing: { ...baseSwing, power: 0.72, timing: 0, attackAngle: -0.4, smoothness: 0.9, confidence: 0.9 },
      aimDegrees: 0,
      distanceToHole: 3,
      terrain: "green",
      wind: { speed: 0, directionDegrees: 0 },
      holeDistance: 3
    });

    expect(shot.holed).toBe(true);
    expect(shot.end.x).toBe(0);
    expect(shot.end.z).toBe(3);
    expect(shot.stats.distanceToHole).toBe(0);
  });
});

describe("Pocket Golf club recommendation", () => {
  it("recommends terrain-aware clubs", () => {
    expect(recommendGolfClub(18, "green").id).toBe("putter");
    expect(recommendGolfClub(48, "bunker").id).toBe("sand-wedge");
    expect(recommendGolfClub(145, "tee", 0).id).toBe("5-iron");
  });
});
