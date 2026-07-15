import type { Server } from "socket.io";
import { SOCKET_EVENTS } from "../../shared/protocol";
import type { RacingGameStatePayload, RacingPlayerState } from "../../shared/protocol";
import { TEST_OVAL_TRACK, shortestProgressDelta } from "../../shared/racingTrack";
import type { TrackDefinition } from "../../shared/racingTrack";
import { roomChannel, toPublicRoomState } from "../rooms";
import type { InternalRoom, RacingCarState, RacingGameState } from "../types";

export const DEFAULT_TRACK_ID = TEST_OVAL_TRACK.id;
const RACING_GRID_SIZE = 4;
const BOT_PLAYER_START = 101;
const BOT_COLORS = ["#f97316", "#22c55e", "#a855f7", "#facc15"] as const;
const BOT_NAMES = ["Turbo Kim", "Pixel Rae", "Nitro Jun", "Apex Mina"] as const;

function makeCarState(overrides: Partial<RacingCarState> = {}): RacingCarState {
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
    lastSequence: -1,
    lastCollisionAt: 0,
    rank: 1,
    lap: 1,
    finished: false,
    finishTime: null,
    ...overrides
  };
}

function isBotPlayerNumber(playerNumber: number): boolean {
  return playerNumber >= BOT_PLAYER_START;
}

export function createRacingGameState(room: InternalRoom): RacingGameState {
  const cars = new Map<number, RacingCarState>();
  const laneSpacing = Math.min(4.2, TEST_OVAL_TRACK.trackHalfWidth / 2.2);
  room.players.forEach((player, index) => {
    const lateralOffset = room.players.length === 1 ? 0 : (index - (RACING_GRID_SIZE - 1) / 2) * laneSpacing;
    cars.set(
      player.playerNumber,
      makeCarState({
        lateralOffset,
        rank: player.playerNumber
      })
    );
  });
  const botCount = Math.max(0, RACING_GRID_SIZE - room.players.length);
  const botLaneOffsets = [-laneSpacing, laneSpacing, laneSpacing * 2, -laneSpacing * 2];
  for (let i = 0; i < botCount; i++) {
    const botNumber = BOT_PLAYER_START + i;
    cars.set(
      botNumber,
      makeCarState({
        isBot: true,
        displayName: BOT_NAMES[i] ?? `CPU ${i + 1}`,
        color: BOT_COLORS[i % BOT_COLORS.length],
        lateralOffset: botLaneOffsets[i] ?? 0,
        rank: room.players.length + i + 1
      })
    );
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
const BROADCAST_EVERY_N_STEPS = 1; // 60Hz snapshots keep phone steering visibly responsive.
const MAX_STEPS_PER_CALLBACK = 5;
const INPUT_TIMEOUT_MS = 300;
const STEERING_DECAY = 0.9;
const MAX_HEADING_ERROR = Math.PI * (80 / 180);
const RACE_SAFETY_TIMEOUT_MS = 180_000;
// Arcade car "footprint" for collision purposes - roughly the visible car's
// wheelbase/track after client scaling, not a full rigid-body hull.
const COLLISION_LONGITUDINAL_RADIUS = 4.9;
const COLLISION_LATERAL_RADIUS = 2.35;
const COLLISION_RESOLUTION_PASSES = 4;
const COLLISION_SPEED_FACTOR = 0.78;
const COLLISION_FEEDBACK_WINDOW_MS = 220;

export const RACING = {
  trackHalfWidth: TEST_OVAL_TRACK.trackHalfWidth,
  maxSpeed: 42,
  maxReverseSpeed: 13,
  acceleration: 14,
  brakeForce: 22,
  reverseAcceleration: 11,
  coastDrag: 5,
  steeringResponsiveness: 4.4,
  yawDamping: 3.35,
  headingCentering: 3.9,
  lateralResponsiveness: 0.72,
  driftGrip: 1.8,
  steeringSlip: 0.12,
  offTrackSlowFactor: 0.94,
  barrierOffset: 2.6,
  barrierSpeedRetention: 0.88
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

function applyBotInput(playerNumber: number, car: RacingCarState): void {
  const botIndex = Math.max(0, playerNumber - BOT_PLAYER_START);
  // Each bot gets its own cruise speed, cornering aggression, and braking
  // point (seeded off botIndex so it's stable/reproducible, not random each
  // tick) so racers spread out and show different speeds instead of every
  // car converging on the same global top speed on a long straight.
  const cruiseSpeed = 27 + botIndex * 4.5 + Math.sin(botIndex * 3.1) * 2;
  const corneringConfidence = 0.62 + (botIndex % 3) * 0.1;
  const wave = Math.sin(car.progress * 0.035 + botIndex * 1.7) * 0.2;
  const laneTarget = ((botIndex % 3) - 1) * (TEST_OVAL_TRACK.trackHalfWidth * 0.34);
  if (car.speed < cruiseSpeed) {
    car.throttle = 0.78 + botIndex * 0.035;
    car.brake = 0;
  } else {
    // Actually hold near cruiseSpeed instead of just slowing the climb rate -
    // previously a reduced-but-still-positive throttle let every bot creep
    // all the way up to the shared global max speed regardless of its own
    // target, which is why every racer showed the same speed on a straight.
    car.throttle = 0;
    car.brake = Math.min(0.3, (car.speed - cruiseSpeed) * 0.05);
  }
  car.steering = Math.max(-0.55, Math.min(0.55, wave * corneringConfidence + (laneTarget - car.lateralOffset) * 0.075));
  car.lastInputAt = Date.now();
}

export function stepCar(track: TrackDefinition, car: RacingCarState, dt: number): void {
  const steering = Math.abs(car.steering) < 0.04 ? 0 : car.steering;
  const targetHeading = steering * Math.PI * 0.36;
  car.yawRate += (targetHeading - car.headingError) * RACING.steeringResponsiveness * dt;
  car.yawRate -= car.yawRate * RACING.yawDamping * dt;
  car.headingError += car.yawRate * dt;
  if (steering === 0) car.headingError += (0 - car.headingError) * Math.min(1, RACING.headingCentering * dt);
  car.headingError = Math.max(-MAX_HEADING_ERROR, Math.min(MAX_HEADING_ERROR, car.headingError));

  if (car.throttle > 0) {
    const force = car.speed < 0 ? RACING.brakeForce : RACING.acceleration;
    car.speed += car.throttle * force * dt;
  } else if (car.brake > 0) {
    const force = car.speed > 0.5 ? RACING.brakeForce : RACING.reverseAcceleration;
    car.speed -= car.brake * force * dt;
  } else {
    if (car.speed > 0) car.speed = Math.max(0, car.speed - RACING.coastDrag * dt);
    else if (car.speed < 0) car.speed = Math.min(0, car.speed + RACING.coastDrag * dt);
  }
  car.speed = Math.max(-RACING.maxReverseSpeed, Math.min(RACING.maxSpeed, car.speed));

  const grip = Math.min(1, Math.max(0.2, Math.abs(car.speed) / RACING.maxSpeed));
  const forwardSpeed = car.speed * Math.cos(car.headingError);
  const driftSpeed = car.speed * Math.sin(car.headingError) * RACING.lateralResponsiveness;
  const steeringSlip = steering * Math.max(3, Math.abs(car.speed)) * RACING.steeringSlip * (1 - grip * 0.45);
  car.progress += forwardSpeed * dt;
  const lateralSpeed = driftSpeed + steeringSlip;
  car.lateralOffset += lateralSpeed * dt;
  const gripRecovery = Math.min(1, RACING.driftGrip * dt * (0.45 + grip * 0.75));
  car.headingError += (0 - car.headingError) * gripRecovery * (steering === 0 ? 1 : 0.18);

  const barrierLimit = track.trackHalfWidth + RACING.barrierOffset;
  let hitBarrier = false;
  let repeatedBarrierContact = false;
  if (Math.abs(car.lateralOffset) > barrierLimit) {
    const side = Math.sign(car.lateralOffset);
    const penetration = Math.abs(car.lateralOffset) - barrierLimit;
    const now = Date.now();
    repeatedBarrierContact = now - car.lastCollisionAt < 140;
    hitBarrier = true;
    car.lateralOffset = side * (barrierLimit - 0.04);
    car.speed *= repeatedBarrierContact ? 0.995 : RACING.barrierSpeedRetention;
    car.yawRate += -side * Math.min(1.6, 0.35 + penetration * 0.08 + Math.abs(car.speed) * 0.02);
    car.headingError += -side * Math.min(0.16, 0.035 + penetration * 0.012);
    car.lastCollisionAt = now;
  }
  if (Math.abs(car.lateralOffset) > track.trackHalfWidth) {
    if (!hitBarrier) {
      car.speed *= RACING.offTrackSlowFactor;
    } else if (!repeatedBarrierContact) {
      car.speed *= 0.98;
    }
    if (Math.abs(car.speed) < 5) {
      const edge = Math.sign(car.lateralOffset) * track.trackHalfWidth * 0.92;
      car.lateralOffset += (edge - car.lateralOffset) * Math.min(1, dt * 2.4);
    } else {
      const edge = Math.sign(car.lateralOffset) * track.trackHalfWidth * 0.98;
      car.lateralOffset += (edge - car.lateralOffset) * Math.min(1, dt * 0.85);
    }
  }

  if (car.progress < 0) car.progress = 0;
  if (car.progress >= track.trackLength && car.speed > 0 && !car.finished) {
    car.finished = true;
  }
}

function updateRanks(gameState: RacingGameState): void {
  const entries = [...gameState.cars.entries()].sort(([, a], [, b]) => b.progress - a.progress);
  entries.forEach(([, car], index) => {
    car.rank = index + 1;
  });
}

function clampCollisionLateral(track: TrackDefinition, car: RacingCarState): void {
  const barrierLimit = track.trackHalfWidth + RACING.barrierOffset - 0.04;
  car.lateralOffset = Math.max(-barrierLimit, Math.min(barrierLimit, car.lateralOffset));
}

function resolveCollisionPair(
  track: TrackDefinition,
  playerNumberA: number,
  carA: RacingCarState,
  playerNumberB: number,
  carB: RacingCarState,
  now: number,
  applyImpulse: boolean
): boolean {
  const longitudinal = shortestProgressDelta(track, carA.progress, carB.progress);
  const lateral = carB.lateralOffset - carA.lateralOffset;
  const normalizedLongitudinal = longitudinal / COLLISION_LONGITUDINAL_RADIUS;
  const normalizedLateral = lateral / COLLISION_LATERAL_RADIUS;
  const normalizedDistance = Math.hypot(normalizedLongitudinal, normalizedLateral);
  if (normalizedDistance >= 1) return false;

  let normalLongitudinal = 0;
  let normalLateral = playerNumberA < playerNumberB ? 1 : -1;
  if (normalizedDistance > 0.0001) {
    normalLongitudinal = normalizedLongitudinal / normalizedDistance;
    normalLateral = normalizedLateral / normalizedDistance;
  }

  const separationRatio = 1 - normalizedDistance;
  const progressPush = normalLongitudinal * COLLISION_LONGITUDINAL_RADIUS * separationRatio * 0.55;
  const lateralPush = normalLateral * COLLISION_LATERAL_RADIUS * separationRatio * 0.55;
  carA.progress = Math.max(0, carA.progress - progressPush);
  carB.progress = Math.max(0, carB.progress + progressPush);
  carA.lateralOffset -= lateralPush;
  carB.lateralOffset += lateralPush;
  clampCollisionLateral(track, carA);
  clampCollisionLateral(track, carB);

  if (applyImpulse) {
    carA.speed *= COLLISION_SPEED_FACTOR;
    carB.speed *= COLLISION_SPEED_FACTOR;
    carA.yawRate += -normalLateral * 0.32;
    carB.yawRate += normalLateral * 0.32;
    carA.headingError += -normalLateral * 0.035;
    carB.headingError += normalLateral * 0.035;
    carA.lastCollisionAt = now;
    carB.lastCollisionAt = now;
  }
  return true;
}

/**
 * Arcade car-to-car collisions in track-relative space (progress =
 * longitudinal, lateralOffset = lateral). This is still intentionally lighter
 * than a rigid-body solver, but it now resolves both side and nose-to-tail
 * overlap so cars cannot sit visually inside each other.
 */
function resolveCollisions(track: TrackDefinition, gameState: RacingGameState, now: number): void {
  const entries = [...gameState.cars.entries()];
  const impulseApplied = new Set<string>();
  for (let pass = 0; pass < COLLISION_RESOLUTION_PASSES; pass++) {
    let resolvedAny = false;
    for (let i = 0; i < entries.length; i++) {
      const [playerNumberA, carA] = entries[i]!;
      if (carA.finished) continue;
      for (let j = i + 1; j < entries.length; j++) {
        const [playerNumberB, carB] = entries[j]!;
        if (carB.finished) continue;
        const pairKey = `${Math.min(playerNumberA, playerNumberB)}:${Math.max(playerNumberA, playerNumberB)}`;
        const resolved = resolveCollisionPair(
          track,
          playerNumberA,
          carA,
          playerNumberB,
          carB,
          now,
          !impulseApplied.has(pairKey)
        );
        if (!resolved) continue;
        impulseApplied.add(pairKey);
        resolvedAny = true;
      }
    }
    if (!resolvedAny) break;
  }
}

export function stepPhysics(room: InternalRoom, dt: number): void {
  if (room.gameState?.gameType !== "racing") return;
  const track = trackFor(room);
  const now = Date.now();
  const startedAt = room.gameState.startedAt ?? now;
  for (const [playerNumber, car] of room.gameState.cars) {
    if (car.finished) continue;
    if (car.isBot || isBotPlayerNumber(playerNumber)) applyBotInput(playerNumber, car);
    else applyInputTimeout(car, now);
    stepCar(track, car, dt);
    if (car.finished) car.finishTime = now - startedAt;
  }
  resolveCollisions(track, room.gameState, now);
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
  const now = Date.now();
  const players: RacingPlayerState[] = gameState
    ? [...gameState.cars.entries()].map(([playerNumber, car]) => ({
        playerNumber,
        displayName: car.displayName,
        color: car.color,
        isBot: car.isBot,
        progress: car.progress,
        lateralOffset: car.lateralOffset,
        headingError: car.headingError,
        speed: car.speed,
        steering: car.steering,
        throttle: car.throttle,
        brake: car.brake,
        inputStale: !car.isBot && now - car.lastInputAt > INPUT_TIMEOUT_MS,
        lastInputAt: car.lastControllerInputAt ?? undefined,
        collided: now - car.lastCollisionAt < COLLISION_FEEDBACK_WINDOW_MS,
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
