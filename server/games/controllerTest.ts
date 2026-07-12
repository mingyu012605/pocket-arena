import type { Server } from "socket.io";
import { ARENA, SOCKET_EVENTS } from "../../shared/protocol";
import type { ControllerTestGameStatePayload } from "../../shared/protocol";
import type { ControllerTestGameState, ControllerTestPhysics, InternalRoom } from "../types";
import { roomChannel } from "../rooms";

const TICK_MS = 50;

export function createControllerTestGameState(room: InternalRoom): ControllerTestGameState {
  const players = new Map<number, ControllerTestPhysics>();
  for (const player of room.players) {
    players.set(player.playerNumber, {
      x: ARENA.width / 2,
      y: ARENA.groundY,
      vy: 0,
      grounded: true,
      direction: 0,
      lastSequence: -1
    });
  }
  return { gameType: "controller-test", players };
}

export function stepPhysics(room: InternalRoom, deltaSeconds: number): void {
  if (room.gameState?.gameType !== "controller-test") return;
  for (const physics of room.gameState.players.values()) {
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

export function toGameStatePayload(room: InternalRoom): ControllerTestGameStatePayload {
  const gameState = room.gameState?.gameType === "controller-test" ? room.gameState : null;
  return {
    gameType: "controller-test",
    roundId: room.roundId ?? "",
    players: room.players
      .filter((p) => p.connected)
      .map((p) => {
        const physics = gameState?.players.get(p.playerNumber);
        return { playerNumber: p.playerNumber, x: physics?.x ?? 0, y: physics?.y ?? 0 };
      })
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
  if (room.gameState?.gameType !== "controller-test") return;
  for (const physics of room.gameState.players.values()) physics.direction = 0;
}

export function resetPlayerDirection(room: InternalRoom, playerNumber: number): void {
  if (room.gameState?.gameType !== "controller-test") return;
  const physics = room.gameState.players.get(playerNumber);
  if (physics) physics.direction = 0;
}
