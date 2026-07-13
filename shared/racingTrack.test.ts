import { describe, it, expect } from "vitest";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle, shortestProgressDelta } from "./racingTrack";

describe("TEST_OVAL_TRACK", () => {
  it("has a positive track length", () => {
    expect(TEST_OVAL_TRACK.trackLength).toBeGreaterThan(0);
  });

  it("is a larger rally course with a forgiving wide road", () => {
    expect(TEST_OVAL_TRACK.trackLength).toBeGreaterThan(1450);
    expect(TEST_OVAL_TRACK.trackHalfWidth).toBe(34);
    expect(TEST_OVAL_TRACK.waypoints.length).toBeGreaterThanOrEqual(16);
  });

  it("wraps progress past trackLength back to the start region", () => {
    const atStart = centerlinePoint(TEST_OVAL_TRACK, 0);
    const wrapped = centerlinePoint(TEST_OVAL_TRACK, TEST_OVAL_TRACK.trackLength);
    expect(wrapped.x).toBeCloseTo(atStart.x, 0);
    expect(wrapped.z).toBeCloseTo(atStart.z, 0);
  });

  it("wraps negative progress to the same seam region", () => {
    const fromNegative = centerlinePoint(TEST_OVAL_TRACK, -1);
    const fromEnd = centerlinePoint(TEST_OVAL_TRACK, TEST_OVAL_TRACK.trackLength - 1);
    expect(fromNegative.x).toBeCloseTo(fromEnd.x, 5);
    expect(fromNegative.z).toBeCloseTo(fromEnd.z, 5);
  });

  it("keeps lookup continuous across the start-finish seam", () => {
    const beforeFinish = centerlinePoint(TEST_OVAL_TRACK, TEST_OVAL_TRACK.trackLength - 0.1);
    const justAfterStart = centerlinePoint(TEST_OVAL_TRACK, 0.1);
    expect(Math.hypot(justAfterStart.x - beforeFinish.x, justAfterStart.z - beforeFinish.z)).toBeLessThan(1);
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

describe("shortestProgressDelta", () => {
  it("treats two cars just on opposite sides of the start/finish seam as close, not almost a lap apart", () => {
    const trackLength = TEST_OVAL_TRACK.trackLength;
    const delta = shortestProgressDelta(TEST_OVAL_TRACK, trackLength - 2, 3);
    expect(Math.abs(delta)).toBeCloseTo(5, 5);
  });

  it("returns the plain difference away from the seam", () => {
    expect(shortestProgressDelta(TEST_OVAL_TRACK, 100, 108)).toBeCloseTo(8, 5);
  });
});
