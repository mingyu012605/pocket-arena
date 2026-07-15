import { describe, expect, it } from "vitest";
import { RacingInterpolationBuffer, shortestDelta } from "./interpolation";
import type { RacingCarFrame } from "./interpolation";
import { computeRacingCarWorldTransform } from "./carTransform";
import { TEST_OVAL_TRACK, sampleRacingTrackFrame } from "../../../../shared/racingTrack";

const TRACK_LENGTH = 100;

function frame(overrides: Partial<RacingCarFrame> = {}): RacingCarFrame {
  return {
    progress: 0,
    lateralOffset: 0,
    headingError: 0,
    speed: 0,
    rank: 1,
    stale: false,
    ...overrides
  };
}

describe("shortestDelta", () => {
  it("takes the short way forward across a lap-wrap boundary", () => {
    expect(shortestDelta(98, 3, TRACK_LENGTH)).toBeCloseTo(5, 5);
  });

  it("takes the short way backward across a lap-wrap boundary", () => {
    expect(shortestDelta(3, 98, TRACK_LENGTH)).toBeCloseTo(-5, 5);
  });

  it("returns the plain difference when nowhere near the wrap", () => {
    expect(shortestDelta(10, 15, TRACK_LENGTH)).toBeCloseTo(5, 5);
  });

  it("wraps angles across +/-PI the same way", () => {
    const delta = shortestDelta(3.13, -3.13, Math.PI * 2);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeCloseTo(0.023, 2);
  });
});

describe("RacingInterpolationBuffer", () => {
  it("interpolates progress across the lap-wrap boundary without sweeping backward", () => {
    const buffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 0);
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: 98 })]]));
    buffer.addSnapshot(1100, new Map([[1, frame({ progress: 3 })]]));

    const result = buffer.interpolate(1050);
    const carProgress = result.get(1)!.progress;
    // The short way from 98 to 3 (via the wrap) is +5, so halfway should sit
    // near 100.5 mod 100 = 0.5 - right at the wrap boundary, never anywhere
    // near the middle of the track (which is what the naive-diff bug produced).
    expect(carProgress).toBeCloseTo(0.5, 1);
  });

  it("interpolates heading across the +/-PI wrap without a snap", () => {
    const buffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 0);
    buffer.addSnapshot(1000, new Map([[1, frame({ headingError: 3.1 })]]));
    buffer.addSnapshot(1100, new Map([[1, frame({ headingError: -3.1 })]]));

    const result = buffer.interpolate(1050);
    const heading = result.get(1)!.headingError;
    // Short way from 3.1 to -3.1 crosses PI outward, so the midpoint should
    // sit just beyond PI/-PI, not at the naive linear midpoint of 0.
    expect(Math.abs(heading)).toBeGreaterThan(3.0);
  });

  it("handles a duplicate snapshot (same timestamp) by keeping the latest payload without growing the buffer", () => {
    const buffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 0);
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: 10 })]]));
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: 12 })]]));

    expect(buffer.size).toBe(1);
    expect(buffer.interpolate(1000).get(1)!.progress).toBe(12);
  });

  it("inserts an out-of-order (late-arriving, earlier-timestamped) snapshot in sorted position", () => {
    const buffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 0);
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: 0 })]]));
    buffer.addSnapshot(1100, new Map([[1, frame({ progress: 10 })]]));
    buffer.addSnapshot(1050, new Map([[1, frame({ progress: 5 })]]));

    expect(buffer.size).toBe(3);
    // Querying between the reordered snapshot and the newest one should blend
    // 5 -> 10, not treat 1050 as if it never existed or came after 1100.
    const result = buffer.interpolate(1075);
    expect(result.get(1)!.progress).toBeCloseTo(7.5, 1);
  });

  it("delayed snapshots: a long gap since the last snapshot still produces a finite, forward-moving result", () => {
    const buffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 70);
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: 0, speed: 10 })]]));
    buffer.addSnapshot(1033, new Map([[1, frame({ progress: 0.33, speed: 10 })]]));

    const result = buffer.interpolate(1033 + 500); // way beyond the buffer
    const carProgress = result.get(1)!.progress;
    expect(Number.isFinite(carProgress)).toBe(true);
    expect(carProgress).toBeGreaterThanOrEqual(0.33);
  });

  it("caps extrapolation at maxExtrapolateMs instead of running away when snapshots stop arriving", () => {
    const cappedBuffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 70);
    cappedBuffer.addSnapshot(1000, new Map([[1, frame({ progress: 0, speed: 10 })]]));
    cappedBuffer.addSnapshot(1033, new Map([[1, frame({ progress: 0.33, speed: 10 })]]));
    const cappedResult = cappedBuffer.interpolate(1033 + 5000).get(1)!.progress;

    const uncappedDistance = 10 * (5000 / 1000);
    expect(cappedResult).toBeLessThan(uncappedDistance);
  });

  it("stops extrapolating once input is marked stale, instead of continuing to move a disconnected car", () => {
    const buffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 70);
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: 0, speed: 10 })]]));
    buffer.addSnapshot(1033, new Map([[1, frame({ progress: 0.33, speed: 10, stale: true })]]));

    const result = buffer.interpolate(1033 + 200);
    expect(result.get(1)!.progress).toBeCloseTo(0.33, 5);
  });

  it("still extrapolates fresh (non-stale) input the same way", () => {
    const buffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 70);
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: 0, speed: 10 })]]));
    buffer.addSnapshot(1033, new Map([[1, frame({ progress: 0.33, speed: 10, stale: false })]]));

    const result = buffer.interpolate(1033 + 30);
    expect(result.get(1)!.progress).toBeGreaterThan(0.33);
  });

  it("resets cleanly for rematch/reconnect: no blending against the previous race's snapshots", () => {
    const buffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 0);
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: 95 })]]));
    buffer.addSnapshot(1100, new Map([[1, frame({ progress: 97 })]]));
    expect(buffer.interpolate(1100).get(1)!.progress).toBeCloseTo(97, 5);

    buffer.reset();
    expect(buffer.size).toBe(0);
    expect(buffer.interpolate(2000).size).toBe(0);

    buffer.addSnapshot(2000, new Map([[1, frame({ progress: 0 })]]));
    const result = buffer.interpolate(2000);
    // A single post-reset snapshot must be returned as-is, not blended
    // against the pre-reset progress=97 from the previous race.
    expect(result.get(1)!.progress).toBe(0);
  });
});

describe("airborne world-space interpolation", () => {
  it("passes through airborne world-space fields unchanged when both snapshots are airborne", () => {
    const buffer = new RacingInterpolationBuffer(TRACK_LENGTH, Infinity, 0, 0);
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: 50, airborne: true, worldX: 10, worldY: 5, worldZ: 20 })]]));
    buffer.addSnapshot(1100, new Map([[1, frame({ progress: 50, airborne: true, worldX: 12, worldY: 4.5, worldZ: 22 })]]));

    const result = buffer.interpolate(1050);
    const f = result.get(1)!;
    expect(f.airborne).toBe(true);
    expect(f.worldX).toBeCloseTo(11, 5);
    expect(f.worldY).toBeCloseTo(4.75, 5);
    expect(f.worldZ).toBeCloseTo(21, 5);
  });
});

describe("interpolation-mode continuity across grounded/airborne transitions", () => {
  it("takeoff: renders (via computeRacingCarWorldTransform) a smooth path from the grounded position into the airborne world position, with no snap at either end", () => {
    const track = TEST_OVAL_TRACK;
    const groundedProgress = 50;
    const groundedLateral = 2;
    const groundedFrame = sampleRacingTrackFrame(track, groundedProgress, groundedLateral);

    // A small, realistic one-tick launch displacement from the grounded position.
    const takeoffWorldX = groundedFrame.x + 0.4;
    const takeoffWorldY = groundedFrame.y + 0.3;
    const takeoffWorldZ = groundedFrame.z + 0.4;

    const buffer = new RacingInterpolationBuffer(track.trackLength, Infinity, 0, 0);
    buffer.addSnapshot(1000, new Map([[1, frame({ progress: groundedProgress, lateralOffset: groundedLateral, airborne: false })]]));
    buffer.addSnapshot(
      1050,
      new Map([[1, frame({ progress: groundedProgress, lateralOffset: groundedLateral, airborne: true, worldX: takeoffWorldX, worldY: takeoffWorldY, worldZ: takeoffWorldZ })]])
    );

    const atStart = computeRacingCarWorldTransform(buffer.interpolate(1000).get(1)!);
    expect(atStart.x).toBeCloseTo(groundedFrame.x, 5);
    expect(atStart.y).toBeCloseTo(groundedFrame.y, 5);
    expect(atStart.z).toBeCloseTo(groundedFrame.z, 5);

    const atEnd = computeRacingCarWorldTransform(buffer.interpolate(1050).get(1)!);
    expect(atEnd.x).toBeCloseTo(takeoffWorldX, 5);
    expect(atEnd.y).toBeCloseTo(takeoffWorldY, 5);
    expect(atEnd.z).toBeCloseTo(takeoffWorldZ, 5);

    // Midpoint must sit strictly between the two endpoints, not jump past
    // them or collapse to one end early - this is exactly what would break
    // if the mixed-pair branch used nextFrame.airborne directly instead of
    // treating the whole transition window as airborne.
    const atMid = computeRacingCarWorldTransform(buffer.interpolate(1025).get(1)!);
    expect(atMid.y).toBeCloseTo((groundedFrame.y + takeoffWorldY) / 2, 5);
    expect(atMid.x).toBeGreaterThan(Math.min(groundedFrame.x, takeoffWorldX) - 1e-6);
    expect(atMid.x).toBeLessThan(Math.max(groundedFrame.x, takeoffWorldX) + 1e-6);
  });

  it("landing: renders (via computeRacingCarWorldTransform) a smooth path from the airborne world position into the landed position, with no early snap to the ground", () => {
    const track = TEST_OVAL_TRACK;
    const landedProgress = 80;
    const landedLateral = -1;
    const landedFrame = sampleRacingTrackFrame(track, landedProgress, landedLateral);

    const preLandingWorldX = landedFrame.x - 0.3;
    const preLandingWorldY = landedFrame.y + 0.5; // still slightly above the surface, descending
    const preLandingWorldZ = landedFrame.z - 0.3;

    const buffer = new RacingInterpolationBuffer(track.trackLength, Infinity, 0, 0);
    buffer.addSnapshot(
      1000,
      new Map([[1, frame({ progress: landedProgress, lateralOffset: landedLateral, airborne: true, worldX: preLandingWorldX, worldY: preLandingWorldY, worldZ: preLandingWorldZ })]])
    );
    buffer.addSnapshot(1050, new Map([[1, frame({ progress: landedProgress, lateralOffset: landedLateral, airborne: false })]]));

    const atStart = computeRacingCarWorldTransform(buffer.interpolate(1000).get(1)!);
    expect(atStart.x).toBeCloseTo(preLandingWorldX, 5);
    expect(atStart.y).toBeCloseTo(preLandingWorldY, 5);

    const atEnd = computeRacingCarWorldTransform(buffer.interpolate(1050).get(1)!);
    expect(atEnd.x).toBeCloseTo(landedFrame.x, 5);
    expect(atEnd.y).toBeCloseTo(landedFrame.y, 5);
    expect(atEnd.z).toBeCloseTo(landedFrame.z, 5);

    // The critical regression case: partway through the landing transition,
    // the car must still be easing down from its airborne height, not
    // already sitting at the landed ground height (which is what
    // `airborne: nextFrame.airborne` would have produced, since nextFrame is
    // grounded for this whole pair).
    const atMid = computeRacingCarWorldTransform(buffer.interpolate(1025).get(1)!);
    expect(atMid.y).toBeCloseTo((preLandingWorldY + landedFrame.y) / 2, 5);
    expect(atMid.y).not.toBeCloseTo(landedFrame.y, 2);
  });
});
