export type GameType =
  | "controller-test"
  | "rhythm-battle"
  | "table-tennis"
  | "bowling"
  | "tennis"
  | "racing"
  | "sketch-relay"
  | "pocket-golf";

export type ControllerType =
  | "button-controller"
  | "motion-wheel"
  | "motion-paddle"
  | "motion-throw"
  | "motion-swing"
  | "touch-motion"
  | "drawing-pad"
  | "golf-swing";

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
  publicOrigin?: string;
}
export interface HostReconnectResponse {
  slots: CreateRoomSlot[];
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

export type SketchRelayWordDifficulty = "easy" | "medium" | "hard";
export type SketchRelayTurnSeconds = 30 | 60 | 90;
export interface SketchRelaySettings {
  difficulty: SketchRelayWordDifficulty;
  turnSeconds: SketchRelayTurnSeconds;
}
export interface GameStartRequest {
  sketchRelay?: Partial<SketchRelaySettings>;
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

export type GolfTerrainType = "tee" | "fairway" | "light-rough" | "deep-rough" | "bunker" | "green" | "water" | "out-of-bounds";
export type PocketGolfDifficulty = "Easy" | "Medium" | "Hard";
export type GolfShotShape = "straight" | "draw" | "fade" | "hook" | "slice";
export type GolfTimingLabel = "PERFECT" | "GREAT" | "GOOD" | "EARLY" | "LATE" | "MISHIT";
export type PocketGolfPhase =
  | "controller-check"
  | "calibration"
  | "course-intro"
  | "hole-intro"
  | "shot-setup"
  | "swing-ready"
  | "swing-animation"
  | "ball-flight"
  | "ball-roll"
  | "shot-result"
  | "hole-result"
  | "match-result";
export interface GolfClubDefinition {
  id: string;
  displayName: string;
  maximumCarryMetres: number;
  launchAngleDegrees: number;
  accuracy: number;
  forgiveness: number;
  backspin: number;
  rollMultiplier: number;
  powerCurve: number;
  allowedTerrain: GolfTerrainType[];
}
export interface GolfSwingResult {
  swingId: string;
  turnId: string;
  power: number;
  timing: number;
  faceAngle: number;
  swingPath: number;
  attackAngle: number;
  smoothness: number;
  confidence: number;
  source?: "motion" | "touch";
}
export interface GolfSwingSubmission extends GolfSwingResult {
  roundId: string;
  timestamp: number;
  clubId?: string;
  aimDeltaDegrees?: number;
}
export interface GolfAimPayload {
  roundId: string;
  turnId: string;
  clubId?: string;
  aimDeltaDegrees?: number;
}
export interface GolfClubPoseSubmission {
  roundId: string;
  turnId: string;
  timestamp: number;
  aimDegrees?: number;
  pitch: number;
  roll: number;
  yaw: number;
  swing: number;
  velocity: number;
  armed: boolean;
  handedness: "right" | "left";
  source: "motion" | "orientation";
}
export interface GolfClubPosePayload extends GolfClubPoseSubmission {
  playerNumber: number;
}
export interface GolfShotStatistics {
  carryDistance: number;
  rollDistance: number;
  totalDistance: number;
  maximumHeight: number;
  maximumBallSpeed: number;
  lateralError: number;
  distanceToHole: number;
  finalTerrain: GolfTerrainType;
  timingLabel: GolfTimingLabel;
  shotShape: GolfShotShape;
}
export interface GolfVec3 {
  x: number;
  y: number;
  z: number;
}
export interface PocketGolfShotPayload {
  sequence: number;
  playerNumber: number;
  playerName: string;
  clubId: string;
  clubName: string;
  swing: GolfSwingResult;
  stats: GolfShotStatistics;
  start: GolfVec3;
  end: GolfVec3;
  trajectory: GolfVec3[];
  penalty: "water" | "out-of-bounds" | null;
}
export interface PocketGolfPlayerStatePayload {
  playerNumber: number;
  displayName: string;
  color: string;
  strokes: number;
  scoreRelativeToPar: number;
  distanceToHole: number;
  lie: GolfTerrainType;
  finished: boolean;
  active: boolean;
  ball: GolfVec3;
}
export interface PocketGolfGameStatePayload {
  gameType: "pocket-golf";
  roundId: string;
  phase: PocketGolfPhase;
  turnId: string;
  holeNumber: number;
  holeName: string;
  holeDifficulty: PocketGolfDifficulty;
  par: number;
  holeDistance: number;
  activePlayerNumber: number | null;
  aimDegrees: number;
  clubId: string;
  recommendedClubId: string;
  wind: { speed: number; directionDegrees: number };
  elevationMetres: number;
  players: PocketGolfPlayerStatePayload[];
  lastShot: PocketGolfShotPayload | null;
  clubPose: GolfClubPosePayload | null;
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
export type SketchRelayPhase =
  | "first-player-drawing"
  | "viewing-previous-drawing"
  | "entering-guess"
  | "drawing-own-guess"
  | "reveal"
  | "result";
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
export interface SketchRelayResult {
  originalWord: string;
  finalGuess: string;
  success: boolean;
}
export interface SketchRelayGameStatePayload {
  gameType: "sketch-relay";
  roundId: string;
  phase: SketchRelayPhase;
  phaseIndex: number;
  entryType: SketchRelayEntryType | null;
  settings: SketchRelaySettings;
  deadlineAt: number | null;
  submittedCount: number;
  totalCount: number;
  playerOrder: number[];
  activePlayerNumber: number | null;
  turnIndex: number;
  totalTurns: number;
  revealChainIndex: number;
  revealEntryIndex: number;
  chains?: SketchRelayChain[];
  result?: SketchRelayResult;
}
export interface SketchRelayAssignmentPayload {
  roundId: string;
  phase: Exclude<SketchRelayPhase, "reveal" | "result">;
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

export type GameStatePayload = ControllerTestGameStatePayload | RacingGameStatePayload | SketchRelayGameStatePayload | PocketGolfGameStatePayload;

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
  GOLF_REQUEST_STATE: "golf:request-state",
  GOLF_AIM: "golf:aim",
  GOLF_CLUB_POSE: "golf:club-pose",
  GOLF_SWING: "golf:swing",
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
