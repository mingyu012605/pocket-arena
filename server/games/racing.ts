import type { Server } from "socket.io";
import { SOCKET_EVENTS } from "../../shared/protocol";
import type { RacingGameStatePayload, RacingPlayerState } from "../../shared/protocol";
import { TEST_OVAL_TRACK } from "../../shared/racingTrack";
import type { TrackDefinition } from "../../shared/racingTrack";
import { roomChannel, toPublicRoomState } from "../rooms";
import type { InternalRoom, RacingCarState, RacingGameState } from "../types";

export const DEFAULT_TRACK_ID = "test-oval";

export function createRacingGameState(room: InternalRoom): RacingGameState {
  const cars = new Map<number, RacingCarState>();
  for (const player of room.players) {
    cars.set(player.playerNumber, {
      progress: 0,
      lateralOffset: 0,
      headingError: 0,
      speed: 0,
      yawRate: 0,
      steering: 0,
      throttle: 0,
      brake: 0,
      lastInputAt: Date.now(),
      lastSequence: -1,
      rank: player.playerNumber,
      lap: 1,
      finished: false,
      finishTime: null
    });
  }
  return {
    gameType: "racing",
    trackId: DEFAULT_TRACK_ID,
    cars,
    finishOrder: [],
    focusedPlayerNumber: room.players[0]?.playerNumber ?? null,
    startedAt: null,
    endedAt: null
  };
}

const PHYSICS_STEP = 1 / 60;
const BROADCAST_EVERY_N_STEPS = 3; // 60 / 3 = 20Hz
const MAX_STEPS_PER_CALLBACK = 5;
const INPUT_TIMEOUT_MS = 300;
const STEERING_DECAY = 0.9;
const MAX_HEADING_ERROR = Math.PI * (80 / 180);
const RACE_SAFETY_TIMEOUT_MS = 180_000;

export const RACING = {
  trackHalfWidth: 6,
  maxSpeed: 42,
  acceleration: 14,
  brakeForce: 22,
  coastDrag: 5,
  steeringResponsiveness: 2.4,
  yawDamping: 3.0,
  offTrackSlowFactor: 0.55
} as const;

function trackFor(_room: InternalRoom): TrackDefinition {
  return TEST_OVAL_TRACK; // single track in Cycle 1; room.gameState.trackId names it for the client
}

function applyInputTimeout(car: RacingCarState, now: number): void {
  if (now - car.lastInputAt > INPUT_TIMEOUT_MS) {
    car.throttle = 0;
    car.brake = 0;
    car.steering *= STEERING_DECAY;
  }
}

export function stepCar(track: TrackDefinition, car: RacingCarState, dt: number): void {
  car.yawRate += (car.steering * RACING.steeringResponsiveness - car.yawRate * RACING.yawDamping) * dt;
  car.headingError += car.yawRate * dt;
  car.headingError = Math.max(-MAX_HEADING_ERROR, Math.min(MAX_HEADING_ERROR, car.headingError));

  if (car.throttle > 0) {
    car.speed += car.throttle * RACING.acceleration * dt;
  } else if (car.brake > 0) {
    car.speed -= car.brake * RACING.brakeForce * dt;
  } else {
    car.speed -= RACING.coastDrag * dt;
  }
  car.speed = Math.max(0, Math.min(RACING.maxSpeed, car.speed));

  car.progress += car.speed * Math.cos(car.headingError) * dt;
  car.lateralOffset += car.speed * Math.sin(car.headingError) * dt;

  const maxOffset = track.trackHalfWidth * 1.6;
  car.lateralOffset = Math.max(-maxOffset, Math.min(maxOffset, car.lateralOffset));
  if (Math.abs(car.lateralOffset) > track.trackHalfWidth) {
    car.speed *= RACING.offTrackSlowFactor;
  }

  if (car.progress < 0) car.progress += track.trackLength;
  if (car.progress >= track.trackLength && !car.finished) {
    car.finished = true;
  }
}

function updateRanks(gameState: RacingGameState): void {
  const entries = [...gameState.cars.entries()].sort(([, a], [, b]) => b.progress - a.progress);
  entries.forEach(([, car], index) => {
    car.rank = index + 1;
  });
}

export function stepPhysics(room: InternalRoom, dt: number): void {
  if (room.gameState?.gameType !== "racing") return;
  const track = trackFor(room);
  const now = Date.now();
  const startedAt = room.gameState.startedAt ?? now;
  for (const car of room.gameState.cars.values()) {
    if (car.finished) continue;
    applyInputTimeout(car, now);
    stepCar(track, car, dt);
    if (car.finished) car.finishTime = now - startedAt;
  }
  updateRanks(room.gameState);
}

function compareFinishOrder(a: [number, RacingCarState], b: [number, RacingCarState]): number {
  const [, carA] = a;
  const [, carB] = b;
  if (carA.finishTime !== null && carB.finishTime !== null) return carA.finishTime - carB.finishTime;
  if (carA.finishTime !== null) return -1;
  if (carB.finishTime !== null) return 1;
  return carB.progress - carA.progress;
}

export function checkRaceCompletion(io: Server, room: InternalRoom, now: number): boolean {
  if (room.status === "results" || room.gameState?.gameType !== "racing") return false;
  const gameState = room.gameState;
  const startedAt = gameState.startedAt ?? now;
  const allFinished = room.players.length > 0 && [...gameState.cars.values()].every((c) => c.finished);
  const timedOut = now - startedAt > RACE_SAFETY_TIMEOUT_MS;
  if (!allFinished && !timedOut) return false;

  if (timedOut) {
    for (const car of gameState.cars.values()) {
      if (!car.finished) {
        car.finished = true;
        car.finishTime = null;
      }
    }
  }
  gameState.finishOrder = [...gameState.cars.entries()].sort(compareFinishOrder).map(([playerNumber]) => playerNumber);
  gameState.finishOrder.forEach((playerNumber, index) => {
    const car = gameState.cars.get(playerNumber);
    if (car) car.rank = index + 1;
  });
  gameState.endedAt = now;
  stopRacingPhysicsLoop(room);
  room.status = "results";
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.GAME_STATE, toGameStatePayload(room));
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.ROOM_STATE, toPublicRoomState(room));
  return true;
}

export function toGameStatePayload(room: InternalRoom): RacingGameStatePayload {
  const gameState = room.gameState?.gameType === "racing" ? room.gameState : null;
  const players: RacingPlayerState[] = gameState
    ? [...gameState.cars.entries()].map(([playerNumber, car]) => ({
        playerNumber,
        progress: car.progress,
        lateralOffset: car.lateralOffset,
        headingError: car.headingError,
        speed: car.speed,
        rank: car.rank,
        lap: car.lap,
        finished: car.finished,
        finishTime: car.finishTime
      }))
    : [];
  const allFinished = players.length > 0 && players.every((p) => p.finished);
  return {
    gameType: "racing",
    roundId: room.roundId ?? "",
    trackId: gameState?.trackId ?? TEST_OVAL_TRACK.id,
    raceStatus: room.status === "countdown" ? "countdown" : allFinished ? "finished" : "racing",
    players
  };
}

export function startRacingPhysicsLoop(io: Server, room: InternalRoom): void {
  if (room.physicsInterval) return;
  if (room.gameState?.gameType === "racing") room.gameState.startedAt = Date.now();
  let accumulator = 0;
  let lastTick = Date.now();
  let stepCount = 0;
  room.physicsInterval = setInterval(() => {
    const now = Date.now();
    accumulator += (now - lastTick) / 1000;
    lastTick = now;
    let steps = 0;
    while (accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_CALLBACK) {
      stepPhysics(room, PHYSICS_STEP);
      accumulator -= PHYSICS_STEP;
      steps += 1;
      stepCount += 1;
    }
    if (steps > 0 && stepCount % BROADCAST_EVERY_N_STEPS === 0) {
      io.to(roomChannel(room.id)).volatile.emit(SOCKET_EVENTS.GAME_STATE, toGameStatePayload(room));
    }
    checkRaceCompletion(io, room, now);
  }, Math.round(PHYSICS_STEP * 1000));
}

export function stopRacingPhysicsLoop(room: InternalRoom): void {
  if (room.physicsInterval) {
    clearInterval(room.physicsInterval);
    room.physicsInterval = null;
  }
}

export function resetAllRacingInputs(room: InternalRoom): void {
  if (room.gameState?.gameType !== "racing") return;
  for (const car of room.gameState.cars.values()) {
    car.steering = 0;
    car.throttle = 0;
    car.brake = 0;
  }
}

export function resetCarInput(room: InternalRoom, playerNumber: number): void {
  if (room.gameState?.gameType !== "racing") return;
  const car = room.gameState.cars.get(playerNumber);
  if (car) {
    car.steering = 0;
    car.throttle = 0;
    car.brake = 0;
  }
}
