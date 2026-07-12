# Racing Motion Controller — Design Spec

Date: 2026-07-12
Status: Approved for implementation

## 1. Overview

Adds a second playable game to Pocket Arena: **Racing** (working title "Pocket
Formula" / "Formula Motion GP"), controlled entirely by phone motion — the
player holds their phone like a steering wheel and tilts it forward/back to
throttle/brake. No touch buttons during gameplay; touch is reserved for
mandatory setup (enable motion, grant permission, calibrate, ready).

This replaces an earlier, discarded touch-button racing prototype (steer/drive
"buttons" bolted into the Controller Test physics module). That prototype is
preserved out-of-tree (`git stash`) for reference only; none of its code is
reused as-is.

### Non-goals for this phase

- No externally-sourced 3D models, textures, or audio files — see §7.4.
- No full vehicle-dynamics simulation (tire slip angles, weight transfer,
  understeer/oversteer) — the physics model (§6.1) gives real turning and
  rotation but is deliberately simplified; a proper tire model is future work.
- No ranked/competitive matchmaking, no persistent stats across sessions.
- Controller Test is untouched in behavior; the internal refactor in §5 is
  purely structural and must not change how it plays or looks.

## 2. Architecture & Module Boundaries

Racing is its own vertical slice, isolated from Controller Test at every
layer:

- `server/games/racing.ts` — physics tick, car state, collision, AI (later
  stage). No shared code with `server/games/controllerTest.ts`.
- `client/src/controller/inputs/motion.ts` — reusable motion-input state
  machine (§4), independent of `buttons.ts`.
- `client/src/controller/racingView.ts` — phone racing controller screen,
  parallel to `controllerView.ts`.
- `client/src/games/racing/` — Three.js renderer, track/car/scenery builders,
  camera, HUD glue. `client/src/games/controller-test/renderer.ts` is
  untouched except for the discriminated-union payload change (§3).
- `client/src/games/gameRenderer.ts`'s `GameRenderer<TState>` interface is
  unchanged; `RacingRenderer implements GameRenderer<RacingGameStatePayload>`.

## 3. Protocol: Discriminated `game:state`

`GameStatePayload` becomes a union keyed by `gameType`, so the two games'
snapshots can never be cross-consumed by the wrong renderer:

```ts
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
  progress: number;       // arc-length distance along the centerline, 0..trackLength
  lateralOffset: number;  // signed distance from centerline, meters
  headingError: number;   // radians, car heading relative to track tangent
  speed: number;
  rank: number;            // 1-based live placement
  lap: number;              // always 1 in this phase; field exists for future multi-lap
  finished: boolean;
  finishTime: number | null; // ms since race start, set once
}
export interface RacingGameStatePayload {
  gameType: "racing";
  roundId: string;
  trackId: string;
  raceStatus: "countdown" | "racing" | "finished";
  players: RacingPlayerState[];
}

export type GameStatePayload = ControllerTestGameStatePayload | RacingGameStatePayload;
```

`hostLobby.ts` narrows on `state.gameType` before calling the mounted
renderer's `applyState` (only one renderer is ever mounted per room, matching
`room.gameType`). This is a breaking change to Controller Test's existing
payload shape (adds `gameType`/`roundId` fields it didn't carry before) —
`toGameStatePayload` in `controllerTest.ts` is updated accordingly; no other
Controller Test behavior changes.

**New input event**, separate from `input:action` (three simultaneous analog
channels don't fit that event's single-action-plus-value shape):

```ts
export interface RacingInputPayload {
  steering: number;  // -1..1
  throttle: number;  // 0..1
  brake: number;     // 0..1
  sequence: number;
  roundId: string;
}
// SOCKET_EVENTS.RACING_INPUT = "racing:input"
```

Validated identically to `input:action`: identity from `socket.data.session`
only, rejected unless `room.status` is `countdown`/`in-progress` and
`roundId` matches, stale/duplicate `sequence` dropped (same pattern proven in
Controller Test, including the countdown-hold-through fix). No `timestamp`
field — the server has no use for client wall-clock time; `sequence` alone
orders packets.

## 4. Client Motion Controller (`inputs/motion.ts`)

```ts
type MotionState =
  | "insecure-context"
  | "unavailable"
  | "permission-required"
  | "permission-denied"
  | "await-landscape"
  | "await-calibration"
  | "sensor-timeout"
  | "ready";
```

One state visible on screen at all times — no silent failure.

- **`insecure-context`** is checked first, before anything else:
  `window.isSecureContext === false` shows "Motion controls need a secure
  connection — this page was opened over plain HTTP" and blocks all further
  steps. (See §8.)
- **`unavailable`**: no `DeviceOrientationEvent` in this browser at all.
- **Permission**: `requestPermission()` calls
  `DeviceOrientationEvent.requestPermission()` and
  `DeviceMotionEvent.requestPermission()` where present (feature-detected;
  most non-iOS browsers have neither and grant implicitly), only from the
  visible setup button. `permission-denied` is a distinct, visible state.
- **`await-landscape`**: derived from `screen.orientation.angle` (90/270)
  with a `window.innerWidth > innerHeight` fallback. Calibration cannot start
  while portrait.
- **Axis normalization**: `screen.orientation.angle` picks which raw sensor
  axis is "wheel rotation" (`rotation`) vs. "forward/back tilt" (`pitch`)
  before anything downstream sees them — solved once, centrally.
- **`await-calibration`**: a **guided, sign-confirming** flow, not a single
  tap, because raw axis *sign* (which direction is "more positive") is not
  guaranteed consistent across devices even after orientation normalization:
  1. *Center* — user holds the phone naturally, taps Center. Captures
     `neutralRotation`/`neutralPitch`.
  2. *Confirm right* — "Turn the phone slightly right, then tap Next."
     Reads the resulting `rotation`, computes
     `steeringSign = Math.sign(rotation - neutralRotation) || 1` — this
     becomes a per-session multiplier so "physically right" always outputs
     positive steering regardless of device quirks.
  3. *Confirm tilt* — "Tilt the top edge away from you, then tap Next."
     Same idea: `throttleSign = Math.sign(pitch - neutralPitch) || 1`.
  4. *Return to neutral, complete* — transitions to `ready` (or
     `sensor-timeout` if no events were ever observed during steps 1–3, see
     below).
  This whole flow is an internal sub-state of `await-calibration`
  (`calibrationStep: "center" | "confirm-right" | "confirm-tilt" | "done"`),
  not a new top-level `MotionState` — the union stays exactly the 8 values
  above.
- **`sensor-timeout`**: if calibration is started but no `deviceorientation`
  event has been observed within 3000ms, transition here instead of hanging
  on `await-calibration` forever. Message: "No motion data was detected.
  Check browser permissions or try recalibrating." A Recalibrate action
  retries from Center.
- **Staleness, not just states, guards against stuck input**: the module
  only computes a nonzero `{steering, throttle, brake}` from events received
  within the last 300ms; if the freshest event is older than that (sensor
  silently stalls mid-session — some Android power-saving behavior does
  this), output is forced to zero regardless of `MotionState`. This is the
  client-side half of stuck-input protection; §6.4 is the server-side half.
  A mid-race stall does **not** force a state transition (that would be
  disruptive) — it just means the car coasts to a stop like releasing the
  pedal, and the server's own input timeout (§6.4) is the authoritative
  backstop either way.
- **Steering**: `(rotation - neutralRotation) * steeringSign`, dead zone 5°,
  clamped to ±35°, linearly mapped to **-1..1**, then light single-pole
  low-pass smoothing (small time constant — kills jitter, not
  responsiveness).
- **Throttle/brake**: `(pitch - neutralPitch) * throttleSign`, dead-zoned and
  clamped the same way; positive → `throttle: 0..1`, negative → `brake:
  0..1` (only one nonzero at a time).
- **Output cadence**: internal sampling runs as fast as events arrive; a
  fixed ~30Hz timer emits the latest (possibly zero, per staleness above)
  computed reading to `RACING_INPUT`.

## 5. Refactor: Room-Level Game State (affects Controller Test internals)

**This is a scoped structural refactor of already-shipped code**, done
before any racing-specific logic, with its own regression gate:

```ts
interface ControllerTestPhysics {
  x: number; y: number; vy: number; grounded: boolean; direction: -1 | 0 | 1;
}
interface ControllerTestGameState {
  gameType: "controller-test";
  players: Map<number, ControllerTestPhysics>;
}

interface RacingCarState {
  progress: number; lateralOffset: number; headingError: number; speed: number;
  yawRate: number; steering: number; throttle: number; brake: number;
  lastInputAt: number; lastSequence: number;
  rank: number; lap: number; finished: boolean; finishTime: number | null;
}
interface RacingGameState {
  gameType: "racing";
  trackId: string;
  cars: Map<number, RacingCarState>;
  finishOrder: number[];
  focusedPlayerNumber: number | null;
  startedAt: number | null;
  endedAt: number | null;
}

type InternalGameState = ControllerTestGameState | RacingGameState;

interface InternalRoom {
  // ...existing fields unchanged...
  gameState: InternalGameState | null; // null in "lobby"/"results"/"host-disconnected"
}
```

`InternalPlayer.physics` (today's flat, always-present Controller Test field)
is **removed**; `InternalPlayer.token`/`nickname`/`color`/`connected`/`ready`
etc. are untouched. `room.gameState` is `null` until `game:start` constructs
it fresh (Controller Test: one `ControllerTestPhysics` per slot at spawn
position; Racing: one `RacingCarState` per connected+ready player at a grid
start position along the chosen track), and is set back to `null` whenever
the round ends (`endRound`, one function, game-agnostic — it just nulls the
field, no per-field zeroing needed anymore).

Every function that touched `player.physics` moves to read/write
`room.gameState` narrowed to `ControllerTestGameState`:
`stepPhysics`/`toGameStatePayload`/`resetAllDirections`/`resetPlayerDirection`
in `controllerTest.ts`, and the `input:action` handler in `socketHandlers.ts`.

**Regression gate:** the existing Controller Test test suite
(`server/rooms.test.ts`, `server/games/controllerTest.test.ts`,
`server/socketHandlers.test.ts`) must pass unchanged in behavior after this
refactor (test *code* updates to match the new state shape, but assertions
keep the same intent), plus a full manual Controller Test playthrough
(host→QR→join→ready→start→countdown→JUMP/LEFT/RIGHT) before any racing code
is written on top. If this regresses, it blocks everything else.

## 6. Server Racing Physics (`server/games/racing.ts`)

### 6.1 Track-relative (Frenet-style) car model

The track is a **closed-loop spline** (Catmull-Rom through an ordered list of
waypoints) exposing, for any `progress` value (wrapping at `trackLength`):

- `centerlinePoint(progress) → {x, z}`
- `centerlineTangent(progress) → {x, z}` (unit vector, track direction)

A car's world position/heading is derived, never stored directly:

```text
worldPos    = centerlinePoint(progress) + lateralOffset * normalOf(tangent)
worldHeading = angleOf(tangent) + headingError
```

Per-tick update (fixed 60Hz step, §6.2):

```text
yawRate += (steering * steeringResponsiveness - yawRate * yawDamping) * dt
headingError += yawRate * dt              // clamped to ±80° — full spin-out is future work
speed += throttle>0 ? throttle*accel*dt : throttle<0 ? throttle*brakeForce*dt : -coastDrag*dt
speed = clamp(speed, 0, maxSpeed)
progress      += speed * cos(headingError) * dt   // forward component along track
lateralOffset += speed * sin(headingError) * dt   // sideways component — real drift, not a slide
lateralOffset  = clamp(lateralOffset, -trackHalfWidth*1.6, trackHalfWidth*1.6) // grass, not a wall
if |lateralOffset| > trackHalfWidth: speed *= offTrackSlowFactor   // off-track penalty
```

This is what makes the car visibly rotate and respond to turns instead of
sliding sideways while facing forward: `headingError` is a first-class,
player-influenced quantity that determines *which direction* the car's
forward motion actually points, and `progress`/`lateralOffset` are just the
track-relative decomposition of that motion. Understeer/oversteer (grip-based
slip, separate from steering input) is explicitly future work, not this
phase.

Starting tuning constants (analogous to Controller Test's `ARENA` block;
adjustable during implementation but given concrete starting values so the
plan doesn't need to invent them):

```ts
const RACING = {
  trackHalfWidth: 6,          // meters
  maxSpeed: 42,                // m/s (~150 km/h)
  acceleration: 14,            // m/s^2 at full throttle
  brakeForce: 22,               // m/s^2 at full brake
  coastDrag: 5,                  // m/s^2 when throttle/brake both ~0
  steeringResponsiveness: 2.4,  // yawRate gain from steering input
  yawDamping: 3.0,                // per-second decay of yawRate
  offTrackSlowFactor: 0.55         // speed multiplier while |lateralOffset| > trackHalfWidth
} as const;
```

### 6.2 Fixed 60Hz physics, 20Hz broadcast

```ts
const PHYSICS_STEP = 1 / 60;
```

A fixed-timestep accumulator (not naïve wall-clock delta per callback, which
is what Controller Test uses and is fine at its simpler scale but not here):
each `setInterval` firing (~16ms) adds the real elapsed time to an
accumulator; while `accumulator >= PHYSICS_STEP`, step once and subtract
`PHYSICS_STEP` (capped at 5 steps per callback to avoid a spiral-of-death if
the process stalls). This gives deterministic, jitter-resistant physics
regardless of Node's actual timer precision.

`game:state` is broadcast every 3rd physics step (60/3 = 20Hz), matching
Controller Test's existing cadence — client-side interpolation reuses the
same render-delay technique proven there (extracted into a small shared
helper both renderers call), tuned to the same one-broadcast-interval delay.
Phone input arrives ~30Hz (§4); laptop rendering runs at `requestAnimationFrame`
(~60Hz) reading the interpolated buffer.

### 6.3 Race order, no collisions yet (Stage 1) → simple separation (Stage 2)

Every tick, cars are sorted by `progress` descending (loop-aware: a car that
has completed more of the track ranks above one that hasn't, ties broken by
`lateralOffset` irrelevant) to compute live `rank`. **Stage 1** (this phase's
initial milestone): cars may visually overlap, no collision response —
matches the "focused prototype, not a full simulator" scope. **Stage 2**
(added before this phase is considered feature-complete, per §9): a simple
circle-radius overlap check between each car pair in track-space (arc-length
distance along the loop, shortest-path aware so it's correct near the
start/finish wrap), and on overlap, symmetric positional separation pushing
both cars apart along the separation vector proportional to overlap depth.
**Stage 3** (impact speed loss + vibration/screen-flash feedback) is grouped
with the polished-slice audio/feedback work in §7.3, not required for this
phase's playable milestone.

### 6.4 Input timeout (stuck-input protection, racing's version)

Each `RacingCarState` tracks `lastInputAt`. Every physics tick:

```text
if now - lastInputAt > 300ms:
  throttle = 0; brake = 0
  steering *= 0.9   // eases toward center, not an instant snap
```

Additionally, **immediately** (not gradually) zeroed on: controller socket
disconnect, host disconnect, round end, round ID change, and client-initiated
recalibration (the client also sends an explicit zeroed packet the instant
recalibration starts, so no stale reading lingers even before the timeout
would catch it). This mirrors Controller Test's proven
`resetPlayerDirection`/`resetAllDirections` pattern, extended for racing's
three-channel input.

## 7. Client Racing Renderer

### 7.1 Technical renderer (this phase's playable milestone)

`RacingRenderer implements GameRenderer<RacingGameStatePayload>` — same
`mount`/`applyState`/`render`/`destroy` contract as `ControllerTestRenderer`,
so `hostLobby.ts` needs no structural changes to support a second game, just
a `gameType`-based renderer choice at construction:

- `THREE.Scene` / `PerspectiveCamera` / `WebGLRenderer`.
- Track: an extruded ribbon/tube mesh following the centerline spline, a flat
  color material plus a canvas-generated texture for lane/edge lines (no
  external texture files).
- Cars: simple multi-primitive meshes (body box + wheel cylinders), colored
  per player's assigned color, oriented by `worldHeading` (§6.1) each frame —
  this alone proves the "car visibly turns" requirement visually.
- Shared two-snapshot interpolation (extracted from Controller Test, §6.2)
  applied to `progress`/`lateralOffset`/`headingError`.
- Chase camera following the focused car (`gameState.focusedPlayerNumber`,
  default: current leader); DOM-overlaid HUD (leaderboard, speed, progress,
  countdown) — cheaper than in-3D text and reuses the existing countdown
  overlay pattern.
- Single-player rooms: closer chase distance, no leaderboard clutter beyond
  "P1 / time trial."

### 7.2 Camera & multiplayer presentation

One shared camera, not four cockpit views (all players watch the same
laptop screen). Host can click a leaderboard row or a "cycle camera" control
to change `focusedPlayerNumber` (a host-only action, similar in spirit to
existing host controls); server just tracks the value on `RacingGameState`
for the host's convenience — it doesn't affect physics.

### 7.3 Polished vertical slice (later stage within this feature, not the initial milestone)

Everything below is achieved with **procedural Three.js geometry, materials,
lighting, and particle systems, plus Web Audio API-synthesized tones** — not
externally sourced 3D model files, textures, or audio recordings (confirmed
scope decision; this environment has no asset pipeline or licensing-clean
source for such files). Concretely: multi-part stylized car meshes (separate
body/spoiler/cockpit/wheel geometry with proper `MeshStandardMaterial`
roughness/metalness, not one box), canvas-generated road/curb/livery
textures, instanced barrier and grandstand/building geometry lining the
track, directional "sun" + ambient lighting with shadow maps, particle-sprite
tire smoke/dust and speed-streak effects (procedurally drawn sprite
textures), small procedural camera-shake on collision/high-speed, in-scene
countdown lights (emissive-material mesh, not DOM), a checkered
procedurally-textured finish banner, engine/collision tones synthesized via
oscillator nodes (pitch tied to `speed`), and original "Pocket Formula"
branding throughout (typography/color, no third-party marks). If real
glTF/audio assets become available later, the renderer's loader boundary
(`GLTFLoader`/`TextureLoader`/`AudioLoader`) is the natural drop-in point —
not part of this phase's scope.

### 7.4 Asset-sourcing constraint (explicit)

Restated for clarity since it shapes §7.1 and §7.3: no external 3D model,
texture, or audio *files* are sourced or fabricated anywhere in this feature.
Everything visual/audible is generated in code at runtime.

## 8. Phone Racing Controller Screen (`racingView.ts`)

One screen per `MotionState` (§4) — `insecure-context`, `unavailable`,
`permission-required`, `permission-denied`, `await-landscape`,
`await-calibration` (with its own guided sub-steps), `sensor-timeout`, and
`ready`. In `ready`: a large steering-wheel graphic rotating live with
`steering` (CSS `transform: rotate()`), a throttle bar and a brake bar, a
server-driven speed readout (from `game:state`, never predicted locally —
server stays authoritative), an always-visible **Recalibrate** button, and
the safety copy ("Hold phone securely"). No LEFT/RIGHT/accelerator/brake
touch controls anywhere in this screen during gameplay. A `?dev=1`-gated
keyboard fallback (arrow keys → synthetic steering/throttle/brake) exists
only behind an explicit, clearly-labeled dev-mode flag for desktop testing —
never reachable through the normal join flow.

## 9. Race Lifecycle (Results Screen)

```text
lobby → countdown → in-progress → results → (rematch: countdown again) | (change game: lobby)
```

`room.status` already includes `"results"` in the existing `RoomStatus`
union (defined in the original v1 spec, never previously reached — Controller
Test skips straight back to `lobby`). Racing is the first game to actually
use it: the server monitors during `in-progress` and, once every connected
player's car has `finished: true` **or** 180 seconds have elapsed since
`startedAt` (a safety timeout preventing a stalled last-place car from
blocking everyone indefinitely — any car still unfinished at that point is
marked `finished: true` with `finishTime: null`, ranked after all cars that
genuinely finished), stops the physics loop and transitions `room.status` to
`"results"`, snapshotting `finishOrder`/`finishTime`/best-speed-seen into
`room.gameState`.

Both host and phones render a results screen off this status: final ranking,
finish time, best speed, player colors, and two host actions — **Rematch**
and **Return to Lobby / Change Game** — which both call the *existing*,
already-shipped `game:end` (already transitions any status back to `"lobby"`
without touching `player.ready`, which is exactly the behavior needed: ready
players stay ready). The only difference between the two buttons is where the
host ends up afterward — the same lobby page (rematch: press the existing
Start Game button again once ready) or navigating to `/host` (change game).
**No new lifecycle socket events are needed** — `game:end`, `game:start`, and
ready-state persistence already provide everything this requires.

## 10. Single-Player Mode

This phase's milestone: **time trial** — a 1-player room races alone against
the clock, `rank` is trivially 1, `finished` triggers results normally.
**Later stage** (grouped with §7.3's polish work): 3–7 simple AI cars,
targeting the centerline (`lateralOffset → 0`) with throttle modulated by
upcoming track curvature (look ahead N units along the spline; reduce target
speed proportionally to curvature) — enough to feel present without a full
racing-line/opponent AI system. AI cars fill empty grid slots in both
single-player and under-populated multiplayer rooms once implemented.

## 11. HTTPS / Secure Context

`MotionInputSource` checks `window.isSecureContext` first, before any
permission request — plain LAN HTTP shows the `insecure-context` state with
clear copy rather than silently receiving `null` sensor values (matches the
existing project-wide principle: nothing fails silently). Development/testing
uses browser sensor emulation (Chrome DevTools' Sensors panel) — documented
in the README, not a code fallback. Controller Test's existing HTTP flow is
completely unaffected; this constraint is racing-specific.

## 12. Delivery Stages

Mirrors the requested work sequence, each stage independently verifiable
before the next starts:

1. Motion permission + secure-context handling, on-screen state only (no
   track, no server).
2. Landscape gate + axis normalization + guided calibration + live debug
   readout (raw steering/throttle/brake numbers on screen, still no
   networking).
3. `racing:input` wired to the server; server validates and stores values
   (no physics integration yet — just confirms the pipe works).
4. §5's `InternalGameState` refactor, with its regression gate, landing
   *before* any racing physics is written.
5. §6.1–6.2 physics on a single test track, single car, proving the
   track-relative model and 60Hz/20Hz split.
6. Multiplayer: multiple cars, live rank, §6.3 Stage 1 (no collision).
7. §9 results screen + rematch, closing the full lifecycle loop.
8. §7.1 technical Three.js renderer replacing any interim debug visualization.
9. §6.3 Stage 2 (simple collision/separation).
10. §7.3 polished vertical slice + §10's AI opponents + §6.3 Stage 3
    (impact feedback), as a distinct later pass — not required for this
    feature to be considered a working playable milestone.

Stages 1–7 constitute this phase's "first playable" bar — motion-controlled,
multiplayer-capable, real turning physics, full lobby→results loop, plain
(non-polished) visuals. Stages 8–10 are explicitly a follow-on pass.

## 13. Testing Plan

Automated, where practical (mirrors the project's existing vitest
conventions):

- Orientation normalization: landscape-left vs. landscape-right produce
  correctly swapped/signed `rotation`/`pitch` for identical raw
  `beta`/`gamma` input.
- Calibration: neutral capture, `steeringSign`/`throttleSign` derivation from
  synthetic "turned right"/"tilted forward" readings.
- Dead zone and clamping: values inside the dead zone map to exactly 0;
  values beyond max tilt clamp to exactly ±1.
- Smoothing: a step input converges toward the target without overshoot,
  within a bounded number of samples (not "exactly equals" — smoothing is
  inherently gradual).
- Server: stale-sequence rejection, wrong-`roundId` rejection, input timeout
  decay (300ms → zeroed throttle/brake, steering easing), immediate reset on
  disconnect/round-end/round-change.
- Physics: a full-throttle straight-line run increases `progress` and
  `speed`; a sustained steering input increases `|headingError|` and, given
  nonzero speed, increases `|lateralOffset|` — confirming the car turns
  rather than only sliding.
- Regression: the full existing Controller Test suite continues to pass
  after §5's refactor.

Manual (sensor emulation where a physical device isn't available, consistent
with §11):

1. Neutral calibrated phone → near-zero steering.
2. Rotate left → negative steering; rotate right → positive.
3. Forward tilt → increasing throttle; backward tilt → increasing braking.
4. Return to neutral → no large unintended input (dead zone holding).
5. The laptop car turns and moves smoothly, no visible stutter.
6. No gameplay touch arrows appear on the Racing phone controller at any
   `MotionState`.
7. Existing Controller Test (join, ready, JUMP/LEFT/RIGHT) still works
   unchanged after the §5 refactor.

## 14. Known Limitations (this phase)

- No real vehicle-dynamics tire model (grip/slip) — turning is responsive
  but simplified; understeer/oversteer is future work.
- No car-to-car collision until Stage 2 lands (§6.3); no impact
  speed-loss/feedback until Stage 3, grouped with polish.
- Visuals/audio are procedural only until real assets (if ever) are supplied
  and wired through standard Three.js loaders — no AAA fidelity in this
  phase.
- AI opponents are a later-stage addition; the initial single-player
  experience is time-trial only.
- Multi-lap racing is representable in the data model (`lap` field) but not
  implemented — this phase is single-lap only.
