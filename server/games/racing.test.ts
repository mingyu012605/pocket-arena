import { describe, expect, it } from "vitest";
import { TEST_OVAL_TRACK } from "../../shared/racingTrack";
import { RACING, stepCar } from "./racing";
import type { RacingCarState } from "../types";

function makeCar(overrides: Partial<RacingCarState> = {}): RacingCarState {
  return {
    progress: 0,
    lateralOffset: 0,
    headingError: 0,
    speed: 0,
    yawRate: 0,
    steering: 0,
    throttle: 0,
    brake: 0,
    lastInputAt: Date.now(),
    lastSequence: 0,
    rank: 1,
    lap: 1,
    finished: false,
    finishTime: null,
    ...overrides
  };
}

describe("stepCar", () => {
  it("accelerates forward and increases progress under full throttle with no steering", () => {
    const car = makeCar({ throttle: 1 });
    for (let i = 0; i < 120; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.speed).toBeGreaterThan(0);
    expect(car.progress).toBeGreaterThan(0);
    expect(car.lateralOffset).toBeCloseTo(0, 1);
  });

  it("turns: sustained steering with speed increases heading error and lateral offset, not just progress", () => {
    const car = makeCar({ throttle: 1, speed: RACING.maxSpeed / 2, steering: 1 });
    for (let i = 0; i < 60; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(Math.abs(car.headingError)).toBeGreaterThan(0);
    expect(Math.abs(car.lateralOffset)).toBeGreaterThan(0);
  });

  it("slows down when off track", () => {
    const onTrack = makeCar({ speed: RACING.maxSpeed, lateralOffset: 0 });
    const offTrack = makeCar({ speed: RACING.maxSpeed, lateralOffset: TEST_OVAL_TRACK.trackHalfWidth + 1 });
    stepCar(TEST_OVAL_TRACK, onTrack, 1 / 60);
    stepCar(TEST_OVAL_TRACK, offTrack, 1 / 60);
    expect(offTrack.speed).toBeLessThan(onTrack.speed);
  });

  it("coasts to a stop with no throttle or brake", () => {
    const car = makeCar({ speed: 10 });
    for (let i = 0; i < 300; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.speed).toBe(0);
  });

  it("clamps speed to RACING.maxSpeed", () => {
    const car = makeCar({ throttle: 1 });
    for (let i = 0; i < 600; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.speed).toBeLessThanOrEqual(RACING.maxSpeed);
  });

  it("marks the car finished once progress reaches the track length", () => {
    const car = makeCar({ progress: TEST_OVAL_TRACK.trackLength - 0.001, throttle: 1, speed: RACING.maxSpeed });
    stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.finished).toBe(true);
  });
});
