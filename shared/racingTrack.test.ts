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
