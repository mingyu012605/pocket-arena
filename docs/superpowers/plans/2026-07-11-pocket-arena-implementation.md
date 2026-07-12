# Pocket Arena v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working version of Pocket Arena — a dark, polished landing/host/join web flow plus one playable minigame (Controller Test) proving out the host-authoritative, phone-as-controller networking model described in the design spec.

**Architecture:** A single Node/Express/Socket.IO process serves both the Vite-built client and the game server on one port (LAN-reachable on `0.0.0.0`). The server is authoritative: it owns room state, player identity (bound to `socket.data.session` after token validation), and Controller Test physics; phones only ever send input events, the laptop only ever renders server-pushed state.

**Tech Stack:** Vite, TypeScript (strict), Express, Socket.IO v4, `qrcode`, `esbuild` (server bundling), `tsx` (dev), `vitest` (server-side unit/integration tests). No framework on the client — vanilla TS/DOM. No database.

**Source spec:** `docs/superpowers/specs/2026-07-11-pocket-arena-design.md` — every task below implements a specific section of that document; section references (`§N`) point back to it.

## Global Constraints

- No database or persistent accounts; all room state lives in server memory (spec §1, §4).
- No HTTPS in v1 — button input only; controller input is structured behind `client/src/controller/inputs/` so a secure-context input source can be added later without touching room/game plumbing (spec §1, §9).
- Single HTTP port for everything in dev and prod; server listens on `0.0.0.0` (spec §2).
- `PUBLIC_BASE_URL` env var overrides LAN-IP auto-detection for QR codes; falls back to detected LAN IPv4, then `localhost` (spec §2).
- Vite is imported dynamically only inside the non-production branch of `server/index.ts` — never a static top-level import (spec §2).
- `"type": "module"` in `package.json`; server production bundle is `esbuild --platform=node --format=esm --packages=external` (spec §2).
- Tokens are used only for `controller:join`/reclaim and `host:reconnect`; every other gameplay event derives identity from `socket.data.session`, never from the payload (spec §5).
- `room:state` is always a `PublicRoomState` — host tokens, player tokens, socket IDs, and timer/interval handles must never be serialized to a client (spec §4).
- Room codes are 5 characters, uppercase, excluding `0/O/1/I`, collision-checked against the in-memory room map; tokens are `randomBytes(32).toString("base64url")` via `node:crypto` (spec §5).
- Only Controller Test is playable; all other game cards are inert "Coming Soon" placeholders — do not build real game logic for them.
- Every page/game-view render function returns a cleanup function that removes DOM listeners, cancels `requestAnimationFrame` loops, and detaches Socket.IO listeners (spec §9).

---

### Task 1: Project Scaffolding and Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.client.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `server/network.ts`
- Create: `server/index.ts`
- Create: `client/index.html`
- Create: `client/src/main.ts`
- Create: `README.md`

**Interfaces:**
- Produces: `resolveUrls(port: number): { localUrl: string; lanUrl: string | null; publicUrl: string }` from `server/network.ts` — consumed by `server/index.ts` (this task) and later by `server/socketHandlers.ts` (Task 4) to build QR join URLs.
- Produces: an npm script surface (`dev`, `build`, `build:client`, `build:server`, `start`, `typecheck`, `test`) that every later task's verification step relies on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pocket-arena",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch server/index.ts",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server/index.js",
    "start": "node dist/server/index.js",
    "typecheck": "tsc -p tsconfig.client.json --noEmit && tsc -p tsconfig.server.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.21.2",
    "qrcode": "^1.5.4",
    "socket.io": "^4.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.5",
    "@types/qrcode": "^1.5.5",
    "esbuild": "^0.24.2",
    "socket.io-client": "^4.8.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vite": "^6.0.7",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` (shared base)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 3: Create `tsconfig.client.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": [],
    "noEmit": true
  },
  "include": ["client/src", "shared"]
}
```

- [ ] **Step 4: Create `tsconfig.server.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "noEmit": true
  },
  "include": ["server", "shared"]
}
```

- [ ] **Step 5: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: {
    outDir: "../dist/client",
    emptyOutDir: true
  }
});
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"]
  }
});
```

- [ ] **Step 7: Create `.gitignore`**

```text
node_modules/
dist/
.env
.env.local
*.log
```

- [ ] **Step 8: Create `server/network.ts`**

```ts
import { networkInterfaces } from "node:os";

export interface ResolvedUrls {
  localUrl: string;
  lanUrl: string | null;
  publicUrl: string;
}

export function detectLanAddress(): string | null {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

export function resolveUrls(port: number): ResolvedUrls {
  const localUrl = `http://localhost:${port}`;
  const lanAddress = detectLanAddress();
  const lanUrl = lanAddress ? `http://${lanAddress}:${port}` : null;
  const override = process.env.PUBLIC_BASE_URL?.trim();
  const publicUrl = override && override.length > 0 ? override.replace(/\/$/, "") : (lanUrl ?? localUrl);
  return { localUrl, lanUrl, publicUrl };
}
```

- [ ] **Step 9: Create `server/index.ts`**

```ts
import express from "express";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import { resolveUrls } from "./network";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    console.log(`socket connected: ${socket.id}`);
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom"
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const indexPath = path.resolve(process.cwd(), "client/index.html");
        let template = await fs.readFile(indexPath, "utf-8");
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (err) {
        next(err as Error);
      }
    });
  } else {
    const clientDist = path.resolve(process.cwd(), "dist/client");
    app.use(express.static(clientDist));
    app.get(/^(?!\/socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  httpServer.listen(port, "0.0.0.0", () => {
    const { localUrl, lanUrl, publicUrl } = resolveUrls(port);
    console.log(`Local:    ${localUrl}`);
    console.log(`Network:  ${lanUrl ?? "(no LAN address detected)"}`);
    console.log(`QR codes will use: ${publicUrl}`);
  });
}

main();
```

- [ ] **Step 10: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>Pocket Arena</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 11: Create `client/src/main.ts`**

```ts
const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.textContent = "Pocket Arena — booting…";
}
```

- [ ] **Step 12: Create `README.md`**

```markdown
# Pocket Arena

Turn every phone into a game controller. One laptop hosts the shared screen;
players join by scanning a QR code with their phones.

## Install

npm install

## Run (development)

npm run dev

This starts a single server on http://localhost:3000 that serves the
website and the Socket.IO game server together, with hot reload. On
startup the terminal prints two URLs:

Local:    http://localhost:3000
Network:  http://<your-lan-ip>:3000

Open the **Local** URL on the laptop that will host the game.

## Join from a phone on the same Wi-Fi

Phones do not type a URL — they scan the QR codes shown in the host lobby,
which are already generated against the printed **Network** URL. If you
need to override the address used for QR codes (e.g. a reverse proxy or a
non-standard network setup), set `PUBLIC_BASE_URL` before starting the
server:

PUBLIC_BASE_URL=http://192.168.1.50:3000 npm run dev

Both the laptop and the phones must be on the same Wi-Fi network, and any
firewall must allow inbound connections on the chosen port (3000 by
default).

## Build and run (production)

npm run build
npm start

`npm run build` compiles the client with Vite and bundles the server with
esbuild into `dist/`. `npm start` runs the production server the same way
`npm run dev` runs the development one — one process, one port.

## Type-checking and tests

npm run typecheck
npm test
```

- [ ] **Step 13: Install dependencies**

Run: `npm install`
Expected: installs cleanly, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 14: Verify dev server boots and prints URLs**

Run: `npm run dev`
Expected terminal output includes lines starting with `Local:`, `Network:`, and `QR codes will use:`. Open the printed Local URL in a browser — the page shows the text "Pocket Arena — booting…". Stop the server (Ctrl+C) before continuing.

- [ ] **Step 15: Verify type-checking passes**

Run: `npm run typecheck`
Expected: no errors (only `server/index.ts`, `server/network.ts`, `client/src/main.ts` exist so far).

- [ ] **Step 16: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.client.json tsconfig.server.json vite.config.ts vitest.config.ts .gitignore server/network.ts server/index.ts client/index.html client/src/main.ts README.md
git commit -m "Scaffold Pocket Arena: single-port Express+Vite+Socket.IO dev/prod setup"
```

---

### Task 2: Shared Protocol and Types

**Files:**
- Create: `shared/protocol.ts`
- Test: `shared/protocol.test.ts`

**Interfaces:**
- Consumes: nothing (this is the foundational shared module).
- Produces: `GameType`, `RoomStatus`, `PublicPlayer`, `PublicRoomState`, `ControllerAction`, `ErrorPayload`, `Ack<T>`, every request/response payload interface, `SOCKET_EVENTS`, `PLAYER_COLORS`, `MIN_PLAYERS`/`MAX_PLAYERS`, and `ARENA` — every later server and client task imports from this file by exact name.

- [ ] **Step 1: Create `shared/protocol.ts`**

```ts
export type GameType =
  | "controller-test"
  | "rhythm-battle"
  | "table-tennis"
  | "bowling"
  | "tennis"
  | "racing";

export type RoomStatus =
  | "lobby"
  | "countdown"
  | "in-progress"
  | "host-disconnected"
  | "results";

export const PLAYER_COLORS = ["#22d3ee", "#a855f7", "#fbbf24", "#34d399"] as const;

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;

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
    | "not-host"
    | "not-ready";
  message: string;
}

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: ErrorPayload };

export interface CreateRoomRequest {
  gameType: GameType;
  maxPlayers: number;
}
export interface CreateRoomSlot {
  playerNumber: number;
  joinUrl: string;
  qrDataUrl: string;
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

export interface PlayerReadyRequest {
  ready: boolean;
}

export interface InputActionPayload {
  action: ControllerAction;
  sequence: number;
  roundId: string;
}

export interface CountdownTickPayload {
  value: 3 | 2 | 1 | "go";
  roundId: string;
}

export interface GameStatePlayer {
  playerNumber: number;
  x: number;
  y: number;
}
export interface GameStatePayload {
  roundId: string;
  players: GameStatePlayer[];
}

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
  CONTROLLER_LEAVE: "controller:leave",
  PLAYER_READY: "player:ready",
  GAME_START: "game:start",
  GAME_END: "game:end",
  INPUT_ACTION: "input:action",
  ROOM_STATE: "room:state",
  ROOM_CLOSED: "room:closed",
  PLAYER_DISCONNECTED: "player:disconnected",
  PLAYER_RECONNECTED: "player:reconnected",
  GAME_COUNTDOWN_TICK: "game:countdown-tick",
  GAME_STATE: "game:state"
} as const;
```

- [ ] **Step 2: Create `shared/protocol.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { SOCKET_EVENTS, PLAYER_COLORS, MIN_PLAYERS, MAX_PLAYERS } from "./protocol";

describe("protocol constants", () => {
  it("has no duplicate socket event names", () => {
    const values = Object.values(SOCKET_EVENTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("has enough player colors for the maximum player count", () => {
    expect(PLAYER_COLORS.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
  });

  it("has a sane min/max player range", () => {
    expect(MIN_PLAYERS).toBeGreaterThanOrEqual(1);
    expect(MAX_PLAYERS).toBeGreaterThanOrEqual(MIN_PLAYERS);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run shared/protocol.test.ts`
Expected: 3 passed.

- [ ] **Step 4: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.ts shared/protocol.test.ts
git commit -m "Add shared Socket.IO protocol types and event names"
```

---

### Task 3: Room Storage and Token Generation

**Files:**
- Create: `server/types.ts`
- Create: `server/rooms.ts`
- Test: `server/rooms.test.ts`

**Interfaces:**
- Consumes: `GameType`, `RoomStatus`, `PublicPlayer`, `PublicRoomState`, `PLAYER_COLORS`, `ARENA` from `shared/protocol.ts` (Task 2).
- Produces: `InternalRoom`, `InternalPlayer`, `PlayerPhysics`, `SocketSession` types from `server/types.ts`; `createToken()`, `generateRoomCode()`, `createRoom(gameType, maxPlayers)`, `getRoom(roomId)`, `deleteRoom(roomId)`, `findPlayer(room, playerNumber)`, `toPublicRoomState(room)`, `clearRoomTimers(room)`, `teardownRoom(roomId)`, `allSlotsReady(room)`, `roomChannel(roomId)`, `HOST_GRACE_MS` from `server/rooms.ts` — consumed by `server/socketHandlers.ts` (Task 4) and `server/games/controllerTest.ts` (Task 8).

- [ ] **Step 1: Create `server/types.ts`**

```ts
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

// socket.io's `Socket.data` is typed via a generic parameter that defaults to
// `any`; declaration-merging into `Socket`/`SocketData` directly either fails
// to compile (conflicts with the generic) or silently stays `any`. Verified
// empirically: parameterizing the generic directly is the only approach that
// actually narrows `socket.data.session` at compile time.
export type AppSocket = Socket<any, any, any, { session?: SocketSession }>;
```

**Amendment (applied during implementation, see commit `4fc9815`):** the code above supersedes an earlier draft of this file that tried `declare module "socket.io" { interface Socket { data: {...} } }`, which fails to compile against socket.io 4.8.1 (`TS2717: Subsequent property declarations must have the same type`). A follow-up attempt to augment a `SocketData` interface compiled, but only because `Socket`'s `SocketData` generic defaults to `any` — it added no real type safety. The `AppSocket` type alias above is the verified-working fix: every later task that handles a connected socket (Task 4, and any future task adding new socket handlers) must type that parameter as `AppSocket` (imported from `./types`), not the bare `Socket` type from `socket.io`.

- [ ] **Step 2: Create `server/rooms.ts`**

```ts
import { randomBytes } from "node:crypto";
import { ARENA, PLAYER_COLORS } from "../shared/protocol";
import type { GameType, PublicPlayer, PublicRoomState } from "../shared/protocol";
import type { InternalPlayer, InternalRoom } from "./types";

const ROOM_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 5;
export const HOST_GRACE_MS = 10 * 60 * 1000;

const rooms = new Map<string, InternalRoom>();

export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

function generateRoomCodeCandidate(): string {
  let code = "";
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[(bytes[i] ?? 0) % ROOM_CODE_CHARS.length];
  }
  return code;
}

export function generateRoomCode(): string {
  let code: string;
  do {
    code = generateRoomCodeCandidate();
  } while (rooms.has(code));
  return code;
}

function createPlayer(playerNumber: number): InternalPlayer {
  return {
    playerNumber,
    token: createToken(),
    nickname: null,
    color: PLAYER_COLORS[(playerNumber - 1) % PLAYER_COLORS.length] ?? "#22d3ee",
    socketId: null,
    connected: false,
    ready: false,
    lastSequence: -1,
    physics: { x: ARENA.width / 2, y: ARENA.groundY, vy: 0, grounded: true, direction: 0 }
  };
}

export function createRoom(gameType: GameType, maxPlayers: number): InternalRoom {
  const id = generateRoomCode();
  const players: InternalPlayer[] = [];
  for (let i = 1; i <= maxPlayers; i++) players.push(createPlayer(i));

  const room: InternalRoom = {
    id,
    gameType,
    maxPlayers,
    hostToken: createToken(),
    hostSocketId: null,
    status: "lobby",
    statusBeforeHostDisconnect: null,
    roundId: null,
    countdownEndsAt: null,
    players,
    createdAt: Date.now(),
    hostGraceTimer: null,
    countdownTimer: null,
    physicsInterval: null
  };
  rooms.set(id, room);
  return room;
}

export function getRoom(roomId: string): InternalRoom | undefined {
  return rooms.get(roomId);
}

export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
}

export function findPlayer(room: InternalRoom, playerNumber: number): InternalPlayer | undefined {
  return room.players.find((p) => p.playerNumber === playerNumber);
}

export function toPublicRoomState(room: InternalRoom): PublicRoomState {
  const players: PublicPlayer[] = room.players.map((p) => ({
    playerNumber: p.playerNumber,
    nickname: p.nickname,
    color: p.color,
    connected: p.connected,
    ready: p.ready
  }));
  return {
    id: room.id,
    gameType: room.gameType,
    maxPlayers: room.maxPlayers,
    status: room.status,
    roundId: room.roundId,
    countdownEndsAt: room.countdownEndsAt,
    players
  };
}

export function clearRoomTimers(room: InternalRoom): void {
  if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  if (room.physicsInterval) clearInterval(room.physicsInterval);
  room.hostGraceTimer = null;
  room.countdownTimer = null;
  room.physicsInterval = null;
}

export function teardownRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  clearRoomTimers(room);
  deleteRoom(roomId);
}

export function allSlotsReady(room: InternalRoom): boolean {
  return room.players.length === room.maxPlayers && room.players.every((p) => p.connected && p.ready);
}

export function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}
```

- [ ] **Step 3: Create `server/rooms.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createRoom, createToken, generateRoomCode, toPublicRoomState, allSlotsReady, findPlayer } from "./rooms";

describe("generateRoomCode", () => {
  it("produces a 5-character uppercase code excluding ambiguous characters", () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(5);
    expect(code).toMatch(/^[A-Z2-9]+$/);
    expect(code).not.toMatch(/[01OI]/);
  });

  it("produces distinct codes across many calls", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("createToken", () => {
  it("produces long, distinct secrets", () => {
    const a = createToken();
    const b = createToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(32);
  });
});

describe("createRoom", () => {
  it("creates one player slot per maxPlayers, each with a unique token", () => {
    const room = createRoom("controller-test", 3);
    expect(room.players).toHaveLength(3);
    const tokens = new Set(room.players.map((p) => p.token));
    expect(tokens.size).toBe(3);
    expect(room.status).toBe("lobby");
  });
});

describe("toPublicRoomState", () => {
  it("never exposes secrets or internal handles", () => {
    const room = createRoom("controller-test", 2);
    const publicState = toPublicRoomState(room);
    const serialized = JSON.stringify(publicState);
    expect(serialized).not.toContain(room.hostToken);
    for (const player of room.players) {
      expect(serialized).not.toContain(player.token);
    }
    expect(publicState).not.toHaveProperty("hostToken");
    expect(publicState).not.toHaveProperty("hostSocketId");
  });
});

describe("allSlotsReady", () => {
  it("is false until every slot is connected and ready", () => {
    const room = createRoom("controller-test", 2);
    expect(allSlotsReady(room)).toBe(false);
    const p1 = findPlayer(room, 1)!;
    p1.connected = true;
    p1.ready = true;
    expect(allSlotsReady(room)).toBe(false);
    const p2 = findPlayer(room, 2)!;
    p2.connected = true;
    p2.ready = true;
    expect(allSlotsReady(room)).toBe(true);
  });

  it("is false if a slot disconnects after being ready", () => {
    const room = createRoom("controller-test", 1);
    const p1 = findPlayer(room, 1)!;
    p1.connected = true;
    p1.ready = true;
    expect(allSlotsReady(room)).toBe(true);
    p1.connected = false;
    expect(allSlotsReady(room)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/rooms.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/types.ts server/rooms.ts server/rooms.test.ts
git commit -m "Add in-memory room store with token generation and public-state projection"
```

---

### Task 4: Socket.IO Lifecycle Handlers

**Files:**
- Create: `server/qr.ts`
- Create: `server/socketHandlers.ts`
- Test: `server/socketHandlers.test.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: everything from `shared/protocol.ts` (Task 2) and `server/rooms.ts`/`server/types.ts` (Task 3); `resolveUrls` from `server/network.ts` (Task 1).
- Produces: `buildSlotQrData(room, baseUrl): Promise<CreateRoomSlot[]>` from `server/qr.ts`; `registerSocketHandlers(io: Server, port: number): void` from `server/socketHandlers.ts` — consumed by `server/index.ts` (this task) and extended by `server/games/controllerTest.ts` (Task 8, which the handler file will import from).
- Note: this task implements full room/session lifecycle and a working countdown, but Controller Test movement physics does not exist yet — `input:action` validates and stores intent on `player.physics`, but nothing integrates or broadcasts positions until Task 8 adds the physics tick loop. This is intentional layering, not a placeholder.

- [ ] **Step 1: Create `server/qr.ts`**

```ts
import QRCode from "qrcode";
import type { CreateRoomSlot } from "../shared/protocol";
import type { InternalRoom } from "./types";

export async function buildSlotQrData(room: InternalRoom, baseUrl: string): Promise<CreateRoomSlot[]> {
  const slots: CreateRoomSlot[] = [];
  for (const player of room.players) {
    const joinUrl = `${baseUrl}/join/${room.id}/${player.playerNumber}?token=${player.token}`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 256 });
    slots.push({ playerNumber: player.playerNumber, joinUrl, qrDataUrl });
  }
  return slots;
}
```

- [ ] **Step 2: Create `server/socketHandlers.ts`**

```ts
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
  if (room.physicsInterval) clearInterval(room.physicsInterval);
  room.physicsInterval = null;
  room.status = "lobby";
  room.roundId = null;
  room.countdownEndsAt = null;
  for (const player of room.players) player.physics.direction = 0;
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
      ack({ ok: true });
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
      ack({ ok: true });
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
      ack({ ok: true });
    });

    socket.on(SOCKET_EVENTS.GAME_START, (_payload: unknown, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "host") return ack(errorAck("not-host", "Only the host can start the game."));
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      if (!allSlotsReady(room)) {
        return ack(errorAck("not-ready", "Every player slot must be connected and ready."));
      }
      room.roundId = createToken();
      room.status = "countdown";
      room.countdownEndsAt = Date.now() + 3000;
      broadcastRoomState(io, room);
      runCountdown(io, room);
      ack({ ok: true });
    });

    socket.on(SOCKET_EVENTS.GAME_END, (_payload: unknown, ack: (res: Ack<Record<string, never>>) => void) => {
      const session = socket.data.session;
      if (!session || session.role !== "host") return ack(errorAck("not-host", "Only the host can end the game."));
      const room = getRoom(session.roomId);
      if (!room) return ack(errorAck("invalid-room", "Room no longer exists."));
      endRound(room);
      broadcastRoomState(io, room);
      ack({ ok: true });
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
        room.hostSocketId = null;
        room.statusBeforeHostDisconnect = room.status;
        if (room.countdownTimer) {
          clearTimeout(room.countdownTimer);
          room.countdownTimer = null;
        }
        if (room.physicsInterval) {
          clearInterval(room.physicsInterval);
          room.physicsInterval = null;
        }
        room.status = "host-disconnected";
        for (const player of room.players) player.physics.direction = 0;
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
          player.physics.direction = 0;
          io.to(roomChannel(room.id)).emit(SOCKET_EVENTS.PLAYER_DISCONNECTED, { playerNumber: player.playerNumber });
          broadcastRoomState(io, room);
        }
      }
    });
  });
}

export { clearRoomTimers };
```

- [ ] **Step 3: Modify `server/index.ts`** — replace the stub connection handler with real socket wiring

Replace:

```ts
  io.on("connection", (socket) => {
    console.log(`socket connected: ${socket.id}`);
  });
```

with:

```ts
  registerSocketHandlers(io, port);
```

and add the import at the top of the file:

```ts
import { registerSocketHandlers } from "./socketHandlers";
```

- [ ] **Step 4: Create `server/socketHandlers.test.ts`**

```ts
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
    await new Promise((resolve) => host.on("connect", resolve));

    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 2
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const p1 = connect();
    await new Promise((resolve) => p1.on("connect", resolve));
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
    await new Promise((resolve) => p2.on("connect", resolve));
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
    await new Promise((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");
    const token = tokenFromJoinUrl(created.slots[0]!.joinUrl);

    const p1 = connect();
    await new Promise((resolve) => p1.on("connect", resolve));
    await emitAck(p1, SOCKET_EVENTS.CONTROLLER_JOIN, {
      roomId: created.roomId,
      playerNumber: 1,
      token,
      nickname: "Alice"
    });

    const p2 = connect();
    await new Promise((resolve) => p2.on("connect", resolve));
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
    await new Promise((resolve) => host.on("connect", resolve));
    const created = await emitAck<CreateRoomResponse>(host, SOCKET_EVENTS.HOST_CREATE_ROOM, {
      gameType: "controller-test",
      maxPlayers: 1
    });
    if (!created.ok) throw new Error("setup failed");

    const p1 = connect();
    await new Promise((resolve) => p1.on("connect", resolve));
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
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run server/socketHandlers.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev`, open the printed Local URL in two browser tabs. This step has no UI yet (Task 5+), so verification is via the automated tests above plus confirming the dev server still boots without errors and prints the URL banner.

- [ ] **Step 8: Commit**

```bash
git add server/qr.ts server/socketHandlers.ts server/socketHandlers.test.ts server/index.ts
git commit -m "Implement Socket.IO room lifecycle: create/join/ready/start/end, host-disconnect pause, cleanup"
```

---

### Task 5: Client Router and Common UI

**Files:**
- Create: `client/src/networking/socket.ts`
- Create: `client/src/networking/router.ts`
- Create: `client/src/components/button.ts`
- Create: `client/src/styles/global.css`
- Create: `client/src/styles/components.css`
- Create: `client/src/pages/landing.ts`
- Modify: `client/src/main.ts`

**Interfaces:**
- Consumes: `SOCKET_EVENTS` and payload types from `shared/protocol.ts` (Task 2) are available to later pages via `getSocket()`/`emitWithAck()`.
- Produces: `getSocket(): Socket`, `emitWithAck<TResponse>(event, payload): Promise<TResponse>` from `client/src/networking/socket.ts`; `CleanupFn`, `RouteContext`, `RouteHandler`, `registerRoute(path, handler)`, `navigate(path)`, `startRouter(root)` from `client/src/networking/router.ts`; `createButton(options): HTMLButtonElement` from `client/src/components/button.ts` — every later page task depends on these exact names.

- [ ] **Step 1: Create `client/src/networking/socket.ts`**

```ts
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ transports: ["websocket"], autoConnect: true });
  }
  return socket;
}

export function emitWithAck<TResponse>(event: string, payload: unknown): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    getSocket().emit(event, payload, (response: TResponse) => {
      if (response && typeof response === "object" && "ok" in response && (response as { ok: boolean }).ok === false) {
        reject((response as { error: { message: string } }).error);
      } else {
        resolve(response);
      }
    });
  });
}
```

- [ ] **Step 2: Create `client/src/networking/router.ts`**

```ts
export type CleanupFn = () => void;

export interface RouteContext {
  container: HTMLElement;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type RouteHandler = (ctx: RouteContext) => CleanupFn | void;

interface Route {
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];
let activeCleanup: CleanupFn | null = null;
let container: HTMLElement | null = null;

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const pattern = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "/([^/]+)";
      }
      return segment ? `/${segment}` : "";
    })
    .join("");
  return { pattern: new RegExp(`^${pattern || "/"}$`), keys };
}

export function registerRoute(path: string, handler: RouteHandler): void {
  const { pattern, keys } = compile(path);
  routes.push({ pattern, keys, handler });
}

function render(): void {
  if (!container) return;
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  const url = new URL(window.location.href);
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, i) => {
      const value = match[i + 1];
      if (value !== undefined) params[key] = value;
    });
    container.innerHTML = "";
    const cleanup = route.handler({ container, params, query: url.searchParams });
    activeCleanup = cleanup ?? null;
    return;
  }
  container.innerHTML = `<div class="page-section centered"><h1>Page Not Found</h1><a href="/" data-link>Back to Pocket Arena</a></div>`;
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  render();
}

export function startRouter(rootElement: HTMLElement): void {
  container = rootElement;
  window.addEventListener("popstate", render);
  document.addEventListener("click", (event) => {
    const anchor = (event.target as HTMLElement).closest("a[data-link]");
    if (anchor instanceof HTMLAnchorElement) {
      event.preventDefault();
      navigate(anchor.getAttribute("href") ?? "/");
    }
  });
  render();
}
```

**Amendment (applied during implementation, see commit in Task 5's ledger entry):** the code above supersedes an earlier draft that built the root path's regex as `new RegExp(`^${pattern}$`)` with no fallback. For `path === "/"`, `"/".split("/")` yields `["", ""]`, both segments map to the empty string, and the joined pattern is `""` — producing `/^$/`, which never matches `window.location.pathname === "/"`. The `pattern || "/"` fallback above is the fix, verified empirically (`/^\/$/.test("/") === true`). The same amendment also moves the `activeCleanup()` call to the top of `render()`, unconditionally, so the "no route matched" fallback path also tears down the previous route's listeners/loops instead of only doing so on a successful match — required by the plan's own cleanup-function guarantee (spec §9).

- [ ] **Step 3: Create `client/src/components/button.ts`**

```ts
export interface ButtonOptions {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  onClick?: () => void;
}

export function createButton(options: ButtonOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `btn btn-${options.variant ?? "primary"}`;
  button.textContent = options.label;
  button.disabled = Boolean(options.disabled);
  if (options.onClick) button.addEventListener("click", options.onClick);
  return button;
}
```

- [ ] **Step 4: Create `client/src/styles/global.css`**

```css
:root {
  --color-bg: #05070f;
  --color-surface: #11162a;
  --color-border: #232a45;
  --color-text: #e8ecf9;
  --color-text-dim: #8b93b8;
  --color-blue: #3b82f6;
  --color-purple: #a855f7;
  --color-cyan: #22d3ee;
  --shadow-glow: 0 0 24px rgba(59, 130, 246, 0.35);
  --radius-lg: 20px;
  --radius-md: 12px;
  --font-body: "Inter", system-ui, -apple-system, sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: radial-gradient(circle at top, #0c1224 0%, var(--color-bg) 60%);
  color: var(--color-text);
  font-family: var(--font-body);
  -webkit-tap-highlight-color: transparent;
}

#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

h1,
h2,
h3 {
  margin: 0 0 0.5em;
  font-weight: 700;
  letter-spacing: -0.02em;
}

a {
  color: var(--color-cyan);
}

.glow-text {
  background: linear-gradient(90deg, var(--color-cyan), var(--color-purple));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.eyebrow {
  letter-spacing: 0.3em;
  color: var(--color-text-dim);
  font-size: 0.8rem;
}

.page-section {
  max-width: 1000px;
  margin: 0 auto;
  padding: 3rem 1.5rem;
  width: 100%;
}

.page-section.centered {
  text-align: center;
  max-width: 480px;
  padding-top: 4rem;
}

.error-text {
  color: #ef4444;
  margin-top: 0.75rem;
}
```

- [ ] **Step 5: Create `client/src/styles/components.css`**

```css
.btn {
  font-family: inherit;
  font-size: 1.05rem;
  font-weight: 600;
  padding: 0.9rem 1.75rem;
  border-radius: 999px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.btn:active {
  transform: scale(0.97);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

.btn-primary {
  background: linear-gradient(135deg, var(--color-blue), var(--color-purple));
  color: white;
  box-shadow: var(--shadow-glow);
}
.btn-primary:hover:not(:disabled) {
  box-shadow: 0 0 32px rgba(168, 85, 247, 0.5);
}

.btn-secondary {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text);
}
.btn-secondary:hover:not(:disabled) {
  border-color: var(--color-cyan);
}

.btn-danger {
  background: transparent;
  border-color: #ef4444;
  color: #ef4444;
}

.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
}

.hero {
  max-width: 720px;
  margin: 0 auto;
  padding: 4rem 1.5rem 2rem;
  text-align: center;
}
.hero-title {
  font-size: clamp(2rem, 6vw, 3.5rem);
  line-height: 1.05;
}
.hero-copy {
  color: var(--color-text-dim);
  font-size: 1.1rem;
  margin: 1rem 0 2rem;
}
.hero-actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}

.how-it-works {
  max-width: 900px;
  margin: 3rem auto;
  padding: 0 1.5rem 3rem;
}
.steps {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.step-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1rem 1.25rem;
}
.step-index {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-cyan), var(--color-blue));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #05070f;
  flex-shrink: 0;
}
```

- [ ] **Step 6: Create `client/src/pages/landing.ts`**

```ts
import { createButton } from "../components/button";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";

const STEPS = [
  "Open Pocket Arena on a laptop",
  "Choose a game",
  "Friends scan the QR code",
  "Phones become controllers",
  "Start playing"
];

export function renderLandingPage({ container }: RouteContext): CleanupFn | void {
  container.innerHTML = `
    <section class="hero">
      <p class="eyebrow">POCKET ARENA</p>
      <h1 class="hero-title">Turn Every Phone Into a <span class="glow-text">Controller</span></h1>
      <p class="hero-copy">
        One laptop hosts the shared screen. Friends scan a QR code with their phones
        to join instantly as controllers — no apps, no accounts.
      </p>
      <div class="hero-actions" id="hero-actions"></div>
    </section>
    <section class="how-it-works" id="how-it-works">
      <h2>How It Works</h2>
      <ol class="steps"></ol>
    </section>
  `;

  const actions = container.querySelector<HTMLDivElement>("#hero-actions")!;
  actions.appendChild(createButton({ label: "Host a Game", variant: "primary", onClick: () => navigate("/host") }));
  actions.appendChild(
    createButton({
      label: "How It Works",
      variant: "secondary",
      onClick: () => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })
    })
  );

  const list = container.querySelector<HTMLOListElement>(".steps")!;
  STEPS.forEach((step, index) => {
    const li = document.createElement("li");
    li.className = "step-card";
    li.innerHTML = `<span class="step-index">${index + 1}</span><span>${step}</span>`;
    list.appendChild(li);
  });
}
```

- [ ] **Step 7: Modify `client/src/main.ts`** — replace its contents entirely

```ts
import "./styles/global.css";
import "./styles/components.css";
import { registerRoute, startRouter } from "./networking/router";
import { renderLandingPage } from "./pages/landing";

registerRoute("/", renderLandingPage);

const app = document.querySelector<HTMLDivElement>("#app");
if (app) startRouter(app);
```

- [ ] **Step 8: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Manual verification**

Run: `npm run dev`, open the Local URL. Confirm: the landing page renders with the "Turn Every Phone Into a Controller" headline, the 5-step list, and two buttons. Click "How It Works" — it scrolls smoothly to the steps section. Click "Host a Game" — the URL changes to `/host` and the page shows "Page Not Found" (expected — that route is registered in Task 6). Click browser Back — you return to `/` and the landing page re-renders.

- [ ] **Step 10: Commit**

```bash
git add client/src/networking/socket.ts client/src/networking/router.ts client/src/components/button.ts client/src/styles/global.css client/src/styles/components.css client/src/pages/landing.ts client/src/main.ts
git commit -m "Add client router, socket wrapper, base styles, and landing page"
```

---

### Task 6: Host Creation and Lobby Flow

**Files:**
- Create: `client/src/games/catalog.ts`
- Create: `client/src/components/gameCard.ts`
- Create: `client/src/components/qrCard.ts`
- Create: `client/src/components/playerCard.ts`
- Create: `client/src/pages/hostGameSelect.ts`
- Create: `client/src/pages/hostPlayerCount.ts`
- Create: `client/src/pages/hostLobby.ts`
- Modify: `client/src/main.ts`
- Modify: `client/src/styles/components.css`

**Interfaces:**
- Consumes: `createButton` (Task 5), `emitWithAck`/`getSocket` (Task 5), `registerRoute`/`navigate`/`RouteContext`/`CleanupFn` (Task 5), `SOCKET_EVENTS` + request/response types (Task 2).
- Produces: `GAME_CATALOG: GameCatalogEntry[]` from `client/src/games/catalog.ts`; `createGameCard`, `createQrCard`, `createPlayerCard` component functions — reused as-is in later tasks. `renderHostLobbyPage` is extended (not replaced) by Task 9 to add the in-progress game view and by Task 11 to add reconnect-on-mount.
- Known gap (resolved in Task 11): if the lobby page is hard-reloaded, the browser gets a new Socket.IO connection with no bound session, so Start Game/Leave Room will not work until Task 11 wires `host:reconnect` on mount. Do not refresh the lobby page during this task's manual verification.

- [ ] **Step 1: Create `client/src/games/catalog.ts`**

```ts
import type { GameType } from "../../../shared/protocol";

export interface GameCatalogEntry {
  id: GameType;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  playable: boolean;
  icon: string;
}

export const GAME_CATALOG: GameCatalogEntry[] = [
  {
    id: "controller-test",
    title: "Controller Test",
    description: "Jump and dodge with your phone as a controller — the proving ground for every game to come.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: true,
    icon: "🎮"
  },
  {
    id: "rhythm-battle",
    title: "Rhythm Battle",
    description: "Hit the beat before your rivals do.",
    minPlayers: 2,
    maxPlayers: 4,
    playable: false,
    icon: "🎵"
  },
  {
    id: "table-tennis",
    title: "Table Tennis",
    description: "Quick reflexes, one paddle each.",
    minPlayers: 2,
    maxPlayers: 2,
    playable: false,
    icon: "🏓"
  },
  {
    id: "bowling",
    title: "Bowling",
    description: "Line up the perfect strike.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: false,
    icon: "🎳"
  },
  {
    id: "tennis",
    title: "Tennis",
    description: "Rally it out, best of five.",
    minPlayers: 2,
    maxPlayers: 2,
    playable: false,
    icon: "🎾"
  },
  {
    id: "racing",
    title: "Racing",
    description: "Tilt, boost, and drift to the line.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: false,
    icon: "🏎️"
  }
];
```

- [ ] **Step 2: Create `client/src/components/gameCard.ts`**

```ts
import type { GameCatalogEntry } from "../games/catalog";
import { createButton } from "./button";

export function createGameCard(entry: GameCatalogEntry, onPlay: () => void): HTMLElement {
  const card = document.createElement("article");
  card.className = `card game-card${entry.playable ? "" : " game-card-disabled"}`;
  card.innerHTML = `
    <div class="game-icon">${entry.icon}</div>
    <h3>${entry.title}</h3>
    <p class="game-desc">${entry.description}</p>
    <p class="game-players">${
      entry.minPlayers === entry.maxPlayers
        ? `${entry.maxPlayers} players`
        : `${entry.minPlayers}-${entry.maxPlayers} players`
    }</p>
  `;
  const actions = document.createElement("div");
  actions.className = "game-card-actions";
  actions.appendChild(
    entry.playable
      ? createButton({ label: "Play", variant: "primary", onClick: onPlay })
      : createButton({ label: "Coming Soon", variant: "secondary", disabled: true })
  );
  card.appendChild(actions);
  return card;
}
```

- [ ] **Step 3: Create `client/src/components/qrCard.ts`**

```ts
export function createQrCard(playerNumber: number, qrDataUrl: string, color: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "qr-card";
  wrapper.style.setProperty("--player-color", color);
  wrapper.innerHTML = `<img class="qr-card-image" src="${qrDataUrl}" alt="QR code to join as player ${playerNumber}" />`;
  return wrapper;
}
```

- [ ] **Step 4: Create `client/src/components/playerCard.ts`**

```ts
import type { PublicPlayer } from "../../../shared/protocol";

function statusLabel(player: PublicPlayer): string {
  if (!player.nickname) return "Waiting for player";
  if (!player.connected) return "Disconnected";
  return player.ready ? "Ready" : "Connected";
}

function statusClass(player: PublicPlayer): string {
  if (!player.nickname) return "waiting";
  if (!player.connected) return "disconnected";
  return player.ready ? "ready" : "connected";
}

export function createPlayerCard(player: PublicPlayer): HTMLElement {
  const card = document.createElement("div");
  card.className = `player-card status-${statusClass(player)}`;
  card.innerHTML = `
    <span class="player-number">Player ${player.playerNumber}</span>
    <span class="player-nickname">${player.nickname ?? "Waiting to scan…"}</span>
    <span class="player-status">${statusLabel(player)}</span>
  `;
  return card;
}
```

- [ ] **Step 5: Create `client/src/pages/hostGameSelect.ts`**

```ts
import { GAME_CATALOG } from "../games/catalog";
import { createGameCard } from "../components/gameCard";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";

export function renderHostGameSelectPage({ container }: RouteContext): CleanupFn | void {
  container.innerHTML = `
    <section class="page-section">
      <h1>Choose a Game</h1>
      <div class="game-grid" id="game-grid"></div>
    </section>
  `;
  const grid = container.querySelector<HTMLDivElement>("#game-grid")!;
  for (const entry of GAME_CATALOG) {
    grid.appendChild(createGameCard(entry, () => navigate(`/host/${entry.id}`)));
  }
}
```

- [ ] **Step 6: Create `client/src/pages/hostPlayerCount.ts`**

```ts
import { GAME_CATALOG } from "../games/catalog";
import { emitWithAck } from "../networking/socket";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type { CreateRoomRequest, CreateRoomResponse } from "../../../shared/protocol";
import { createButton } from "../components/button";

export function renderHostPlayerCountPage({ container, params }: RouteContext): CleanupFn | void {
  const entry = GAME_CATALOG.find((g) => g.id === params.gameId);

  if (!entry || !entry.playable) {
    container.innerHTML = `
      <section class="page-section centered">
        <h1>Coming Soon</h1>
        <p>${entry ? entry.title : "This game"} isn't ready to play yet.</p>
        <div id="back-slot"></div>
      </section>
    `;
    container
      .querySelector<HTMLDivElement>("#back-slot")!
      .appendChild(createButton({ label: "Back to Games", variant: "secondary", onClick: () => navigate("/host") }));
    return;
  }

  container.innerHTML = `
    <section class="page-section centered">
      <h1>${entry.title}</h1>
      <p class="hero-copy">How many players?</p>
      <div class="player-count-grid" id="counts"></div>
      <p class="error-text" id="error" hidden></p>
    </section>
  `;

  const counts = container.querySelector<HTMLDivElement>("#counts")!;
  const errorEl = container.querySelector<HTMLParagraphElement>("#error")!;
  let busy = false;

  for (let n = entry.minPlayers; n <= entry.maxPlayers; n++) {
    const btn = createButton({
      label: `${n} Player${n > 1 ? "s" : ""}`,
      variant: "primary",
      onClick: async () => {
        if (busy) return;
        busy = true;
        errorEl.hidden = true;
        try {
          const res = await emitWithAck<CreateRoomResponse>(SOCKET_EVENTS.HOST_CREATE_ROOM, {
            gameType: entry.id,
            maxPlayers: n
          } satisfies CreateRoomRequest);
          sessionStorage.setItem(
            `pocket-arena:host:${res.roomId}`,
            JSON.stringify({ hostToken: res.hostToken, slots: res.slots, room: res.room })
          );
          navigate(`/host/lobby/${res.roomId}`);
        } catch (err) {
          errorEl.textContent = (err as { message?: string }).message ?? "Could not create room.";
          errorEl.hidden = false;
          busy = false;
        }
      }
    });
    counts.appendChild(btn);
  }
}
```

- [ ] **Step 7: Create `client/src/pages/hostLobby.ts`**

```ts
import { getSocket, emitWithAck } from "../networking/socket";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type { CreateRoomSlot, PublicRoomState, RoomClosedPayload } from "../../../shared/protocol";
import { createQrCard } from "../components/qrCard";
import { createPlayerCard } from "../components/playerCard";
import { createButton } from "../components/button";

interface StoredHostSession {
  hostToken: string;
  slots: CreateRoomSlot[];
  room: PublicRoomState;
}

export function renderHostLobbyPage({ container, params }: RouteContext): CleanupFn | void {
  const roomId = params.roomCode!;
  const raw = sessionStorage.getItem(`pocket-arena:host:${roomId}`);
  if (!raw) {
    navigate("/host");
    return;
  }
  const session: StoredHostSession = JSON.parse(raw);

  container.innerHTML = `
    <section class="page-section">
      <header class="lobby-header">
        <div>
          <p class="eyebrow">ROOM CODE</p>
          <h1 class="room-code">${roomId}</h1>
        </div>
      </header>
      <div class="lobby-grid" id="lobby-grid"></div>
      <div class="lobby-footer" id="lobby-footer"></div>
    </section>
  `;

  const gridEl = container.querySelector<HTMLDivElement>("#lobby-grid")!;
  const footerEl = container.querySelector<HTMLDivElement>("#lobby-footer")!;

  const startButton = createButton({
    label: "Start Game",
    variant: "primary",
    disabled: true,
    onClick: async () => {
      try {
        await emitWithAck(SOCKET_EVENTS.GAME_START, {});
      } catch (err) {
        alert((err as { message?: string }).message ?? "Could not start the game.");
      }
    }
  });
  const leaveButton = createButton({
    label: "Leave Room",
    variant: "danger",
    onClick: async () => {
      await emitWithAck(SOCKET_EVENTS.HOST_LEAVE_ROOM, {});
      sessionStorage.removeItem(`pocket-arena:host:${roomId}`);
      navigate("/");
    }
  });
  footerEl.appendChild(startButton);
  footerEl.appendChild(leaveButton);

  function renderRoom(room: PublicRoomState): void {
    gridEl.innerHTML = "";
    for (const player of room.players) {
      const slot = session.slots.find((s) => s.playerNumber === player.playerNumber);
      const wrapper = document.createElement("div");
      wrapper.className = "lobby-slot";
      wrapper.style.setProperty("--player-color", player.color);
      if (slot) wrapper.appendChild(createQrCard(slot.playerNumber, slot.qrDataUrl, player.color));
      wrapper.appendChild(createPlayerCard(player));
      gridEl.appendChild(wrapper);
    }
    const allReady = room.players.length === room.maxPlayers && room.players.every((p) => p.connected && p.ready);
    startButton.disabled = !allReady;
  }

  renderRoom(session.room);

  const socket = getSocket();
  const onRoomState = (room: PublicRoomState) => renderRoom(room);
  const onRoomClosed = (payload: RoomClosedPayload) => {
    alert(payload.reason);
    sessionStorage.removeItem(`pocket-arena:host:${roomId}`);
    navigate("/");
  };
  socket.on(SOCKET_EVENTS.ROOM_STATE, onRoomState);
  socket.on(SOCKET_EVENTS.ROOM_CLOSED, onRoomClosed);

  return () => {
    socket.off(SOCKET_EVENTS.ROOM_STATE, onRoomState);
    socket.off(SOCKET_EVENTS.ROOM_CLOSED, onRoomClosed);
  };
}
```

- [ ] **Step 8: Modify `client/src/main.ts`** — register the new routes

```ts
import "./styles/global.css";
import "./styles/components.css";
import { registerRoute, startRouter } from "./networking/router";
import { renderLandingPage } from "./pages/landing";
import { renderHostGameSelectPage } from "./pages/hostGameSelect";
import { renderHostPlayerCountPage } from "./pages/hostPlayerCount";
import { renderHostLobbyPage } from "./pages/hostLobby";

registerRoute("/", renderLandingPage);
registerRoute("/host", renderHostGameSelectPage);
registerRoute("/host/:gameId", renderHostPlayerCountPage);
registerRoute("/host/lobby/:roomCode", renderHostLobbyPage);

const app = document.querySelector<HTMLDivElement>("#app");
if (app) startRouter(app);
```

- [ ] **Step 9: Modify `client/src/styles/components.css`** — append game grid, player-count grid, and lobby styles

```css
.game-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1.25rem;
  margin-top: 1.5rem;
}
.game-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.game-card-disabled {
  opacity: 0.6;
}
.game-icon {
  font-size: 2.5rem;
}
.game-desc {
  color: var(--color-text-dim);
  font-size: 0.95rem;
  flex-grow: 1;
}
.game-players {
  font-size: 0.85rem;
  color: var(--color-cyan);
}
.game-card-actions {
  margin-top: 0.5rem;
}

.player-count-grid {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
  margin: 1.5rem 0;
}

.lobby-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}
.room-code {
  font-size: 2.5rem;
  letter-spacing: 0.15em;
}

.lobby-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1.25rem;
}
.lobby-slot {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
  text-align: center;
  border-top: 3px solid var(--player-color, var(--color-cyan));
}
.qr-card-image {
  width: 100%;
  max-width: 180px;
  border-radius: var(--radius-md);
  background: white;
  padding: 0.5rem;
}
.player-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.75rem;
}
.player-number {
  font-weight: 700;
}
.player-nickname {
  color: var(--color-text-dim);
}
.player-status {
  font-size: 0.85rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  display: inline-block;
  align-self: center;
}
.status-waiting .player-status {
  background: var(--color-border);
  color: var(--color-text-dim);
}
.status-connected .player-status {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}
.status-ready .player-status {
  background: rgba(52, 211, 153, 0.2);
  color: #34d399;
}
.status-disconnected .player-status {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.lobby-footer {
  display: flex;
  gap: 1rem;
  justify-content: center;
  margin-top: 2rem;
}
```

- [ ] **Step 10: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 11: Manual verification**

Run: `npm run dev`. From `/`, click "Host a Game" → game selection grid shows 6 cards, only Controller Test has an enabled "Play" button, the rest show disabled "Coming Soon". Click a disabled game's card area is fine (button itself is disabled) — click Controller Test's Play button → player-count buttons 1–4 appear. Click "2 Players" → navigates to `/host/lobby/<CODE>` showing a 5-character room code, two lobby slots each with a QR image and "Waiting for player" status, and a disabled "Start Game" button. Do not refresh this page (see Known Gap above). Open one of the QR images' underlying `joinUrl` (visible via browser devtools on the `<img>` `alt`/inspect, or temporarily `console.log` it) in a new tab on the same machine — do not submit the form yet, that's Task 7.

- [ ] **Step 12: Commit**

```bash
git add client/src/games/catalog.ts client/src/components/gameCard.ts client/src/components/qrCard.ts client/src/components/playerCard.ts client/src/pages/hostGameSelect.ts client/src/pages/hostPlayerCount.ts client/src/pages/hostLobby.ts client/src/main.ts client/src/styles/components.css
git commit -m "Add host game-select, player-count, and lobby pages with QR display"
```

---

### Task 7: Phone Join and Ready Flow

**Files:**
- Create: `client/src/pages/join.ts`
- Modify: `client/src/main.ts`
- Modify: `client/src/styles/components.css`

**Interfaces:**
- Consumes: `createButton` (Task 5), `emitWithAck` (Task 5), `RouteContext`/`CleanupFn` (Task 5), `SOCKET_EVENTS`/`ValidateTokenRequest`/`ValidateTokenResponse`/`ControllerJoinRequest`/`ControllerJoinResponse`/`PlayerReadyRequest` (Task 2).
- Produces: `renderJoinPage(ctx): CleanupFn | void`, registered at `/join/:roomCode/:playerNumber`. Task 10 replaces this file's contents to add live room-status handling (countdown/in-progress/host-disconnected) and the controller button view — this task only needs to get a phone from "scan QR" to "ready, waiting for host."

- [ ] **Step 1: Create `client/src/pages/join.ts`**

```ts
import { emitWithAck } from "../networking/socket";
import type { CleanupFn, RouteContext } from "../networking/router";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type {
  ControllerJoinRequest,
  ControllerJoinResponse,
  ValidateTokenRequest,
  ValidateTokenResponse
} from "../../../shared/protocol";
import { createButton } from "../components/button";

function tokenKey(roomId: string, playerNumber: string): string {
  return `pocket-arena:player:${roomId}:${playerNumber}`;
}

export function renderJoinPage({ container, params, query }: RouteContext): CleanupFn | void {
  const roomId = params.roomCode!;
  const playerNumber = params.playerNumber!;
  const queryToken = query.get("token");

  if (queryToken) {
    sessionStorage.setItem(tokenKey(roomId, playerNumber), queryToken);
    window.history.replaceState({}, "", `/join/${roomId}/${playerNumber}`);
  }
  const token = queryToken ?? sessionStorage.getItem(tokenKey(roomId, playerNumber));

  container.innerHTML = `<section class="page-section centered join-page"><p>Checking your invite…</p></section>`;
  const section = container.querySelector<HTMLElement>(".join-page")!;

  if (!token) {
    section.innerHTML = `<h1>Invalid Link</h1><p>This join link is missing its access token. Ask your host for a fresh QR code.</p>`;
    return;
  }

  let cancelled = false;

  emitWithAck<ValidateTokenResponse>(SOCKET_EVENTS.CONTROLLER_VALIDATE_TOKEN, {
    roomId,
    playerNumber: Number(playerNumber),
    token
  } satisfies ValidateTokenRequest)
    .then((validated) => {
      if (!cancelled) renderNicknameForm(validated);
    })
    .catch((err: { message?: string }) => {
      if (cancelled) return;
      section.innerHTML = `<h1>Invalid or Expired Link</h1><p>${err.message ?? "This QR code is no longer valid."}</p>`;
    });

  function renderNicknameForm(validated: ValidateTokenResponse): void {
    section.style.setProperty("--player-color", validated.color);
    section.innerHTML = `
      <p class="eyebrow">PLAYER ${playerNumber}</p>
      <h1 class="glow-text">Join the Arena</h1>
      <form id="nickname-form" class="nickname-form">
        <input id="nickname-input" type="text" maxlength="20" placeholder="Your nickname" autocomplete="off" value="${validated.nickname ?? ""}" required />
        <div id="nickname-submit"></div>
      </form>
      <p class="error-text" id="join-error" hidden></p>
    `;
    const form = section.querySelector<HTMLFormElement>("#nickname-form")!;
    const input = section.querySelector<HTMLInputElement>("#nickname-input")!;
    const submitSlot = section.querySelector<HTMLDivElement>("#nickname-submit")!;
    const errorEl = section.querySelector<HTMLParagraphElement>("#join-error")!;
    const submitButton = createButton({ label: "Join Game", variant: "primary" });
    submitButton.type = "submit";
    submitSlot.appendChild(submitButton);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.hidden = true;
      submitButton.disabled = true;
      try {
        const joined = await emitWithAck<ControllerJoinResponse>(SOCKET_EVENTS.CONTROLLER_JOIN, {
          roomId,
          playerNumber: Number(playerNumber),
          token,
          nickname: input.value
        } satisfies ControllerJoinRequest);
        renderReadyScreen(joined);
      } catch (err) {
        errorEl.textContent = (err as { message?: string }).message ?? "Could not join the room.";
        errorEl.hidden = false;
        submitButton.disabled = false;
      }
    });
  }

  function renderReadyScreen(joined: ControllerJoinResponse): void {
    const self = joined.room.players.find((p) => p.playerNumber === Number(playerNumber));
    section.style.setProperty("--player-color", joined.color);
    section.innerHTML = `
      <p class="eyebrow">PLAYER ${playerNumber}</p>
      <h1 class="glow-text">${self?.nickname ?? ""}</h1>
      <div id="ready-slot"></div>
      <p id="waiting-text" class="hero-copy" hidden>Waiting for host…</p>
    `;
    const readySlot = section.querySelector<HTMLDivElement>("#ready-slot")!;
    const waitingText = section.querySelector<HTMLParagraphElement>("#waiting-text")!;
    let ready = false;
    const readyButton = createButton({
      label: "Ready",
      variant: "primary",
      onClick: async () => {
        ready = !ready;
        readyButton.disabled = true;
        try {
          await emitWithAck(SOCKET_EVENTS.PLAYER_READY, { ready } satisfies { ready: boolean });
          readyButton.textContent = ready ? "Cancel Ready" : "Ready";
          waitingText.hidden = !ready;
        } finally {
          readyButton.disabled = false;
        }
      }
    });
    readySlot.appendChild(readyButton);
  }

  return () => {
    cancelled = true;
  };
}
```

- [ ] **Step 2: Modify `client/src/main.ts`** — register the join route

```ts
import { renderJoinPage } from "./pages/join";

registerRoute("/join/:roomCode/:playerNumber", renderJoinPage);
```

(Add the import alongside the other page imports and the `registerRoute` call alongside the others, before `startRouter`.)

- [ ] **Step 3: Modify `client/src/styles/components.css`** — append the nickname form styles

```css
.nickname-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1.5rem;
}
.nickname-form input {
  font-family: inherit;
  font-size: 1.1rem;
  padding: 0.9rem 1.1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
}
.nickname-form input:focus {
  outline: 2px solid var(--player-color, var(--color-cyan));
}
```

- [ ] **Step 4: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification (multi-tab)**

Run: `npm run dev`. In tab A, go through Host a Game → Controller Test → 2 Players to reach the lobby; note the room code. In the lobby, temporarily log `session.slots` to the console (or inspect the QR `<img>` `alt` text plus the room code) to recover a `joinUrl`, then open it in tab B (same-origin, so `localhost` is fine for this manual check). Confirm: tab B shows "Checking your invite…" then the nickname form pre-filled empty; the browser address bar no longer shows `?token=...` after the page settles. Submit a nickname — tab B shows a "Ready" button; tab A's lobby card for that slot updates from "Waiting for player" to "Connected" with the nickname. Click "Ready" in tab B — tab A's card shows "Ready" and tab B shows "Waiting for host…". Repeat for player 2 in a tab C. Edit tab B's URL to use a made-up token and reload — confirm it shows "Invalid or Expired Link" instead of crashing. Try opening the same original join URL in a tab D while tab B is still connected — confirm it's rejected with an "already connected on another device" style error.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/join.ts client/src/main.ts client/src/styles/components.css
git commit -m "Add phone join page: token validation, nickname form, ready toggle"
```

---

### Task 8: Controller Test Server Physics

**Files:**
- Create: `server/games/controllerTest.ts`
- Test: `server/games/controllerTest.test.ts`
- Modify: `server/socketHandlers.ts`

**Interfaces:**
- Consumes: `ARENA`, `SOCKET_EVENTS`, `GameStatePayload` (Task 2); `InternalRoom` (Task 3); `roomChannel` (Task 3).
- Produces: `stepPhysics(room, deltaSeconds)`, `toGameStatePayload(room)`, `startPhysicsLoop(io, room)`, `stopPhysicsLoop(room)`, `resetAllDirections(room)`, `resetPlayerDirection(room, playerNumber)` from `server/games/controllerTest.ts` — consumed by `server/socketHandlers.ts` (this task's modification) to make the countdown-to-in-progress transition (built in Task 4) actually move and broadcast player positions.

- [ ] **Step 1: Create `server/games/controllerTest.ts`**

```ts
import type { Server } from "socket.io";
import { ARENA, SOCKET_EVENTS } from "../../shared/protocol";
import type { GameStatePayload } from "../../shared/protocol";
import type { InternalRoom } from "../types";
import { roomChannel } from "../rooms";

const TICK_MS = 50;

export function stepPhysics(room: InternalRoom, deltaSeconds: number): void {
  for (const player of room.players) {
    const physics = player.physics;
    physics.x += physics.direction * ARENA.moveSpeed * deltaSeconds;
    physics.x = Math.max(ARENA.playerRadius, Math.min(ARENA.width - ARENA.playerRadius, physics.x));

    physics.vy += ARENA.gravity * deltaSeconds;
    physics.y += physics.vy * deltaSeconds;
    if (physics.y >= ARENA.groundY) {
      physics.y = ARENA.groundY;
      physics.vy = 0;
      physics.grounded = true;
    }
  }
}

export function toGameStatePayload(room: InternalRoom): GameStatePayload {
  return {
    roundId: room.roundId ?? "",
    players: room.players
      .filter((p) => p.connected)
      .map((p) => ({ playerNumber: p.playerNumber, x: p.physics.x, y: p.physics.y }))
  };
}

export function startPhysicsLoop(io: Server, room: InternalRoom): void {
  let lastTick = Date.now();
  room.physicsInterval = setInterval(() => {
    const now = Date.now();
    const deltaSeconds = (now - lastTick) / 1000;
    lastTick = now;
    stepPhysics(room, deltaSeconds);
    io.to(roomChannel(room.id)).volatile.emit(SOCKET_EVENTS.GAME_STATE, toGameStatePayload(room));
  }, TICK_MS);
}

export function stopPhysicsLoop(room: InternalRoom): void {
  if (room.physicsInterval) {
    clearInterval(room.physicsInterval);
    room.physicsInterval = null;
  }
}

export function resetAllDirections(room: InternalRoom): void {
  for (const player of room.players) player.physics.direction = 0;
}

export function resetPlayerDirection(room: InternalRoom, playerNumber: number): void {
  const player = room.players.find((p) => p.playerNumber === playerNumber);
  if (player) player.physics.direction = 0;
}
```

- [ ] **Step 2: Create `server/games/controllerTest.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ARENA } from "../../shared/protocol";
import type { InternalRoom } from "../types";
import { resetAllDirections, stepPhysics } from "./controllerTest";

function makeRoom(): InternalRoom {
  return {
    id: "TEST1",
    gameType: "controller-test",
    maxPlayers: 1,
    hostToken: "h",
    hostSocketId: null,
    status: "in-progress",
    statusBeforeHostDisconnect: null,
    roundId: "r1",
    countdownEndsAt: null,
    createdAt: Date.now(),
    hostGraceTimer: null,
    countdownTimer: null,
    physicsInterval: null,
    players: [
      {
        playerNumber: 1,
        token: "t",
        nickname: "A",
        color: "#fff",
        socketId: "s1",
        connected: true,
        ready: true,
        lastSequence: 0,
        physics: { x: ARENA.width / 2, y: ARENA.groundY, vy: 0, grounded: true, direction: 0 }
      }
    ]
  };
}

describe("stepPhysics", () => {
  it("moves a player right and clamps at the arena bound", () => {
    const room = makeRoom();
    room.players[0]!.physics.direction = 1;
    for (let i = 0; i < 1000; i++) stepPhysics(room, 1 / 20);
    expect(room.players[0]!.physics.x).toBeLessThanOrEqual(ARENA.width - ARENA.playerRadius);
  });

  it("applies gravity so a jump arcs back down to the ground", () => {
    const room = makeRoom();
    const player = room.players[0]!;
    player.physics.vy = ARENA.jumpVelocity;
    player.physics.grounded = false;
    let leftGround = false;
    for (let i = 0; i < 200; i++) {
      stepPhysics(room, 1 / 20);
      if (player.physics.y < ARENA.groundY) leftGround = true;
    }
    expect(leftGround).toBe(true);
    expect(player.physics.grounded).toBe(true);
    expect(player.physics.y).toBe(ARENA.groundY);
  });

  it("resetAllDirections stops horizontal movement", () => {
    const room = makeRoom();
    room.players[0]!.physics.direction = 1;
    resetAllDirections(room);
    expect(room.players[0]!.physics.direction).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run server/games/controllerTest.test.ts`
Expected: 3 passed.

- [ ] **Step 4: Modify `server/socketHandlers.ts`** — wire the physics loop into the round lifecycle

Add the import:

```ts
import { resetAllDirections, resetPlayerDirection, startPhysicsLoop, stopPhysicsLoop } from "./games/controllerTest";
```

In `runCountdown`'s `emitNext`, replace:

```ts
    if (value === "go") {
      room.status = "in-progress";
      room.countdownEndsAt = null;
      room.countdownTimer = null;
      broadcastRoomState(io, room);
      return;
    }
```

with:

```ts
    if (value === "go") {
      room.status = "in-progress";
      room.countdownEndsAt = null;
      room.countdownTimer = null;
      broadcastRoomState(io, room);
      startPhysicsLoop(io, room);
      return;
    }
```

In `endRound`, replace:

```ts
  if (room.physicsInterval) clearInterval(room.physicsInterval);
  room.physicsInterval = null;
  room.status = "lobby";
  room.roundId = null;
  room.countdownEndsAt = null;
  for (const player of room.players) player.physics.direction = 0;
```

with:

```ts
  stopPhysicsLoop(room);
  room.status = "lobby";
  room.roundId = null;
  room.countdownEndsAt = null;
  resetAllDirections(room);
```

In the `disconnect` handler's host branch, replace:

```ts
        if (room.physicsInterval) {
          clearInterval(room.physicsInterval);
          room.physicsInterval = null;
        }
        room.status = "host-disconnected";
        for (const player of room.players) player.physics.direction = 0;
```

with:

```ts
        stopPhysicsLoop(room);
        room.status = "host-disconnected";
        resetAllDirections(room);
```

In the `disconnect` handler's controller branch, replace:

```ts
        if (player && player.socketId === socket.id) {
          player.connected = false;
          player.socketId = null;
          player.physics.direction = 0;
```

with:

```ts
        if (player && player.socketId === socket.id) {
          player.connected = false;
          player.socketId = null;
          resetPlayerDirection(room, player.playerNumber);
```

- [ ] **Step 5: Run all server tests**

Run: `npm test`
Expected: all suites pass (protocol, rooms, socketHandlers, controllerTest).

- [ ] **Step 6: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, create a 1-player Controller Test room, join and ready up from a second tab, press Start Game. Open browser devtools on the host tab's console and run `window.__socket = undefined;` is not needed — instead temporarily add `socket.on("game:state", console.log)` via the console (the socket instance isn't globally exposed yet, so use the Network tab's WS frames inspector on the host tab to confirm `game:state` frames are flowing at roughly 20/second after the countdown reaches "go"). Full visual confirmation of movement arrives in Task 9.

- [ ] **Step 8: Commit**

```bash
git add server/games/controllerTest.ts server/games/controllerTest.test.ts server/socketHandlers.ts
git commit -m "Add Controller Test server-authoritative physics tick and wire it into the round lifecycle"
```

---

### Task 9: Controller Test Host Renderer

**Files:**
- Create: `client/src/games/gameRenderer.ts`
- Create: `client/src/games/controller-test/renderer.ts`
- Modify: `client/src/pages/hostLobby.ts`
- Modify: `client/src/styles/components.css`

**Interfaces:**
- Consumes: `ARENA`, `SOCKET_EVENTS`, `GameStatePayload`, `CountdownTickPayload`, `PublicRoomState` (Task 2).
- Produces: `GameRenderer<TState>` interface from `client/src/games/gameRenderer.ts` (the seam future Three.js games implement); `ControllerTestRenderer` class from `client/src/games/controller-test/renderer.ts`, constructed with a `PublicRoomState` and exposing `mount`, `applyState`, `render`, `destroy`.

- [ ] **Step 1: Create `client/src/games/gameRenderer.ts`**

```ts
export interface GameRenderer<TState> {
  mount(container: HTMLElement): void;
  applyState(state: TState): void;
  render(timestamp: number): void;
  destroy(): void;
}
```

- [ ] **Step 2: Create `client/src/games/controller-test/renderer.ts`**

```ts
import type { GameRenderer } from "../gameRenderer";
import { ARENA } from "../../../../shared/protocol";
import type { GameStatePayload, PublicRoomState } from "../../../../shared/protocol";

interface Snapshot {
  time: number;
  players: Map<number, { x: number; y: number }>;
}

export class ControllerTestRenderer implements GameRenderer<GameStatePayload> {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private snapshots: Snapshot[] = [];
  private colors = new Map<number, string>();

  constructor(room: PublicRoomState) {
    for (const player of room.players) this.colors.set(player.playerNumber, player.color);
  }

  mount(container: HTMLElement): void {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ARENA.width;
    this.canvas.height = ARENA.groundY + 60;
    this.canvas.className = "game-canvas";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
  }

  applyState(state: GameStatePayload): void {
    const players = new Map(state.players.map((p) => [p.playerNumber, { x: p.x, y: p.y }]));
    this.snapshots.push({ time: performance.now(), players });
    if (this.snapshots.length > 2) this.snapshots.shift();
  }

  render(_timestamp: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#0b0f1e";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#232a45";
    ctx.fillRect(0, ARENA.groundY + 24, this.canvas.width, 4);

    for (const [playerNumber, pos] of this.interpolate()) {
      ctx.beginPath();
      ctx.fillStyle = this.colors.get(playerNumber) ?? "#22d3ee";
      ctx.arc(pos.x, pos.y, ARENA.playerRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private interpolate(): Map<number, { x: number; y: number }> {
    if (this.snapshots.length === 0) return new Map();
    if (this.snapshots.length === 1) return this.snapshots[0]!.players;
    const [prev, next] = this.snapshots as [Snapshot, Snapshot];
    const span = next.time - prev.time || 1;
    const t = Math.min(1.2, Math.max(0, (performance.now() - next.time) / span + 1));
    const result = new Map<number, { x: number; y: number }>();
    for (const [playerNumber, nextPos] of next.players) {
      const prevPos = prev.players.get(playerNumber) ?? nextPos;
      result.set(playerNumber, {
        x: prevPos.x + (nextPos.x - prevPos.x) * t,
        y: prevPos.y + (nextPos.y - prevPos.y) * t
      });
    }
    return result;
  }

  destroy(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }
}
```

- [ ] **Step 3: Modify `client/src/pages/hostLobby.ts`** — add the game view

Add imports at the top:

```ts
import { ControllerTestRenderer } from "../games/controller-test/renderer";
import type { CountdownTickPayload, GameStatePayload } from "../../../shared/protocol";
```

Immediately after the existing `footerEl.appendChild(leaveButton);` line, add:

```ts
  const gameSectionEl = document.createElement("div");
  gameSectionEl.className = "game-section";
  gameSectionEl.hidden = true;
  container.querySelector(".page-section")!.appendChild(gameSectionEl);

  let renderer: ControllerTestRenderer | null = null;
  let rafHandle: number | null = null;
  let lastStatus: PublicRoomState["status"] | null = null;

  function startGameView(room: PublicRoomState): void {
    gridEl.hidden = true;
    footerEl.hidden = true;
    gameSectionEl.hidden = false;
    gameSectionEl.innerHTML = `<div class="countdown-overlay" id="countdown"></div>`;
    renderer = new ControllerTestRenderer(room);
    renderer.mount(gameSectionEl);
    const loop = (t: number) => {
      renderer?.render(t);
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  }

  function stopGameView(): void {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    renderer?.destroy();
    renderer = null;
    gameSectionEl.hidden = true;
    gridEl.hidden = false;
    footerEl.hidden = false;
  }
```

Replace the body of `renderRoom` with:

```ts
  function renderRoom(room: PublicRoomState): void {
    const isPlaying = room.status === "countdown" || room.status === "in-progress";
    const wasPlaying = lastStatus === "countdown" || lastStatus === "in-progress";
    if (isPlaying && !wasPlaying) startGameView(room);
    if (!isPlaying && wasPlaying) stopGameView();
    lastStatus = room.status;

    if (room.status !== "lobby") return;

    gridEl.innerHTML = "";
    for (const player of room.players) {
      const slot = session.slots.find((s) => s.playerNumber === player.playerNumber);
      const wrapper = document.createElement("div");
      wrapper.className = "lobby-slot";
      wrapper.style.setProperty("--player-color", player.color);
      if (slot) wrapper.appendChild(createQrCard(slot.playerNumber, slot.qrDataUrl, player.color));
      wrapper.appendChild(createPlayerCard(player));
      gridEl.appendChild(wrapper);
    }
    const allReady = room.players.length === room.maxPlayers && room.players.every((p) => p.connected && p.ready);
    startButton.disabled = !allReady;
  }
```

Immediately before the existing `socket.on(SOCKET_EVENTS.ROOM_STATE, onRoomState);` line, add:

```ts
  const onCountdownTick = (payload: CountdownTickPayload) => {
    const el = document.getElementById("countdown");
    if (el) el.textContent = String(payload.value);
  };
  const onGameState = (payload: GameStatePayload) => {
    renderer?.applyState(payload);
  };
  socket.on(SOCKET_EVENTS.GAME_COUNTDOWN_TICK, onCountdownTick);
  socket.on(SOCKET_EVENTS.GAME_STATE, onGameState);
```

Replace the final `return () => { ... }` block with:

```ts
  return () => {
    socket.off(SOCKET_EVENTS.ROOM_STATE, onRoomState);
    socket.off(SOCKET_EVENTS.ROOM_CLOSED, onRoomClosed);
    socket.off(SOCKET_EVENTS.GAME_COUNTDOWN_TICK, onCountdownTick);
    socket.off(SOCKET_EVENTS.GAME_STATE, onGameState);
    stopGameView();
  };
```

- [ ] **Step 4: Modify `client/src/styles/components.css`** — append game view styles

```css
.game-section {
  position: relative;
  display: flex;
  justify-content: center;
  margin-top: 1rem;
}
.game-canvas {
  max-width: 100%;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
}
.countdown-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 6rem;
  font-weight: 800;
  color: white;
  text-shadow: 0 0 40px var(--color-cyan);
  pointer-events: none;
  z-index: 2;
}
```

- [ ] **Step 5: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, create a 1-player Controller Test room, join and ready up, press Start Game. Confirm: the lobby grid hides, a 3-2-1 countdown overlay appears over a dark canvas, then a single colored circle appears resting on the ground line. Since the phone controller UI doesn't exist yet (Task 10), the circle should sit still — that's expected for this task.

- [ ] **Step 7: Commit**

```bash
git add client/src/games/gameRenderer.ts client/src/games/controller-test/renderer.ts client/src/pages/hostLobby.ts client/src/styles/components.css
git commit -m "Add Canvas-based Controller Test host renderer with snapshot interpolation"
```

---

### Task 10: Controller Input Screen

**Files:**
- Create: `client/src/controller/inputs/buttons.ts`
- Create: `client/src/controller/controllerView.ts`
- Create: `client/src/styles/controller.css`
- Modify: `client/src/pages/join.ts` (replace file contents)

**Interfaces:**
- Consumes: `getSocket` (Task 5); `SOCKET_EVENTS`, `ControllerAction`, `InputActionPayload` (Task 2); `CleanupFn` (Task 5).
- Produces: `ButtonInputSource` class (`pressLeft/releaseLeft/pressRight/releaseRight/jump/releaseAll`) and `bindHoldButton(element, onPress, onRelease): CleanupFn` from `client/src/controller/inputs/buttons.ts`; `mountControllerView(container, {nickname, color, roundId}): CleanupFn` from `client/src/controller/controllerView.ts`. This task also finishes `join.ts`'s state machine (started in Task 7) by making it react to `room:state.status` transitions — this is the last task needed for the full "host creates room → phone joins → JUMP moves the circle" milestone. `client/src/controller/inputs/` is intentionally a folder (not a single file) so a future secure-context `motion.ts` input source can sit alongside `buttons.ts` without touching `controllerView.ts`'s consumers.

- [ ] **Step 1: Create `client/src/controller/inputs/buttons.ts`**

```ts
import { getSocket } from "../../networking/socket";
import { SOCKET_EVENTS } from "../../../../shared/protocol";
import type { ControllerAction, InputActionPayload } from "../../../../shared/protocol";

export class ButtonInputSource {
  private sequence = 0;
  private roundId: string;
  private heldDirection: "left" | "right" | null = null;

  constructor(roundId: string) {
    this.roundId = roundId;
  }

  private send(action: ControllerAction): void {
    const socket = getSocket();
    if (!socket.connected) return;
    this.sequence += 1;
    socket.emit(SOCKET_EVENTS.INPUT_ACTION, {
      action,
      sequence: this.sequence,
      roundId: this.roundId
    } satisfies InputActionPayload);
  }

  pressLeft(): void {
    this.heldDirection = "left";
    this.send("left-start");
  }
  releaseLeft(): void {
    if (this.heldDirection === "left") {
      this.heldDirection = null;
      this.send("left-end");
    }
  }
  pressRight(): void {
    this.heldDirection = "right";
    this.send("right-start");
  }
  releaseRight(): void {
    if (this.heldDirection === "right") {
      this.heldDirection = null;
      this.send("right-end");
    }
  }
  jump(): void {
    this.send("jump");
  }

  releaseAll(): void {
    if (this.heldDirection === "left") this.send("left-end");
    if (this.heldDirection === "right") this.send("right-end");
    this.heldDirection = null;
  }
}

export function bindHoldButton(element: HTMLElement, onPress: () => void, onRelease: () => void): () => void {
  const down = (event: Event) => {
    event.preventDefault();
    onPress();
  };
  const up = (event: Event) => {
    event.preventDefault();
    onRelease();
  };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
  element.addEventListener("pointerleave", up);
  return () => {
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", up);
    element.removeEventListener("pointerleave", up);
  };
}
```

- [ ] **Step 2: Create `client/src/controller/controllerView.ts`**

```ts
import { ButtonInputSource, bindHoldButton } from "./inputs/buttons";
import { getSocket } from "../networking/socket";
import type { CleanupFn } from "../networking/router";

export function mountControllerView(
  container: HTMLElement,
  opts: { nickname: string; color: string; roundId: string }
): CleanupFn {
  container.innerHTML = `
    <div class="controller-screen" style="--player-color:${opts.color}">
      <header class="controller-header">
        <span class="controller-nickname">${opts.nickname}</span>
        <span class="controller-status" id="conn-indicator">●</span>
      </header>
      <button class="jump-button" id="btn-jump">JUMP</button>
      <div class="dpad-row">
        <button class="dpad-button" id="btn-left">◀ LEFT</button>
        <button class="dpad-button" id="btn-right">RIGHT ▶</button>
      </div>
    </div>
  `;

  const input = new ButtonInputSource(opts.roundId);
  const jumpBtn = container.querySelector<HTMLButtonElement>("#btn-jump")!;
  const leftBtn = container.querySelector<HTMLButtonElement>("#btn-left")!;
  const rightBtn = container.querySelector<HTMLButtonElement>("#btn-right")!;
  const indicator = container.querySelector<HTMLSpanElement>("#conn-indicator")!;

  const unbindLeft = bindHoldButton(
    leftBtn,
    () => input.pressLeft(),
    () => input.releaseLeft()
  );
  const unbindRight = bindHoldButton(
    rightBtn,
    () => input.pressRight(),
    () => input.releaseRight()
  );
  const onJumpDown = (event: Event) => {
    event.preventDefault();
    input.jump();
  };
  jumpBtn.addEventListener("pointerdown", onJumpDown);

  const releaseAll = () => input.releaseAll();
  const onVisibility = () => {
    if (document.hidden) releaseAll();
  };
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", onVisibility);

  const socket = getSocket();
  const onDisconnect = () => {
    releaseAll();
    indicator.classList.add("offline");
  };
  const onConnect = () => indicator.classList.remove("offline");
  socket.on("disconnect", onDisconnect);
  socket.on("connect", onConnect);

  return () => {
    unbindLeft();
    unbindRight();
    jumpBtn.removeEventListener("pointerdown", onJumpDown);
    window.removeEventListener("blur", releaseAll);
    document.removeEventListener("visibilitychange", onVisibility);
    socket.off("disconnect", onDisconnect);
    socket.off("connect", onConnect);
    releaseAll();
  };
}
```

- [ ] **Step 3: Create `client/src/styles/controller.css`**

```css
.controller-screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
  background: radial-gradient(
    circle at top,
    color-mix(in srgb, var(--player-color) 25%, var(--color-bg)) 0%,
    var(--color-bg) 70%
  );
}
.controller-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.controller-nickname {
  font-weight: 700;
  font-size: 1.1rem;
}
.controller-status {
  color: #34d399;
}
.controller-status.offline {
  color: #ef4444;
}

.jump-button {
  flex: 1;
  font-size: 2.5rem;
  font-weight: 800;
  border-radius: var(--radius-lg);
  border: none;
  background: linear-gradient(160deg, var(--player-color), color-mix(in srgb, var(--player-color) 60%, black));
  color: white;
  box-shadow: 0 0 40px color-mix(in srgb, var(--player-color) 50%, transparent);
  touch-action: none;
  user-select: none;
  margin-bottom: 1rem;
}
.jump-button:active {
  transform: scale(0.97);
}

.dpad-row {
  display: flex;
  gap: 1rem;
  height: 6rem;
}
.dpad-button {
  flex: 1;
  font-size: 1.25rem;
  font-weight: 700;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  touch-action: none;
  user-select: none;
}
.dpad-button:active {
  background: var(--color-border);
}
```

- [ ] **Step 4: Modify `client/src/pages/join.ts`** — replace the entire file contents

```ts
import { emitWithAck, getSocket } from "../networking/socket";
import type { CleanupFn, RouteContext } from "../networking/router";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type {
  ControllerJoinRequest,
  ControllerJoinResponse,
  CountdownTickPayload,
  PublicRoomState,
  ValidateTokenRequest,
  ValidateTokenResponse
} from "../../../shared/protocol";
import { createButton } from "../components/button";
import { mountControllerView } from "../controller/controllerView";
import "../styles/controller.css";

function tokenKey(roomId: string, playerNumber: string): string {
  return `pocket-arena:player:${roomId}:${playerNumber}`;
}

export function renderJoinPage({ container, params, query }: RouteContext): CleanupFn | void {
  const roomId = params.roomCode!;
  const playerNumber = params.playerNumber!;
  const queryToken = query.get("token");

  if (queryToken) {
    sessionStorage.setItem(tokenKey(roomId, playerNumber), queryToken);
    window.history.replaceState({}, "", `/join/${roomId}/${playerNumber}`);
  }
  const token = queryToken ?? sessionStorage.getItem(tokenKey(roomId, playerNumber));

  container.innerHTML = `<section class="page-section centered join-page"><p>Checking your invite…</p></section>`;
  const section = container.querySelector<HTMLElement>(".join-page")!;

  if (!token) {
    section.innerHTML = `<h1>Invalid Link</h1><p>This join link is missing its access token. Ask your host for a fresh QR code.</p>`;
    return;
  }

  let cancelled = false;
  let controllerCleanup: CleanupFn | null = null;
  let lastStatus: PublicRoomState["status"] | null = null;
  const socket = getSocket();

  const onCountdownTick = (payload: CountdownTickPayload) => {
    const el = document.getElementById("phone-countdown");
    if (el) el.textContent = String(payload.value);
  };
  socket.on(SOCKET_EVENTS.GAME_COUNTDOWN_TICK, onCountdownTick);

  function renderReadyScreen(room: PublicRoomState, color: string): void {
    const self = room.players.find((p) => p.playerNumber === Number(playerNumber));
    section.style.setProperty("--player-color", color);
    section.innerHTML = `
      <p class="eyebrow">PLAYER ${playerNumber}</p>
      <h1 class="glow-text">${self?.nickname ?? ""}</h1>
      <div id="ready-slot"></div>
      <p id="waiting-text" class="hero-copy" hidden>Waiting for host…</p>
    `;
    const readySlot = section.querySelector<HTMLDivElement>("#ready-slot")!;
    const waitingText = section.querySelector<HTMLParagraphElement>("#waiting-text")!;
    let ready = self?.ready ?? false;
    waitingText.hidden = !ready;
    const readyButton = createButton({
      label: ready ? "Cancel Ready" : "Ready",
      variant: "primary",
      onClick: async () => {
        ready = !ready;
        readyButton.disabled = true;
        try {
          await emitWithAck(SOCKET_EVENTS.PLAYER_READY, { ready } satisfies { ready: boolean });
          readyButton.textContent = ready ? "Cancel Ready" : "Ready";
          waitingText.hidden = !ready;
        } finally {
          readyButton.disabled = false;
        }
      }
    });
    readySlot.appendChild(readyButton);
  }

  function onRoomState(room: PublicRoomState): void {
    const self = room.players.find((p) => p.playerNumber === Number(playerNumber));
    if (!self || room.status === lastStatus) {
      lastStatus = room.status;
      return;
    }
    controllerCleanup?.();
    controllerCleanup = null;

    if (room.status === "host-disconnected") {
      section.innerHTML = `<h1>Reconnecting to Host…</h1><p class="hero-copy">Sit tight — your slot is saved.</p>`;
    } else if (room.status === "countdown" || room.status === "in-progress") {
      section.innerHTML = `<div class="countdown-overlay" id="phone-countdown"></div><div id="controller-mount"></div>`;
      controllerCleanup = mountControllerView(section.querySelector("#controller-mount")!, {
        nickname: self.nickname ?? "Player",
        color: self.color,
        roundId: room.roundId ?? ""
      });
    } else {
      renderReadyScreen(room, self.color);
    }
    lastStatus = room.status;
  }
  socket.on(SOCKET_EVENTS.ROOM_STATE, onRoomState);

  emitWithAck<ValidateTokenResponse>(SOCKET_EVENTS.CONTROLLER_VALIDATE_TOKEN, {
    roomId,
    playerNumber: Number(playerNumber),
    token
  } satisfies ValidateTokenRequest)
    .then((validated) => {
      if (!cancelled) renderNicknameForm(validated);
    })
    .catch((err: { message?: string }) => {
      if (cancelled) return;
      section.innerHTML = `<h1>Invalid or Expired Link</h1><p>${err.message ?? "This QR code is no longer valid."}</p>`;
    });

  function renderNicknameForm(validated: ValidateTokenResponse): void {
    section.style.setProperty("--player-color", validated.color);
    section.innerHTML = `
      <p class="eyebrow">PLAYER ${playerNumber}</p>
      <h1 class="glow-text">Join the Arena</h1>
      <form id="nickname-form" class="nickname-form">
        <input id="nickname-input" type="text" maxlength="20" placeholder="Your nickname" autocomplete="off" value="${validated.nickname ?? ""}" required />
        <div id="nickname-submit"></div>
      </form>
      <p class="error-text" id="join-error" hidden></p>
    `;
    const form = section.querySelector<HTMLFormElement>("#nickname-form")!;
    const input = section.querySelector<HTMLInputElement>("#nickname-input")!;
    const submitSlot = section.querySelector<HTMLDivElement>("#nickname-submit")!;
    const errorEl = section.querySelector<HTMLParagraphElement>("#join-error")!;
    const submitButton = createButton({ label: "Join Game", variant: "primary" });
    submitButton.type = "submit";
    submitSlot.appendChild(submitButton);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.hidden = true;
      submitButton.disabled = true;
      try {
        const joined = await emitWithAck<ControllerJoinResponse>(SOCKET_EVENTS.CONTROLLER_JOIN, {
          roomId,
          playerNumber: Number(playerNumber),
          token,
          nickname: input.value
        } satisfies ControllerJoinRequest);
        lastStatus = null;
        onRoomState(joined.room);
      } catch (err) {
        errorEl.textContent = (err as { message?: string }).message ?? "Could not join the room.";
        errorEl.hidden = false;
        submitButton.disabled = false;
      }
    });
  }

  return () => {
    cancelled = true;
    controllerCleanup?.();
    socket.off(SOCKET_EVENTS.ROOM_STATE, onRoomState);
    socket.off(SOCKET_EVENTS.GAME_COUNTDOWN_TICK, onCountdownTick);
  };
}
```

- [ ] **Step 5: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification — the full first-playable-milestone path**

Run: `npm run dev`. Tab A: Host a Game → Controller Test → 1 Player → lobby. Recover the join URL (as in Task 6/7) and open it in Tab B (phone-simulating tab, or an actual phone on the same Wi-Fi using the printed Network URL). In Tab B: submit a nickname, tap Ready. In Tab A: Start Game becomes enabled; click it. Confirm both tabs show a synced 3-2-1 countdown. After the countdown, Tab A shows a single colored circle on the canvas; Tab B shows JUMP/LEFT/RIGHT buttons in the same color with the nickname and a green connection dot. Press and hold LEFT in Tab B — the circle moves left on Tab A with no perceptible lag; release — it stops. Press RIGHT similarly. Tap JUMP — the circle arcs up and back down. This is the milestone described in the project requirements: host creates room → QR → phone joins → ready → start → JUMP → matching circle jumps.

- [ ] **Step 7: Commit**

```bash
git add client/src/controller/inputs/buttons.ts client/src/controller/controllerView.ts client/src/styles/controller.css client/src/pages/join.ts
git commit -m "Add phone controller input screen (JUMP/LEFT/RIGHT) wired to room status transitions"
```

---

### Task 11: Reconnection and Cleanup Handling

**Files:**
- Modify: `client/src/pages/hostLobby.ts`

**Interfaces:**
- Consumes: `SOCKET_EVENTS.HOST_RECONNECT`, `HostReconnectResponse` (Task 2, handled server-side in Task 4); everything already imported in `hostLobby.ts`.
- Produces: no new exports — this task closes the "Known gap" noted in Task 6 by making the host lobby resilient to page reloads and brief host-side disconnects, and is otherwise a verification-heavy task exercising behavior already implemented server-side in Task 4 (host-disconnected pause/grace timer, player reconnect-by-token, duplicate-slot rejection) and client-side in Task 10 (phone "Reconnecting to Host…" screen, stuck-input release).

- [ ] **Step 1: Modify `client/src/pages/hostLobby.ts`** — reconnect on mount and handle `host-disconnected` status

Add the import:

```ts
import type { HostReconnectResponse } from "../../../shared/protocol";
```

Replace the line `renderRoom(session.room);` with:

```ts
  emitWithAck<HostReconnectResponse>(SOCKET_EVENTS.HOST_RECONNECT, {
    roomId,
    hostToken: session.hostToken
  }).then(
    ({ room }) => renderRoom(room),
    () => {
      sessionStorage.removeItem(`pocket-arena:host:${roomId}`);
      navigate("/");
    }
  );
```

Add a reconnecting banner element to the initial `container.innerHTML` template, immediately after the `<div class="lobby-grid" ...></div>` line:

```html
      <p class="reconnecting-banner" id="reconnecting" hidden>Reconnecting…</p>
```

Grab a reference to it alongside `gridEl`/`footerEl`:

```ts
  const reconnectingEl = container.querySelector<HTMLParagraphElement>("#reconnecting")!;
```

At the top of `renderRoom`, before the existing game-view-toggle logic, add the host-disconnected branch:

```ts
  function renderRoom(room: PublicRoomState): void {
    if (room.status === "host-disconnected") {
      gridEl.hidden = true;
      footerEl.hidden = true;
      gameSectionEl.hidden = true;
      reconnectingEl.hidden = false;
      lastStatus = room.status;
      return;
    }
    reconnectingEl.hidden = true;

    const isPlaying = room.status === "countdown" || room.status === "in-progress";
    // ...unchanged from Task 9 onward
```

(The rest of `renderRoom`'s body — the `isPlaying`/`wasPlaying` game-view toggle and the `lobby` status grid rendering — stays exactly as Task 9 left it.)

- [ ] **Step 2: Add the reconnecting banner style to `client/src/styles/components.css`**

```css
.reconnecting-banner {
  text-align: center;
  color: var(--color-text-dim);
  font-size: 1.2rem;
  padding: 3rem 0;
}
```

- [ ] **Step 3: Run type-checking**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification — full reconnection/duplicate/stuck-input matrix**

Run `npm run dev` and, using multiple tabs (host tab + 2 player tabs), work through each scenario and confirm the listed outcome:

1. **Host page reload:** with a room in the lobby, refresh the host tab. Expect: the lobby re-renders with the same room code and player states (via the new `host:reconnect` call), Start Game re-enables correctly once conditions are met.
2. **Player disconnect/reconnect, no duplicate:** with a player joined and ready, close that player's tab, confirm the host lobby shows "Disconnected" for that slot within a second or two. Re-open the original join URL (from sessionStorage-backed history or a saved copy) in a new tab — confirm it reconnects into the *same* slot (nickname preserved, no new slot created) and the host lobby shows it as Connected/Ready again.
3. **Duplicate slot claim:** while a player tab is actively connected, open its exact join URL in a second, separate tab — confirm the second tab is rejected with an "already connected on another device" error and the first tab is unaffected.
4. **Host disconnect mid-lobby:** with players connected, close the host tab. Confirm both player tabs transition to "Reconnecting to Host…" within a second or two. Re-open the host lobby URL — since `sessionStorage` is tab-scoped, do this by reopening the same physical tab (e.g. undo-close) so the stored `hostToken` is present; confirm the room returns to `lobby` and both player tabs return to their ready screens with prior ready state intact.
5. **Stuck input on backgrounded tab:** during an active round, press and hold LEFT on a phone tab, then switch OS-level focus away from the browser (or switch browser tabs) without releasing the pointer. Confirm the circle on the host stops moving (does not drift indefinitely) because `visibilitychange`/`blur` released the button client-side.
6. **Stuck input on disconnect:** during an active round with a player holding RIGHT, close that player's tab entirely. Confirm the circle stops moving immediately on the host (server-side `resetPlayerDirection` on socket disconnect), rather than continuing to drift.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/hostLobby.ts client/src/styles/components.css
git commit -m "Make host lobby resilient to reload/reconnect and add host-disconnected banner"
```

---

### Task 12: Styling and Responsive Design

**Files:**
- Modify: `client/src/styles/global.css`
- Modify: `client/src/styles/components.css`
- Modify: `client/src/styles/controller.css`
- Create: `client/src/styles/animations.css`
- Modify: `client/src/main.ts`

**Interfaces:**
- Consumes: nothing new — this task is a pure visual polish pass over markup already produced by Tasks 5–11. No component/page function signatures change.

- [ ] **Step 1: Create `client/src/styles/animations.css`**

```css
@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse-glow {
  0%,
  100% {
    box-shadow: 0 0 24px rgba(59, 130, 246, 0.35);
  }
  50% {
    box-shadow: 0 0 40px rgba(168, 85, 247, 0.55);
  }
}

.page-section {
  animation: fade-in 0.35s ease both;
}

.card,
.lobby-slot,
.game-card {
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.card:hover,
.lobby-slot:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--color-cyan) 40%, var(--color-border));
}

.status-ready {
  animation: pulse-glow 2.2s ease-in-out infinite;
}
```

- [ ] **Step 2: Modify `client/src/main.ts`** — import the new stylesheet

Add after the existing `import "./styles/components.css";` line:

```ts
import "./styles/animations.css";
```

- [ ] **Step 3: Modify `client/src/styles/global.css`** — append responsive breakpoints and typography refinement

```css
@media (max-width: 480px) {
  .page-section {
    padding: 2rem 1rem;
  }
  .hero-title {
    font-size: clamp(1.75rem, 8vw, 2.5rem);
  }
}

::selection {
  background: color-mix(in srgb, var(--color-cyan) 40%, transparent);
}

button,
input {
  font: inherit;
}
```

- [ ] **Step 4: Modify `client/src/styles/components.css`** — responsive grids and lobby header stacking

Append:

```css
@media (max-width: 640px) {
  .lobby-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }
  .game-grid,
  .lobby-grid {
    grid-template-columns: 1fr;
  }
  .lobby-footer {
    flex-direction: column;
  }
  .lobby-footer .btn {
    width: 100%;
  }
}

.game-card:not(.game-card-disabled):hover {
  border-color: color-mix(in srgb, var(--color-purple) 50%, var(--color-border));
}
```

- [ ] **Step 5: Modify `client/src/styles/controller.css`** — portrait-mode sizing guarantees

Append:

```css
@media (orientation: portrait) {
  .jump-button {
    min-height: 40vh;
  }
  .dpad-button {
    font-size: 1.1rem;
  }
}

@media (max-height: 600px) {
  .jump-button {
    min-height: 30vh;
    font-size: 1.8rem;
  }
  .dpad-row {
    height: 4.5rem;
  }
}
```

- [ ] **Step 6: Run type-checking**

Run: `npm run typecheck`
Expected: no errors (CSS-only changes plus one import line).

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. Resize the browser to a narrow (< 480px) width and confirm: the landing hero text scales down and stays readable, the game-selection grid and lobby grid collapse to a single column, the lobby footer buttons stack full-width. Using the browser's device toolbar in phone/portrait mode, open the join → controller flow and confirm the JUMP button occupies a large, comfortably tappable area and LEFT/RIGHT remain easily reachable with thumbs. Confirm hover states on cards (desktop) show a subtle lift and border glow, and a "Ready" player card has a soft pulsing glow.

- [ ] **Step 8: Commit**

```bash
git add client/src/styles/animations.css client/src/styles/global.css client/src/styles/components.css client/src/styles/controller.css client/src/main.ts
git commit -m "Polish dark arena theme: animations, hover/glow states, responsive breakpoints"
```

---

### Task 13: Full Verification and Production Build

**Files:**
- Modify: `README.md`
- No source files created or modified beyond documentation — this task is a verification and sign-off pass.

**Interfaces:**
- Consumes: the entire application built across Tasks 1–12.
- Produces: nothing new — confirms the "Final checks" from the project requirements are all satisfied.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: all suites pass — `shared/protocol.test.ts`, `server/rooms.test.ts`, `server/socketHandlers.test.ts`, `server/games/controllerTest.test.ts`.

- [ ] **Step 2: Run type-checking**

Run: `npm run typecheck`
Expected: no errors across client and server configs.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: `vite build` completes and writes `dist/client/`; `esbuild` completes and writes `dist/server/index.js`. Fix any build errors before proceeding (common culprits: a stray dev-only import outside the `if (!isProduction)` branch in `server/index.ts`, or a client file importing a Node-only module).

- [ ] **Step 4: Run the production server and smoke-test it**

Run: `NODE_ENV=production npm start`
Expected terminal output: the same `Local:`/`Network:`/`QR codes will use:` banner as dev. Open the printed Local URL — the full landing page renders (confirms static file serving + SPA fallback work). Navigate directly to a nonexistent deep link, e.g. `http://localhost:3000/host/lobby/ZZZZZ` — confirm it does not 404 as a raw file-not-found (the Express SPA fallback should serve `index.html`, and the client router then shows its own "Page Not Found" or redirects, rather than a bare Express/browser error page).

- [ ] **Step 5: Full manual play-through against the production build**

With the production server still running from Step 4, repeat the complete milestone from Task 10 Step 6 (host creates a room, phone joins via the printed Network URL, ready up, start, countdown, JUMP/LEFT/RIGHT move the matching circle) — this time using the LAN URL from an actual second device if available, not just a second browser tab. Confirm QR codes decode (via a phone camera or QR reader) to a URL of the form `http://<lan-ip>:3000/join/<ROOMCODE>/<N>?token=<...>`, matching spec §9.

- [ ] **Step 6: Re-run the multi-scenario reconnection matrix from Task 11 Step 4**

Confirm all six scenarios (host reload, player disconnect/reconnect without duplication, duplicate slot rejection, host disconnect mid-lobby, stuck input on backgrounding, stuck input on disconnect) still pass against the production build.

- [ ] **Step 7: Confirm full-room and invalid-link handling**

Create a 1-player room, join and claim its only slot, then attempt to open `/join/<ROOMCODE>/2?token=anything` (a player number beyond `maxPlayers`) — confirm it shows the invalid-link error screen rather than crashing. Attempt to open `/join/<ROOMCODE>/1` with no `token` query parameter at all (assuming no prior visit left one in `sessionStorage` for that room/player pair, e.g. in a fresh private/incognito window) — confirm it shows "Invalid Link".

- [ ] **Step 8: Finalize `README.md`**

Re-read the file created in Task 1 and confirm every command in it (`npm install`, `npm run dev`, `npm run build`, `npm start`, `npm run typecheck`, `npm test`) matches the final `package.json` scripts exactly, and that the Wi-Fi/QR instructions match the actual behavior verified in Step 5. If `package.json` gained any scripts this plan didn't originally list, add them to the README. No functional change is expected — this is a documentation accuracy check.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "Complete Pocket Arena v1: verified build, tests, and end-to-end multi-device play"
```

If Step 8 required no README changes and no other files changed, skip this commit — there is nothing new to commit.

---

## Plan Self-Review

**Spec coverage:** Every numbered section of `docs/superpowers/specs/2026-07-11-pocket-arena-design.md` maps to a task — §2 architecture → Task 1; §3 structure → all tasks; §4 data model → Task 3; §5 identity-on-socket → Task 4; §6 protocol → Tasks 4 & 8; §7 host-disconnect pause → Tasks 4, 8, 11; §8 stuck-input prevention → Tasks 4, 10, 11; §9 pages/routing/cleanup functions → Tasks 5–7, 9–11; §10 Controller Test physics/rendering → Tasks 8–9; §11 error matrix → Tasks 4, 6, 7, 13; §12 cleanup rules → Tasks 3, 4, 8; §13 manual verification plan → Tasks 10, 11, 13. All 12 brainstorming corrections (identity-on-socket, all-slots-required, public/internal split, leave-event semantics, host-disconnect pause, countdown-in-state, stuck-input handling, volatile snapshots, secure tokens/room-code collision loop, strict cleanup, page cleanup functions, `GameRenderer` interface with interpolation) are each implemented in a specific task and cross-referenced above.

**Placeholder scan:** No task contains "TBD", "add error handling", or unshown code. Every step that changes code shows the complete code for that change. The two places that intentionally defer behavior to a later task (Task 4's `input:action` storing intent without a tick loop; Task 7's `join.ts` without live status handling) are explicitly called out as sequencing, with the consuming task named, not left ambiguous.

**Type consistency:** Verified `PublicRoomState`/`InternalRoom`/`InternalPlayer` field names are used identically from Task 2 through Task 13 (`playerNumber`, `nickname`, `connected`, `ready`, `status`, `roundId`, `countdownEndsAt`). `ControllerTestRenderer` (Task 9) and `ButtonInputSource`/`mountControllerView` (Task 10) consume exactly the `GameStatePayload`/`InputActionPayload`/`CountdownTickPayload` shapes defined in Task 2. `roomChannel`, `allSlotsReady`, `toPublicRoomState`, `createToken` (Task 3) are imported by name, unchanged, in Tasks 4 and 8. `startPhysicsLoop`/`stopPhysicsLoop`/`resetAllDirections`/`resetPlayerDirection` (Task 8) match the call sites added to `server/socketHandlers.ts` in that same task's Step 4.

**Dependency order check:** No task imports a symbol before the task that creates it. Task 4 references `startPhysicsLoop`/etc. only in its Step-4-deferred description (actually wired in Task 8, not Task 4) — confirmed Task 4's own code never imports `server/games/controllerTest.ts`. Task 9's `hostLobby.ts` edits build on the exact `renderRoom`/`gridEl`/`footerEl`/`socket` locals Task 6 created. Task 10's full `join.ts` rewrite builds on the exact `tokenKey`/`renderNicknameForm` structure Task 7 created. Task 11's `hostLobby.ts` edits build on the exact `renderRoom` signature Task 9 left it in. No circular imports: `server/rooms.ts` has no dependency on `server/socketHandlers.ts` or `server/games/controllerTest.ts`; both of those import from `server/rooms.ts`, never the reverse.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-pocket-arena-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
