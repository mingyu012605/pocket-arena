import { describe, it, expect } from "vitest";
import { createRoom, createToken, generateRoomCode, toPublicRoomState, allSlotsReady, findPlayer } from "./rooms";

describe("generateRoomCode", () => {
  it("produces a 5-character uppercase code excluding ambiguous characters", () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(5);
    expect(code).toMatch(/^[A-Z2-9]+$/);
    expect(code).not.toMatch(/[01OI]/);
  });

  it("produces distinct codes across many calls", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("createToken", () => {
  it("produces long, distinct secrets", () => {
    const a = createToken();
    const b = createToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(32);
  });
});

describe("createRoom", () => {
  it("creates one player slot per maxPlayers, each with a unique token", () => {
    const room = createRoom("controller-test", 3);
    expect(room.players).toHaveLength(3);
    const tokens = new Set(room.players.map((p) => p.token));
    expect(tokens.size).toBe(3);
    expect(room.status).toBe("lobby");
  });
});

describe("toPublicRoomState", () => {
  it("never exposes secrets or internal handles", () => {
    const room = createRoom("controller-test", 2);
    const publicState = toPublicRoomState(room);
    const serialized = JSON.stringify(publicState);
    expect(serialized).not.toContain(room.hostToken);
    for (const player of room.players) {
      expect(serialized).not.toContain(player.token);
    }
    expect(publicState).not.toHaveProperty("hostToken");
    expect(publicState).not.toHaveProperty("hostSocketId");
  });
});

describe("allSlotsReady", () => {
  it("is false until every slot is connected and ready", () => {
    const room = createRoom("controller-test", 2);
    expect(allSlotsReady(room)).toBe(false);
    const p1 = findPlayer(room, 1)!;
    p1.connected = true;
    p1.ready = true;
    expect(allSlotsReady(room)).toBe(false);
    const p2 = findPlayer(room, 2)!;
    p2.connected = true;
    p2.ready = true;
    expect(allSlotsReady(room)).toBe(true);
  });

  it("is false if a slot disconnects after being ready", () => {
    const room = createRoom("controller-test", 1);
    const p1 = findPlayer(room, 1)!;
    p1.connected = true;
    p1.ready = true;
    expect(allSlotsReady(room)).toBe(true);
    p1.connected = false;
    expect(allSlotsReady(room)).toBe(false);
  });
});
