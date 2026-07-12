# Pocket Arena — v1 Design Spec

Date: 2026-07-11
Status: Approved for implementation

## 1. Overview

Pocket Arena is a local-network party-game platform. One laptop ("the host")
runs the shared game screen in a browser; players join from their phones by
scanning a QR code, which turns each phone into a game controller. This spec
covers the v1 foundation: the website shell, room/lobby/join flow, and one
playable minigame — **Controller Test** — that proves out the
host-authoritative networking model. Real sports/rhythm games (table tennis,
bowling, tennis, racing, rhythm battle) are stubbed as "Coming Soon" cards
only.

### Non-goals for v1

- No database or persistent accounts — everything lives in server memory and
  is lost on restart.
- No HTTPS — LAN HTTP is acceptable for button input. The controller input
  layer is structured so a secure-context input source (e.g. device motion)
  can be added later without reworking room/game plumbing.
- No real sports/rhythm game logic — only Controller Test is playable.
- No mid-game state restoration on host reconnect — the room returns to the
  lobby (see §6).

## 2. Architecture & Process Model

Single Node process, single HTTP port, in both dev and prod.

- `server/index.ts` creates one `http.Server`, attaches Express and
  Socket.IO to it, and listens on `0.0.0.0` so LAN phones can connect.
- **Dev:** `npm run dev` runs `tsx watch server/index.ts`. Vite is imported
  **dynamically**, only inside the non-production branch, so a production
  install (which may skip devDependencies) never needs the `vite` package:

  ```ts
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "custom" });
    app.use(vite.middlewares);
  }
  ```

  Express API routes and Socket.IO are registered **before** the Vite
  middleware so `/api/*` and `/socket.io/*` are never swallowed by Vite's
  catch-all.
- **Prod:** `npm run build` runs `vite build` (client → `dist/client`) and
  `esbuild` bundling `server/` + `shared/` into `dist/server/index.js`
  (`platform=node`, `format=esm`, `packages=external`, so `express`,
  `socket.io`, `qrcode` stay as real `node_modules` requires while our own
  relative imports get bundled and don't hit Node ESM extension issues).
  `package.json` keeps `"type": "module"`. `npm start` runs
  `node dist/server/index.js`, which serves `dist/client` as static files
  with an SPA fallback to `dist/client/index.html` for any non-API route,
  and attaches Socket.IO the same way as dev.
- **Network URL:** a `PUBLIC_BASE_URL` env var overrides automatic
  detection. If unset, the server scans `os.networkInterfaces()` for a
  private, non-loopback IPv4 address and falls back to `localhost` if none
  is found. On startup the server prints the local URL, the detected LAN
  URL(s), and the final URL actually used for QR codes, e.g.:

  ```text
  Local:    http://localhost:3000
  Network:  http://192.168.1.42:3000
  QR codes will use: http://192.168.1.42:3000
  ```

## 3. Project Structure

```text
pocket-arena/
├── client/
│   ├── index.html
│   └── src/
│       ├── pages/            (landing, host-game-select, host-player-count,
│       │                      host-lobby, join)
│       ├── components/       (QR card, player card, button, etc.)
│       ├── controller/
│       │   └── inputs/       (buttons.ts today; motion.ts later)
│       ├── games/
│       │   └── controller-test/  (GameRenderer impl + client physics interpolation)
│       ├── networking/       (typed socket.io client wrapper)
│       ├── styles/
│       └── types/
├── server/
│   ├── index.ts              (http/express/vite/socket.io bootstrap)
│   ├── rooms.ts               (Room store, InternalRoom, lifecycle/cleanup)
│   ├── socketHandlers.ts     (event wiring, delegates to rooms.ts + games/)
│   ├── games/
│   │   └── controllerTest.ts (server-authoritative physics tick)
│   └── types.ts
├── shared/
│   └── protocol.ts           (event names, payload types, PublicRoomState)
├── docs/superpowers/specs/   (this file)
├── package.json
├── tsconfig.json
├── tsconfig.client.json
├── tsconfig.server.json
├── README.md
└── .gitignore
```

- One root `package.json`, no workspaces. `express`, `socket.io`, `qrcode`
  are regular `dependencies` (needed at runtime in prod); `vite`,
  `typescript`, `tsx`, `esbuild`, `@types/*` are `devDependencies`.
- `shared/protocol.ts` is imported via plain relative paths from both
  `client/src` and `server/` — no path aliases.
- `tsconfig.json` holds shared compiler settings; `tsconfig.client.json`
  extends it and adds `DOM` lib for browser code; `tsconfig.server.json`
  extends it and adds `node` types. Type-checking is explicit, not build-mode:

  ```json
  "typecheck": "tsc -p tsconfig.client.json --noEmit && tsc -p tsconfig.server.json --noEmit"
  ```

## 4. Data Model

Internal server state is never sent to clients directly — a public snapshot
type is derived from it on every broadcast.

```ts
type RoomStatus = "lobby" | "countdown" | "in-progress" | "host-disconnected" | "results";
type GameType = "controller-test" | "rhythm-battle" | "table-tennis" | "bowling" | "tennis" | "racing";

interface InternalPlayer {
  playerNumber: number;
  token: string;              // secret, only ever sent once, inside that slot's QR/join URL
  nickname: string | null;
  color: string;               // fixed palette by playerNumber
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  physics: { x: number; vy: number; grounded: boolean; direction: -1 | 0 | 1 };
}

interface InternalRoom {
  id: string;                  // 5-char human-readable code
  gameType: GameType;
  maxPlayers: number;
  hostToken: string;           // secret, given to host client once on create-room
  hostSocketId: string | null;
  status: RoomStatus;
  statusBeforeHostDisconnect: RoomStatus | null;
  players: InternalPlayer[];   // length === maxPlayers, always
  roundId: string | null;
  countdownEndsAt: number | null;
  createdAt: number;
  hostGraceTimer: NodeJS.Timeout | null;
  physicsInterval: NodeJS.Timeout | null;
  countdownTimer: NodeJS.Timeout | null;
}

interface PublicPlayer {
  playerNumber: number;
  nickname: string | null;
  color: string;
  connected: boolean;
  ready: boolean;
}

interface PublicRoomState {
  id: string;
  gameType: GameType;
  maxPlayers: number;
  status: RoomStatus;
  roundId: string | null;
  countdownEndsAt: number | null;
  players: PublicPlayer[];
}
```

`PublicRoomState` (via `toPublicRoomState(room)`) is the **only** room shape
ever sent over `room:state`. Host tokens, player tokens, socket IDs, timer
handles, and physics handles never leave the server. QR URLs/data-URLs are
generated server-side and returned **only** to the host (in the
`host:create-room` ack) — never broadcast in `room:state`.

## 5. Security Model — Identity Bound to Socket

Tokens are used only for the three operations that establish identity:
`controller:join`, `controller:leave`/reclaim, and `host:reconnect`. Once a
socket is validated, its identity is stored server-side and trusted for the
rest of that connection's lifetime:

```ts
socket.data.session =
  | { role: "host"; roomId: string }
  | { role: "controller"; roomId: string; playerNumber: number };
```

Gameplay events (`input:action`, `player:ready`, `game:start`,
`controller:leave`) read `roomId`/`playerNumber` from `socket.data.session`,
**never** from the event payload. This means a connected player cannot spoof
another player's number, and gameplay packets don't repeatedly expose the
secret token on the wire.

Room codes stay short and human-readable (5 chars, uppercase, excludes
`0/O/1/I`) since they are not secrets — collision-checked on generation:

```ts
do { roomCode = generateRoomCode(); } while (rooms.has(roomCode));
```

Host and player tokens are generated with `node:crypto`, not `Math.random()`:

```ts
import { randomBytes } from "node:crypto";
function createToken(): string {
  return randomBytes(32).toString("base64url");
}
```

## 6. Socket.IO Protocol (`shared/protocol.ts`)

Reliable, ack-based, client → server:

| Event | Payload | Ack | Notes |
|---|---|---|---|
| `host:create-room` | `{ gameType, maxPlayers }` | `{ ok, roomId, hostToken, players: [{playerNumber, joinUrl, qrDataUrl}] }` | Generates all slot tokens/QRs up front |
| `host:reconnect` | `{ roomId, hostToken }` | `{ ok, room: PublicRoomState }` \| error | Re-binds `socket.data.session`, cancels grace timer, restores previous status **to `lobby`** (see §7) |
| `host:leave-room` | `{}` (host session already bound) | `{ ok }` | Destroys the room entirely |
| `controller:validate-token` | `{ roomId, playerNumber, token }` | `{ ok, color, gameType, maxPlayers }` \| error | Pre-join check for the join page, before nickname entry; does not claim the slot |
| `controller:join` | `{ roomId, playerNumber, token, nickname }` | `{ ok, room: PublicRoomState }` \| error | Claims (or reclaims, if reconnecting with matching token) the slot; binds `socket.data.session` |
| `controller:leave` | `{}` | `{ ok }` | Releases only that player's slot (nickname/ready cleared); does **not** touch the room |
| `player:ready` | `{ ready: boolean }` | `{ ok }` | Uses session identity |
| `game:start` | `{}` (host only) | `{ ok }` \| error | Requires `players.length === maxPlayers && players.every(p => p.connected && p.ready)` |
| `game:end` | `{}` (host only) | `{ ok }` | Ends the current round, returns room to `lobby`; room persists |
| `input:action` | `{ action, sequence, roundId }` | none (fire-and-forget) | `action ∈ left-start\|left-end\|right-start\|right-end\|jump`; rejected server-side unless `room.status === "in-progress"` and `roundId` matches the room's current `roundId`; `sequence` is monotonically increasing per socket, older/duplicate sequences are dropped |

Broadcast, server → client:

| Event | Payload | Delivery |
|---|---|---|
| `room:state` | `PublicRoomState` | reliable — sent to host + all controllers in the room on every meaningful change, including `countdownEndsAt`/`roundId` so a reconnecting device can recover without having seen earlier ticks |
| `room:closed` | `{ reason }` | reliable |
| `player:disconnected` / `player:reconnected` | `{ playerNumber }` | reliable — lightweight notifications alongside the `room:state` that follows |
| `game:countdown-tick` | `{ value: 3\|2\|1\|"go", roundId }` | reliable — presentation-only; `room:state.countdownEndsAt` remains the recovery source of truth |
| `game:state` | `{ roundId, players: [{playerNumber, x, y}] }` | **volatile** (`io.to(room).volatile.emit(...)`) — 20 Hz snapshots; stale frames are worthless once a newer one exists, so drops under backpressure are fine |

## 7. Room Lifecycle & Host-Disconnect Handling

```text
lobby → countdown → in-progress → results → lobby (game:end)
  │         │             │
  └─────────┴─────────────┴──→ host-disconnected (on host socket disconnect)
```

On host disconnect, **regardless of current status**:
1. Store `statusBeforeHostDisconnect = room.status`.
2. Stop the countdown timer and physics interval (both nulled out).
3. Set `status = "host-disconnected"`, broadcast `room:state`.
4. Every controller UI shows "Reconnecting to host…".
5. Start a 10-minute `hostGraceTimer`. On expiry: broadcast `room:closed`,
   fully tear down the room (see §10).

On host reconnect (`host:reconnect` within the grace window): cancel the
grace timer, and — for v1 — **always return to `lobby`** rather than
attempting to resume countdown/physics mid-round. This is simpler and
avoids desync bugs; a future version could restore `in-progress` state.

Player (non-host) disconnect does **not** change room status and does not
free the slot — it's marked `connected:false` and reserved indefinitely
while the room lives, so the same phone/token can reconnect any time via
`controller:join`.

## 8. Stuck-Input Prevention

Client (`controller/inputs/buttons.ts`): release all held directions on
`pointerup`, `pointercancel`, `blur`, `visibilitychange` (tab hidden), and
socket `disconnect`. The client does not emit `input:action` while the
socket is disconnected.

Server (`server/games/controllerTest.ts`): reset a player's `direction` to
`0` whenever: their socket disconnects, the host disconnects, `game:end`
fires, or the room's `roundId` changes. Inputs are rejected outright unless
`room.status === "in-progress"` and the packet's `roundId` matches the
room's current `roundId`; a per-socket monotonically increasing `sequence`
rejects duplicated/out-of-order packets.

## 9. Client Pages & Routing

A small (~40 line) History-API router in `client/src/networking/router.ts`
maps paths to render functions mounted into `#app`. **Every page/game view
render function returns a cleanup function** that removes DOM listeners,
cancels `requestAnimationFrame` loops, and detaches Socket.IO listeners —
invoked by the router before mounting the next page, preventing duplicate
listeners across navigation/reconnects.

- `/` — **Landing**: title, tagline "Turn Every Phone Into a Controller",
  description, large `Host a Game` button, smaller `How It Works` button,
  and a 5-step visual strip (open on laptop → choose game → friends scan QR
  → phones become controllers → start playing).
- `/host` — **Game selection**: cards for Rhythm Battle, Table Tennis,
  Bowling, Tennis, Racing, Controller Test — each showing title,
  description, min/max players, a CSS/icon illustration, and a
  Play/Coming Soon button. Only Controller Test's button is enabled.
- `/host/controller-test` — **Player-count selection**: 1/2/3/4 buttons;
  on selection calls `host:create-room`, stashes `{roomId, hostToken}` in
  `sessionStorage`, and navigates to the lobby.
- `/host/lobby/:roomCode` — **Host lobby**: room code, selected game,
  player count, one QR card per slot (player number, nickname,
  connection/ready status — Waiting/Connected/Ready/Disconnected), Start
  Game (disabled until the §6 all-slots-ready rule is met), Leave Room.
  Swaps in-place to the Canvas game view once `room:state.status` becomes
  `countdown`/`in-progress`.
- `/join/:roomCode/:playerNumber?token=...` — **Phone join**: on load,
  calls `controller:validate-token`; on success immediately strips the
  token from the visible URL via `history.replaceState` (keeping it in
  `sessionStorage`, keyed by `roomCode:playerNumber`, for reconnection) and
  shows a nickname form + assigned player number/color. On invalid/expired
  token, shows a clear error screen instead of crashing. After
  `controller:join` succeeds, shows a large `Ready` button; once ready,
  shows "Waiting for host…". Swaps in-place to the controller view
  (JUMP/LEFT/RIGHT, nickname, connection indicator) once the room enters
  `countdown`.

## 10. Controller Test Game

Server (`server/games/controllerTest.ts`) runs a 20 Hz tick per room while
`status === "in-progress"`: integrates `x` from `direction * SPEED`, applies
gravity to `vy`/`y` with ground clamping, and sets `grounded` on landing.
`jump` applies an upward impulse only if `grounded`. Broadcasts volatile
`game:state` snapshots each tick.

Client rendering uses a renderer interface designed for network snapshots
and future Three.js games:

```ts
interface GameRenderer<TState> {
  mount(container: HTMLElement): void;
  applyState(state: TState): void;
  render(timestamp: number): void;
  destroy(): void;
}
```

The Controller Test implementation (`client/src/games/controller-test/`)
mounts a `<canvas>`, drives `render()` via `requestAnimationFrame`, and
interpolates between the two most recently received 20 Hz `game:state`
snapshots for smooth on-screen movement despite the lower network tick
rate. A future Three.js game implements the same interface against a WebGL
canvas instead — the room/lobby/routing/socket code doesn't change.

Countdown: on `game:start` success, server sets `roundId` (new
`randomBytes`-based id), `countdownEndsAt = Date.now() + 3000`,
`status = "countdown"`, broadcasts `room:state`, then emits
`game:countdown-tick` at `3, 2, 1, "go"` one second apart before flipping
`status = "in-progress"` and starting the physics interval.

## 11. Error Handling Matrix

| Condition | Handling |
|---|---|
| Invalid/expired join link (bad token/room/player number) | `controller:validate-token` returns `ok:false`; join page shows an error screen, no crash |
| Room full / slot already claimed by a live socket | `slot-taken` ack error |
| Same token used by a second live socket while first still connected | rejected with "already connected on another device" |
| Host disconnects | room → `host-disconnected`; controllers show "Reconnecting to host…"; 10-min grace timer |
| Grace timer expires | `room:closed`, full teardown |
| Start Game pressed with an unready/disconnected slot | disabled client-side; re-validated and rejected server-side regardless |
| Stuck directional input (dropped `*-end`, backgrounded tab, disconnect) | client releases on `pointercancel`/`blur`/`visibilitychange`/`disconnect`; server resets on disconnect/host-disconnect/round-end/stale `roundId` |
| Out-of-order or duplicate `input:action` | dropped via per-socket `sequence` check |

## 12. Cleanup Rules

Every room teardown (`host:leave-room`, grace-timer expiry) clears: host
grace timer, countdown timer, physics interval, all player socket
associations, all sockets' `socket.data.session` for that room, Socket.IO
room membership (`socket.leave(...)`), and the room entry itself from the
in-memory store. `controller:leave` and `game:end` only clear the subset
relevant to a slot or a round, never the whole room.

## 13. Manual Verification Plan (pre-completion checklist)

- `npm run typecheck` and `npm run build` both pass clean.
- `npm run dev`: landing → host → controller-test → 2-player room created;
  QR codes decode to `http://<lan-ip>:PORT/join/<code>/<n>?token=...`.
- Two browser tabs (or a second device) join as player 1 and 2, submit
  nicknames, ready up; Start Game enables only once both are
  connected+ready.
- Countdown runs on host and both controllers; JUMP/LEFT/RIGHT on one
  controller moves only that player's circle on the host screen with no
  perceptible lag.
- Disconnect a controller mid-game (close tab) → its slot shows
  Disconnected, direction resets (no stuck movement), then reconnect via
  the same join URL restores it without creating a duplicate player.
  Disconnect and reconnect the host → controllers see "Reconnecting to
  host…" then return to lobby.
- `npm run build && npm start`, repeat the join/host flow once against the
  production server.

## 14. Known Limitations (v1)

- No HTTPS, so no device-motion/orientation controls yet (buttons only).
- Host reconnect always resets to lobby; no mid-round resume.
- No idle-room sweep beyond the host-disconnect grace timer — a
  created-but-abandoned room with a host that never disconnects (tab left
  open indefinitely) stays in memory. Acceptable for a local-network
  prototype; flagged for a future TTL sweep.
- Only Controller Test is playable; other game cards are inert placeholders.
