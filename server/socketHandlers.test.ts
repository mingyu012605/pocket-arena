import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { registerSocketHandlers } from "./socketHandlers";
import { getRoom } from "./rooms";
import { SOCKET_EVENTS } from "../shared/protocol";
import type {
  Ack,
  ControllerAutoJoinResponse,
  ControllerJoinResponse,
  CreateRoomResponse,
  GameStatePayload,
  HostReconnectResponse
} from "../shared/protocol";

let httpServer: ReturnType<typeof createServer>;
let port: number;

beforeAll(async () => {
  httpServer = createServer();
  const io = new Server(httpServer);
  registerSocketHandlers(io, 0);
  await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
  port = (httpServer.address() as { port: number }).port;
});

afterAll(() => {
  httpServer.close();
});

function connect(): ClientSocket {
  return ioClient(`http://localhost:${port}`, { transports: ["websocket"] });
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForSocketEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

describe("room lifecycle", () => {
  it("creates universal QR join URLs without per-player token query params", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));

    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 2,
      publicOrigin: "https://pocket-arena.example"
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.slots[0]!.joinUrl).toBe(`https://pocket-arena.example/join/${created.roomId}`);
    expect(created.slots[1]!.joinUrl).toBe(created.slots[0]!.joinUrl);
    expect(new URL(created.slots[0]!.joinUrl).searchParams.get("token")).toBeNull();
    expect(created.slots[0]!.token).not.toBe(created.slots[1]!.token);

    host.close();
  });

  it("refreshes universal QR join URLs when the host reconnects through a public origin", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));

    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1,
      publicOrigin: "http://127.0.0.1:3000"
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const reconnect = await emitAck<HostReconnectResponse>(host, SOCKET_EVENTS.HOST_RECONNECT, {
      roomId: created.roomId,
      hostToken: created.hostToken,
      publicOrigin: "https://pocket-arena.example"
    });
    expect(reconnect.ok).toBe(true);
    if (!reconnect.ok) return;
    expect(reconnect.slots[0]!.joinUrl).toBe(`https://pocket-arena.example/join/${created.roomId}`);

    host.close();
  });

  it("auto-assigns universal QR joins in player order with controller metadata", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 2
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    const p2 = connect();
    await Promise.all([new Promise<void>((resolve) => p1.on("connect", resolve)), new Promise<void>((resolve) => p2.on("connect", resolve))]);

    const join1 = await emitAck<ControllerAutoJoinResponse>(p1, SOCKET_EVENTS.CONTROLLER_JOIN_ROOM, { roomId: created.roomId });
    const join2 = await emitAck<ControllerAutoJoinResponse>(p2, SOCKET_EVENTS.CONTROLLER_JOIN_ROOM, { roomId: created.roomId });
    expect(join1.ok).toBe(true);
    expect(join2.ok).toBe(true);
    if (!join1.ok || !join2.ok) return;
    expect(join1.playerNumber).toBe(1);
    expect(join2.playerNumber).toBe(2);
    expect(join1.controllerType).toBe("motion-wheel");
    expect(join1.playerColor).toBe("#22d3ee");
    expect(join2.playerColor).toBe("#f97316");

    host.close();
    p1.close();
    p2.close();
  });

  it("rejects universal QR joins when the room is full", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    const p2 = connect();
    await Promise.all([new Promise<void>((resolve) => p1.on("connect", resolve)), new Promise<void>((resolve) => p2.on("connect", resolve))]);
    const join1 = await emitAck<ControllerAutoJoinResponse>(p1, SOCKET_EVENTS.CONTROLLER_JOIN_ROOM, { roomId: created.roomId });
    expect(join1.ok).toBe(true);
    const join2 = await emitAck<ControllerAutoJoinResponse>(p2, SOCKET_EVENTS.CONTROLLER_JOIN_ROOM, { roomId: created.roomId });
    expect(join2.ok).toBe(false);
    if (!join2.ok) expect(join2.error.code).toBe("room-full");

    host.close();
    p1.close();
    p2.close();
  });

  it("restores the same player slot on universal reconnect without duplicating players", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 2
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    const join1 = await emitAck<ControllerAutoJoinResponse>(p1, SOCKET_EVENTS.CONTROLLER_JOIN_ROOM, { roomId: created.roomId });
    if (!join1.ok) throw new Error("setup failed");

    const p1Again = connect();
    await new Promise<void>((resolve) => p1Again.on("connect", resolve));
    const reconnect = await emitAck<ControllerAutoJoinResponse>(p1Again, SOCKET_EVENTS.CONTROLLER_JOIN_ROOM, {
      roomId: created.roomId,
      controllerToken: join1.controllerToken
    });
    expect(reconnect.ok).toBe(true);
    if (!reconnect.ok) return;
    expect(reconnect.playerNumber).toBe(1);
    const room = getRoom(created.roomId);
    expect(room?.players.filter((p) => p.nickname !== null)).toHaveLength(1);

    host.close();
    p1.close();
    p1Again.close();
  });

  it("rejects universal QR joins for a wrong room code", async () => {
    const phone = connect();
    await new Promise<void>((resolve) => phone.on("connect", resolve));

    const join = await emitAck<ControllerAutoJoinResponse>(phone, SOCKET_EVENTS.CONTROLLER_JOIN_ROOM, { roomId: "NOPE1" });
    expect(join.ok).toBe(false);
    if (!join.ok) expect(join.error.code).toBe("invalid-room");

    phone.close();
  });

  it("creates a room, joins two slots, and only allows start once every slot is ready", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));

    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 2
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    const join1 = await emitAck<ControllerJoinResponse>(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    expect(join1.ok).toBe(true);

    const startEarly = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(startEarly.ok).toBe(false);

    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    const p2 = connect();
    await new Promise<void>((resolve) => p2.on("connect", resolve));
    const join2 = await emitAck<ControllerJoinResponse>(p2, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 2,
      token: created.slots[1]!.token,
      nickname: "Bob"
    });
    expect(join2.ok).toBe(true);
    await emitAck(p2, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);

    host.close();
    p1.close();
    p2.close();
  });

  it("starts Pocket Golf and resends the authoritative golf state on request", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));

    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "pocket-golf",
      maxPlayers: 1
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const phone = connect();
    await new Promise<void>((resolve) => phone.on("connect", resolve));
    const joined = await emitAck<ControllerAutoJoinResponse>(phone, SOCKET_EVENTS.CONTROLLER_JOIN_ROOM, { roomId: created.roomId });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.controllerType).toBe("golf-swing");
    await emitAck(phone, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);

    const statePromise = waitForSocketEvent<GameStatePayload>(phone, SOCKET_EVENTS.GAME_STATE);
    const requested = await emitAck<Record<string, never>>(phone, SOCKET_EVENTS.GOLF_REQUEST_STATE, {});
    expect(requested.ok).toBe(true);
    const state = await statePromise;
    expect(state.gameType).toBe("pocket-golf");
    if (state.gameType === "pocket-golf") {
      expect(state.activePlayerNumber).toBe(1);
      expect(state.players[0]?.displayName).toBe("Player 1");
    }

    host.close();
    phone.close();
  });

  it("rejects a second device claiming an already-connected slot", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");
    const token = created.slots[0]!.token;

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token,
      nickname: "Alice"
    });

    const p2 = connect();
    await new Promise<void>((resolve) => p2.on("connect", resolve));
    const join2 = await emitAck<ControllerJoinResponse>(p2, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token,
      nickname: "Mallory"
    });
    expect(join2.ok).toBe(false);

    host.close();
    p1.close();
    p2.close();
  });

  it("rejects a second game:start while a round is already in progress", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    const firstStart = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(firstStart.ok).toBe(true);

    const secondStart = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(secondStart.ok).toBe(false);
    if (!secondStart.ok) expect(secondStart.error.code).toBe("already-started");

    host.close();
    p1.close();
  });

  it(
    "accepts input held during the countdown so movement starts immediately at go",
    async () => {
      const host = connect();
      await new Promise<void>((resolve) => host.on("connect", resolve));
      const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
        gameType: "controller-test",
        maxPlayers: 1
      });
      if (!created.ok) throw new Error("setup failed");

      const p1 = connect();
      await new Promise<void>((resolve) => p1.on("connect", resolve));
      await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
        roomId: created.roomId,
        playerNumber: 1,
        token: created.slots[0]!.token,
        nickname: "Alice"
      });
      await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

      let roundId: string | null = null;
      host.on(SOCKET_EVENTS.ROOM_STATE, (room: { roundId: string | null }) => {
        if (room.roundId) roundId = room.roundId;
      });

      const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
      expect(started.ok).toBe(true);
      expect(roundId).not.toBeNull();

      // Held during the countdown, well before "go" fires (~4s later).
      p1.emit(SOCKET_EVENTS.INPUT_ACTION, { action: "left-start", sequence: 1, roundId });

      const firstState = await new Promise<{
        gameType: string;
        players: Array<{ playerNumber: number; x: number }>;
      }>((resolve) => {
        host.once(SOCKET_EVENTS.GAME_STATE, resolve);
      });

      expect(firstState.gameType).toBe("controller-test");
      expect(firstState.players[0]!.x).toBeLessThan(400);

      host.close();
      p1.close();
    },
    8000
  );

  it("rejects an invalid token", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    const join = await emitAck<ControllerJoinResponse>(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: "not-the-real-token",
      nickname: "Eve"
    });
    expect(join.ok).toBe(false);

    host.close();
    p1.close();
  });

  it("stores validated racing:input values on the room's racing game state", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    let roundId: string | null = null;
    host.on(SOCKET_EVENTS.ROOM_STATE, (room: { roundId: string | null }) => {
      if (room.roundId) roundId = room.roundId;
    });
    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(roundId).not.toBeNull();

    p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: 0.5, throttle: 0.8, brake: 0, sequence: 1, roundId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const room = getRoom(created.roomId);
    expect(room?.gameState?.gameType).toBe("racing");
    if (room?.gameState?.gameType === "racing") {
      const car = room.gameState.cars.get(1);
      expect(car?.steering).toBe(0.5);
      expect(car?.throttle).toBe(0.8);
    }

    host.close();
    p1.close();
  });

  it("clamps out-of-range racing:input values and rejects stale sequence / wrong roundId", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    let roundId: string | null = null;
    host.on(SOCKET_EVENTS.ROOM_STATE, (room: { roundId: string | null }) => {
      if (room.roundId) roundId = room.roundId;
    });
    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(roundId).not.toBeNull();

    // Out-of-range values must be clamped, not stored raw.
    p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: 2, throttle: -1, brake: 5, sequence: 1, roundId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    let room = getRoom(created.roomId);
    if (room?.gameState?.gameType === "racing") {
      const car = room.gameState.cars.get(1);
      expect(car?.steering).toBe(1);
      expect(car?.throttle).toBe(0);
      expect(car?.brake).toBe(1);
    }

    // A stale/duplicate sequence must be dropped, not overwrite the stored value.
    p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: -0.9, throttle: 0.1, brake: 0, sequence: 1, roundId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    room = getRoom(created.roomId);
    if (room?.gameState?.gameType === "racing") {
      const car = room.gameState.cars.get(1);
      expect(car?.steering).toBe(1); // unchanged from the first, clamped packet
    }

    // A mismatched roundId must be dropped even with a fresh sequence number.
    p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: -0.5, throttle: 0.2, brake: 0, sequence: 2, roundId: "wrong-round" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    room = getRoom(created.roomId);
    if (room?.gameState?.gameType === "racing") {
      const car = room.gameState.cars.get(1);
      expect(car?.steering).toBe(1); // still unchanged
    }

    host.close();
    p1.close();
  });

  it("starts a racing room through countdown to in-progress", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(getRoom(created.roomId)?.physicsInterval).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 4300));
    const room = getRoom(created.roomId);
    expect(room?.status).toBe("in-progress");
    expect(room?.gameState?.gameType).toBe("racing");
    expect(room?.physicsInterval).not.toBeNull();

    host.close();
    p1.close();
  }, 10000);

  it("racing throttle packets after GO increase authoritative speed/progress and emitted state", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    let roundId: string | null = null;
    host.on(SOCKET_EVENTS.ROOM_STATE, (room: { roundId: string | null }) => {
      if (room.roundId) roundId = room.roundId;
    });
    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(roundId).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 4300));
    for (let sequence = 1; sequence <= 12; sequence++) {
      p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: 0, throttle: 1, brake: 0, sequence, roundId });
      await new Promise((resolve) => setTimeout(resolve, 35));
    }

    const payload = await new Promise<{
      gameType: "racing";
      players: Array<{ speed: number; progress: number }>;
    }>((resolve) => host.once(SOCKET_EVENTS.GAME_STATE, resolve));
    const room = getRoom(created.roomId);
    if (room?.gameState?.gameType !== "racing") throw new Error("expected racing game state");
    const car = room.gameState.cars.get(1)!;
    expect(car.speed).toBeGreaterThan(0);
    expect(car.progress).toBeGreaterThan(0);
    expect(payload.players[0]!.speed).toBeGreaterThan(0);
    expect(payload.players[0]!.progress).toBeGreaterThan(0);

    host.close();
    p1.close();
  }, 10000);

  it("racing steering packets after GO change authoritative heading", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    let roundId: string | null = null;
    host.on(SOCKET_EVENTS.ROOM_STATE, (room: { roundId: string | null }) => {
      if (room.roundId) roundId = room.roundId;
    });
    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(roundId).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 4300));
    for (let sequence = 1; sequence <= 16; sequence++) {
      p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: 1, throttle: 1, brake: 0, sequence, roundId });
      await new Promise((resolve) => setTimeout(resolve, 35));
    }

    const room = getRoom(created.roomId);
    if (room?.gameState?.gameType !== "racing") throw new Error("expected racing game state");
    const car = room.gameState.cars.get(1)!;
    expect(car.speed).toBeGreaterThan(0);
    expect(car.headingError).toBeGreaterThan(0);
    expect(car.lateralOffset).toBeGreaterThan(0);

    host.close();
    p1.close();
  }, 10000);

  it("racing rematch creates a fresh sequence window", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    let roundId: string | null = null;
    host.on(SOCKET_EVENTS.ROOM_STATE, (room: { roundId: string | null }) => {
      if (room.roundId) roundId = room.roundId;
    });
    let started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: 0, throttle: 1, brake: 0, sequence: 25, roundId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const ended = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_END, {});
    expect(ended.ok).toBe(true);

    roundId = null;
    started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(roundId).not.toBeNull();
    p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: 0.25, throttle: 0.5, brake: 0, sequence: 1, roundId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const room = getRoom(created.roomId);
    if (room?.gameState?.gameType !== "racing") throw new Error("expected racing game state");
    const car = room.gameState.cars.get(1)!;
    expect(car.lastSequence).toBe(1);
    expect(car.throttle).toBe(0.5);

    host.close();
    p1.close();
  }, 10000);

  it("resets racing input when a controller disconnects", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    let roundId: string | null = null;
    host.on(SOCKET_EVENTS.ROOM_STATE, (room: { roundId: string | null }) => {
      if (room.roundId) roundId = room.roundId;
    });
    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(roundId).not.toBeNull();

    p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: 0.7, throttle: 1, brake: 0.2, sequence: 1, roundId });
    await new Promise((resolve) => setTimeout(resolve, 50));
    p1.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const room = getRoom(created.roomId);
    if (room?.gameState?.gameType !== "racing") throw new Error("expected racing game state");
    const car = room.gameState.cars.get(1)!;
    expect(car.steering).toBe(0);
    expect(car.throttle).toBe(0);
    expect(car.brake).toBe(0);

    host.close();
  });

  it("stops racing physics and clears all racing inputs when the host disconnects", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    let roundId: string | null = null;
    host.on(SOCKET_EVENTS.ROOM_STATE, (room: { roundId: string | null }) => {
      if (room.roundId) roundId = room.roundId;
    });
    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(roundId).not.toBeNull();
    p1.emit(SOCKET_EVENTS.RACING_INPUT, { steering: 1, throttle: 1, brake: 0, sequence: 1, roundId });

    await new Promise((resolve) => setTimeout(resolve, 4300));
    expect(getRoom(created.roomId)?.physicsInterval).not.toBeNull();
    host.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const room = getRoom(created.roomId);
    expect(room?.status).toBe("host-disconnected");
    expect(room?.physicsInterval).toBeNull();
    if (room?.gameState?.gameType !== "racing") throw new Error("expected racing game state");
    const car = room.gameState.cars.get(1)!;
    expect(car.steering).toBe(0);
    expect(car.throttle).toBe(0);
    expect(car.brake).toBe(0);

    p1.close();
  }, 9000);

  it("game:end stops racing from results and returns the room to lobby without destroying it", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "racing",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    const activeRoom = getRoom(created.roomId);
    if (!activeRoom) throw new Error("expected active room");
    activeRoom.status = "results";

    const ended = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_END, {});
    expect(ended.ok).toBe(true);

    const room = getRoom(created.roomId);
    expect(room).toBeDefined();
    expect(room?.status).toBe("lobby");
    expect(room?.roundId).toBeNull();
    expect(room?.gameState).toBeNull();
    expect(room?.physicsInterval).toBeNull();
    expect(room?.players[0]!.ready).toBe(true);

    host.close();
    p1.close();
  });

  it("game:end still cleans up Controller Test rounds", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise<void>((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token: created.slots[0]!.token,
      nickname: "Alice"
    });
    await emitAck(p1, SOCKET_EVENTS.PLAYER_READY, { ready: true });

    const started = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_START, {});
    expect(started.ok).toBe(true);
    expect(getRoom(created.roomId)?.gameState?.gameType).toBe("controller-test");

    const ended = await emitAck<Record<string, never>>(host, SOCKET_EVENTS.GAME_END, {});
    expect(ended.ok).toBe(true);
    const room = getRoom(created.roomId);
    expect(room?.status).toBe("lobby");
    expect(room?.gameState).toBeNull();
    expect(room?.physicsInterval).toBeNull();

    host.close();
    p1.close();
  });
});
