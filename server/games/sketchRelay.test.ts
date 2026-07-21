import type { Server } from "socket.io";
import { describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "../../shared/protocol";
import { createRoom } from "../rooms";
import type { InternalRoom } from "../types";
import {
  createSketchRelayGameState,
  entryTypeForPhase,
  handleSketchSubmission,
  normalizeSketchRelaySettings,
  sanitizeSketchText,
  startSketchRelay,
  stopSketchRelay,
  toSketchRelayPublicState,
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

describe("Sketch Relay phase order", () => {
  it("alternates text and drawing phases", () => {
    expect(entryTypeForPhase(1)).toBe("drawing");
    expect(entryTypeForPhase(2)).toBe("text");
    expect(entryTypeForPhase(3)).toBe("drawing");
    expect(entryTypeForPhase(4)).toBe("text");
  });
});

describe("Sketch Relay validation", () => {
  it("normalizes host settings", () => {
    expect(normalizeSketchRelaySettings({ difficulty: "hard", turnSeconds: 90 })).toEqual({ difficulty: "hard", turnSeconds: 90 });
    expect(normalizeSketchRelaySettings({ difficulty: "wild" as never, turnSeconds: 999 as never })).toEqual({
      difficulty: "medium",
      turnSeconds: 60
    });
  });

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
  it("starts with one server word and one relay chain", () => {
    const room = sketchRoom(3);
    const state = createSketchRelayGameState(room, "round-1");
    room.gameState = state;
    expect(state.chains).toHaveLength(1);
    expect(state.chains[0]?.entries[0]?.type).toBe("text");
    expect(state.chains[0]?.entries[0]?.contributorName).toBe("Secret word");
    expect(state.settings).toEqual({ difficulty: "medium", turnSeconds: 60 });
    expect(state.phase).toBe("drawing");
    expect(state.phaseIndex).toBe(1);
    stopSketchRelay(room);
  });

  it("stores selected settings on the active relay state", () => {
    const room = sketchRoom(3);
    const state = createSketchRelayGameState(room, "round-settings", { difficulty: "easy", turnSeconds: 30 });
    expect(state.settings).toEqual({ difficulty: "easy", turnSeconds: 30 });
    expect(toSketchRelayPublicState(state).settings).toEqual({ difficulty: "easy", turnSeconds: 30 });
    stopSketchRelay(room);
  });

  it("assigns Player 1 to draw the random word first", () => {
    const { io, emissions } = fakeIo();
    const room = sketchRoom(3);
    room.roundId = "round-1";
    startSketchRelay(io, room, room.roundId);
    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") {
      expect(room.gameState.phase).toBe("drawing");
      expect(room.gameState.phaseIndex).toBe(1);
      expect(room.gameState.assignments.size).toBe(1);
      const assignment = room.gameState.assignments.get(1);
      expect(assignment?.entryType).toBe("drawing");
      expect(assignment?.prompt).toBeTruthy();
    }
    expect(emissions.some((emission) => emission.event === SOCKET_EVENTS.GAME_STATE)).toBe(true);
    stopSketchRelay(room);
  });

  it("rejects duplicate submissions and advances one player at a time", () => {
    const { io } = fakeIo();
    const room = sketchRoom(3);
    room.roundId = "round-2";
    startSketchRelay(io, room, room.roundId);

    const drawing = { strokes: [{ color: "#111827", width: 5, points: [{ x: 0.2, y: 0.3 }] }] };
    expect(handleSketchSubmission(io, room, 1, { roundId: "round-2", drawing }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 1, { roundId: "round-2", drawing }).ok).toBe(false);
    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") {
      expect(room.gameState.phase).toBe("guessing");
      expect(room.gameState.phaseIndex).toBe(2);
      expect(room.gameState.assignments.get(2)?.entryType).toBe("text");
    }
    stopSketchRelay(room);
  });

  it("hides the previous drawing once the same player draws their guess", () => {
    const { io } = fakeIo();
    const room = sketchRoom(3);
    room.roundId = "round-privacy";
    startSketchRelay(io, room, room.roundId);

    const drawing = { strokes: [{ color: "#111827", width: 5, points: [{ x: 0.2, y: 0.3 }] }] };
    expect(handleSketchSubmission(io, room, 1, { roundId: "round-privacy", drawing }).ok).toBe(true);
    const guessAssignment = room.gameState?.gameType === "sketch-relay" ? room.gameState.assignments.get(2) : undefined;
    expect(guessAssignment?.entryType).toBe("text");
    expect(guessAssignment?.drawing).toBeTruthy();

    expect(handleSketchSubmission(io, room, 2, { roundId: "round-privacy", text: "yellow kart" }).ok).toBe(true);
    const drawAssignment = room.gameState?.gameType === "sketch-relay" ? room.gameState.assignments.get(2) : undefined;
    expect(drawAssignment?.entryType).toBe("drawing");
    expect(drawAssignment?.prompt).toBe("yellow kart");
    expect(drawAssignment?.drawing).toBeUndefined();
    stopSketchRelay(room);
  });

  it("reveals secret word, drawing, guess, drawing, guess, drawing", () => {
    const { io } = fakeIo();
    const room = sketchRoom(3);
    room.roundId = "round-3";
    startSketchRelay(io, room, room.roundId);

    const drawing = { strokes: [{ color: "#111827", width: 5, points: [{ x: 0.2, y: 0.3 }] }] };
    expect(handleSketchSubmission(io, room, 1, { roundId: "round-3", drawing }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-3", text: "yellow kart" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-3", drawing }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 3, { roundId: "round-3", text: "banana car" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 3, { roundId: "round-3", drawing }).ok).toBe(true);

    expect(room.status).toBe("results");
    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") {
      const entries = room.gameState.chains[0]?.entries ?? [];
      expect(room.gameState.phase).toBe("reveal");
      expect(entries.map((entry) => entry.type)).toEqual(["text", "drawing", "text", "drawing", "text", "drawing"]);
      expect(entries.map((entry) => entry.contributorPlayerNumber)).toEqual([0, 1, 2, 2, 3, 3]);
    }
    stopSketchRelay(room);
  });

  it("supports the same relay pattern with more players", () => {
    const { io } = fakeIo();
    const room = sketchRoom(4);
    room.roundId = "round-4";
    startSketchRelay(io, room, room.roundId);

    const drawing = { strokes: [{ color: "#111827", width: 5, points: [{ x: 0.2, y: 0.3 }] }] };
    expect(handleSketchSubmission(io, room, 1, { roundId: "round-4", drawing }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-4", text: "guess 2" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-4", drawing }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 3, { roundId: "round-4", text: "guess 3" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 3, { roundId: "round-4", drawing }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 4, { roundId: "round-4", text: "guess 4" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 4, { roundId: "round-4", drawing }).ok).toBe(true);

    expect(room.status).toBe("results");
    if (room.gameState?.gameType === "sketch-relay") {
      expect(room.gameState.chains[0]?.entries).toHaveLength(8);
    }
    stopSketchRelay(room);
  });
});
