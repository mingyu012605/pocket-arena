import { describe, expect, it } from "vitest";
import { ARENA } from "../../shared/protocol";
import type { ControllerTestGameState, InternalRoom } from "../types";
import { resetAllDirections, stepPhysics } from "./controllerTest";

function makeRoom(): InternalRoom {
  const gameState: ControllerTestGameState = {
    gameType: "controller-test",
    players: new Map([
      [1, { x: ARENA.width / 2, y: ARENA.groundY, vy: 0, grounded: true, direction: 0, lastSequence: 0 }]
    ])
  };
  return {
    id: "TEST1",
    gameType: "controller-test",
    maxPlayers: 1,
    hostToken: "h",
    hostSocketId: null,
    status: "in-progress",
    statusBeforeHostDisconnect: null,
    roundId: "r1",
    countdownEndsAt: null,
    createdAt: Date.now(),
    hostGraceTimer: null,
    countdownTimer: null,
    physicsInterval: null,
    gameState,
    players: [
      {
        playerNumber: 1,
        token: "t",
        nickname: "A",
        color: "#fff",
        socketId: "s1",
        connected: true,
        ready: true
      }
    ]
  };
}

function physicsOf(room: InternalRoom, playerNumber: number) {
  if (room.gameState?.gameType !== "controller-test") throw new Error("not a controller-test room");
  const physics = room.gameState.players.get(playerNumber);
  if (!physics) throw new Error(`no physics for player ${playerNumber}`);
  return physics;
}

describe("stepPhysics", () => {
  it("moves a player right and clamps at the arena bound", () => {
    const room = makeRoom();
    physicsOf(room, 1).direction = 1;
    for (let i = 0; i < 1000; i++) stepPhysics(room, 1 / 20);
    expect(physicsOf(room, 1).x).toBeLessThanOrEqual(ARENA.width - ARENA.playerRadius);
  });

  it("applies gravity so a jump arcs back down to the ground", () => {
    const room = makeRoom();
    const physics = physicsOf(room, 1);
    physics.vy = ARENA.jumpVelocity;
    physics.grounded = false;
    let leftGround = false;
    for (let i = 0; i < 200; i++) {
      stepPhysics(room, 1 / 20);
      if (physics.y < ARENA.groundY) leftGround = true;
    }
    expect(leftGround).toBe(true);
    expect(physics.grounded).toBe(true);
    expect(physics.y).toBe(ARENA.groundY);
  });

  it("resetAllDirections stops horizontal movement", () => {
    const room = makeRoom();
    physicsOf(room, 1).direction = 1;
    resetAllDirections(room);
    expect(physicsOf(room, 1).direction).toBe(0);
  });
});
