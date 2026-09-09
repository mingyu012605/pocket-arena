import type { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import type { GolfSwingSubmission } from "../../shared/protocol";
import { createRoom } from "../rooms";
import type { InternalRoom, PocketGolfGameState } from "../types";
import {
  handleGolfAim,
  handleGolfClubPose,
  handleGolfSwing,
  startPocketGolf,
  toPocketGolfGameStatePayload
} from "./pocketGolf";

function fakeIo(): { io: Server; emissions: Array<{ event: string; payload: unknown }> } {
  const emissions: Array<{ event: string; payload: unknown }> = [];
  const io = {
    to: () => ({
      emit: (event: string, payload: unknown) => emissions.push({ event, payload })
    })
  } as unknown as Server;
  return { io, emissions };
}

function golfRoom(players: number): InternalRoom {
  const room = createRoom("pocket-golf", players);
  room.hostSocketId = "host";
  for (const player of room.players) {
    player.nickname = `Player ${player.playerNumber}`;
    player.connected = true;
    player.ready = true;
    player.socketId = `socket-${player.playerNumber}`;
  }
  return room;
}

function startRoom(players = 2, roundId = "golf-round"): { io: Server; room: InternalRoom; state: PocketGolfGameState } {
  const { io } = fakeIo();
  const room = golfRoom(players);
  room.roundId = roundId;
  startPocketGolf(io, room, roundId);
  if (room.gameState?.gameType !== "pocket-golf") throw new Error("Pocket Golf did not start.");
  return { io, room, state: room.gameState };
}

function swing(roundId: string, turnId: string, overrides: Partial<GolfSwingSubmission> = {}): GolfSwingSubmission {
  return {
    roundId,
    turnId,
    swingId: "swing-a",
    timestamp: Date.now(),
    power: 0.82,
    timing: 0.02,
    faceAngle: 0,
    swingPath: 0,
    attackAngle: 0.05,
    smoothness: 0.86,
    confidence: 0.92,
    source: "touch",
    clubId: "7-iron",
    aimDeltaDegrees: 0,
    ...overrides
  };
}

describe("Pocket Golf server turn validation", () => {
  it("only lets the active player swing", () => {
    const { io, room, state } = startRoom(2, "round-active");
    expect(handleGolfSwing(io, room, 2, swing("round-active", state.turnId)).ok).toBe(false);
    expect(handleGolfSwing(io, room, 1, swing("round-active", state.turnId)).ok).toBe(true);
  });

  it("rejects duplicate swing ids on the current turn", () => {
    const { io, room, state } = startRoom(1, "round-dup");
    state.usedSwingIds.add("dup-id");
    expect(handleGolfSwing(io, room, 1, swing("round-dup", state.turnId, { swingId: "dup-id" })).ok).toBe(false);
  });

  it("rejects outdated turn ids", () => {
    const { io, room, state } = startRoom(1, "round-old-turn");
    const oldTurn = state.turnId;
    state.turnId = "new-server-turn";
    expect(handleGolfSwing(io, room, 1, swing("round-old-turn", oldTurn)).ok).toBe(false);
  });

  it("clamps swing values before simulating a shot", () => {
    const { io, room, state } = startRoom(1, "round-clamp");
    const result = handleGolfSwing(
      io,
      room,
      1,
      swing("round-clamp", state.turnId, {
        power: 99,
        timing: -99,
        faceAngle: 99,
        swingPath: -99,
        attackAngle: 99,
        smoothness: 99,
        confidence: 99
      })
    );
    expect(result.ok).toBe(true);
    expect(state.lastShot?.swing.power).toBe(1);
    expect(state.lastShot?.swing.timing).toBe(-1);
    expect(state.lastShot?.swing.faceAngle).toBe(1);
    expect(state.lastShot?.swing.swingPath).toBe(-1);
    expect(state.lastShot?.swing.attackAngle).toBe(1);
    expect(state.lastShot?.swing.smoothness).toBe(1);
    expect(state.lastShot?.swing.confidence).toBe(1);
  });

  it("keeps aim and club selection server-authoritative", () => {
    const { io, room, state } = startRoom(2, "round-aim");
    expect(handleGolfAim(io, room, 2, { roundId: "round-aim", turnId: state.turnId, aimDeltaDegrees: 8, clubId: "driver" }).ok).toBe(false);
    expect(handleGolfAim(io, room, 1, { roundId: "round-aim", turnId: state.turnId, aimDeltaDegrees: 99, clubId: "driver" }).ok).toBe(true);
    expect(state.aimDegrees).toBe(28);
    expect(state.clubId).toBe("driver");
  });

  it("keeps phone motion direction visible on the easy warmup hole", () => {
    const right = startRoom(1, "round-motion-right");
    expect(
      handleGolfSwing(
        right.io,
        right.room,
        1,
        swing("round-motion-right", right.state.turnId, {
          source: "motion",
          power: 0.9,
          faceAngle: 0.8,
          swingPath: 0.65,
          confidence: 0.9
        })
      ).ok
    ).toBe(true);

    const left = startRoom(1, "round-motion-left");
    expect(
      handleGolfSwing(
        left.io,
        left.room,
        1,
        swing("round-motion-left", left.state.turnId, {
          source: "motion",
          power: 0.9,
          faceAngle: -0.8,
          swingPath: -0.65,
          confidence: 0.9
        })
      ).ok
    ).toBe(true);

    expect(right.state.lastShot?.end.x).toBeLessThan(-8);
    expect(left.state.lastShot?.end.x).toBeGreaterThan(8);
  });

  it("only lets the active player stream live club pose for the current turn", () => {
    const { io, room, state } = startRoom(2, "round-pose");
    const pose = {
      roundId: "round-pose",
      turnId: state.turnId,
      timestamp: Date.now(),
      aimDegrees: 99,
      pitch: 2,
      roll: -2,
      yaw: 0.25,
      swing: 0.5,
      velocity: 3,
      armed: true,
      handedness: "right" as const,
      source: "orientation" as const
    };
    expect(handleGolfClubPose(io, room, 2, pose).ok).toBe(false);
    expect(handleGolfClubPose(io, room, 1, { ...pose, turnId: "old-turn" }).ok).toBe(false);
    expect(handleGolfClubPose(io, room, 1, pose).ok).toBe(true);
    expect(state.clubPose).toMatchObject({
      playerNumber: 1,
      aimDegrees: 28,
      pitch: 1,
      roll: -1,
      velocity: 1,
      armed: true
    });
    expect(toPocketGolfGameStatePayload(state, "round-pose").clubPose?.playerNumber).toBe(1);
  });
});

describe("Pocket Golf multiplayer order", () => {
  it("starts on an easy warmup hole", () => {
    const { state } = startRoom(1, "round-easy");
    const payload = toPocketGolfGameStatePayload(state, "round-easy");
    expect(payload.holeName).toBe("Warmup Garden");
    expect(payload.holeDifficulty).toBe("Easy");
    expect(payload.holeDistance).toBe(112);
    expect(payload.wind.speed).toBeLessThanOrEqual(2);
  });

  it("starts with the first player and then gives the farthest player the next turn", () => {
    const { io, room, state } = startRoom(2, "round-order");
    expect(toPocketGolfGameStatePayload(state, "round-order").activePlayerNumber).toBe(1);
    expect(handleGolfSwing(io, room, 1, swing("round-order", state.turnId)).ok).toBe(true);
    expect(state.activePlayerNumber).toBe(2);
  });

  it("uses the previous landing position as the next address lie", () => {
    const { io, room, state } = startRoom(1, "round-next-lie");
    const firstTurn = state.turnId;

    expect(
      handleGolfSwing(
        io,
        room,
        1,
        swing("round-next-lie", firstTurn, {
          swingId: "first-lie-shot",
          power: 0.34,
          faceAngle: 0.55,
          swingPath: 0.2,
          clubId: "9-iron"
        })
      ).ok
    ).toBe(true);

    const firstEnd = state.lastShot?.end;
    expect(firstEnd).toBeDefined();
    const payloadAfterFirst = toPocketGolfGameStatePayload(state, "round-next-lie");
    expect(payloadAfterFirst.players[0]?.ball.x).toBeCloseTo(firstEnd!.x, 5);
    expect(payloadAfterFirst.players[0]?.ball.z).toBeCloseTo(firstEnd!.z, 5);

    const secondTurn = state.turnId;
    expect(
      handleGolfSwing(
        io,
        room,
        1,
        swing("round-next-lie", secondTurn, {
          swingId: "second-lie-shot",
          power: 0.18,
          faceAngle: -0.25,
          swingPath: -0.1,
          clubId: "pitching-wedge"
        })
      ).ok
    ).toBe(true);

    expect(state.lastShot?.start.x).toBeCloseTo(firstEnd!.x, 5);
    expect(state.lastShot?.start.z).toBeCloseTo(firstEnd!.z, 5);
    expect(state.lastShot?.trajectory[0]?.x).toBeCloseTo(firstEnd!.x, 5);
    expect(state.lastShot?.trajectory[0]?.z).toBeCloseTo(firstEnd!.z, 5);
  });

  it("scores a short putt and snaps the final ball to the cup", () => {
    vi.useFakeTimers();
    try {
      const { io, room, state } = startRoom(1, "round-short-putt");
      const player = state.players.get(1)!;
      player.ballX = 0;
      player.ballZ = 109;
      player.distanceToHole = 3;
      player.lie = "green";
      state.clubId = "putter";

      expect(
        handleGolfSwing(
          io,
          room,
          1,
          swing("round-short-putt", state.turnId, {
            swingId: "short-putt-score",
            power: 0.72,
            timing: 0,
            attackAngle: -0.4,
            clubId: "putter"
          })
        ).ok
      ).toBe(true);

      expect(player.finished).toBe(true);
      expect(player.distanceToHole).toBe(0);
      expect(state.lastShot?.end).toMatchObject({ x: 0, z: 112 });
      expect(state.phase).toBe("hole-result");
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips finished players when choosing the next active player", () => {
    const { io, room, state } = startRoom(3, "round-skip");
    const first = state.players.get(1)!;
    const second = state.players.get(2)!;
    const third = state.players.get(3)!;
    first.finished = true;
    first.distanceToHole = 0;
    second.distanceToHole = 24;
    third.distanceToHole = 132;
    state.activePlayerNumber = 2;
    state.turnId = "skip-turn";
    expect(handleGolfSwing(io, room, 2, swing("round-skip", "skip-turn", { power: 0.32, swingId: "skip-swing" })).ok).toBe(true);
    expect(state.activePlayerNumber).toBe(3);
  });

  it("automatically advances from the easy hole to a harder hole after every player finishes", () => {
    vi.useFakeTimers();
    try {
      const { io, room, state } = startRoom(1, "round-next-hole");
      const player = state.players.get(1)!;
      player.distanceToHole = 0.4;
      player.ballZ = 111.6;
      player.lie = "green";
      state.clubId = "putter";
      expect(handleGolfSwing(io, room, 1, swing("round-next-hole", state.turnId, { power: 0, clubId: "putter" })).ok).toBe(true);
      expect(state.phase).toBe("hole-result");
      expect(state.activePlayerNumber).toBeNull();

      vi.advanceTimersByTime(2800);

      expect(state.holeIndex).toBe(1);
      expect(state.phase).toBe("shot-setup");
      expect(state.activePlayerNumber).toBe(1);
      const payload = toPocketGolfGameStatePayload(state, "round-next-hole");
      expect(payload.holeDifficulty).toBe("Medium");
      expect(payload.players[0]?.distanceToHole).toBe(168);
    } finally {
      vi.useRealTimers();
    }
  });
});
