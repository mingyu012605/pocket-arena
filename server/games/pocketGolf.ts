import { randomBytes } from "node:crypto";
import type { Server } from "socket.io";
import { SOCKET_EVENTS } from "../../shared/protocol";
import type {
  GolfAimPayload,
  GolfClubPosePayload,
  GolfClubPoseSubmission,
  GolfSwingSubmission,
  PocketGolfGameStatePayload,
  PocketGolfPlayerStatePayload,
  PocketGolfShotPayload
} from "../../shared/protocol";
import {
  clubById,
  normalizeGolfSwingSubmission,
  recommendGolfClub,
  simulateGolfShot
} from "../../shared/pocketGolf";
import type { GolfArcadeObstacle } from "../../shared/pocketGolf";
import { roomChannel, toPublicRoomState } from "../rooms";
import type { InternalRoom, PocketGolfGameState, PocketGolfPlayerState } from "../types";

type GolfZone = { xMin: number; xMax: number; zMin: number; zMax: number };

interface GolfHoleDefinition {
  name: string;
  difficulty: "Easy" | "Medium" | "Hard";
  par: number;
  distance: number;
  elevation: number;
  wind: { speed: number; directionDegrees: number };
  waterZones: GolfZone[];
  bunkerZones: GolfZone[];
  arcadeObstacles: GolfArcadeObstacle[];
  fairwayHalfWidth: number;
  lightRoughHalfWidth: number;
  greenRadius: number;
  outOfBoundsX: number;
}

const HOLES = [
  {
    name: "Warmup Garden",
    difficulty: "Easy",
    par: 3,
    distance: 112,
    elevation: 0,
    wind: { speed: 2, directionDegrees: 40 },
    waterZones: [],
    bunkerZones: [],
    arcadeObstacles: [
      { kind: "bumper", x: -17, z: 48, radius: 4.6, strength: 1.05 },
      { kind: "bumper", x: 18, z: 69, radius: 4.4, strength: 1.05 },
      { kind: "spinner", x: -8, z: 91, radius: 4.2, strength: 0.8 }
    ],
    fairwayHalfWidth: 33,
    lightRoughHalfWidth: 54,
    greenRadius: 21,
    outOfBoundsX: 96
  },
  {
    name: "Lagoon Bend",
    difficulty: "Medium",
    par: 4,
    distance: 168,
    elevation: -2,
    wind: { speed: 9, directionDegrees: 118 },
    waterZones: [{ xMin: 22, xMax: 70, zMin: 74, zMax: 132 }],
    bunkerZones: [
      { xMin: -38, xMax: -19, zMin: 88, zMax: 128 },
      { xMin: 16, xMax: 38, zMin: 132, zMax: 158 }
    ],
    arcadeObstacles: [
      { kind: "spinner", x: -7, z: 68, radius: 4.8, strength: 1.2 },
      { kind: "gate", x: 12, z: 105, radius: 6.2, strength: 0.75 },
      { kind: "bumper", x: -16, z: 137, radius: 4.2, strength: 1.08 }
    ],
    fairwayHalfWidth: 25,
    lightRoughHalfWidth: 42,
    greenRadius: 16,
    outOfBoundsX: 76
  },
  {
    name: "Skyline Gauntlet",
    difficulty: "Hard",
    par: 3,
    distance: 194,
    elevation: 8,
    wind: { speed: 15, directionDegrees: 270 },
    waterZones: [
      { xMin: -74, xMax: -24, zMin: 56, zMax: 124 },
      { xMin: 30, xMax: 82, zMin: 116, zMax: 178 }
    ],
    bunkerZones: [
      { xMin: -26, xMax: -10, zMin: 132, zMax: 170 },
      { xMin: 10, xMax: 29, zMin: 144, zMax: 184 },
      { xMin: -42, xMax: -25, zMin: 176, zMax: 208 }
    ],
    arcadeObstacles: [
      { kind: "gate", x: 0, z: 64, radius: 6.5, strength: 0.85 },
      { kind: "spinner", x: -14, z: 111, radius: 5.2, strength: 1.35 },
      { kind: "spinner", x: 13, z: 151, radius: 5.2, strength: -1.25 },
      { kind: "bumper", x: -4, z: 181, radius: 4.5, strength: 1.18 }
    ],
    fairwayHalfWidth: 18,
    lightRoughHalfWidth: 34,
    greenRadius: 12,
    outOfBoundsX: 58
  }
] satisfies GolfHoleDefinition[];

function turnId(): string {
  return `golf-${randomBytes(8).toString("base64url")}`;
}

function currentHole(state: PocketGolfGameState) {
  return HOLES[state.holeIndex] ?? HOLES[0]!;
}

function completedPar(state: PocketGolfGameState, player: PocketGolfPlayerState): number {
  const completedBeforeCurrent = HOLES.slice(0, state.holeIndex).reduce((sum, hole) => sum + hole.par, 0);
  return completedBeforeCurrent + (player.finished ? currentHole(state).par : 0);
}

function playerPayload(player: PocketGolfPlayerState, state: PocketGolfGameState): PocketGolfPlayerStatePayload {
  const hole = currentHole(state);
  return {
    playerNumber: player.playerNumber,
    displayName: player.displayName,
    color: player.color,
    strokes: player.strokes,
    scoreRelativeToPar: player.strokes - completedPar(state, player),
    distanceToHole: player.distanceToHole,
    lie: player.lie,
    finished: player.finished,
    active: player.playerNumber === state.activePlayerNumber,
    ball: { x: player.ballX, y: 0.042, z: player.ballZ }
  };
}

function resetPlayersForHole(state: PocketGolfGameState): void {
  const hole = currentHole(state);
  for (const player of orderedPlayers(state)) {
    player.distanceToHole = hole.distance;
    player.lie = "tee";
    player.finished = false;
    player.ballX = 0;
    player.ballZ = 0;
  }
  state.activePlayerNumber = orderedPlayers(state)[0]?.playerNumber ?? null;
  state.turnId = turnId();
  state.aimDegrees = 0;
  state.clubId = recommendGolfClub(hole.distance, "tee", hole.wind.speed).id;
  state.usedSwingIds.clear();
  state.lastShot = null;
  state.clubPose = null;
  state.phase = "shot-setup";
}

function scheduleNextHole(io: Server, room: InternalRoom, state: PocketGolfGameState): void {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  state.phase = "hole-result";
  state.activePlayerNumber = null;
  state.clubPose = null;
  broadcastGolfState(io, room);
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null;
    if (room.status !== "in-progress" || room.gameState !== state || state.gameType !== "pocket-golf") return;
    state.holeIndex += 1;
    resetPlayersForHole(state);
    broadcastGolfState(io, room);
  }, 2800);
}

function finishGolfMatch(io: Server, room: InternalRoom, state: PocketGolfGameState): void {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  state.phase = "match-result";
  state.activePlayerNumber = null;
  state.clubPose = null;
  room.status = "results";
  broadcastGolfState(io, room);
}

function orderedPlayers(state: PocketGolfGameState): PocketGolfPlayerState[] {
  return [...state.players.values()].sort((a, b) => a.playerNumber - b.playerNumber);
}

function activePlayer(state: PocketGolfGameState): PocketGolfPlayerState | null {
  return state.activePlayerNumber === null ? null : state.players.get(state.activePlayerNumber) ?? null;
}

function chooseNextActive(state: PocketGolfGameState): number | null {
  const candidates = orderedPlayers(state).filter((player) => !player.finished);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.distanceToHole - a.distanceToHole || a.strokes - b.strokes || a.playerNumber - b.playerNumber);
  return candidates[0]!.playerNumber;
}

function ensureSelectedClub(state: PocketGolfGameState, player: PocketGolfPlayerState): void {
  const selected = clubById(state.clubId);
  const recommended = recommendGolfClub(player.distanceToHole, player.lie, currentHole(state).wind.speed);
  if (!selected.allowedTerrain.includes(player.lie)) state.clubId = recommended.id;
  if (player.lie === "green") state.clubId = "putter";
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeClubPose(payload: GolfClubPoseSubmission, playerNumber: number): GolfClubPosePayload {
  return {
    roundId: String(payload.roundId ?? ""),
    turnId: String(payload.turnId ?? ""),
    playerNumber,
    timestamp: clamp(finite(payload.timestamp, Date.now()), Date.now() - 5000, Date.now() + 5000),
    aimDegrees: clamp(finite(payload.aimDegrees, 0), -28, 28),
    pitch: clamp(finite(payload.pitch), -1, 1),
    roll: clamp(finite(payload.roll), -1, 1),
    yaw: clamp(finite(payload.yaw), -1, 1),
    swing: clamp(finite(payload.swing), -1, 1),
    velocity: clamp(finite(payload.velocity), 0, 1),
    armed: Boolean(payload.armed),
    handedness: payload.handedness === "left" ? "left" : "right",
    source: payload.source === "orientation" ? "orientation" : "motion"
  };
}

export function createPocketGolfGameState(room: InternalRoom): PocketGolfGameState {
  const hole = HOLES[0]!;
  const players = new Map<number, PocketGolfPlayerState>();
  for (const player of room.players) {
    players.set(player.playerNumber, {
      playerNumber: player.playerNumber,
      displayName: player.nickname ?? `Player ${player.playerNumber}`,
      color: player.color,
      strokes: 0,
      distanceToHole: hole.distance,
      lie: "tee",
      finished: false,
      ballX: 0,
      ballZ: 0
    });
  }
  const activePlayerNumber = room.players[0]?.playerNumber ?? null;
  return {
    gameType: "pocket-golf",
    phase: "shot-setup",
    holeIndex: 0,
    activePlayerNumber,
    turnId: turnId(),
    aimDegrees: 0,
    clubId: "7-iron",
    usedSwingIds: new Set(),
    players,
    shotSequence: 0,
    lastShot: null,
    clubPose: null
  };
}

export function toPocketGolfGameStatePayload(state: PocketGolfGameState, roundId: string): PocketGolfGameStatePayload {
  const hole = currentHole(state);
  const active = activePlayer(state);
  if (active) ensureSelectedClub(state, active);
  const recommended = active ? recommendGolfClub(active.distanceToHole, active.lie, hole.wind.speed) : clubById(state.clubId);
  return {
    gameType: "pocket-golf",
    roundId,
    phase: state.phase,
    turnId: state.turnId,
    holeNumber: state.holeIndex + 1,
    holeName: hole.name,
    holeDifficulty: hole.difficulty,
    par: hole.par,
    holeDistance: hole.distance,
    activePlayerNumber: state.activePlayerNumber,
    aimDegrees: state.aimDegrees,
    clubId: state.clubId,
    recommendedClubId: recommended.id,
    wind: hole.wind,
    elevationMetres: hole.elevation,
    players: orderedPlayers(state).map((player) => playerPayload(player, state)),
    lastShot: state.lastShot,
    clubPose: state.clubPose
  };
}

function broadcastGolfState(io: Server, room: InternalRoom): void {
  if (room.gameState?.gameType !== "pocket-golf" || !room.roundId) return;
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.ROOM_STATE, toPublicRoomState(room));
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.GAME_STATE, toPocketGolfGameStatePayload(room.gameState, room.roundId));
}

export function startPocketGolf(io: Server, room: InternalRoom, roundId: string): void {
  room.gameState = createPocketGolfGameState(room);
  room.status = "in-progress";
  broadcastGolfState(io, room);
}

export function handleGolfAim(io: Server, room: InternalRoom, playerNumber: number, payload: GolfAimPayload): { ok: true } | { ok: false; message: string } {
  if (room.gameState?.gameType !== "pocket-golf" || !room.roundId) return { ok: false, message: "Pocket Golf is not active." };
  const state = room.gameState;
  if (payload.roundId !== room.roundId || payload.turnId !== state.turnId) return { ok: false, message: "Old golf turn." };
  if (playerNumber !== state.activePlayerNumber) return { ok: false, message: "Only the active player can aim." };
  const player = activePlayer(state);
  if (!player) return { ok: false, message: "No active golfer." };
  state.aimDegrees = Math.max(-28, Math.min(28, Number(payload.aimDeltaDegrees ?? state.aimDegrees)));
  const requestedClub = clubById(payload.clubId ?? state.clubId);
  if (requestedClub.allowedTerrain.includes(player.lie)) state.clubId = requestedClub.id;
  ensureSelectedClub(state, player);
  broadcastGolfState(io, room);
  return { ok: true };
}

export function handleGolfClubPose(
  io: Server,
  room: InternalRoom,
  playerNumber: number,
  payload: GolfClubPoseSubmission
): { ok: true } | { ok: false; message: string } {
  if (room.gameState?.gameType !== "pocket-golf" || !room.roundId) return { ok: false, message: "Pocket Golf is not active." };
  const state = room.gameState;
  if (payload.roundId !== room.roundId || payload.turnId !== state.turnId) return { ok: false, message: "Old golf turn." };
  if (playerNumber !== state.activePlayerNumber) return { ok: false, message: "Only the active player can move the club." };
  const pose = normalizeClubPose(payload, playerNumber);
  state.clubPose = pose;
  state.aimDegrees = pose.aimDegrees ?? state.aimDegrees;
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.GOLF_CLUB_POSE, pose);
  return { ok: true };
}

export function handleGolfSwing(
  io: Server,
  room: InternalRoom,
  playerNumber: number,
  payload: GolfSwingSubmission
): { ok: true } | { ok: false; message: string } {
  if (room.gameState?.gameType !== "pocket-golf" || !room.roundId) return { ok: false, message: "Pocket Golf is not active." };
  const state = room.gameState;
  if (payload.roundId !== room.roundId) return { ok: false, message: "This swing belongs to an old round." };
  if (payload.turnId !== state.turnId) return { ok: false, message: "This swing belongs to an old turn." };
  if (playerNumber !== state.activePlayerNumber) return { ok: false, message: "Only the active player can swing." };
  if (!payload.swingId || state.usedSwingIds.has(payload.swingId)) return { ok: false, message: "Duplicate golf swing." };
  const player = activePlayer(state);
  if (!player || player.finished) return { ok: false, message: "No active golfer." };
  const swing = normalizeGolfSwingSubmission(payload);
  if (swing.confidence < 0.16) return { ok: false, message: "Swing confidence is too low." };
  state.usedSwingIds.add(swing.swingId);
  state.aimDegrees = Math.max(-28, Math.min(28, Number(payload.aimDeltaDegrees ?? state.aimDegrees)));
  const requestedClub = clubById(payload.clubId ?? state.clubId);
  state.clubId = requestedClub.allowedTerrain.includes(player.lie) ? requestedClub.id : recommendGolfClub(player.distanceToHole, player.lie, currentHole(state).wind.speed).id;
  ensureSelectedClub(state, player);
  const club = clubById(state.clubId);
  const hole = currentHole(state);
  const simulationSwing =
    hole.difficulty === "Easy"
      ? {
          ...swing,
          timing: swing.timing * 0.62,
          faceAngle: swing.faceAngle * 0.78,
          swingPath: swing.swingPath * 0.78,
          smoothness: Math.max(0.76, swing.smoothness),
          confidence: Math.max(0.68, swing.confidence)
        }
      : swing;
  const previousBallX = player.ballX;
  const previousBallZ = player.ballZ;
  const pinVectorX = -previousBallX;
  const pinVectorZ = hole.distance - previousBallZ;
  const distanceToPinBeforeShot = Math.max(0.001, Math.hypot(pinVectorX, pinVectorZ));
  const forwardX = pinVectorX / distanceToPinBeforeShot;
  const forwardZ = pinVectorZ / distanceToPinBeforeShot;
  const rightX = forwardZ;
  const rightZ = -forwardX;
  const shotPointToWorld = (point: { x: number; z: number }) => ({
    x: previousBallX + rightX * point.x + forwardX * point.z,
    z: previousBallZ + rightZ * point.x + forwardZ * point.z
  });
  const simulation = simulateGolfShot({
    club,
    swing: simulationSwing,
    aimDegrees: state.aimDegrees,
    distanceToHole: distanceToPinBeforeShot,
    terrain: player.lie,
    wind: hole.wind,
    holeDistance: distanceToPinBeforeShot,
    waterZones: hole.waterZones,
    bunkerZones: hole.bunkerZones,
    fairwayHalfWidth: hole.fairwayHalfWidth,
    lightRoughHalfWidth: hole.lightRoughHalfWidth,
    greenRadius: hole.greenRadius,
    outOfBoundsX: hole.outOfBoundsX,
    arcadeObstacles: hole.arcadeObstacles
  });
  const finalWorldPoint = shotPointToWorld(simulation.end);
  const rawDistanceToHole = Math.hypot(finalWorldPoint.x, hole.distance - finalWorldPoint.z);
  const scoredShot = !simulation.penalty && (simulation.holed || rawDistanceToHole <= 1.18);
  const finalBallX = scoredShot ? 0 : finalWorldPoint.x;
  const finalBallZ = scoredShot ? hole.distance : finalWorldPoint.z;
  const distanceToHole = scoredShot ? 0 : rawDistanceToHole;
  const finalStats = {
    ...simulation.stats,
    lateralError: finalBallX,
    distanceToHole
  };
  const penaltyStroke = simulation.penalty ? 1 : 0;
  player.strokes += 1 + penaltyStroke;
  player.distanceToHole = distanceToHole;
  player.finished = scoredShot || player.distanceToHole < 0.8;
  player.lie = scoredShot ? "green" : simulation.penalty ? "fairway" : simulation.stats.finalTerrain;
  player.ballX = finalBallX;
  player.ballZ = finalBallZ;
  state.shotSequence += 1;
  const worldTrajectory = simulation.trajectory.map((point) => {
    const worldPoint = shotPointToWorld(point);
    return {
      x: worldPoint.x,
      y: point.y,
      z: worldPoint.z
    };
  });
  if (scoredShot) worldTrajectory.push({ x: finalBallX, y: 0.042, z: finalBallZ });
  state.lastShot = {
    sequence: state.shotSequence,
    playerNumber,
    playerName: player.displayName,
    clubId: club.id,
    clubName: club.displayName,
    swing,
    stats: finalStats,
    start: { x: previousBallX, y: 0.042, z: previousBallZ },
    end: { x: player.ballX, y: 0.042, z: player.ballZ },
    trajectory: worldTrajectory,
    penalty: simulation.penalty
  } satisfies PocketGolfShotPayload;

  const next = chooseNextActive(state);
  state.activePlayerNumber = next;
  state.turnId = turnId();
  state.aimDegrees = 0;
  state.clubPose = null;
  if (next === null) {
    if (state.holeIndex >= HOLES.length - 1) finishGolfMatch(io, room, state);
    else scheduleNextHole(io, room, state);
    return { ok: true };
  } else {
    const nextPlayer = state.players.get(next)!;
    state.clubId = recommendGolfClub(nextPlayer.distanceToHole, nextPlayer.lie, hole.wind.speed).id;
    state.phase = "shot-result";
  }
  broadcastGolfState(io, room);
  return { ok: true };
}
