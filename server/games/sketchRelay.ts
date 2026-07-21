import type { Server } from "socket.io";
import { SOCKET_EVENTS } from "../../shared/protocol";
import type {
  SketchDrawing,
  SketchRelayAssignmentPayload,
  SketchRelayChain,
  SketchRelayDrawingSubmission,
  SketchRelayEntry,
  SketchRelayEntryType,
  SketchRelayGameStatePayload,
  SketchRelayPhase,
  SketchRelayReactionPayload,
  SketchRelayRevealControlPayload,
  SketchRelaySettings,
  SketchRelayTextSubmission,
  SketchRelayTurnSeconds,
  SketchRelayWordDifficulty,
  SketchStroke
} from "../../shared/protocol";
import { findPlayer, roomChannel, toPublicRoomState } from "../rooms";
import type { InternalPlayer, InternalRoom, SketchRelayGameState } from "../types";

const DEFAULT_SKETCH_RELAY_SETTINGS: SketchRelaySettings = {
  difficulty: "medium",
  turnSeconds: 60
};
const VALID_DIFFICULTIES = new Set<SketchRelayWordDifficulty>(["easy", "medium", "hard"]);
const VALID_TURN_SECONDS = new Set<SketchRelayTurnSeconds>([30, 60, 90]);
const MAX_TEXT_LENGTH = 80;
const MAX_STROKES = 120;
const MAX_POINTS_PER_STROKE = 240;
const MAX_TOTAL_POINTS = 3600;
const SECRET_WORDS: Record<SketchRelayWordDifficulty, string[]> = {
  easy: [
    "Yellow car",
    "Pizza",
    "Robot",
    "Rainbow",
    "Dinosaur",
    "Soccer ball",
    "Ice cream",
    "Rocket",
    "Cat driver",
    "Palm tree"
  ],
  medium: [
    "Blue-haired kart racer",
    "Giant rainbow loop",
    "Yellow turbo kart",
    "Cheering stadium crowd",
    "Road monster eating cones",
    "Palm tree race track",
    "Flying confetti tunnel",
    "Funny robot driver",
    "Seoul night market",
    "Dancing traffic light",
    "Rocket boost banana",
    "Sleepy dragon taxi"
  ],
  hard: [
    "A penguin DJ drifting through Seoul",
    "A haunted vending machine selling boosts",
    "A moon parade inside a racing tunnel",
    "A tiny chef driving a noodle kart",
    "A dragon traffic cop at rush hour",
    "A superhero banana missing a wheel",
    "A karaoke robot chasing confetti",
    "A space taxi jumping over a stadium",
    "A sleepy wizard fixing a turbo engine",
    "A monster bus stuck in a rainbow loop"
  ]
};

export function sanitizeSketchText(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function fallbackPrompt(playerNumber: number): string {
  return SECRET_WORDS.medium[(playerNumber - 1) % SECRET_WORDS.medium.length]!;
}

export function normalizeSketchRelaySettings(settings?: Partial<SketchRelaySettings>): SketchRelaySettings {
  const difficulty = settings?.difficulty && VALID_DIFFICULTIES.has(settings.difficulty) ? settings.difficulty : DEFAULT_SKETCH_RELAY_SETTINGS.difficulty;
  const turnSeconds =
    settings?.turnSeconds && VALID_TURN_SECONDS.has(settings.turnSeconds) ? settings.turnSeconds : DEFAULT_SKETCH_RELAY_SETTINGS.turnSeconds;
  return { difficulty, turnSeconds };
}

function randomSecretWord(settings: SketchRelaySettings): string {
  const words = SECRET_WORDS[settings.difficulty] ?? SECRET_WORDS.medium;
  return words[Math.floor(Math.random() * words.length)] ?? words[0]!;
}

function entryId(chainId: string, phaseIndex: number): string {
  return `${chainId}:${phaseIndex}`;
}

function playerName(players: InternalPlayer[], playerNumber: number): string {
  return players.find((player) => player.playerNumber === playerNumber)?.nickname ?? `Player ${playerNumber}`;
}

export function assignmentPlayerForChain(chainIndex: number, phaseIndex: number, playerNumbers: number[]): number {
  return playerNumbers[(chainIndex + phaseIndex) % playerNumbers.length]!;
}

export function entryTypeForPhase(phaseIndex: number): SketchRelayEntryType {
  return phaseIndex % 2 === 1 ? "drawing" : "text";
}

function phaseNameForIndex(phaseIndex: number): Exclude<SketchRelayPhase, "reveal" | "finished"> {
  return entryTypeForPhase(phaseIndex) === "drawing" ? "drawing" : "guessing";
}

export function validateSketchDrawing(input: SketchDrawing): { ok: true; drawing: SketchDrawing } | { ok: false; reason: string } {
  if (!input || !Array.isArray(input.strokes)) return { ok: false, reason: "Drawing payload is missing strokes." };
  if (input.strokes.length > MAX_STROKES) return { ok: false, reason: "Drawing has too many strokes." };
  let totalPoints = 0;
  const strokes: SketchStroke[] = [];
  for (const stroke of input.strokes) {
    if (!stroke || !Array.isArray(stroke.points)) return { ok: false, reason: "Malformed stroke." };
    if (stroke.points.length > MAX_POINTS_PER_STROKE) return { ok: false, reason: "Stroke has too many points." };
    totalPoints += stroke.points.length;
    if (totalPoints > MAX_TOTAL_POINTS) return { ok: false, reason: "Drawing has too many points." };
    const color = /^#[0-9a-fA-F]{6}$/.test(stroke.color) ? stroke.color : "#111827";
    const width = Number(stroke.width);
    if (!Number.isFinite(width)) return { ok: false, reason: "Invalid brush width." };
    const points = [];
    for (const point of stroke.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { ok: false, reason: "Invalid drawing point." };
      if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return { ok: false, reason: "Drawing point out of range." };
      points.push({ x: point.x, y: point.y });
    }
    strokes.push({ color, width: Math.max(1, Math.min(48, width)), eraser: Boolean(stroke.eraser), points });
  }
  return { ok: true, drawing: { strokes } };
}

function blankDrawing(): SketchDrawing {
  return { strokes: [] };
}

function latestEntry(chain: SketchRelayChain): SketchRelayEntry | undefined {
  return chain.entries[chain.entries.length - 1];
}

export function createSketchRelayGameState(room: InternalRoom, roundId: string, settings?: Partial<SketchRelaySettings>): SketchRelayGameState {
  const firstPlayer = room.players[0];
  const normalizedSettings = normalizeSketchRelaySettings(settings);
  const secretWord = randomSecretWord(normalizedSettings);
  const chains: SketchRelayChain[] = [
    {
      id: "chain-main",
      ownerPlayerNumber: firstPlayer?.playerNumber ?? 1,
      entries: [
        {
          id: entryId("chain-main", 0),
          chainId: "chain-main",
          phaseIndex: 0,
          type: "text",
          contributorPlayerNumber: 0,
          contributorName: "Secret word",
          text: secretWord,
          timestamp: Date.now()
        }
      ]
    }
  ];
  return {
    gameType: "sketch-relay",
    roundId,
    phase: "drawing",
    phaseIndex: 1,
    deadlineAt: null,
    chains,
    settings: normalizedSettings,
    assignments: new Map(),
    submissions: new Set(),
    revealChainIndex: 0,
    revealEntryIndex: 0,
    phaseTimer: null
  };
}

export function toSketchRelayPublicState(state: SketchRelayGameState, reveal = false): SketchRelayGameStatePayload {
  return {
    gameType: "sketch-relay",
    roundId: state.roundId,
    phase: state.phase,
    phaseIndex: state.phaseIndex,
    entryType: state.phase === "reveal" || state.phase === "finished" ? null : entryTypeForPhase(state.phaseIndex),
    settings: state.settings,
    deadlineAt: state.deadlineAt,
    submittedCount: state.submissions.size,
    totalCount: state.assignments.size,
    revealChainIndex: state.revealChainIndex,
    revealEntryIndex: state.revealEntryIndex,
    chains: reveal || state.phase === "reveal" || state.phase === "finished" ? state.chains : undefined
  };
}

function broadcastSketchState(io: Server, room: InternalRoom): void {
  if (room.gameState?.gameType !== "sketch-relay") return;
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.ROOM_STATE, toPublicRoomState(room));
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.GAME_STATE, toSketchRelayPublicState(room.gameState));
}

function emitAssignments(io: Server, room: InternalRoom): void {
  if (room.gameState?.gameType !== "sketch-relay") return;
  for (const [playerNumber, assignment] of room.gameState.assignments) {
    const socketId = findPlayer(room, playerNumber)?.socketId;
    if (socketId) io.to(socketId).emit(SOCKET_EVENTS.SKETCH_ASSIGNMENT, assignment);
  }
}

export function emitSketchAssignmentToPlayer(io: Server, room: InternalRoom, playerNumber: number): void {
  if (room.gameState?.gameType !== "sketch-relay") return;
  const assignment = room.gameState.assignments.get(playerNumber);
  const socketId = findPlayer(room, playerNumber)?.socketId;
  if (assignment && socketId) io.to(socketId).emit(SOCKET_EVENTS.SKETCH_ASSIGNMENT, assignment);
}

function buildAssignments(room: InternalRoom, state: SketchRelayGameState): void {
  const playerNumbers = room.players.map((player) => player.playerNumber);
  const phase = phaseNameForIndex(state.phaseIndex);
  const entryType = entryTypeForPhase(state.phaseIndex);
  const chain = state.chains[0];
  if (!chain) return;
  const assigneeIndex = Math.min(playerNumbers.length - 1, Math.floor(state.phaseIndex / 2));
  const playerNumber = playerNumbers[assigneeIndex];
  if (!playerNumber) return;
  const previous = latestEntry(chain);
  state.phase = phase;
  state.submissions.clear();
  state.assignments.clear();
  state.assignments.set(playerNumber, {
    roundId: state.roundId,
    phase,
    phaseIndex: state.phaseIndex,
    entryType,
    deadlineAt: state.deadlineAt ?? Date.now(),
    submitted: false,
    submittedCount: 0,
    totalCount: 1,
    chainId: chain.id,
    prompt: entryType === "drawing" ? previous?.text ?? fallbackPrompt(playerNumber) : undefined,
    drawing: entryType === "text" ? previous?.drawing ?? blankDrawing() : undefined
  });
}

function assignmentWithProgress(assignment: SketchRelayAssignmentPayload, state: SketchRelayGameState): SketchRelayAssignmentPayload {
  return {
    ...assignment,
    submitted: state.submissions.has(assignmentPlayerFromAssignment(state, assignment)),
    submittedCount: state.submissions.size,
    totalCount: state.assignments.size
  };
}

function assignmentPlayerFromAssignment(state: SketchRelayGameState, target: SketchRelayAssignmentPayload): number {
  for (const [playerNumber, assignment] of state.assignments) {
    if (assignment.chainId === target.chainId) return playerNumber;
  }
  return 0;
}

function refreshAssignments(io: Server, room: InternalRoom): void {
  if (room.gameState?.gameType !== "sketch-relay") return;
  for (const [playerNumber, assignment] of [...room.gameState.assignments]) {
    room.gameState.assignments.set(playerNumber, assignmentWithProgress(assignment, room.gameState));
  }
  emitAssignments(io, room);
}

function addEntry(room: InternalRoom, state: SketchRelayGameState, playerNumber: number, payload: { text?: string; drawing?: SketchDrawing }): void {
  const assignment = state.assignments.get(playerNumber);
  if (!assignment) throw new Error("No assignment.");
  const chain = state.chains.find((item) => item.id === assignment.chainId);
  if (!chain) throw new Error("Missing chain.");
  const type = assignment.entryType;
  const text = type === "text" ? sanitizeSketchText(payload.text ?? "") || fallbackPrompt(playerNumber) : undefined;
  const drawing = type === "drawing" ? payload.drawing ?? blankDrawing() : undefined;
  chain.entries.push({
    id: entryId(chain.id, state.phaseIndex),
    chainId: chain.id,
    phaseIndex: state.phaseIndex,
    type,
    contributorPlayerNumber: playerNumber,
    contributorName: playerName(room.players, playerNumber),
    text,
    drawing,
    timestamp: Date.now()
  });
  state.submissions.add(playerNumber);
}

function autoSubmitMissing(room: InternalRoom, state: SketchRelayGameState): void {
  for (const player of room.players) {
    if (state.submissions.has(player.playerNumber) || !state.assignments.has(player.playerNumber)) continue;
    const assignment = state.assignments.get(player.playerNumber)!;
    if (assignment.entryType === "text") addEntry(room, state, player.playerNumber, { text: fallbackPrompt(player.playerNumber) });
    else addEntry(room, state, player.playerNumber, { drawing: blankDrawing() });
  }
}

function beginPhase(io: Server, room: InternalRoom, state: SketchRelayGameState): void {
  if (state.phaseTimer) clearTimeout(state.phaseTimer);
  const seconds = state.settings.turnSeconds;
  state.deadlineAt = Date.now() + seconds * 1000;
  buildAssignments(room, state);
  refreshAssignments(io, room);
  broadcastSketchState(io, room);
  state.phaseTimer = setTimeout(() => completePhase(io, room), seconds * 1000 + 250);
}

export function startSketchRelay(io: Server, room: InternalRoom, roundId: string, settings?: Partial<SketchRelaySettings>): void {
  const state = createSketchRelayGameState(room, roundId, settings);
  room.gameState = state;
  room.status = "in-progress";
  beginPhase(io, room, state);
}

function completePhase(io: Server, room: InternalRoom): void {
  if (room.gameState?.gameType !== "sketch-relay") return;
  const state = room.gameState;
  autoSubmitMissing(room, state);
  const finalPhaseIndex = room.players.length * 2 - 1;
  if (state.phaseIndex >= finalPhaseIndex) {
    if (state.phaseTimer) clearTimeout(state.phaseTimer);
    state.phaseTimer = null;
    state.phase = "reveal";
    state.deadlineAt = null;
    state.assignments.clear();
    state.submissions.clear();
    state.revealChainIndex = 0;
    state.revealEntryIndex = 0;
    room.status = "results";
    io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.ROOM_STATE, toPublicRoomState(room));
    io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.GAME_STATE, toSketchRelayPublicState(state, true));
    return;
  }
  state.phaseIndex += 1;
  beginPhase(io, room, state);
}

export function stopSketchRelay(room: InternalRoom): void {
  if (room.gameState?.gameType === "sketch-relay" && room.gameState.phaseTimer) {
    clearTimeout(room.gameState.phaseTimer);
    room.gameState.phaseTimer = null;
  }
}

export function handleSketchSubmission(
  io: Server,
  room: InternalRoom,
  playerNumber: number,
  payload: SketchRelayTextSubmission | SketchRelayDrawingSubmission
): { ok: true } | { ok: false; message: string } {
  if (room.gameState?.gameType !== "sketch-relay") return { ok: false, message: "Sketch Relay is not active." };
  const state = room.gameState;
  if (payload.roundId !== state.roundId) return { ok: false, message: "This submission belongs to an old round." };
  if (state.phase === "reveal" || state.phase === "finished") return { ok: false, message: "This phase is already over." };
  if (state.submissions.has(playerNumber)) return { ok: false, message: "You already submitted this phase." };
  const assignment = state.assignments.get(playerNumber);
  if (!assignment) return { ok: false, message: "You do not have an assignment." };
  if (assignment.entryType === "drawing") {
    const drawing = (payload as SketchRelayDrawingSubmission).drawing;
    const validated = validateSketchDrawing(drawing);
    if (!validated.ok) return { ok: false, message: validated.reason };
    addEntry(room, state, playerNumber, { drawing: validated.drawing });
  } else {
    addEntry(room, state, playerNumber, { text: (payload as SketchRelayTextSubmission).text });
  }
  refreshAssignments(io, room);
  broadcastSketchState(io, room);
  if (state.submissions.size >= state.assignments.size) completePhase(io, room);
  return { ok: true };
}

export function handleSketchRevealControl(io: Server, room: InternalRoom, payload: SketchRelayRevealControlPayload): { ok: true } | { ok: false; message: string } {
  if (room.gameState?.gameType !== "sketch-relay") return { ok: false, message: "Sketch Relay is not active." };
  const state = room.gameState;
  if (payload.roundId !== state.roundId) return { ok: false, message: "Old reveal control." };
  if (state.phase !== "reveal" && state.phase !== "finished") return { ok: false, message: "Reveal has not started." };
  const chain = state.chains[state.revealChainIndex];
  const maxEntry = Math.max(0, (chain?.entries.length ?? 1) - 1);
  if (payload.action === "next") {
    if (state.revealEntryIndex < maxEntry) state.revealEntryIndex += 1;
    else if (state.revealChainIndex < state.chains.length - 1) {
      state.revealChainIndex += 1;
      state.revealEntryIndex = 0;
    } else {
      state.phase = "finished";
    }
  } else if (payload.action === "previous") {
    if (state.revealEntryIndex > 0) state.revealEntryIndex -= 1;
    else if (state.revealChainIndex > 0) {
      state.revealChainIndex -= 1;
      state.revealEntryIndex = Math.max(0, state.chains[state.revealChainIndex]!.entries.length - 1);
    }
  } else if (payload.action === "skip-chain") {
    state.revealChainIndex = Math.min(state.chains.length - 1, state.revealChainIndex + 1);
    state.revealEntryIndex = 0;
  } else if (payload.action === "restart") {
    state.revealChainIndex = 0;
    state.revealEntryIndex = 0;
    state.phase = "reveal";
  } else if (payload.action === "finish") {
    state.phase = "finished";
  }
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.GAME_STATE, toSketchRelayPublicState(state, true));
  return { ok: true };
}

export function handleSketchReaction(io: Server, room: InternalRoom, playerNumber: number, payload: SketchRelayReactionPayload): void {
  if (room.gameState?.gameType !== "sketch-relay" || payload.roundId !== room.gameState.roundId) return;
  if (!["😂", "❤️", "😱", "👏"].includes(payload.reaction)) return;
  const player = findPlayer(room, playerNumber);
  if (!player) return;
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.SKETCH_REACTION_POP, {
    roundId: payload.roundId,
    reaction: payload.reaction,
    playerNumber,
    nickname: player.nickname ?? `Player ${playerNumber}`,
    color: player.color
  });
}
