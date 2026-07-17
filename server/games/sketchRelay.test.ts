import type { Server } from "socket.io";
import { describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "../../shared/protocol";
import { createRoom } from "../rooms";
import type { InternalRoom } from "../types";
import {
  assignmentPlayerForChain,
  createSketchRelayGameState,
  entryTypeForPhase,
  handleSketchSubmission,
  sanitizeSketchText,
  startSketchRelay,
  stopSketchRelay,
  validateSketchDrawing
} from "./sketchRelay";

function fakeIo(): { io: Server; emissions: Array<{ event: string; payload: unknown }> } {
  const emissions: Array<{ event: string; payload: unknown }> = [];
  const io = {
    to: () => ({
      emit: (event: string, payload: unknown) => emissions.push({ event, payload })
    })
  } as unknown as Server;
  return { io, emissions };
}

function sketchRoom(players: number): InternalRoom {
  const room = createRoom("sketch-relay", players);
  room.hostSocketId = "host";
  for (const player of room.players) {
    player.nickname = `Player ${player.playerNumber}`;
    player.connected = true;
    player.ready = true;
    player.socketId = `socket-${player.playerNumber}`;
  }
  return room;
}

describe("Sketch Relay chain rotation", () => {
  for (const count of [3, 4, 5, 12]) {
    it(`assigns every chain exactly once per phase with ${count} players`, () => {
      const players = Array.from({ length: count }, (_, index) => index + 1);
      for (let phase = 0; phase < count; phase++) {
        const assignments = players.map((_, chainIndex) => assignmentPlayerForChain(chainIndex, phase, players));
        expect(new Set(assignments).size).toBe(count);
        if (phase > 0) {
          for (let chainIndex = 0; chainIndex < count; chainIndex++) {
            expect(assignments[chainIndex]).not.toBe(players[chainIndex]);
          }
        }
      }
    });
  }

  it("alternates text and drawing phases", () => {
    expect(entryTypeForPhase(0)).toBe("text");
    expect(entryTypeForPhase(1)).toBe("drawing");
    expect(entryTypeForPhase(2)).toBe("text");
    expect(entryTypeForPhase(3)).toBe("drawing");
  });
});

describe("Sketch Relay validation", () => {
  it("sanitizes text", () => {
    expect(sanitizeSketchText("  hello\n\n<script>  world  ")).toBe("hello <script> world");
    expect(sanitizeSketchText("x".repeat(200))).toHaveLength(80);
  });

  it("rejects malformed drawing payloads", () => {
    expect(validateSketchDrawing({ strokes: [{ color: "#111827", width: 4, points: [{ x: Number.NaN, y: 0.5 }] }] }).ok).toBe(false);
    expect(validateSketchDrawing({ strokes: [{ color: "#111827", width: 4, points: [{ x: 1.2, y: 0.5 }] }] }).ok).toBe(false);
  });

  it("normalizes valid drawings", () => {
    const result = validateSketchDrawing({ strokes: [{ color: "bad", width: 100, points: [{ x: 0.1, y: 0.2 }] }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.drawing.strokes[0]?.color).toBe("#111827");
      expect(result.drawing.strokes[0]?.width).toBe(48);
    }
  });
});

describe("Sketch Relay phase flow", () => {
  it("restores a current assignment from game state", () => {
    const room = sketchRoom(3);
    const state = createSketchRelayGameState(room, "round-1");
    room.gameState = state;
    expect(state.chains).toHaveLength(3);
    expect(state.phase).toBe("prompt-entry");
    stopSketchRelay(room);
  });

  it("rejects duplicate submissions and advances phases", () => {
    const { io, emissions } = fakeIo();
    const room = sketchRoom(3);
    room.roundId = "round-1";
    startSketchRelay(io, room, room.roundId);
    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") expect(room.gameState.phase).toBe("prompt-entry");

    expect(handleSketchSubmission(io, room, 1, { roundId: "round-1", text: "space taco" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 1, { roundId: "round-1", text: "duplicate" }).ok).toBe(false);
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-1", text: "" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 3, { roundId: "round-1", text: "wizard bus" }).ok).toBe(true);

    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") {
      expect(room.gameState.phase).toBe("drawing");
      expect(room.gameState.phaseIndex).toBe(1);
      expect([...room.gameState.assignments.values()].every((assignment) => assignment.prompt)).toBe(true);
    }
    expect(emissions.some((emission) => emission.event === SOCKET_EVENTS.GAME_STATE)).toBe(true);
    stopSketchRelay(room);
  });

  it("completes reveal ordering after all phases", () => {
    const { io } = fakeIo();
    const room = sketchRoom(3);
    room.roundId = "round-2";
    startSketchRelay(io, room, room.roundId);

    for (const player of [1, 2, 3]) {
      expect(handleSketchSubmission(io, room, player, { roundId: "round-2", text: `prompt ${player}` }).ok).toBe(true);
    }
    for (const player of [1, 2, 3]) {
      expect(
        handleSketchSubmission(io, room, player, {
          roundId: "round-2",
          drawing: { strokes: [{ color: "#111827", width: 5, points: [{ x: 0.2, y: 0.3 }] }] }
        }).ok
      ).toBe(true);
    }
    for (const player of [1, 2, 3]) {
      expect(handleSketchSubmission(io, room, player, { roundId: "round-2", text: `guess ${player}` }).ok).toBe(true);
    }

    expect(room.status).toBe("results");
    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") {
      expect(room.gameState.phase).toBe("reveal");
      expect(room.gameState.chains[0]?.entries.map((entry) => entry.type)).toEqual(["text", "drawing", "text"]);
    }
    stopSketchRelay(room);
  });
});
