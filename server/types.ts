import type { GameType, RoomStatus } from "../shared/protocol";

export interface PlayerPhysics {
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  direction: -1 | 0 | 1;
}

export interface InternalPlayer {
  playerNumber: number;
  token: string;
  nickname: string | null;
  color: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  lastSequence: number;
  physics: PlayerPhysics;
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
  createdAt: number;
  hostGraceTimer: NodeJS.Timeout | null;
  countdownTimer: NodeJS.Timeout | null;
  physicsInterval: NodeJS.Timeout | null;
}

export type SocketSession =
  | { role: "host"; roomId: string }
  | { role: "controller"; roomId: string; playerNumber: number };

declare module "socket.io" {
  interface SocketData {
    session?: SocketSession;
  }
}
