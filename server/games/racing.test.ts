import type { Server } from "socket.io";
import { describe, expect, it } from "vitest";
import { TEST_OVAL_TRACK } from "../../shared/racingTrack";
import { SOCKET_EVENTS } from "../../shared/protocol";
import type { RacingGameStatePayload } from "../../shared/protocol";
import { RACING, checkRaceCompletion, createRacingGameState, stepCar, stepPhysics } from "./racing";
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
    gameState.cars.get(1)!.finished = true;
    gameState.cars.get(1)!.finishTime = 1000;

    const finished = checkRaceCompletion(fakeIo(), room, Date.now());

    expect(finished).toBe(true);
    expect(room.status).toBe("results");
    expect(gameState.finishOrder).toEqual([1]);
  });

  it("records finish order by finish time, not finish-line overshoot", () => {
    const room = createRoom("racing", 2);
    room.status = "in-progress";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    Object.assign(gameState.cars.get(1)!, { finished: true, finishTime: 5000, progress: 700 });
    Object.assign(gameState.cars.get(2)!, { finished: true, finishTime: 4000, progress: 650 });

    checkRaceCompletion(fakeIo(), room, Date.now());

    expect(gameState.finishOrder).toEqual([2, 1]);
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
    expect(room.status).toBe("results");
  });

  it("emits a final authoritative racing snapshot when entering results", () => {
    const room = createRoom("racing", 1);
    room.status = "in-progress";
    room.roundId = "round-1";
    const gameState = createRacingGameState(room);
    room.gameState = gameState;
    gameState.cars.get(1)!.finished = true;
    gameState.cars.get(1)!.finishTime = 1234;
    const emits: FakeEmit[] = [];

    checkRaceCompletion(fakeIo(emits), room, Date.now());

    const gameStateEmit = emits.find((emit) => emit.event === SOCKET_EVENTS.GAME_STATE);
    expect(gameStateEmit).toBeDefined();
    const payload = gameStateEmit!.payload as RacingGameStatePayload;
    expect(payload.raceStatus).toBe("finished");
    expect(payload.players[0]!.finishTime).toBe(1234);
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
