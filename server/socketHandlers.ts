import type { Server } from "socket.io";
import {
  ARENA,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SOCKET_EVENTS
} from "../shared/protocol";
import type {
  Ack,
  ControllerAutoJoinRequest,
  ControllerAutoJoinResponse,
  ControllerJoinRequest,
  ControllerJoinResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  ErrorPayload,
  GameStartRequest,
  HostReconnectRequest,
  HostReconnectResponse,
  InputActionPayload,
  PlayerReadyRequest,
  RacingInputPayload,
  SketchRelayDrawingSubmission,
  SketchRelayReactionPayload,
  SketchRelayRevealControlPayload,
  SketchRelayTextSubmission,
  ValidateTokenRequest,
  ValidateTokenResponse
} from "../shared/protocol";
import {
  HOST_GRACE_MS,
  allSlotsReady,
  clearRoomTimers,
  createRoom,
  createToken,
  controllerTypeForGame,
  findPlayer,
  findPlayerByToken,
  getRoom,
  nextAvailablePlayer,
  roomChannel,
  teardownRoom,
  toPublicRoomState
} from "./rooms";
import type { AppSocket, InternalRoom } from "./types";
import { resolvePublicBaseUrl } from "./network";
import { buildSlotQrData } from "./qr";
import {
  createControllerTestGameState,
  resetAllDirections,
  resetPlayerDirection,
  startPhysicsLoop,
  stopPhysicsLoop
} from "./games/controllerTest";
import {
  createRacingGameState,
  resetAllRacingInputs,
  resetCarInput,
  startRacingPhysicsLoop,
  stopRacingPhysicsLoop,
  toGameStatePayload
} from "./games/racing";
import {
  emitSketchAssignmentToPlayer,
  handleSketchReaction,
  handleSketchRevealControl,
  handleSketchSubmission,
  startSketchRelay,
  stopSketchRelay
} from "./games/sketchRelay";

function errorAck(code: ErrorPayload["code"], message: string): { ok: false; error: ErrorPayload } {
  return { ok: false, error: { code, message } };
}

function playerLimitsForGame(gameType: CreateRoomRequest["gameType"]): { min: number; max: number } {
  if (gameType === "sketch-relay") return { min: 3, max: 12 };
  if (gameType === "table-tennis" || gameType === "tennis") return { min: 2, max: 2 };
  if (gameType === "rhythm-battle") return { min: 2, max: 4 };
  return { min: MIN_PLAYERS, max: 4 };
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
  stopSketchRelay(room);
  if (room.gameType === "racing") stopRacingPhysicsLoop(room);
  else if (room.gameType !== "sketch-relay") stopPhysicsLoop(room);
  room.status = "lobby";
  room.roundId = null;
  room.countdownEndsAt = null;
  room.gameState = null;
}

function runCountdown(io: Server, room: InternalRoom): void {
  const ticks: Array<4 | 3 | 2 | 1 | "go"> = [4, 3, 2, 1, "go"];
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
      if (room.gameType === "racing") startRacingPhysicsLoop(io, room);
      else startPhysicsLoop(io, room);
      return;
    }
    room.countdownTimer = setTimeout(emitNext, 1000);
  };

  emitNext();
}

export function registerSocketHandlers(io: Server, port: number): void {
  io.on("connection", (socket: AppSocket) => {
    // Optional one-socket diagnostic logging; it never affects gameplay or URL routing.
    const racingInputDevLogEnabled = socket.handshake.query.dev === "1";
    let racingFirstInputLogged = false;
    socket.on(
      SOCKET_EVENTS.HOST_CREATE_ROOM,
      async (payload: CreateRoomRequest, ack: (res: Ack<CreateRoomResponse>) => void) => {
        const limits = playerLimitsForGame(payload.gameType);
        if (payload.maxPlayers < limits.min || payload.maxPlayers > Math.min(limits.max, MAX_PLAYERS)) {
          return ack(errorAck("invalid-room", `Player count must be between ${limits.min} and ${limits.max}.`));
        }
        const room = createRoom(payload.gameType, payload.maxPlayers);
        room.hostSocketId = socket.id;
        socket.data.session = { role: "host", roomId: room.id };
        socket.join(roomChannel(room.id));
        const publicUrl = resolvePublicBaseUrl({
          requestOrigin: payload.publicOrigin ?? socket.handshake.headers.origin,
          forwardedProto: socket.handshake.headers["x-forwarded-proto"],
          forwardedHost: socket.handshake.headers["x-forwarded-host"],
          host: socket.handshake.headers.host,
          fallbackPort: port
        });
        console.info("[host:create-room]", {
          roomId: room.id,
          gameType: room.gameType,
          requestOrigin: payload.publicOrigin ?? socket.handshake.headers.origin,
          publicUrl
        });
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
        console.info("[controller:join-room]", {
          roomId: room.id,
          playerNumber: player.playerNumber,
          gameType: room.gameType,
          isReconnect,
          controllerType: controllerTypeForGame(room.gameType)
        });
        broadcastRoomState(io, room);
        ack({ ok: true, room: toPublicRoomState(room), color: player.color });
        emitSketchAssignmentToPlayer(io, room, player.playerNumber);
      }
    );

    socket.on(
      SOCKET_EVENTS.CONTROLLER_JOIN_ROOM,
      (payload: ControllerAutoJoinRequest, ack: (res: Ack<ControllerAutoJoinResponse>) => void) => {
        const room = getRoom(payload.roomId);
        if (!room) return ack(errorAck("invalid-room", "This room no longer exists."));
        const controllerType = controllerTypeForGame(room.gameType);
        let player = payload.controllerToken ? findPlayerByToken(room, payload.controllerToken) : undefined;
        const isReconnect = Boolean(player);

        if (!player) {
          player = nextAvailablePlayer(room);
          if (!player) return ack(errorAck("room-full", "This room is full."));
        }

        if (player.connected && player.socketId && player.socketId !== socket.id && !isReconnect) {
          return ack(errorAck("already-connected", "This player slot is already connected on another device."));
        }
        if (player.socketId && player.socketId !== socket.id) {
          io.sockets.sockets.get(player.socketId)?.leave(roomChannel(room.id));
        }

        const nickname = payload.nickname?.trim().slice(0, 20) || player.nickname || `Player ${player.playerNumber}`;
        player.nickname = nickname;
        player.connected = true;
        player.socketId = socket.id;
        socket.data.session = { role: "controller", roomId: room.id, playerNumber: player.playerNumber };
        socket.join(roomChannel(room.id));

        if (isReconnect) {
          io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.PLAYER_RECONNECTED, { playerNumber: player.playerNumber });
        }
        console.info("[controller:join-room]", {
          roomId: room.id,
          playerNumber: player.playerNumber,
          gameType: room.gameType,
          isReconnect,
          controllerType
        });
        broadcastRoomState(io, room);
        ack({
          ok: true,
          roomCode: room.id,
          gameType: room.gameType,
          controllerType,
          playerNumber: player.playerNumber,
          playerColor: player.color,
          roomStatus: room.status,
          controllerToken: player.token,
          room: toPublicRoomState(room)
        });
        emitSketchAssignmentToPlayer(io, room, player.playerNumber);
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
        if (room.gameType === "racing") resetCarInput(room, player.playerNumber);
        else if (room.gameType !== "sketch-relay") resetPlayerDirection(room, player.playerNumber);
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

    socket.on(SOCKET_EVENTS.GAME_START, (payload: GameStartRequest | undefined, ack: (res: Ack<Record<string, never>>) => void) => {
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
      if (room.gameType === "sketch-relay") {
        startSketchRelay(io, room, room.roundId, payload?.sketchRelay);
        ack({ ok: true } as Ack<Record<string, never>>);
        return;
      }
      room.status = "countdown";
      room.countdownEndsAt = Date.now() + 4000;
      room.gameState = room.gameType === "racing" ? createRacingGameState(room) : createControllerTestGameState(room);
      broadcastRoomState(io, room);
      if (room.gameType === "racing") {
        io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.GAME_STATE, toGameStatePayload(room));
      }
      runCountdown(io, room);
      ack({ ok: true } as Ack<Record<string, never>>);
    });

    socket.on(SOCKET_EVENTS.SKETCH_SUBMIT_TEXT, (payload: SketchRelayTextSubmission, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "controller") return ack(errorAck("invalid-player", "No active player session."));
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      const result = handleSketchSubmission(io, room, session.playerNumber, payload);
      if (!result.ok) return ack(errorAck("invalid-room", result.message));
      ack({ ok: true } as Ack<Record<string, never>>);
    });

    socket.on(SOCKET_EVENTS.SKETCH_SUBMIT_DRAWING, (payload: SketchRelayDrawingSubmission, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "controller") return ack(errorAck("invalid-player", "No active player session."));
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      const result = handleSketchSubmission(io, room, session.playerNumber, payload);
      if (!result.ok) return ack(errorAck("invalid-room", result.message));
      ack({ ok: true } as Ack<Record<string, never>>);
    });

    socket.on(SOCKET_EVENTS.SKETCH_REVEAL_CONTROL, (payload: SketchRelayRevealControlPayload, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "host") return ack(errorAck("not-host", "Only the host can control reveal."));
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      const result = handleSketchRevealControl(io, room, payload);
      if (!result.ok) return ack(errorAck("invalid-room", result.message));
      ack({ ok: true } as Ack<Record<string, never>>);
    });

    socket.on(SOCKET_EVENTS.SKETCH_REACTION, (payload: SketchRelayReactionPayload) => {
      const session = socket.data.session;
      if (!session || session.role !== "controller") return;
      const room = getRoom(session.roomId);
      if (!room) return;
      handleSketchReaction(io, room, session.playerNumber, payload);
    });

    socket.on(SOCKET_EVENTS.SKETCH_REQUEST_ASSIGNMENT, (_payload: unknown, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "controller") return ack(errorAck("invalid-player", "No active player session."));
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      emitSketchAssignmentToPlayer(io, room, session.playerNumber);
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
      // "countdown" is accepted alongside "in-progress": a room's roundId is fixed
      // for the whole countdown+in-progress span (see GAME_START/runCountdown), and
      // the physics tick doesn't start until "go" — so a direction/jump set during
      // the countdown just sits on the player's physics until the tick loop begins
      // consuming it, letting a pre-emptive hold take effect immediately at "go"
      // instead of being silently dropped and requiring a release-and-repress.
      if (!room || (room.status !== "in-progress" && room.status !== "countdown") || room.roundId !== payload.roundId) {
        return;
      }
      if (room.gameState?.gameType !== "controller-test") return;
      const physics = room.gameState.players.get(session.playerNumber);
      if (!physics || payload.sequence <= physics.lastSequence) return;
      physics.lastSequence = payload.sequence;
      switch (payload.action) {
        case "left-start":
          physics.direction = -1;
          break;
        case "right-start":
          physics.direction = 1;
          break;
        case "left-end":
          if (physics.direction === -1) physics.direction = 0;
          break;
        case "right-end":
          if (physics.direction === 1) physics.direction = 0;
          break;
        case "jump":
          if (physics.grounded) {
            physics.vy = ARENA.jumpVelocity;
            physics.grounded = false;
          }
          break;
      }
    });

    socket.on(SOCKET_EVENTS.RACING_INPUT, (payload: RacingInputPayload) => {
      // Ownership is always resolved from the authenticated socket session,
      // never from the packet payload - a packet cannot claim to control a
      // different player's/slot's car than the one this socket authenticated
      // as when it joined.
      const session = socket.data.session;
      const reject = (reason: string): void => {
        if (!racingInputDevLogEnabled) return;
        console.warn("[racing:input] rejected", {
          reason,
          socketId: socket.id,
          session,
          roundId: payload?.roundId,
          sequence: payload?.sequence,
          steering: payload?.steering,
          throttle: payload?.throttle,
          brake: payload?.brake,
          receivedAt: Date.now()
        });
      };
      if (!session || session.role !== "controller") return reject("unauthenticated-socket");
      const room = getRoom(session.roomId);
      if (!room) return reject("room-not-found");
      if (room.status !== "in-progress" && room.status !== "countdown") return reject("room-not-racing");
      if (room.roundId !== payload.roundId) return reject("wrong-round-id");
      if (room.gameState?.gameType !== "racing") return reject("wrong-game-type");
      const car = room.gameState.cars.get(session.playerNumber);
      if (!car) return reject("player-slot-not-found");
      if (car.finished) return reject("player-already-finished");
      if (payload.sequence <= car.lastSequence) return reject("stale-or-duplicate-sequence");
      if (
        !Number.isFinite(payload.steering) ||
        !Number.isFinite(payload.throttle) ||
        !Number.isFinite(payload.brake)
      ) {
        return reject("invalid-values");
      }
      car.lastSequence = payload.sequence;
      car.lastInputAt = Date.now();
      car.lastControllerInputAt = car.lastInputAt;
      car.steering = Math.max(-1, Math.min(1, payload.steering));
      car.throttle = Math.max(0, Math.min(1, payload.throttle));
      car.brake = Math.max(0, Math.min(1, payload.brake));
      if (!racingFirstInputLogged) {
        racingFirstInputLogged = true;
        console.info("[racing:input] first accepted", {
          socketId: socket.id,
          playerNumber: session.playerNumber,
          roomId: room.id,
          roundId: payload.roundId,
          sequence: payload.sequence,
          steering: car.steering,
          throttle: car.throttle,
          brake: car.brake,
          receivedAt: car.lastInputAt
        });
      }
      if (racingInputDevLogEnabled) {
        console.log("[racing:input] accepted", {
          socketId: socket.id,
          playerNumber: session.playerNumber,
          nickname: findPlayer(room, session.playerNumber)?.nickname,
          roomId: room.id,
          roundId: payload.roundId,
          sequence: payload.sequence,
          steering: car.steering,
          throttle: car.throttle,
          brake: car.brake,
          receivedAt: car.lastInputAt
        });
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
        if (room.gameType === "racing") {
          stopRacingPhysicsLoop(room);
          resetAllRacingInputs(room);
        } else if (room.gameType !== "sketch-relay") {
          stopPhysicsLoop(room);
          resetAllDirections(room);
        }
        room.status = "host-disconnected";
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
          if (room.gameType === "racing") resetCarInput(room, player.playerNumber);
          else if (room.gameType !== "sketch-relay") resetPlayerDirection(room, player.playerNumber);
          io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.PLAYER_DISCONNECTED, { playerNumber: player.playerNumber });
          broadcastRoomState(io, room);
        }
      }
    });
  });
}

export { clearRoomTimers };
