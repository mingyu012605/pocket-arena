import { describe, it, expect } from "vitest";
import { SOCKET_EVENTS, PLAYER_COLORS, MIN_PLAYERS, MAX_PLAYERS } from "./protocol";

describe("protocol constants", () => {
  it("has no duplicate socket event names", () => {
    const values = Object.values(SOCKET_EVENTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("has enough player colors for the maximum player count", () => {
    expect(PLAYER_COLORS.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
  });

  it("has a sane min/max player range", () => {
    expect(MIN_PLAYERS).toBeGreaterThanOrEqual(1);
    expect(MAX_PLAYERS).toBeGreaterThanOrEqual(MIN_PLAYERS);
  });
});
