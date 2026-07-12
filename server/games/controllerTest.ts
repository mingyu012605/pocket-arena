import type { Server } from "socket.io";
import { ARENA, SOCKET_EVENTS } from "../../shared/protocol";
import type { GameStatePayload } from "../../shared/protocol";
import type { InternalRoom } from "../types";
import { roomChannel } from "../rooms";

const TICK_MS = 50;

export function stepPhysics(room: InternalRoom, deltaSeconds: number): void {
  for (const player of room.players) {
    const physics = player.physics;
    physics.x += physics.direction * ARENA.moveSpeed * deltaSeconds;
    physics.x = Math.max(ARENA.playerRadius, Math.min(ARENA.width - ARENA.playerRadius, physics.x));

    physics.vy += ARENA.gravity * deltaSeconds;
    physics.y += physics.vy * deltaSeconds;
    if (physics.y >= ARENA.groundY) {
      physics.y = ARENA.groundY;
      physics.vy = 0;
      physics.grounded = true;
    }
  }
}

export function toGameStatePayload(room: InternalRoom): GameStatePayload {
  return {
    roundId: room.roundId ?? "",
    players: room.players
      .filter((p) => p.connected)
      .map((p) => ({ playerNumber: p.playerNumber, x: p.physics.x, y: p.physics.y }))
  };
}

export function startPhysicsLoop(io: Server, room: InternalRoom): void {
  if (room.physicsInterval) return;
  let lastTick = Date.now();
  room.physicsInterval = setInterval(() => {
    const now = Date.now();
    const deltaSeconds = (now - lastTick) / 1000;
    lastTick = now;
    stepPhysics(room, deltaSeconds);
    io.to(roomChannel(room.id)).volatile.emit(SOCKET_EVENTS.GAME_STATE, toGameStatePayload(room));
  }, TICK_MS);
}

export function stopPhysicsLoop(room: InternalRoom): void {
  if (room.physicsInterval) {
    clearInterval(room.physicsInterval);
    room.physicsInterval = null;
  }
}

export function resetAllDirections(room: InternalRoom): void {
  for (const player of room.players) player.physics.direction = 0;
}

export function resetPlayerDirection(room: InternalRoom, playerNumber: number): void {
  const player = room.players.find((p) => p.playerNumber === playerNumber);
  if (player) player.physics.direction = 0;
}
