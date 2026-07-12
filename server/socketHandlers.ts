import type { Server } from "socket.io";
import {
  ARENA,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SOCKET_EVENTS
} from "../shared/protocol";
import type {
  Ack,
  ControllerJoinRequest,
  ControllerJoinResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  ErrorPayload,
  HostReconnectRequest,
  HostReconnectResponse,
  InputActionPayload,
  PlayerReadyRequest,
  ValidateTokenRequest,
  ValidateTokenResponse
} from "../shared/protocol";
import {
  HOST_GRACE_MS,
  allSlotsReady,
  clearRoomTimers,
  createRoom,
  createToken,
  findPlayer,
  getRoom,
  roomChannel,
  teardownRoom,
  toPublicRoomState
} from "./rooms";
import type { AppSocket, InternalRoom } from "./types";
import { resolveUrls } from "./network";
import { buildSlotQrData } from "./qr";
import { resetAllDirections, resetPlayerDirection, startPhysicsLoop, stopPhysicsLoop } from "./games/controllerTest";

function errorAck(code: ErrorPayload["code"], message: string): { ok: false; error: ErrorPayload } {
  return { ok: false, error: { code, message } };
}

function broadcastRoomState(io: Server, room: InternalRoom): void {
  io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.ROOM_STATE, toPublicRoomState(room));
}

function connectedSocketIds(room: InternalRoom): string[] {
  const ids: string[] = [];
  if (room.hostSocketId) ids.push(room.hostSocketId);
  for (const p of room.players) if (p.socketId) ids.push(p.socketId);
  return ids;
}

function endRound(room: InternalRoom): void {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  stopPhysicsLoop(room);
  room.status = "lobby";
  room.roundId = null;
  room.countdownEndsAt = null;
  resetAllDirections(room);
}

function runCountdown(io: Server, room: InternalRoom): void {
  const ticks: Array<3 | 2 | 1 | "go"> = [3, 2, 1, "go"];
  const roundId = room.roundId;
  let index = 0;

  const emitNext = (): void => {
    if (room.roundId !== roundId) return;
    const value = ticks[index]!;
    io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.GAME_COUNTDOWN_TICK, { value, roundId });
    index += 1;
    if (value === "go") {
      room.status = "in-progress";
      room.countdownEndsAt = null;
      room.countdownTimer = null;
      broadcastRoomState(io, room);
      startPhysicsLoop(io, room);
      return;
    }
    room.countdownTimer = setTimeout(emitNext, 1000);
  };

  emitNext();
}

export function registerSocketHandlers(io: Server, port: number): void {
  io.on("connection", (socket: AppSocket) => {
    socket.on(
      SOCKET_EVENTS.HOST_CREATE_ROOM,
      async (payload: CreateRoomRequest, ack: (res: Ack<CreateRoomResponse>) => void) => {
        if (payload.maxPlayers < MIN_PLAYERS || payload.maxPlayers > MAX_PLAYERS) {
          return ack(errorAck("invalid-room", "Player count must be between 1 and 4."));
        }
        const room = createRoom(payload.gameType, payload.maxPlayers);
        room.hostSocketId = socket.id;
        socket.data.session = { role: "host", roomId: room.id };
        socket.join(roomChannel(room.id));
        const { publicUrl } = resolveUrls(port);
        const slots = await buildSlotQrData(room, publicUrl);
        ack({ ok: true, roomId: room.id, hostToken: room.hostToken, slots, room: toPublicRoomState(room) });
      }
    );

    socket.on(
      SOCKET_EVENTS.HOST_RECONNECT,
      (payload: HostReconnectRequest, ack: (res: Ack<HostReconnectResponse>) => void) => {
        const room = getRoom(payload.roomId);
        if (!room) return ack(errorAck("invalid-room", "This room no longer exists."));
        if (room.hostToken !== payload.hostToken) return ack(errorAck("invalid-token", "Invalid host session."));

        if (room.hostGraceTimer) {
          clearTimeout(room.hostGraceTimer);
          room.hostGraceTimer = null;
        }
        room.hostSocketId = socket.id;
        socket.data.session = { role: "host", roomId: room.id };
        socket.join(roomChannel(room.id));
        if (room.status === "host-disconnected") {
          endRound(room);
        }
        broadcastRoomState(io, room);
        ack({ ok: true, room: toPublicRoomState(room) });
      }
    );

    socket.on(SOCKET_EVENTS.HOST_LEAVE_ROOM, (_payload: unknown, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "host") return ack(errorAck("not-host", "No active host session."));
      const room = getRoom(session.roomId);
      if (room) {
        io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.ROOM_CLOSED, { reason: "The host ended the session." });
        for (const id of connectedSocketIds(room)) {
          io.sockets.sockets.get(id)?.leave(roomChannel(room.id));
        }
        teardownRoom(room.id);
      }
      socket.leave(roomChannel(session.roomId));
      socket.data.session = undefined;
      ack({ ok: true } as Ack<Record<string, never>>);
    });

    socket.on(
      SOCKET_EVENTS.CONTROLLER_VALIDATE_TOKEN,
      (payload: ValidateTokenRequest, ack: (res: Ack<ValidateTokenResponse>) => void) => {
        const room = getRoom(payload.roomId);
        if (!room) return ack(errorAck("invalid-room", "This room no longer exists."));
        const player = findPlayer(room, payload.playerNumber);
        if (!player) return ack(errorAck("invalid-player", "This player slot does not exist."));
        if (player.token !== payload.token) {
          return ack(errorAck("invalid-token", "This join link is invalid or expired."));
        }
        ack({
          ok: true,
          color: player.color,
          gameType: room.gameType,
          maxPlayers: room.maxPlayers,
          nickname: player.nickname
        });
      }
    );

    socket.on(
      SOCKET_EVENTS.CONTROLLER_JOIN,
      (payload: ControllerJoinRequest, ack: (res: Ack<ControllerJoinResponse>) => void) => {
        const room = getRoom(payload.roomId);
        if (!room) return ack(errorAck("invalid-room", "This room no longer exists."));
        const player = findPlayer(room, payload.playerNumber);
        if (!player) return ack(errorAck("invalid-player", "This player slot does not exist."));
        if (player.token !== payload.token) {
          return ack(errorAck("invalid-token", "This join link is invalid or expired."));
        }
        if (player.connected && player.socketId && player.socketId !== socket.id) {
          return ack(errorAck("already-connected", "This player slot is already connected on another device."));
        }

        const isReconnect = player.nickname !== null;
        const nickname = payload.nickname.trim().slice(0, 20) || `Player ${player.playerNumber}`;
        player.nickname = nickname;
        player.connected = true;
        player.socketId = socket.id;
        socket.data.session = { role: "controller", roomId: room.id, playerNumber: player.playerNumber };
        socket.join(roomChannel(room.id));

        if (isReconnect) {
          io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.PLAYER_RECONNECTED, { playerNumber: player.playerNumber });
        }
        broadcastRoomState(io, room);
        ack({ ok: true, room: toPublicRoomState(room), color: player.color });
      }
    );

    socket.on(SOCKET_EVENTS.CONTROLLER_LEAVE, (_payload: unknown, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "controller") {
        return ack(errorAck("invalid-player", "No active player session."));
      }
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      const player = findPlayer(room, session.playerNumber);
      if (player) {
        player.nickname = null;
        player.connected = false;
        player.ready = false;
        player.socketId = null;
        player.physics.direction = 0;
      }
      socket.leave(roomChannel(room.id));
      socket.data.session = undefined;
      broadcastRoomState(io, room);
      ack({ ok: true } as Ack<Record<string, never>>);
    });

    socket.on(SOCKET_EVENTS.PLAYER_READY, (payload: PlayerReadyRequest, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "controller") {
        return ack(errorAck("invalid-player", "No active player session."));
      }
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      const player = findPlayer(room, session.playerNumber);
      if (!player) return ack(errorAck("invalid-player", "Player slot not found."));
      player.ready = payload.ready;
      broadcastRoomState(io, room);
      ack({ ok: true } as Ack<Record<string, never>>);
    });

    socket.on(SOCKET_EVENTS.GAME_START, (_payload: unknown, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "host") return ack(errorAck("not-host", "Only the host can start the game."));
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      if (room.status !== "lobby") {
        return ack(errorAck("already-started", "The game has already started."));
      }
      if (!allSlotsReady(room)) {
        return ack(errorAck("not-ready", "Every player slot must be connected and ready."));
      }
      room.roundId = createToken();
      room.status = "countdown";
      room.countdownEndsAt = Date.now() + 3000;
      broadcastRoomState(io, room);
      runCountdown(io, room);
      ack({ ok: true } as Ack<Record<string, never>>);
    });

    socket.on(SOCKET_EVENTS.GAME_END, (_payload: unknown, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "host") return ack(errorAck("not-host", "Only the host can end the game."));
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      endRound(room);
      broadcastRoomState(io, room);
      ack({ ok: true } as Ack<Record<string, never>>);
    });

    socket.on(SOCKET_EVENTS.INPUT_ACTION, (payload: InputActionPayload) => {
      const session = socket.data.session;
      if (!session || session.role !== "controller") return;
      const room = getRoom(session.roomId);
      if (!room || room.status !== "in-progress" || room.roundId !== payload.roundId) return;
      const player = findPlayer(room, session.playerNumber);
      if (!player || payload.sequence <= player.lastSequence) return;
      player.lastSequence = payload.sequence;
      switch (payload.action) {
        case "left-start":
          player.physics.direction = -1;
          break;
        case "right-start":
          player.physics.direction = 1;
          break;
        case "left-end":
          if (player.physics.direction === -1) player.physics.direction = 0;
          break;
        case "right-end":
          if (player.physics.direction === 1) player.physics.direction = 0;
          break;
        case "jump":
          if (player.physics.grounded) {
            player.physics.vy = ARENA.jumpVelocity;
            player.physics.grounded = false;
          }
          break;
      }
    });

    socket.on("disconnect", () => {
      const session = socket.data.session;
      if (!session) return;
      const room = getRoom(session.roomId);
      if (!room) return;

      if (session.role === "host") {
        if (room.hostSocketId !== socket.id) return;
        room.hostSocketId = null;
        room.statusBeforeHostDisconnect = room.status;
        if (room.countdownTimer) {
          clearTimeout(room.countdownTimer);
          room.countdownTimer = null;
        }
        stopPhysicsLoop(room);
        room.status = "host-disconnected";
        resetAllDirections(room);
        broadcastRoomState(io, room);
        room.hostGraceTimer = setTimeout(() => {
          io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.ROOM_CLOSED, {
            reason: "The host did not reconnect in time."
          });
          teardownRoom(room.id);
        }, HOST_GRACE_MS);
      } else {
        const player = findPlayer(room, session.playerNumber);
        if (player && player.socketId === socket.id) {
          player.connected = false;
          player.socketId = null;
          resetPlayerDirection(room, player.playerNumber);
          io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.PLAYER_DISCONNECTED, { playerNumber: player.playerNumber });
          broadcastRoomState(io, room);
        }
      }
    });
  });
}

export { clearRoomTimers };
