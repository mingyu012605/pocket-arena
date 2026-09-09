import type { Socket } from "socket.io";
import type {
  GameType,
  GolfClubPosePayload,
  GolfTerrainType,
  PocketGolfPhase,
  PocketGolfShotPayload,
  RoomStatus,
  SketchRelayAssignmentPayload,
  SketchRelayChain,
  SketchRelayPhase,
  SketchRelaySettings
} from "../shared/protocol";

export interface ControllerTestPhysics {
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  direction: -1 | 0 | 1;
  lastSequence: number;
}
export interface ControllerTestGameState {
  gameType: "controller-test";
  players: Map<number, ControllerTestPhysics>;
}
export interface RacingCarState {
  isBot?: boolean;
  displayName?: string;
  color?: string;
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  yawRate: number;
  steering: number;
  smoothedSteering: number;
  throttle: number;
  brake: number;
  lastInputAt: number;
  lastControllerInputAt: number | null;
  lastSequence: number;
  lastCollisionAt: number;
  rank: number;
  lap: number;
  finished: boolean;
  finishTime: number | null;
  airborne: boolean;
  worldX: number;
  worldY: number;
  worldZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  takeoffProgress: number;
  settleTimer: number;
  settleFromPitch: number;
  hardLanding: boolean;
  fallenAt: number | null;
  lastCheckpointIndex: number;
  projectedProgress: number;
  lastRespawnAt: number;
}
export interface RacingGameState {
  gameType: "racing";
  trackId: string;
  cars: Map<number, RacingCarState>;
  finishOrder: number[];
  focusedPlayerNumber: number | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface PocketGolfPlayerState {
  playerNumber: number;
  displayName: string;
  color: string;
  strokes: number;
  distanceToHole: number;
  lie: GolfTerrainType;
  finished: boolean;
  ballX: number;
  ballZ: number;
}

export interface PocketGolfGameState {
  gameType: "pocket-golf";
  phase: PocketGolfPhase;
  holeIndex: number;
  activePlayerNumber: number | null;
  turnId: string;
  aimDegrees: number;
  clubId: string;
  usedSwingIds: Set<string>;
  players: Map<number, PocketGolfPlayerState>;
  shotSequence: number;
  lastShot: PocketGolfShotPayload | null;
  clubPose: GolfClubPosePayload | null;
}

export interface SketchRelayGameState {
  gameType: "sketch-relay";
  roundId: string;
  phase: SketchRelayPhase;
  phaseIndex: number;
  activePlayerIndex: number;
  deadlineAt: number | null;
  chains: SketchRelayChain[];
  playerOrder: number[];
  pendingGuess: string | null;
  settings: SketchRelaySettings;
  assignments: Map<number, SketchRelayAssignmentPayload>;
  submissions: Set<number>;
  revealChainIndex: number;
  revealEntryIndex: number;
  phaseTimer: NodeJS.Timeout | null;
}

export type InternalGameState = ControllerTestGameState | RacingGameState | SketchRelayGameState | PocketGolfGameState;

export interface InternalPlayer {
  playerNumber: number;
  token: string;
  nickname: string | null;
  color: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
}

export interface InternalRoom {
  id: string;
  gameType: GameType;
  maxPlayers: number;
  hostToken: string;
  hostSocketId: string | null;
  status: RoomStatus;
  statusBeforeHostDisconnect: RoomStatus | null;
  roundId: string | null;
  countdownEndsAt: number | null;
  players: InternalPlayer[];
  gameState: InternalGameState | null;
  createdAt: number;
  hostGraceTimer: NodeJS.Timeout | null;
  countdownTimer: NodeJS.Timeout | null;
  physicsInterval: NodeJS.Timeout | null;
}

export type SocketSession =
  | { role: "host"; roomId: string }
  | { role: "controller"; roomId: string; playerNumber: number };

// socket.io's `Socket.data` is typed via a generic parameter that defaults to
// `any`; declaration-merging into `Socket`/`SocketData` directly either fails
// to compile (conflicts with the generic) or silently stays `any`. Verified
// empirically: parameterizing the generic directly is the only approach that
// actually narrows `socket.data.session` at compile time.
export type AppSocket = Socket<any, any, any, { session?: SocketSession }>;
