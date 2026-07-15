import type { Server } from "socket.io";
import { describe, expect, it } from "vitest";
import { TEST_OVAL_TRACK, shortestProgressDelta, createTrack, rampJumpSpanAt } from "../../shared/racingTrack";
import { SOCKET_EVENTS } from "../../shared/protocol";
import type { RacingGameStatePayload } from "../../shared/protocol";
import { RACING, checkRaceCompletion, createRacingGameState, stepCar, stepPhysics, toGameStatePayload } from "./racing";
import { createRoom, findPlayer } from "../rooms";
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
    lastControllerInputAt: null,
    lastSequence: 0,
    lastCollisionAt: 0,
    rank: 1,
    lap: 1,
    finished: false,
    finishTime: null,
    airborne: false,
    worldX: 0,
    worldY: 0,
    worldZ: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    takeoffProgress: 0,
    settleTimer: 0,
    settleFromPitch: 0,
    hardLanding: false,
    fallenAt: null,
    lastCheckpointIndex: -1,
    projectedProgress: 0,
    ...overrides
  };
}

const rampTrack = createTrack(
  "test-ramp",
  [
    { x: 0, z: 0, y: 0, segmentType: "flat" },
    { x: 100, z: 0, y: 5, segmentType: "ramp", jumpSpan: 40 },
    { x: 160, z: 0, y: 0, segmentType: "gap" },
    { x: 220, z: 0, y: 0, segmentType: "landing" },
    { x: 300, z: 0, y: 0, segmentType: "flat" }
  ],
  12
);

describe("stepCar", () => {
  it("accelerates forward and increases progress under full throttle with no steering", () => {
    const car = makeCar({ throttle: 1 });
    for (let i = 0; i < 120; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.speed).toBeGreaterThan(0);
    expect(car.progress).toBeGreaterThan(0);
    expect(car.lateralOffset).toBeCloseTo(0, 1);
  });

  it("turns by yawing the car first, then drifting laterally from its heading", () => {
    const car = makeCar({ throttle: 1, speed: RACING.maxSpeed / 2, steering: 1 });
    for (let i = 0; i < 60; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(Math.abs(car.headingError)).toBeGreaterThan(0);
    expect(Math.abs(car.lateralOffset)).toBeGreaterThan(0);
    expect(Math.abs(car.lateralOffset)).toBeLessThan(18);
  });

  it("neutral steering lets drift bleed off instead of snapping the car sideways", () => {
    const car = makeCar({ speed: 24, lateralOffset: 2, headingError: 0.55, steering: 0 });
    for (let i = 0; i < 60; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.lateralOffset).toBeGreaterThan(2);
    expect(Math.abs(car.headingError)).toBeLessThan(0.55);
    expect(car.lateralOffset).toBeLessThan(TEST_OVAL_TRACK.trackHalfWidth);
  });

  it("slows down when off track", () => {
    const onTrack = makeCar({ speed: RACING.maxSpeed, lateralOffset: 0 });
    const offTrack = makeCar({ speed: RACING.maxSpeed, lateralOffset: TEST_OVAL_TRACK.trackHalfWidth + 1 });
    stepCar(TEST_OVAL_TRACK, onTrack, 1 / 60);
    stepCar(TEST_OVAL_TRACK, offTrack, 1 / 60);
    expect(offTrack.speed).toBeLessThan(onTrack.speed);
  });

  it("gently recovers a slow off-track car toward the road edge", () => {
    const car = makeCar({ speed: 2, lateralOffset: TEST_OVAL_TRACK.trackHalfWidth * 1.4 });
    stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.lateralOffset).toBeLessThan(TEST_OVAL_TRACK.trackHalfWidth * 1.4);
  });

  it("blocks cars at the side barrier without launching or arbitrary full stops", () => {
    const barrierLimit = TEST_OVAL_TRACK.trackHalfWidth + RACING.barrierOffset;
    const car = makeCar({ speed: 24, lateralOffset: barrierLimit + 3, steering: 1 });
    stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.lateralOffset).toBeLessThanOrEqual(barrierLimit);
    expect(car.speed).toBeGreaterThan(15);
    expect(car.speed).toBeLessThan(24);
    expect(car.lastCollisionAt).toBeGreaterThan(0);
  });

  it("keeps a high-speed barrier impact inside the barrier with mild speed loss", () => {
    const barrierLimit = TEST_OVAL_TRACK.trackHalfWidth + RACING.barrierOffset;
    const car = makeCar({ speed: RACING.maxSpeed, lateralOffset: barrierLimit + 9, steering: 1, headingError: 0.35 });
    stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.lateralOffset).toBeLessThanOrEqual(barrierLimit);
    expect(car.speed).toBeGreaterThan(RACING.maxSpeed * 0.7);
    expect(Math.abs(car.headingError)).toBeLessThan(Math.PI / 2);
  });

  it("slides shallow barrier contact along the wall instead of trapping the car", () => {
    const barrierLimit = TEST_OVAL_TRACK.trackHalfWidth + RACING.barrierOffset;
    const car = makeCar({ speed: 28, lateralOffset: barrierLimit + 0.6, steering: 0.1, headingError: 0.08 });
    stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.lateralOffset).toBeLessThanOrEqual(barrierLimit);
    expect(car.speed).toBeGreaterThan(23);
    expect(car.finished).toBe(false);
  });

  it("does not tunnel through the barrier during repeated contact", () => {
    const barrierLimit = TEST_OVAL_TRACK.trackHalfWidth + RACING.barrierOffset;
    const car = makeCar({ speed: 32, lateralOffset: barrierLimit + 1.2, steering: 1, throttle: 1 });
    for (let i = 0; i < 90; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(barrierLimit);
    expect(car.speed).toBeGreaterThan(0);
  });

  it("handles corner barrier impact without extreme speed reduction", () => {
    const barrierLimit = TEST_OVAL_TRACK.trackHalfWidth + RACING.barrierOffset;
    const car = makeCar({ speed: 30, progress: TEST_OVAL_TRACK.trackLength * 0.32, lateralOffset: -barrierLimit - 5, steering: -1 });
    stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.lateralOffset).toBeGreaterThanOrEqual(-barrierLimit);
    expect(car.speed).toBeGreaterThan(20);
  });

  it("coasts to a stop with no throttle or brake", () => {
    const car = makeCar({ speed: 10 });
    for (let i = 0; i < 300; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.speed).toBe(0);
  });

  it("re-centers heading when steering returns to neutral", () => {
    const car = makeCar({ speed: 20, headingError: 0.7, steering: 0 });
    for (let i = 0; i < 120; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(Math.abs(car.headingError)).toBeLessThan(0.12);
  });

  it("tilting backward applies reverse after braking to a stop", () => {
    const car = makeCar({ brake: 1, speed: 0 });
    for (let i = 0; i < 120; i++) stepCar(TEST_OVAL_TRACK, car, 1 / 60);
    expect(car.speed).toBeLessThan(0);
    expect(Math.abs(car.speed)).toBeLessThanOrEqual(RACING.maxReverseSpeed);
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

interface FakeEmit {
  event: string;
  payload: unknown;
}

function fakeIo(emits: FakeEmit[] = []): Server {
  return {
    to: () => ({
      emit: (event: string, payload: unknown) => {
        emits.push({ event, payload });
      },
      volatile: {
        emit: (event: string, payload: unknown) => {
          emits.push({ event, payload });
        }
      }
    })
  } as unknown as Server;
}

describe("stepPhysics", () => {
  it("adds AI rivals to fill a four-car racing grid", () => {
    const room = createRoom("racing", 1);
    const gameState = createRacingGameState(room);

    expect(gameState.cars.size).toBe(4);
    expect(gameState.cars.get(101)?.isBot).toBe(true);
    expect(gameState.cars.get(102)?.displayName).toBeTruthy();
    expect(gameState.cars.get(103)?.color).toBeTruthy();
  });

  it("ranks cars by authoritative progress", () => {
    const room = createRoom("racing", 2);
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.cars.get(1)!.progress = 25;
    gameState.cars.get(2)!.progress = 75;

    stepPhysics(room, 0);

    expect(gameState.cars.get(2)!.rank).toBe(1);
    expect(gameState.cars.get(1)!.rank).toBe(2);
  });

  it("zeros throttle and brake, then eases steering toward center after input timeout", () => {
    const room = createRoom("racing", 1);
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    const car = gameState.cars.get(1)!;
    car.lastInputAt = Date.now() - 301;
    car.steering = 1;
    car.throttle = 1;
    car.brake = 1;

    stepPhysics(room, 0);

    expect(car.throttle).toBe(0);
    expect(car.brake).toBe(0);
    expect(car.steering).toBeCloseTo(0.9);
  });

  it("sets finishTime when physics carries a car across the finish line", () => {
    const room = createRoom("racing", 1);
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.startedAt = Date.now() - 1000;
    const car = gameState.cars.get(1)!;
    car.progress = TEST_OVAL_TRACK.trackLength - 0.001;
    car.speed = RACING.maxSpeed;
    car.throttle = 1;

    stepPhysics(room, 1 / 60);

    expect(car.finished).toBe(true);
    expect(car.finishTime).not.toBeNull();
  });

  describe("collisions", () => {
    it("separates two overlapping cars sideways instead of letting them pass through each other", () => {
      const room = createRoom("racing", 2);
      const gameState = createRacingGameState(room);
      room.gameState = gameState;
      const carA = gameState.cars.get(1)!;
      const carB = gameState.cars.get(2)!;
      carA.progress = 300;
      carB.progress = 300;
      carA.lateralOffset = 0;
      carB.lateralOffset = 1;

      stepPhysics(room, 1 / 60);

      const separation = carB.lateralOffset - carA.lateralOffset;
      expect(separation).toBeGreaterThan(2.2);
    });

    it("pushes identical-position cars fully apart instead of leaving them stacked", () => {
      const room = createRoom("racing", 2);
      const gameState = createRacingGameState(room);
      room.gameState = gameState;
      const carA = gameState.cars.get(1)!;
      const carB = gameState.cars.get(2)!;
      carA.progress = 300;
      carB.progress = 300;
      carA.lateralOffset = 0;
      carB.lateralOffset = 0;

      stepPhysics(room, 0);

      expect(Math.abs(carB.lateralOffset - carA.lateralOffset)).toBeGreaterThan(2.2);
    });

    it("separates nose-to-tail overlap so cars cannot penetrate longitudinally", () => {
      const room = createRoom("racing", 2);
      const gameState = createRacingGameState(room);
      room.gameState = gameState;
      const carA = gameState.cars.get(1)!;
      const carB = gameState.cars.get(2)!;
      carA.progress = 300;
      carB.progress = 303.4;
      carA.lateralOffset = 0;
      carB.lateralOffset = 0;

      stepPhysics(room, 0);

      expect(Math.abs(shortestProgressDelta(TEST_OVAL_TRACK, carA.progress, carB.progress))).toBeGreaterThan(4.6);
    });

    it("reduces speed on both cars in a collision", () => {
      const room = createRoom("racing", 2);
      const gameState = createRacingGameState(room);
      room.gameState = gameState;
      const carA = gameState.cars.get(1)!;
      const carB = gameState.cars.get(2)!;
      carA.progress = 300;
      carB.progress = 300;
      carA.lateralOffset = 0;
      carB.lateralOffset = 1;
      carA.speed = 20;
      carB.speed = 18;

      stepPhysics(room, 0);

      expect(carA.speed).toBeLessThan(20);
      expect(carB.speed).toBeLessThan(18);
    });

    it("does not collide when cars are far apart", () => {
      const room = createRoom("racing", 2);
      const gameState = createRacingGameState(room);
      room.gameState = gameState;
      const carA = gameState.cars.get(1)!;
      const carB = gameState.cars.get(2)!;
      carA.progress = 300;
      carB.progress = 340;
      carA.lateralOffset = 0;
      carB.lateralOffset = 0;
      carA.speed = 20;
      carB.speed = 20;

      stepPhysics(room, 0);

      expect(carA.lateralOffset).toBe(0);
      expect(carB.speed).toBe(20);
    });

    it("detects a collision across the start/finish seam using the shortest wrap-aware distance", () => {
      const room = createRoom("racing", 2);
      const gameState = createRacingGameState(room);
      room.gameState = gameState;
      const carA = gameState.cars.get(1)!;
      const carB = gameState.cars.get(2)!;
      carA.progress = TEST_OVAL_TRACK.trackLength - 1;
      carB.progress = 1;
      carA.lateralOffset = 0;
      carB.lateralOffset = 1;
      carA.speed = 20;
      carB.speed = 20;

      stepPhysics(room, 0);

      expect(carA.speed).toBeLessThan(20);
      expect(carB.speed).toBeLessThan(20);
    });

    it("surfaces a transient collided flag on the game-state payload within the feedback window", () => {
      const room = createRoom("racing", 2);
      const gameState = createRacingGameState(room);
      room.gameState = gameState;
      const carA = gameState.cars.get(1)!;
      const carB = gameState.cars.get(2)!;
      carA.progress = 300;
      carB.progress = 300;
      carA.lateralOffset = 0;
      carB.lateralOffset = 1;

      stepPhysics(room, 0);
      const payload = toGameStatePayload(room);

      expect(payload.players.find((p) => p.playerNumber === 1)?.collided).toBe(true);
      expect(payload.players.find((p) => p.playerNumber === 2)?.collided).toBe(true);
    });
  });
});

describe("checkRaceCompletion", () => {
  it("transitions the room to results once every car has finished", () => {
    const room = createRoom("racing", 1);
    findPlayer(room, 1)!.connected = true;
    findPlayer(room, 1)!.ready = true;
    room.status = "in-progress";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.startedAt = Date.now() - 1000;
    for (const [playerNumber, car] of gameState.cars) {
      car.finished = true;
      car.finishTime = playerNumber === 1 ? 1000 : 2000 + playerNumber;
    }

    const finished = checkRaceCompletion(fakeIo(), room, Date.now());

    expect(finished).toBe(true);
    expect(room.status).toBe("results");
    expect(gameState.finishOrder[0]).toBe(1);
    expect(gameState.finishOrder).toHaveLength(4);
  });

  it("records finish order by finish time, not finish-line overshoot", () => {
    const room = createRoom("racing", 2);
    room.status = "in-progress";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    Object.assign(gameState.cars.get(1)!, { finished: true, finishTime: 5000, progress: 700 });
    Object.assign(gameState.cars.get(2)!, { finished: true, finishTime: 4000, progress: 650 });
    for (const [playerNumber, car] of gameState.cars) {
      if (playerNumber <= 2) continue;
      Object.assign(car, { finished: true, finishTime: 7000 + playerNumber, progress: 300 });
    }

    checkRaceCompletion(fakeIo(), room, Date.now());

    expect(gameState.finishOrder.slice(0, 2)).toEqual([2, 1]);
    expect(gameState.cars.get(2)!.rank).toBe(1);
    expect(gameState.cars.get(1)!.rank).toBe(2);
  });

  it("does nothing while a car is still racing and the safety timeout has not elapsed", () => {
    const room = createRoom("racing", 1);
    room.status = "in-progress";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.startedAt = Date.now();

    const finished = checkRaceCompletion(fakeIo(), room, Date.now());

    expect(finished).toBe(false);
    expect(room.status).toBe("in-progress");
  });

  it("force-finishes every unfinished car with a null finishTime after the safety timeout", () => {
    const room = createRoom("racing", 2);
    room.status = "in-progress";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.startedAt = Date.now() - 181_000;
    gameState.cars.get(1)!.finished = true;
    gameState.cars.get(1)!.finishTime = 5000;

    checkRaceCompletion(fakeIo(), room, Date.now());

    const car2 = gameState.cars.get(2)!;
    expect(car2.finished).toBe(true);
    expect(car2.finishTime).toBeNull();
    expect(gameState.cars.get(101)!.finished).toBe(true);
    expect(room.status).toBe("results");
  });

  it("emits a final authoritative racing snapshot when entering results", () => {
    const room = createRoom("racing", 1);
    room.status = "in-progress";
    room.roundId = "round-1";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    for (const [playerNumber, car] of gameState.cars) {
      car.finished = true;
      car.finishTime = playerNumber === 1 ? 1234 : 2400 + playerNumber;
    }
    const emits: FakeEmit[] = [];

    checkRaceCompletion(fakeIo(emits), room, Date.now());

    const gameStateEmit = emits.find((emit) => emit.event === SOCKET_EVENTS.GAME_STATE);
    expect(gameStateEmit).toBeDefined();
    const payload = gameStateEmit!.payload as RacingGameStatePayload;
    expect(payload.raceStatus).toBe("finished");
    expect(payload.players[0]!.finishTime).toBe(1234);
    expect(payload.players.some((player) => player.isBot)).toBe(true);
  });

  it("does not rewrite finish order after results have already been recorded", () => {
    const room = createRoom("racing", 2);
    room.status = "results";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.finishOrder = [1, 2];
    Object.assign(gameState.cars.get(1)!, { finished: true, finishTime: 5000 });
    Object.assign(gameState.cars.get(2)!, { finished: true, finishTime: 4000 });

    const finished = checkRaceCompletion(fakeIo(), room, Date.now());

    expect(finished).toBe(false);
    expect(gameState.finishOrder).toEqual([1, 2]);
  });
});

// Empirically verified segment boundaries for `rampTrack` (Catmull-Rom arc
// length isn't proportional to waypoint x-spacing, so these are measured,
// not estimated): flat [0,113), ramp [113,173), gap [173,233),
// landing [233,330), flat (wrap) [330, trackLength).
const RAMP_SEGMENT_START = 113;
const RAMP_SEGMENT_END = 173;

describe("airborne launch", () => {
  // Launch only fires at the ramp segment's *exit* edge, not simply from
  // being somewhere on the ramp - so tests drive forward until the car
  // actually crosses that edge, rather than assuming one tick does it.
  it("launches airborne with upward velocity above the minimum launch speed", () => {
    const car = makeCar({ progress: RAMP_SEGMENT_START + 2, speed: 25, throttle: 1 });
    for (let i = 0; i < 200 && !car.airborne; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.airborne).toBe(true);
    expect(car.velocityY).toBeGreaterThan(0);
  });

  it("drops off the ramp edge without a launch arc below the minimum speed", () => {
    // Positioned within coasting distance of the ramp's exit edge (speed=5
    // decelerating at RACING.coastDrag covers at most 2.5 units before
    // stopping), so it reaches the edge with residual speed still under
    // MIN_LAUNCH_SPEED rather than stopping short of it.
    const car = makeCar({ progress: RAMP_SEGMENT_END - 2, speed: 5 });
    for (let i = 0; i < 100 && !car.airborne; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.airborne).toBe(true);
    expect(car.velocityY).toBeLessThanOrEqual(0.5);
  });

  it("integrates world-space position under gravity while airborne", () => {
    const car = makeCar({ progress: RAMP_SEGMENT_START + 2, speed: 25, throttle: 1 });
    for (let i = 0; i < 200 && !car.airborne; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.airborne).toBe(true);
    const startY = car.worldY;
    const startVelocityY = car.velocityY;
    stepCar(rampTrack, car, 1 / 60);
    expect(car.velocityY).toBeLessThan(startVelocityY);
    expect(car.worldY).not.toBe(startY);
  });

  it("freezes progress at takeoff while airborne", () => {
    const car = makeCar({ progress: RAMP_SEGMENT_START + 2, speed: 25, throttle: 1 });
    for (let i = 0; i < 200 && !car.airborne; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.airborne).toBe(true);
    const frozen = car.progress;
    for (let i = 0; i < 10; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.progress).toBe(frozen);
  });
});
