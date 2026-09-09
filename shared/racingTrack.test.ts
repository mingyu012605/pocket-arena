import { describe, it, expect } from "vitest";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle, shortestProgressDelta, createTrack, sampleRacingTrackFrame } from "./racingTrack";

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

describe("elevation interpolation", () => {
  it("defaults to flat (y=0) when waypoints omit y", () => {
    const flatTrack = createTrack("test-flat-default", [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }, { x: 300, z: 0 }], 10);
    const point = centerlinePoint(flatTrack, flatTrack.trackLength / 3);
    expect(point.y).toBe(0);
  });

  it("interpolates elevation between two elevated waypoints", () => {
    const track = createTrack(
      "test-hill",
      [
        { x: 0, z: 0, y: 0 },
        { x: 100, z: 0, y: 20 },
        { x: 200, z: 0, y: 20 },
        { x: 300, z: 0, y: 0 }
      ],
      10
    );
    // Waypoints 0->1 is the climbing segment (y 0->20), 2->3 is the
    // descending segment (y 20->0); segment 1->2 is a flat plateau at 20,
    // so sampling at the loop's quarter/three-quarter marks would actually
    // land on that plateau rather than mid-slope. Sample explicitly within
    // the climbing and descending segments instead (each roughly 1/6 of
    // the ~600-unit loop, so mid-segment is ~1/12 and ~5/12 of trackLength).
    const climbing = centerlinePoint(track, track.trackLength * (1 / 12));
    const descending = centerlinePoint(track, track.trackLength * (5 / 12));
    expect(climbing.y).toBeGreaterThan(0);
    expect(climbing.y).toBeLessThan(20);
    expect(descending.y).toBeGreaterThan(0);
    expect(descending.y).toBeLessThan(20);
  });

  it("never overshoots past a waypoint's elevation between two waypoints moving the same direction", () => {
    const track = createTrack(
      "test-monotonic",
      [
        { x: 0, z: 0, y: 0 },
        { x: 50, z: 0, y: 5 },
        { x: 100, z: 0, y: 10 },
        { x: 150, z: 0, y: 10 },
        { x: 200, z: 0, y: 0 }
      ],
      10
    );
    for (let p = 0; p < track.trackLength; p += 1) {
      const y = centerlinePoint(track, p).y;
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeLessThanOrEqual(10.01);
    }
  });
});

describe("sampleRacingTrackFrame", () => {
  const bankedTrack = createTrack(
    "test-bank",
    [
      { x: 0, z: 0, y: 0, bankAngle: 0 },
      { x: 100, z: 0, y: 0, bankAngle: 0.3 },
      { x: 200, z: 0, y: 0, bankAngle: 0.3 },
      { x: 300, z: 0, y: 0, bankAngle: 0 }
    ],
    10
  );

  it("raises surface height with lateral offset on a banked segment", () => {
    const centered = sampleRacingTrackFrame(bankedTrack, bankedTrack.trackLength * 0.5, 0);
    const offset = sampleRacingTrackFrame(bankedTrack, bankedTrack.trackLength * 0.5, 5);
    expect(offset.y).toBeGreaterThan(centered.y);
  });

  it("reports surfacePresent false only inside a gap segment", () => {
    const gapTrack = createTrack(
      "test-gap",
      [
        { x: 0, z: 0, y: 0, segmentType: "flat" },
        { x: 100, z: 0, y: 0, segmentType: "gap" },
        { x: 200, z: 0, y: 0, segmentType: "landing" },
        { x: 300, z: 0, y: 0, segmentType: "flat" }
      ],
      10
    );
    const inGap = sampleRacingTrackFrame(gapTrack, gapTrack.trackLength * 0.2, 0);
    const onLanding = sampleRacingTrackFrame(gapTrack, gapTrack.trackLength * 0.6, 0);
    expect(inGap.surfacePresent).toBe(false);
    expect(onLanding.surfacePresent).toBe(true);
  });

  it("has no discontinuity in y at the loop seam", () => {
    const beforeSeam = sampleRacingTrackFrame(TEST_OVAL_TRACK, TEST_OVAL_TRACK.trackLength - 0.1, 0);
    const afterSeam = sampleRacingTrackFrame(TEST_OVAL_TRACK, 0.1, 0);
    expect(Math.abs(afterSeam.y - beforeSeam.y)).toBeLessThan(0.5);
  });
});
