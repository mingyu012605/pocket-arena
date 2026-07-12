import { randomBytes } from "node:crypto";
import { PLAYER_COLORS } from "../shared/protocol";
import type { GameType, PublicPlayer, PublicRoomState } from "../shared/protocol";
import type { InternalPlayer, InternalRoom } from "./types";

const ROOM_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 5;
export const HOST_GRACE_MS = 10 * 60 * 1000;

const rooms = new Map<string, InternalRoom>();

export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

function generateRoomCodeCandidate(): string {
  let code = "";
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[(bytes[i] ?? 0) % ROOM_CODE_CHARS.length];
  }
  return code;
}

export function generateRoomCode(): string {
  let code: string;
  do {
    code = generateRoomCodeCandidate();
  } while (rooms.has(code));
  return code;
}

function createPlayer(playerNumber: number): InternalPlayer {
  return {
    playerNumber,
    token: createToken(),
    nickname: null,
    color: PLAYER_COLORS[(playerNumber - 1) % PLAYER_COLORS.length] ?? "#22d3ee",
    socketId: null,
    connected: false,
    ready: false
  };
}

export function createRoom(gameType: GameType, maxPlayers: number): InternalRoom {
  const id = generateRoomCode();
  const players: InternalPlayer[] = [];
  for (let i = 1; i <= maxPlayers; i++) players.push(createPlayer(i));

  const room: InternalRoom = {
    id,
    gameType,
    maxPlayers,
    hostToken: createToken(),
    hostSocketId: null,
    status: "lobby",
    statusBeforeHostDisconnect: null,
    roundId: null,
    countdownEndsAt: null,
    players,
    gameState: null,
    createdAt: Date.now(),
    hostGraceTimer: null,
    countdownTimer: null,
    physicsInterval: null
  };
  rooms.set(id, room);
  return room;
}

export function getRoom(roomId: string): InternalRoom | undefined {
  return rooms.get(roomId);
}

export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
}

export function findPlayer(room: InternalRoom, playerNumber: number): InternalPlayer | undefined {
  return room.players.find((p) => p.playerNumber === playerNumber);
}

export function toPublicRoomState(room: InternalRoom): PublicRoomState {
  const players: PublicPlayer[] = room.players.map((p) => ({
    playerNumber: p.playerNumber,
    nickname: p.nickname,
    color: p.color,
    connected: p.connected,
    ready: p.ready
  }));
  return {
    id: room.id,
    gameType: room.gameType,
    maxPlayers: room.maxPlayers,
    status: room.status,
    roundId: room.roundId,
    countdownEndsAt: room.countdownEndsAt,
    players
  };
}

export function clearRoomTimers(room: InternalRoom): void {
  if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  if (room.physicsInterval) clearInterval(room.physicsInterval);
  room.hostGraceTimer = null;
  room.countdownTimer = null;
  room.physicsInterval = null;
}

export function teardownRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  clearRoomTimers(room);
  deleteRoom(roomId);
}

export function allSlotsReady(room: InternalRoom): boolean {
  return room.players.length === room.maxPlayers && room.players.every((p) => p.connected && p.ready);
}

export function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}
