# Table Tennis — Design

## Goal

Turn "Table Tennis" from a catalog stub (`playable: false`, falls back to the generic Controller Test game state) into a real, playable 2-player game mode, following the same architectural pattern already proven by Racing: server-authoritative physics, phone-as-motion-controller via QR join, host screen renders the shared 3D scene.

## Non-goals

- Real physical spin/Magnus-effect ball simulation. Racing's own physics is deliberately arcade, not sim; Table Tennis follows the same precedent.
- More than 2 players (the catalog already fixes `minPlayers`/`maxPlayers` at 2).
- Tournament/multi-game match structure. One game (first to 11, win by 2) per room; rematch reuses the existing rematch flow to start a fresh game.
- Any change to Racing, the launcher, or shared infrastructure beyond what's generic enough that both games already depend on it (Socket.IO rooms, session auth, rematch/reconnect, QR join, HUD panel CSS).

## Architecture

Mirrors Racing's split exactly:

- **Server owns the ball.** A fixed-timestep physics loop (`server/games/tableTennis.ts`, structurally parallel to `server/games/racing.ts`) is the single source of truth for ball position/velocity, paddle positions, and score. Clients never simulate the ball — they only render interpolated server snapshots. This is non-negotiable: it's what makes two phones + one host screen agree on where the ball is.
- **Phone sends normalized input, never state.** Same contract as Racing's `racing:input`: the phone sends its intent (paddle target position, swing timestamp), the server decides what actually happens (collision, bounce angle, score). A malicious or buggy phone can't teleport the ball.
- **New types, additive only.** `TableTennisPlayerState`/`TableTennisGameState` join `RacingCarState`/`RacingGameState` in `server/types.ts`'s existing union pattern (`InternalGameState`); `TableTennisInputPayload`/`TableTennisPlayerStatePayload`/`TableTennisGameStatePayload` join the equivalent client-facing unions in `shared/protocol.ts`. No existing type is modified.

## Physics model

Table is a flat rectangle in the XZ plane (X = width, the axis paddles move along; Z = length, the axis the ball travels between the two ends). Net is a thin barrier at Z=0 dividing the two halves.

- **Ball**: position (x, y, z) + velocity (vx, vy, vz). Gravity pulls it down; it bounces off the table surface (Y=0) with energy loss, bounces off the two side edges (X bounds), and must clear the net (a ball at Z≈0 below net height is a fault, immediately scoring the other player).
- **Paddle**: each player's paddle has a target X position (driven by phone tilt, smoothed server-side the same way Racing smooths steering) and a fixed Z position near their own end of the table. A paddle-ball collision happens when the ball's Z crosses the paddle's Z band while X is within paddle-width of the paddle's current X and Y is within paddle-height of the table.
- **Swing**: the phone's tap sends a timestamped "swing" event. The server keeps the last swing timestamp per player; if a paddle-ball collision happens within a short window (~150ms) of a recent swing, the return gets extra speed and a steeper angle than a passive bounce. Outside that window, the paddle still returns the ball (a "block"), just with less pace — so a slow/late phone connection degrades to a weaker shot, never a missed collision entirely.
- **Scoring**: standard table tennis serve/rally rules simplified — whoever's end the ball fails to legally return from (goes out of bounds, into the net, or bounces twice on one side) concedes a point to the other player. First to 11, win by 2, ends the game and enters the existing results/rematch flow.
- **Reset between points**: ball resets to center, brief serve delay, matching Racing's countdown-before-GO pattern conceptually (reuse the existing `game:countdown-tick` event for this beat).

## Controller (phone)

Reuses `MotionInputSource` (`client/src/controller/inputs/motion.ts`) as-is — its calibration wizard, dead-zone/smoothing math, and axis normalization are already generic (`rotation`/`pitch` from beta/gamma). Table Tennis maps `rotation` to paddle X position instead of steering; `pitch` is unused (table tennis doesn't need a second continuous axis the way Racing needs throttle/brake).

New pieces:
- `client/src/controller/tableTennisView.ts` (parallel to `racingView.ts`): renders a paddle-position visualization instead of a steering wheel, a big tap-to-swing zone, and the same connected/motion/calibrated/ready status badges Racing already has.
- Tap-to-swing sends a lightweight `table-tennis:swing` event with a client timestamp; the server clock-skews it against its own receipt time the same way `racing:input` sequence numbers guard against stale packets.

## Renderer (host)

New `client/src/games/tableTennis/renderer.ts` implementing the existing `GameRenderer<TableTennisGameStatePayload>` interface (`mount`/`applyState`/`render`/`destroy>` — no changes to that interface or to how `hostLobby.ts` mounts renderers).

- Simple original 3D scene: a table (rounded-corner slab, matching the "cute and comfy" rounded/warm direction already established for Racing), a low net, two paddles (rounded, player-colored, matching Racing's per-player palette), a ball.
- Camera: fixed high side-on view showing the whole table and both paddles at once (this is a shared host screen, not per-player split-screen) — no chase-cam complexity needed.
- Same warm pastel sky/lighting palette as Racing's latest pass, so the two games read as one product.
- Snapshot interpolation for the ball/paddles follows the same buffered-interpolation approach as `RacingInterpolationBuffer`, adapted for a non-wrapping (rectangular, not circular-track) coordinate space.

## HUD

Compact score panel (top-left, matching Racing's already-shrunk leaderboard style): each player's score, whose serve it is. No lap/leaderboard complexity — 2 players, 1 number each.

## Testing

- `server/games/tableTennis.test.ts`: physics unit tests (ball bounces off table/walls, net fault detection, paddle collision within/outside swing window, scoring, win condition) — same style as `server/games/racing.test.ts`.
- Extend `server/socketHandlers.test.ts` coverage for the new `table-tennis:swing` event and game-start/state-broadcast flow, following the existing racing room-lifecycle test pattern.
- Manual Playwright verification pass (matching this session's established pattern): two-phone room join, neutral-paddle-stays-still safety check, a full point being scored, rematch.

## Implementation stages

Given the scope (comparable to everything built for Racing), this ships in stages, each independently testable/committable:

1. **Physics core**: server types, `tableTennis.ts` physics loop, unit tests. No rendering yet — verifiable via the test suite alone.
2. **Socket wiring**: `GAME_START` dispatch, `table-tennis:swing` handler, state broadcast — verifiable via extending `socketHandlers.test.ts`.
3. **Phone controller**: `tableTennisView.ts`, calibration reuse, swing button. Verifiable by joining as a controller and watching server-side accepted input (same `?dev=1` diagnostic pattern Racing uses).
4. **Host renderer**: 3D table/paddles/ball, camera, HUD. This is where it becomes visually playable.
5. **Polish pass**: palette match, effects (ball trail, paddle hit flash, point-scored celebration), performance check.

Each stage gets its own commit, matching this session's established practice.
