import type { Server } from "socket.io";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOCKET_EVENTS } from "../../shared/protocol";
import { createRoom } from "../rooms";
import type { InternalRoom } from "../types";
import {
  computeSketchRelayResult,
  createSketchRelayGameState,
  entryTypeForPhase,
  handleSketchRevealControl,
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

const drawingA = { strokes: [{ color: "#111827", width: 5, eraser: false, points: [{ x: 0.2, y: 0.3 }] }] };
const drawingB = { strokes: [{ color: "#0ea5e9", width: 7, eraser: false, points: [{ x: 0.4, y: 0.5 }] }] };
const drawingC = { strokes: [{ color: "#ef4444", width: 9, eraser: false, points: [{ x: 0.6, y: 0.7 }] }] };

afterEach(() => {
  vi.useRealTimers();
});

function useSketchFakeTimers(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
}

function finishPreview(): void {
  vi.advanceTimersByTime(3250);
}

function forceOriginalWord(room: InternalRoom, word: string): void {
  if (room.gameState?.gameType !== "sketch-relay") return;
  const original = room.gameState.chains[0]?.entries[0];
  if (original) original.text = word;
  const firstAssignment = room.gameState.assignments.get(1);
  if (firstAssignment) room.gameState.assignments.set(1, { ...firstAssignment, prompt: word });
}

describe("Sketch Relay phase order", () => {
  it("maps live phases to their submitted entry types", () => {
    expect(entryTypeForPhase("first-player-drawing")).toBe("drawing");
    expect(entryTypeForPhase("viewing-previous-drawing")).toBe("text");
    expect(entryTypeForPhase("entering-guess")).toBe("text");
    expect(entryTypeForPhase("drawing-own-guess")).toBe("drawing");
    expect(entryTypeForPhase("reveal")).toBeNull();
    expect(entryTypeForPhase("result")).toBeNull();
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
  it("starts with exactly one server word, one relay chain, and a fixed player order", () => {
    const room = sketchRoom(4);
    const state = createSketchRelayGameState(room, "round-1");
    room.gameState = state;
    expect(state.chains).toHaveLength(1);
    expect(state.chains[0]?.entries).toHaveLength(1);
    expect(state.chains[0]?.entries[0]?.type).toBe("text");
    expect(state.chains[0]?.entries[0]?.contributorPlayerNumber).toBe(0);
    expect(state.chains[0]?.entries[0]?.contributorName).toBe("Secret word");
    expect(state.playerOrder).toEqual([1, 2, 3, 4]);
    expect(state.settings).toEqual({ difficulty: "medium", turnSeconds: 60 });
    expect(state.phase).toBe("first-player-drawing");
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

  it("only assigns Player 1 the original word at the start", () => {
    const { io, emissions } = fakeIo();
    const room = sketchRoom(4);
    room.roundId = "round-1";
    startSketchRelay(io, room, room.roundId);
    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") {
      expect(room.gameState.phase).toBe("first-player-drawing");
      expect(room.gameState.phaseIndex).toBe(1);
      expect(room.gameState.assignments.size).toBe(1);
      expect([...room.gameState.assignments.keys()]).toEqual([1]);
      const assignment = room.gameState.assignments.get(1);
      expect(assignment?.entryType).toBe("drawing");
      expect(assignment?.prompt).toBeTruthy();
      expect(room.gameState.assignments.get(2)).toBeUndefined();
      expect(room.gameState.assignments.get(3)).toBeUndefined();
      expect(room.gameState.assignments.get(4)).toBeUndefined();
      const publicState = toSketchRelayPublicState(room.gameState);
      expect(publicState.activePlayerNumber).toBe(1);
      expect(publicState.turnIndex).toBe(1);
      expect(publicState.totalTurns).toBe(4);
      expect(publicState.chains).toBeUndefined();
    }
    expect(emissions.some((emission) => emission.event === SOCKET_EVENTS.GAME_STATE)).toBe(true);
    stopSketchRelay(room);
  });

  it("rejects duplicate submissions, previews Player 1 drawing, then advances to Player 2 guessing", () => {
    const { io } = fakeIo();
    const room = sketchRoom(4);
    room.roundId = "round-2";
    useSketchFakeTimers();
    startSketchRelay(io, room, room.roundId);

    expect(handleSketchSubmission(io, room, 1, { roundId: "round-2", drawing: drawingA }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 1, { roundId: "round-2", drawing: drawingA }).ok).toBe(false);
    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") {
      expect(room.gameState.phase).toBe("viewing-previous-drawing");
      expect(room.gameState.phaseIndex).toBe(2);
      expect([...room.gameState.assignments.keys()]).toEqual([2]);
      const assignment = room.gameState.assignments.get(2);
      expect(assignment?.entryType).toBe("text");
      expect(assignment?.drawing).toEqual(drawingA);
      expect(assignment?.prompt).toBeUndefined();
    }
    finishPreview();
    if (room.gameState?.gameType === "sketch-relay") {
      expect(room.gameState.phase).toBe("entering-guess");
      const assignment = room.gameState.assignments.get(2);
      expect(assignment?.entryType).toBe("text");
      expect(assignment?.drawing).toBeUndefined();
    }
    stopSketchRelay(room);
  });

  it("passes the previous drawing only to the guessing player", () => {
    const { io } = fakeIo();
    const room = sketchRoom(4);
    room.roundId = "round-privacy";
    useSketchFakeTimers();
    startSketchRelay(io, room, room.roundId);

    expect(handleSketchSubmission(io, room, 1, { roundId: "round-privacy", drawing: drawingA }).ok).toBe(true);
    const guessAssignment = room.gameState?.gameType === "sketch-relay" ? room.gameState.assignments.get(2) : undefined;
    expect(guessAssignment?.entryType).toBe("text");
    expect(guessAssignment?.drawing).toEqual(drawingA);
    expect(guessAssignment?.prompt).toBeUndefined();
    expect(room.gameState?.gameType === "sketch-relay" ? room.gameState.assignments.get(1) : undefined).toBeUndefined();
    expect(room.gameState?.gameType === "sketch-relay" ? room.gameState.assignments.get(3) : undefined).toBeUndefined();
    expect(room.gameState?.gameType === "sketch-relay" ? room.gameState.assignments.get(4) : undefined).toBeUndefined();
    if (room.gameState?.gameType === "sketch-relay") expect(toSketchRelayPublicState(room.gameState).chains).toBeUndefined();
    finishPreview();
    const typingAssignment = room.gameState?.gameType === "sketch-relay" ? room.gameState.assignments.get(2) : undefined;
    expect(typingAssignment?.entryType).toBe("text");
    expect(typingAssignment?.drawing).toBeUndefined();
    stopSketchRelay(room);
  });

  it("passes the guessed word back to the same player for drawing without the old drawing", () => {
    const { io } = fakeIo();
    const room = sketchRoom(4);
    room.roundId = "round-word";
    useSketchFakeTimers();
    startSketchRelay(io, room, room.roundId);

    expect(handleSketchSubmission(io, room, 1, { roundId: "round-word", drawing: drawingA }).ok).toBe(true);
    finishPreview();
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-word", text: "yellow kart" }).ok).toBe(true);
    const drawAssignment = room.gameState?.gameType === "sketch-relay" ? room.gameState.assignments.get(2) : undefined;
    expect(drawAssignment?.entryType).toBe("drawing");
    expect(drawAssignment?.prompt).toBe("yellow kart");
    expect(drawAssignment?.drawing).toBeUndefined();
    expect(room.gameState?.gameType === "sketch-relay" ? [...room.gameState.assignments.keys()] : []).toEqual([2]);
    stopSketchRelay(room);
  });

  it("runs first draw, middle guess-and-draw turns, and final guess before reveal", () => {
    const { io } = fakeIo();
    const room = sketchRoom(4);
    room.roundId = "round-3";
    useSketchFakeTimers();
    startSketchRelay(io, room, room.roundId);
    forceOriginalWord(room, "Elephant");

    expect(handleSketchSubmission(io, room, 1, { roundId: "round-3", drawing: drawingA }).ok).toBe(true);
    finishPreview();
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-3", text: "Big mouse" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-3", drawing: drawingB }).ok).toBe(true);
    finishPreview();
    expect(handleSketchSubmission(io, room, 3, { roundId: "round-3", text: "Rat chef" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 3, { roundId: "round-3", drawing: drawingC }).ok).toBe(true);
    finishPreview();
    expect(handleSketchSubmission(io, room, 4, { roundId: "round-3", text: "Rat" }).ok).toBe(true);

    expect(room.status).toBe("results");
    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") {
      const entries = room.gameState.chains[0]?.entries ?? [];
      expect(room.gameState.phase).toBe("reveal");
      expect(entries.map((entry) => entry.type)).toEqual(["text", "drawing", "text", "drawing", "text", "drawing", "text"]);
      expect(entries.map((entry) => entry.contributorPlayerNumber)).toEqual([0, 1, 2, 2, 3, 3, 4]);
      expect(entries.map((entry) => entry.text ?? entry.type)).toEqual(["Elephant", "drawing", "Big mouse", "drawing", "Rat chef", "drawing", "Rat"]);
    }
    stopSketchRelay(room);
  });

  it("reveals entries in chronological order and then exposes the final result", () => {
    const { io } = fakeIo();
    const room = sketchRoom(4);
    room.roundId = "round-4";
    useSketchFakeTimers();
    startSketchRelay(io, room, room.roundId);
    forceOriginalWord(room, "Elephant");

    expect(handleSketchSubmission(io, room, 1, { roundId: "round-4", drawing: drawingA }).ok).toBe(true);
    finishPreview();
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-4", text: "Big mouse" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-4", drawing: drawingB }).ok).toBe(true);
    finishPreview();
    expect(handleSketchSubmission(io, room, 3, { roundId: "round-4", text: "Rat chef" }).ok).toBe(true);
    expect(handleSketchSubmission(io, room, 3, { roundId: "round-4", drawing: drawingC }).ok).toBe(true);
    finishPreview();
    expect(handleSketchSubmission(io, room, 4, { roundId: "round-4", text: "Rat" }).ok).toBe(true);

    if (room.gameState?.gameType === "sketch-relay") {
      expect(toSketchRelayPublicState(room.gameState, true).chains?.[0]?.entries.map((entry) => entry.text ?? entry.type)).toEqual([
        "Elephant",
        "drawing",
        "Big mouse",
        "drawing",
        "Rat chef",
        "drawing",
        "Rat"
      ]);
      expect(room.gameState.revealEntryIndex).toBe(0);
      expect(handleSketchRevealControl(io, room, { roundId: "round-4", action: "next" }).ok).toBe(true);
      expect(room.gameState.revealEntryIndex).toBe(1);
      expect(handleSketchRevealControl(io, room, { roundId: "round-4", action: "next" }).ok).toBe(true);
      expect(room.gameState.revealEntryIndex).toBe(2);
      expect(handleSketchRevealControl(io, room, { roundId: "round-4", action: "next" }).ok).toBe(true);
      expect(room.gameState.revealEntryIndex).toBe(3);
      expect(handleSketchRevealControl(io, room, { roundId: "round-4", action: "next" }).ok).toBe(true);
      expect(room.gameState.revealEntryIndex).toBe(4);
      expect(handleSketchRevealControl(io, room, { roundId: "round-4", action: "next" }).ok).toBe(true);
      expect(room.gameState.revealEntryIndex).toBe(5);
      expect(handleSketchRevealControl(io, room, { roundId: "round-4", action: "next" }).ok).toBe(true);
      expect(room.gameState.revealEntryIndex).toBe(6);
      expect(handleSketchRevealControl(io, room, { roundId: "round-4", action: "next" }).ok).toBe(true);
      expect(room.gameState.phase).toBe("result");
      expect(toSketchRelayPublicState(room.gameState, true).result).toEqual({
        originalWord: "Elephant",
        finalGuess: "Rat",
        success: false
      });
    }
    stopSketchRelay(room);
  });

  it("normalizes final result case and repeated spaces", () => {
    const chain = {
      id: "chain-main",
      ownerPlayerNumber: 1,
      entries: [
        {
          id: "chain-main:0",
          chainId: "chain-main",
          phaseIndex: 0,
          type: "text" as const,
          contributorPlayerNumber: 0,
          contributorName: "Secret word",
          text: "Ice Cream",
          timestamp: 1
        },
        {
          id: "chain-main:1",
          chainId: "chain-main",
          phaseIndex: 1,
          type: "drawing" as const,
          contributorPlayerNumber: 1,
          contributorName: "Player 1",
          drawing: drawingA,
          timestamp: 2
        },
        {
          id: "chain-main:2",
          chainId: "chain-main",
          phaseIndex: 2,
          type: "text" as const,
          contributorPlayerNumber: 2,
          contributorName: "Player 2",
          text: "  ice   cream ",
          timestamp: 3
        }
      ]
    };

    expect(computeSketchRelayResult(chain)).toEqual({
      originalWord: "Ice Cream",
      finalGuess: "  ice   cream ",
      success: true
    });
  });

  it("fully clears the previous chain when a new round starts", () => {
    const { io } = fakeIo();
    const room = sketchRoom(4);
    room.roundId = "round-old";
    useSketchFakeTimers();
    startSketchRelay(io, room, room.roundId);
    forceOriginalWord(room, "Elephant");
    expect(handleSketchSubmission(io, room, 1, { roundId: "round-old", drawing: drawingA }).ok).toBe(true);
    finishPreview();
    expect(handleSketchSubmission(io, room, 2, { roundId: "round-old", text: "Big mouse" }).ok).toBe(true);

    room.roundId = "round-new";
    startSketchRelay(io, room, room.roundId);
    expect(room.gameState?.gameType).toBe("sketch-relay");
    if (room.gameState?.gameType === "sketch-relay") {
      expect(room.gameState.roundId).toBe("round-new");
      expect(room.gameState.phase).toBe("first-player-drawing");
      expect(room.gameState.phaseIndex).toBe(1);
      expect(room.gameState.chains).toHaveLength(1);
      expect(room.gameState.chains[0]?.entries).toHaveLength(1);
      expect(room.gameState.chains[0]?.entries[0]?.text).not.toBe("Elephant");
      expect(room.gameState.chains[0]?.entries.some((entry) => entry.text === "Big mouse")).toBe(false);
      expect([...room.gameState.assignments.keys()]).toEqual([1]);
      expect(room.gameState.playerOrder).toEqual([1, 2, 3, 4]);
    }
    stopSketchRelay(room);
  });
});
