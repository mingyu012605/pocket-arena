import { describe, expect, it } from "vitest";
import { ARENA } from "../../shared/protocol";
import type { InternalRoom } from "../types";
import { resetAllDirections, stepPhysics } from "./controllerTest";

function makeRoom(): InternalRoom {
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
    players: [
      {
        playerNumber: 1,
        token: "t",
        nickname: "A",
        color: "#fff",
        socketId: "s1",
        connected: true,
        ready: true,
        lastSequence: 0,
        physics: { x: ARENA.width / 2, y: ARENA.groundY, vy: 0, grounded: true, direction: 0 }
      }
    ]
  };
}

describe("stepPhysics", () => {
  it("moves a player right and clamps at the arena bound", () => {
    const room = makeRoom();
    room.players[0]!.physics.direction = 1;
    for (let i = 0; i < 1000; i++) stepPhysics(room, 1 / 20);
    expect(room.players[0]!.physics.x).toBeLessThanOrEqual(ARENA.width - ARENA.playerRadius);
  });

  it("applies gravity so a jump arcs back down to the ground", () => {
    const room = makeRoom();
    const player = room.players[0]!;
    player.physics.vy = ARENA.jumpVelocity;
    player.physics.grounded = false;
    let leftGround = false;
    for (let i = 0; i < 200; i++) {
      stepPhysics(room, 1 / 20);
      if (player.physics.y < ARENA.groundY) leftGround = true;
    }
    expect(leftGround).toBe(true);
    expect(player.physics.grounded).toBe(true);
    expect(player.physics.y).toBe(ARENA.groundY);
  });

  it("resetAllDirections stops horizontal movement", () => {
    const room = makeRoom();
    room.players[0]!.physics.direction = 1;
    resetAllDirections(room);
    expect(room.players[0]!.physics.direction).toBe(0);
  });
});
