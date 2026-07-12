import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { registerSocketHandlers } from "./socketHandlers";
import { SOCKET_EVENTS } from "../shared/protocol";
import type { Ack, ControllerJoinResponse, CreateRoomResponse } from "../shared/protocol";

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

function tokenFromJoinUrl(joinUrl: string): string {
  return new URL(joinUrl).searchParams.get("token")!;
}

describe("room lifecycle", () => {
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
      token: tokenFromJoinUrl(created.slots[0]!.joinUrl),
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
      token: tokenFromJoinUrl(created.slots[1]!.joinUrl),
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

  it("rejects a second device claiming an already-connected slot", async () => {
    const host = connect();
    await new Promise<void>((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");
    const token = tokenFromJoinUrl(created.slots[0]!.joinUrl);

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
});
