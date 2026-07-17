export type GameType =
  | "controller-test"
  | "rhythm-battle"
  | "table-tennis"
  | "bowling"
  | "tennis"
  | "racing"
  | "sketch-relay";

export type ControllerType =
  | "button-controller"
  | "motion-wheel"
  | "motion-paddle"
  | "motion-throw"
  | "motion-swing"
  | "touch-motion"
  | "drawing-pad";

export type RoomStatus =
  | "lobby"
  | "countdown"
  | "in-progress"
  | "host-disconnected"
  | "results";

export const PLAYER_COLORS = [
  "#22d3ee",
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#f43f5e",
  "#eab308",
  "#14b8a6",
  "#6366f1",
  "#ec4899",
  "#84cc16",
  "#0ea5e9",
  "#fb7185"
] as const;

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 12;

export const ARENA = {
  width: 800,
  groundY: 500,
  gravity: 1400,
  jumpVelocity: -620,
  moveSpeed: 260,
  playerRadius: 24
} as const;

export interface PublicPlayer {
  playerNumber: number;
  nickname: string | null;
  color: string;
  connected: boolean;
  ready: boolean;
  controllerType: ControllerType;
}

export interface PublicRoomState {
  id: string;
  gameType: GameType;
  maxPlayers: number;
  status: RoomStatus;
  roundId: string | null;
  countdownEndsAt: number | null;
  players: PublicPlayer[];
}

export type ControllerAction = "left-start" | "left-end" | "right-start" | "right-end" | "jump";

export interface ErrorPayload {
  code:
    | "invalid-room"
    | "invalid-player"
    | "invalid-token"
    | "slot-taken"
    | "already-connected"
    | "room-full"
    | "unsupported-game"
    | "not-host"
    | "not-ready"
    | "already-started";
  message: string;
}

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: ErrorPayload };

export interface CreateRoomRequest {
  gameType: GameType;
  maxPlayers: number;
  publicOrigin?: string;
}
export interface CreateRoomSlot {
  playerNumber: number;
  joinUrl: string;
  qrDataUrl: string;
  token: string;
}
export interface CreateRoomResponse {
  roomId: string;
  hostToken: string;
  slots: CreateRoomSlot[];
  room: PublicRoomState;
}

export interface HostReconnectRequest {
  roomId: string;
  hostToken: string;
}
export interface HostReconnectResponse {
  room: PublicRoomState;
}

export interface ValidateTokenRequest {
  roomId: string;
  playerNumber: number;
  token: string;
}
export interface ValidateTokenResponse {
  color: string;
  gameType: GameType;
  maxPlayers: number;
  nickname: string | null;
}

export interface ControllerJoinRequest {
  roomId: string;
  playerNumber: number;
  token: string;
  nickname: string;
}
export interface ControllerJoinResponse {
  room: PublicRoomState;
  color: string;
}

export interface ControllerAutoJoinRequest {
  roomId: string;
  controllerToken?: string | null;
  nickname?: string;
}
export interface ControllerAutoJoinResponse {
  roomCode: string;
  gameType: GameType;
  controllerType: ControllerType;
  playerNumber: number;
  playerColor: string;
  roomStatus: RoomStatus;
  controllerToken: string;
  room: PublicRoomState;
}

export interface PlayerReadyRequest {
  ready: boolean;
}

export interface InputActionPayload {
  action: ControllerAction;
  sequence: number;
  roundId: string;
}

export interface RacingInputPayload {
  steering: number; // -1..1
  throttle: number; // 0..1
  brake: number;    // 0..1
  sequence: number;
  roundId: string;
}

export interface CountdownTickPayload {
  value: 4 | 3 | 2 | 1 | "go";
  roundId: string;
}

export interface ControllerTestPlayerState {
  playerNumber: number;
  x: number;
  y: number;
}
export interface ControllerTestGameStatePayload {
  gameType: "controller-test";
  roundId: string;
  players: ControllerTestPlayerState[];
}

export interface RacingPlayerState {
  playerNumber: number;
  displayName?: string;
  color?: string;
  isBot?: boolean;
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  steering?: number;
  throttle?: number;
  brake?: number;
  inputStale?: boolean;
  lastInputAt?: number;
  collided?: boolean;
  rank: number;
  lap: number;
  finished: boolean;
  finishTime: number | null;
  airborne?: boolean;
  worldX?: number;
  worldY?: number;
  worldZ?: number;
  respawned?: boolean;
}
export interface RacingGameStatePayload {
  gameType: "racing";
  roundId: string;
  trackId: string;
  raceStatus: "countdown" | "racing" | "finished";
  players: RacingPlayerState[];
}

export interface SketchPoint {
  x: number;
  y: number;
}
export interface SketchStroke {
  color: string;
  width: number;
  points: SketchPoint[];
  eraser?: boolean;
}
export interface SketchDrawing {
  strokes: SketchStroke[];
}
export type SketchRelayPhase = "prompt-entry" | "drawing" | "guessing" | "reveal" | "finished";
export type SketchRelayEntryType = "text" | "drawing";
export interface SketchRelayEntry {
  id: string;
  chainId: string;
  phaseIndex: number;
  type: SketchRelayEntryType;
  contributorPlayerNumber: number;
  contributorName: string;
  text?: string;
  drawing?: SketchDrawing;
  timestamp: number;
}
export interface SketchRelayChain {
  id: string;
  ownerPlayerNumber: number;
  entries: SketchRelayEntry[];
}
export interface SketchRelayGameStatePayload {
  gameType: "sketch-relay";
  roundId: string;
  phase: SketchRelayPhase;
  phaseIndex: number;
  entryType: SketchRelayEntryType | null;
  deadlineAt: number | null;
  submittedCount: number;
  totalCount: number;
  revealChainIndex: number;
  revealEntryIndex: number;
  chains?: SketchRelayChain[];
}
export interface SketchRelayAssignmentPayload {
  roundId: string;
  phase: Exclude<SketchRelayPhase, "reveal" | "finished">;
  phaseIndex: number;
  entryType: SketchRelayEntryType;
  deadlineAt: number;
  submitted: boolean;
  submittedCount: number;
  totalCount: number;
  chainId: string;
  prompt?: string;
  drawing?: SketchDrawing;
}
export interface SketchRelayTextSubmission {
  roundId: string;
  text: string;
}
export interface SketchRelayDrawingSubmission {
  roundId: string;
  drawing: SketchDrawing;
}
export type SketchRelayReaction = "😂" | "❤️" | "😱" | "👏";
export interface SketchRelayReactionPayload {
  roundId: string;
  reaction: SketchRelayReaction;
}
export interface SketchRelayReactionPopPayload extends SketchRelayReactionPayload {
  playerNumber: number;
  nickname: string;
  color: string;
}
export interface SketchRelayRevealControlPayload {
  roundId: string;
  action: "next" | "previous" | "skip-chain" | "restart" | "finish";
}

export type GameStatePayload = ControllerTestGameStatePayload | RacingGameStatePayload | SketchRelayGameStatePayload;

export interface RoomClosedPayload {
  reason: string;
}
export interface PlayerConnectionPayload {
  playerNumber: number;
}

export const SOCKET_EVENTS = {
  HOST_CREATE_ROOM: "host:create-room",
  HOST_RECONNECT: "host:reconnect",
  HOST_LEAVE_ROOM: "host:leave-room",
  CONTROLLER_VALIDATE_TOKEN: "controller:validate-token",
  CONTROLLER_JOIN: "controller:join",
  CONTROLLER_JOIN_ROOM: "controller:join-room",
  CONTROLLER_LEAVE: "controller:leave",
  PLAYER_READY: "player:ready",
  GAME_START: "game:start",
  GAME_END: "game:end",
  INPUT_ACTION: "input:action",
  RACING_INPUT: "racing:input",
  SKETCH_SUBMIT_TEXT: "sketch:submit-text",
  SKETCH_SUBMIT_DRAWING: "sketch:submit-drawing",
  SKETCH_REQUEST_ASSIGNMENT: "sketch:request-assignment",
  SKETCH_ASSIGNMENT: "sketch:assignment",
  SKETCH_REACTION: "sketch:reaction",
  SKETCH_REACTION_POP: "sketch:reaction-pop",
  SKETCH_REVEAL_CONTROL: "sketch:reveal-control",
  ROOM_STATE: "room:state",
  ROOM_CLOSED: "room:closed",
  PLAYER_DISCONNECTED: "player:disconnected",
  PLAYER_RECONNECTED: "player:reconnected",
  GAME_COUNTDOWN_TICK: "game:countdown-tick",
  GAME_STATE: "game:state"
} as const;
