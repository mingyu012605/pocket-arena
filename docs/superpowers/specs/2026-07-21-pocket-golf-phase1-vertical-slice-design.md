# Pocket Golf - Cloudshore Golf Resort - Phase 1 Vertical Slice Design

Date: 2026-07-21
Status: Draft for review before implementation
Phase: Golf Phase 1 of 5 (Visual Proof)

## 1. Purpose

Build one polished, original vertical slice proving that a single Pocket Golf
shot — address, swing, impact, flight, landing, bounce, roll, rest, and
result — looks and feels like a finished arcade sports title, not a physics
sandbox. This phase intentionally excludes motion controls, QR joining,
multiplayer, multiple holes, complete scoring, and club selection so that
effort concentrates entirely on whether one shot feels great.

Full Pocket Golf is a large multi-subsystem feature (custom physics, phone
motion-control swing detection, cinematic camera, ~19 character animation
states, three hand-built holes, full sound library, turn-based multiplayer).
This spec deliberately scopes only the first of five phases; later phases
(phone motion controller, complete hole with terrain/wind/putting,
multiplayer turn order, three-hole course) are out of scope here and will get
their own specs once this slice is approved and feels right.

## 2. Current Technical Baseline

Captured by inspecting the repository on branch `racing/cycle-4-elevation`.

- Client is vanilla TypeScript + DOM (no React), bundled with Vite; server is
  Express + Socket.IO, bundled with esbuild, run in dev via `tsx watch`.
- Racing (`client/src/games/racing/`, `server/games/racing.ts`) is the
  project's only existing 3D game and is confirmed **100% Three.js**
  (`three@^0.170.0`) — the "Unity migration" commit on this branch was a
  safety backup before a migration that never happened; every commit since is
  further Three.js work. Racing is ~10,165 lines total; Sketch Relay (2D,
  DOM-only) is ~1,932 lines. Golf, being 3D, should expect to land nearer the
  Racing end of that range once complete, though Phase 1 alone is much
  smaller.
- There is **no central game registry**. Adding a real, selectable game
  today means touching `shared/protocol.ts`, `client/src/games/catalog.ts`,
  `server/socketHandlers.ts`, `server/rooms.ts`, `server/types.ts`,
  `client/src/pages/hostLobby.ts`, and `client/src/pages/join.ts`. Phase 1
  deliberately avoids all of these files (see Non-Goals).
- `client/src/controller/inputs/motion.ts` already implements a full
  iOS-permission-aware, calibrated, dead-zone-smoothed motion input pipeline
  for Racing's steering wheel, with a touch-fallback pattern in
  `racingView.ts`. Not used in Phase 1, but confirms the eventual Phase 2
  motion controller has a proven pattern to follow.
- `client/src/games/racing/audio.ts` is 100% Web Audio synthesis
  (oscillators/generated noise) with zero sound asset files, created lazily
  on a user gesture. Golf Phase 1 follows the same approach.
- Every mounted page/view in this codebase returns a cleanup function that
  the router (`client/src/networking/router.ts`) invokes before mounting the
  next page, to avoid leaking listeners/RAF loops/audio contexts across
  navigation. Golf's runtime must follow this convention.
- Vitest (`vitest@^2.1.8`) is the only test framework in use. The existing
  house style (seen in `server/games/sketchRelay.test.ts`,
  `client/src/controller/inputs/motion.test.ts`,
  `client/src/games/racing/interpolation.test.ts`) is: keep game/physics
  logic as small exported pure functions, unit-test those directly, and keep
  stateful orchestration thin. `@playwright/test` is an installed but
  currently-unused devDependency (no e2e specs exist yet in the repo).

## 3. Product Goal

Ship one polished, original golf-shot vertical slice at
`/golf-preview` (a temporary development route, not a catalog entry):

- A bright tropical resort tee scene — **Cloudshore Golf Resort** — with
  strong visual depth (fairway extending into the distance, rough, trees,
  ocean, a bunker, a green with a visible flag, sky and soft clouds).
- A clearly visible, large-enough-to-read original chibi golfer standing
  beside the ball, holding a visible club.
- A cinematic, state-driven camera: wide address composition (matching the
  reference screenshot's readability, not its content) → smooth transition
  at impact → chase behind/above the ball → wide tracking on long flight →
  landing → first bounce clearly shown → roll → rest, held long enough to
  read the result.
- Believable arcade ball physics: launch, gravity, drag, spin-influenced
  lift/curve, bounce, roll, terrain friction, and the ball eventually stops.
- Shot information: live distance during flight; carry, roll, total, max
  height, final terrain, and remaining distance to the hole after rest.
- Original Web Audio sound (whoosh, impact, bounce, rolling, result) and a
  small HUD that never covers the golfer, ball, fairway, landing area, or
  flag.
- One default club (a mid-iron) so the ball flight comfortably fits a single
  ~145 m hole; no club-selection UI yet.

This phase is complete only when the full sequence — address → swing →
synchronized impact → ball launch → cinematic flight → landing → bounce →
roll → rest → shot statistics — is demonstrably working end to end in a
browser, not just passing unit tests.

## 4. Non-Goals (Explicit Phase 1 Exclusions)

- No phone motion controls, no QR joining, no Socket.IO wiring for Golf, no
  entries added to `catalog.ts`/`socketHandlers.ts`/`rooms.ts`/
  `hostLobby.ts`/`join.ts`. Golf is reached only via the temporary
  `/golf-preview` route.
- No stub phone screens, stub multiplayer rooms, fake QR integration, or
  placeholder Socket.IO events "for later" — nothing fake, only real modules
  that later phases extend.
- No multiplayer, no turn order, no reconnection handling.
- No multiple holes, no scoring/par tracking, no hole-to-hole flow.
- No club selection UI (one club exists in code as a real
  `GolfClubDefinition`, but there is no picker).
- No wind, no putting-specific mode, no water/out-of-bounds penalty logic
  (the course has a bunker and visible ocean for depth/visual variety, but
  Phase 1's shot is not required to interact with water/OOB rules).
- No random shot-error term. Phase 1 shot direction is fully deterministic
  given identical input (see §7) — this is a deliberate simplification of
  the eventual "small bounded randomness" behavior, needed for repeatable
  testing, and will be revisited in a later phase.
- No sourced/external art or audio assets. Everything is procedurally built
  in code (geometry, materials, animation clips, synthesized audio) — this
  keeps the slice fully original and avoids a licensing/attribution pass.

## 5. Architecture

### 5.1 Route

`client/src/pages/golfPreview.ts` is registered at `/golf-preview` in
`client/src/networking/router.ts`, dynamically imported (matching Racing's
lazy-load pattern so other pages' bundles stay light). This file is thin: it
creates a container element, constructs `GolfRuntime`, calls `mount()`, shows
minimal dev-only on-screen instructions (aim/swing keys), and registers the
router's cleanup callback to call `runtime.dispose()`. It contains no golf
gameplay logic itself.

### 5.2 Module Layout

All gameplay code lives under `client/src/games/golf-preview/`:

```
client/src/games/golf-preview/
  types.ts             Shared types: GolfShotInput, TerrainType, ShotPhase,
                        GolfCameraMode, BallPhysicsState, ShotStatistics,
                        GolfClubDefinition
  runtime.ts            GolfRuntime — owns THREE.Scene/Camera/Renderer, the
                        fixed-timestep physics accumulator, wires every
                        subsystem together; mount(container)/dispose()
  course.ts              Procedural Cloudshore tee-hole geometry: tee,
                        fairway, rough, green, bunker, ocean, trees,
                        clubhouse, flag, sky/clouds; terrainAt(x,z) query;
                        exposes teePosition/holePosition
  golfer.ts              Procedural chibi rig (primitive Object3D hierarchy)
                        + club mesh + hand-authored AnimationClips +
                        AnimationMixer wrapper
  swingSequence.ts        Phase state machine driving the golfer's mixer;
                        fires onImpact() at the exact impact keyframe
  ballPhysics.ts          Pure fixed-timestep integrator: launch, gravity,
                        drag, spin, bounce, roll, terrain friction
  shotConfig.ts           GolfClubDefinition instance + pure
                        computeShotDirection/computeLaunch formulas
  cameraController.ts      State-machine cinematic camera, spring-damped
  shotStats.ts            Pure functions: carry/roll/total/height/remaining
                        from a recorded trajectory trace
  hud.ts                  DOM overlay: pre-shot info, live distance, timing
                        label, result panel
  audio.ts                Web Audio synthesis: whoosh/impact/bounce/roll/
                        result, lazy AudioContext on first user gesture
  input.ts                GolfShotInput type, InputSource interface, and
                        createKeyboardMouseInputRig() (temporary dev input)
```

Each module owns one concern and depends only on `types.ts` and the modules
it explicitly needs (e.g. `swingSequence.ts` depends on `golfer.ts` and
`shotConfig.ts`, but `ballPhysics.ts` has no dependency on Three.js at all).

### 5.3 Controller-Neutral Input Contract

Defined once in `input.ts`, used by `runtime.ts` without knowing whether the
concrete implementation is keyboard/mouse (Phase 1) or phone motion
(Phase 2+):

```ts
export type GolfShotInput = {
  power: number;       // 0..1, clamped
  timing: number;       // -1 (early) .. 0 (perfect) .. +1 (late), clamped
  faceAngle: number;    // clamped, left/right club-face error at impact
  swingPath: number;    // clamped, inside-out / outside-in swing path
  attackAngle: number;  // clamped, upward/downward angle of attack
};

export interface InputSource {
  onAimChange(cb: (deltaRadians: number) => void): void;
  onShotReady(cb: (input: GolfShotInput) => void): void;
  dispose(): void;
}
```

`runtime.ts` is handed an `InputSource` at construction time. Phase 1 passes
`createKeyboardMouseInputRig(container)`. A later phase can pass a
motion-based `InputSource` with no change to `runtime.ts`, `swingSequence.ts`,
`ballPhysics.ts`, `cameraController.ts`, or `hud.ts`.

**Phase 1 keyboard/mouse mapping**: Left/Right arrow keys adjust aim (within
a bounded cone) before the swing. Holding space/mouse-down runs an
oscillating power meter; release sets `power` to the meter's value at
release. A second timed tap against a moving marker sets `timing` (mapped to
`[-1, 1]`). `faceAngle`/`swingPath` derive primarily from the timing error
(early → hook, late → slice), with a small manual nudge available from
arrow keys held during the swing window; `attackAngle` defaults near the
club's natural loft. Exactly one `onShotReady` fires per completed swing
gesture (no swing can be double-triggered).

### 5.4 Per-Shot Control Flow

```
InputSource.onAimChange   → runtime rotates aim marker / camera yaw
InputSource.onShotReady(input) → swingSequence.play(input)
  → golfer AnimationMixer runs address → backswing → downswing
  → at the impact keyframe crossing: swingSequence fires onImpact() once
    → shotConfig.computeLaunch(club, input, aimDirection) → initial
      BallPhysicsState
    → ballPhysics begins fixed-timestep simulation
    → audio.playImpact(); hud.showTimingLabel(); camera → "impact" mode
  → golfer mixer continues into follow-through / watch-ball
  → cameraController tracks live ballPhysics state every frame
  → on ballPhysics.phase === "resting":
    → shotStats.compute(trajectoryTrace, holePosition) → hud.showResult()
    → golfer plays a reaction clip
```

The ball is launched **only** when `swingSequence` detects the animation
crossing its stored impact keyframe time — never on a timer and never
immediately when input arrives.

## 6. Course - Cloudshore Golf Resort (Tee Hole)

One polished tee-to-green layout, modeled after the spec's "Palm Bay" (par 3,
~145 m) for scale, built entirely from procedural Three.js geometry and
materials — no imported model files:

- **Sky/clouds**: gradient sky dome plus a handful of soft, slow-moving
  billboard/plane cloud clusters.
- **Ocean**: an animated plane along one side of the hole (simple
  vertex-displaced or shader-driven wave motion) for depth and resort
  atmosphere.
- **Fairway → rough → green**: distinguished by color/material, laid out as
  a fairway strip narrowing from tee to a green disk around the flag, with
  rough filling the rest of the playable area.
- **Bunker**: a small sand-textured depression short of the green.
- **Trees**: procedural palm trees (bent trunk cylinder + radial frond
  blades) and round stylized trees (trunk + sphere/cone canopy clusters)
  framing the hole.
- **Clubhouse silhouette**: simple box-and-pyramid-roof structure in the
  background for scene readability, not an interactive object.
- **Flag**: pole + cloth plane with wind-driven vertex sway at the hole
  position.
- **Lighting**: warm directional "sun" light with soft contact shadows, plus
  ambient fill, tuned so the golfer and ball read clearly against the
  fairway.

`course.ts` exposes `terrainAt(x, z): TerrainType` as a pure lookup, computed
analytically from the hole's simple geometric regions (green = disk around
the flag, bunker = a small ellipse short of the green, fairway = the
narrowing strip, rough = everything else in bounds). This is intentionally
not a heightmap system — Phase 1 is one hole with simple, flat-ish terrain;
a heightmap/slope system is future work if later holes need elevation.

## 7. Ball Physics & Shot Resolution

### 7.1 Fixed-Timestep Simulation

`ballPhysics.ts` is pure (no THREE dependency), so it is directly unit
-testable. `runtime.ts` drives it with a fixed-timestep accumulator inside
its `requestAnimationFrame` loop (target 120 Hz physics step), so the
simulation result is independent of actual render frame rate:

```ts
type BallPhysicsState = {
  position: Vector3;
  velocity: Vector3;
  spin: Vector3;
  phase: "flight" | "rolling" | "resting";
};

function stepBallPhysics(
  state: BallPhysicsState,
  dt: number,
  terrain: TerrainType,
): BallPhysicsState;
```

Per fixed step: gravity, quadratic air drag, a simple backspin-lift term
(lift proportional to backspin × speed) and sidespin curve. On ground
contact, a terrain-specific restitution/friction pair is applied (bunker
absorbs hard; fairway/green bounce cleanly and roll further); the ball
transitions `flight → rolling` once vertical velocity is negligible, then
`rolling → resting` once horizontal speed drops below a small threshold —
velocity is explicitly zeroed at that point so the ball provably stops
rather than asymptotically approaching zero forever.

### 7.2 Shot Direction & Launch

`shotConfig.ts` defines one real `GolfClubDefinition` (a mid-iron, all
fields from the eventual full club system present even though only one
instance exists) and two pure functions:

```ts
function computeShotDirection(aim: number, input: GolfShotInput): number;
function computeLaunch(
  club: GolfClubDefinition,
  input: GolfShotInput,
): { speed: number; launchAngle: number; backspin: number; sideSpin: number };
```

Direction combines aim + face-angle error + swing-path error + a
timing-derived hook/slice term. **No random term is added in Phase 1** (see
§4) — identical `GolfShotInput` always produces an identical shot, which is
both the intended "good input, repeatable result" behavior and what makes
this deterministically unit-testable.

## 8. Golfer Character & Animation

`golfer.ts` builds a chibi-proportioned puppet rig from primitives (sphere
head, capsule torso, cylinder limbs) as an `Object3D` hierarchy
(root → hips → {spine → {head, armL, armR}, legL, legR}), with bright solid
-color materials and a thin cylinder-shaft/box-head club parented to the
right-hand group so it moves with the swing automatically. The character is
sized to be clearly readable at the address camera's framing (roughly
20-30% of frame height, matching the reference's readability goal, not its
content).

Phase 1 animation states, each a hand-authored `THREE.AnimationClip` with
`QuaternionKeyframeTrack`s per joint, played through one shared
`AnimationMixer` using `crossFadeTo` so transitions blend rather than snap:

1. Idle / address
2. Backswing
3. Downswing
4. Impact (the exact club-to-ball contact pose)
5. Follow-through
6. Watch-ball
7. Good-shot reaction

`swingSequence.ts` stores the downswing clip's known impact keyframe time
(e.g. `IMPACT_TIME`). Every frame it compares the swing action's current
`.time` against that threshold; the first frame it crosses, it fires
`onImpact()` exactly once. This is the mechanism that guarantees the ball
launches on the animation reaching the ball, never before.

## 9. Camera System

`cameraController.ts` implements a state machine over
`GolfCameraMode = "shot-setup" | "impact" | "ball-chase" | "flight-wide" | "landing" | "rolling" | "ball-rest"`
(the full spec's list minus putting-specific modes, which aren't needed
without a green-play loop yet). Every position/look-at target is smoothed
through a reusable critically-damped spring utility, `dampVector3(current,
target, smoothTime, dt)`, rather than assigned directly — no abrupt
snapping, no jitter.

- **shot-setup**: behind/side of the golfer at roughly chest height, golfer
  filling ~20-30% of frame height, fairway and flag visible ahead — matching
  the reference screenshot's camera distance and readability.
- **impact**: a brief tighten toward the ball plus a small camera-shake
  impulse, then hands off smoothly to chase.
- **ball-chase**: `position = ball.pos - dir * chaseDistance + up *
  chaseHeight`, look-ahead target `ball.pos + dir * lookAhead`; chase
  distance grows with ball speed so the ball never fills the whole frame or
  gets lost.
- **flight-wide**: engages above a speed/height threshold for longer shots,
  pulling back to a three-quarter angle so the arc stays readable instead of
  showing mostly empty sky.
- **landing**: as the physics state crosses into `"rolling"`, the camera
  lowers and moves toward the real landing point read directly from
  `ballPhysics` (not predicted), so the first bounce is clearly shown.
- **rolling**: closer and lower, tracking behind/side, slowing as ball speed
  drops.
- **ball-rest**: holds on the stopped ball for a beat before the HUD result
  panel appears.

The camera must never clip through terrain/trees, never lose the ball, and
never show mostly empty sky during the flight/landing/rolling states.

## 10. HUD

`hud.ts` is a plain DOM overlay (`golf.css` imported as a side-effect module,
matching the project's per-game CSS convention), positioned only at screen
edges — never over the golfer, ball, fairway, landing area, or flag.

- **Pre-shot**: hole number and par, distance to flag, current club, aim
  direction indicator, one-line swing instruction.
- **During flight**: a small live-distance readout with player/club label in
  a bottom corner, updating from `ballPhysics` every frame; a brief timing
  label (`PERFECT` / `GOOD` / `MISHIT`, derived from `input.timing`) appears
  near the golfer at the impact moment and fades — never a panel blocking
  the shot.
- **After rest**: a compact result panel — carry, roll, total, max height,
  remaining distance to hole, final terrain — appears only once
  `ballPhysics.phase === "resting"`.

## 11. Audio

`audio.ts` follows Racing's `audio.ts` precedent exactly: pure Web Audio
synthesis (oscillators/filtered noise), no sound asset files, `AudioContext`
created lazily on the first user gesture (satisfied by the first aim/swing
key press). Required sounds: swing whoosh (scales with downswing speed),
impact (a sharp synthesized transient fired in the same tick as
`swingSequence.onImpact()`), an airborne tone only above a height/speed
threshold, a first-bounce sound fired on the physics engine's first ground
contact, a continuous rolling sound whose gain tracks ball speed and fades
to silence as the ball settles, and a short result stinger on rest.

## 12. Shot Statistics

`shotStats.ts` is a pure function over a recorded trajectory trace (position
samples `runtime.ts` pushes every physics step):

```ts
type ShotStatistics = {
  carryDistance: number;
  rollDistance: number;
  totalDistance: number;
  maximumHeight: number;
  finalTerrain: TerrainType;
  distanceToHole: number;
};
```

Carry = horizontal distance from launch to the first ground-contact sample;
roll = distance from that sample to the resting position; total = carry +
roll; maximumHeight = peak Y across the trace; finalTerrain =
`courseModel.terrainAt(restPosition)`; distanceToHole = distance from the
resting position to the hole position.

## 13. Testing Plan

Unit tests (Vitest, one `.test.ts` beside each pure module, no THREE/WebGL
in the test environment):

- `ballPhysics.test.ts` — gravity/drag reduce speed over time; bounce applies
  terrain-specific restitution; the ball transitions
  flight → rolling → resting with velocity explicitly reaching zero (not
  asymptotic); **running the same physical scenario with different outer
  frame deltas accumulated into the fixed step (e.g. 16.6 ms, 33 ms, 7 ms)
  produces the same final resting position**, directly verifying frame-rate
  independence.
- `shotConfig.test.ts` — `computeShotDirection`/`computeLaunch` are fully
  deterministic (identical input ⇒ bit-identical output, confirming no
  hidden randomness); outputs stay within clamped bounds even for
  extreme/out-of-range `GolfShotInput` values.
- `shotStats.test.ts` — carry/roll/total/remaining computed correctly
  against a synthetic trajectory trace with known landing/rest points.
- `cameraController.test.ts` — `dampVector3` approaches its target without
  runaway overshoot and reaches within epsilon in bounded time; camera mode
  transitions follow the expected sequence given a scripted ball-state
  timeline.
- `input.test.ts` — the keyboard/mouse rig's derived `GolfShotInput` values
  are always clamped to valid ranges; exactly one `onShotReady` fires per
  completed swing gesture.

Manual/browser verification (3D + WebGL correctness and feel can't be proven
by unit tests alone):

- Launch the dev server and drive `/golf-preview` with Playwright (already
  an unused devDependency; a one-off verification script, not a new
  permanent e2e suite, since none was requested).
- Confirm a reset action fully clears ball/golfer/camera/trail/HUD state back
  to address.
- Confirm navigating to `/golf-preview` and away and back does not duplicate
  RAF loops, `AudioContext`s, or event listeners, matching the project's
  cleanup-function-on-navigation convention.
- Capture screenshots: address composition, exact impact frame, ball chase,
  ball descending toward the landing area, first bounce, final shot
  statistics — plus a screenshot sequence (or short recording) proving the
  camera continuously tracks the same ball from impact through to rest.
- Run `npm run typecheck`, `npm test`, and a production `npm run build`
  before reporting completion.

## 14. Non-Goals Recap

No motion controls, no QR/room/Socket.IO wiring, no multiplayer, no multiple
holes, no scoring, no club-selection UI, no wind/putting/water-penalty logic,
no random shot error, no sourced external art or audio assets. All excluded
items are structurally enabled for later phases (pure functions, a
controller-neutral `InputSource`, a real `GolfClubDefinition` type) but not
built now.

## 15. Open Questions For Implementation Review

- Exact hole distance/layout numbers (tee-to-green distance, bunker
  placement, fairway width) are illustrative here ("~145 m, Palm-Bay-style")
  — the implementation plan should pin down concrete numbers that make the
  one default club's carry range land naturally short of or on the green.
- Physics fixed-step rate is proposed at 120 Hz; the plan should confirm this
  is comfortably cheap enough alongside rendering on the target laptop, or
  pick 60 Hz if not.
- `flight-wide` camera engagement thresholds (speed/height) need concrete
  tuning during implementation/playtesting, not just a formula.

## 16. Appendix: Relationship To A Pre-Existing Concurrent Implementation

While this spec was being written, an unrelated concurrent process (not part
of this design conversation) was independently and directly implementing a
much larger "Pocket Golf" feature in the same working tree, uncommitted:
`shared/pocketGolf.ts`, `server/games/pocketGolf.ts`,
`client/src/games/pocket-golf/renderer.ts` +`.css`, plus edits to
`shared/protocol.ts`, `server/types.ts`, `server/rooms.ts`,
`server/socketHandlers.ts`, `client/src/games/catalog.ts`,
`client/src/components/gameLauncher.ts`/`launcherArtwork.ts`, and
`client/src/pages/hostLobby.ts`/`join.ts`. That work targets the full
53-section original brief directly (real catalog entry, full socket
protocol, 3-hole course, multiplayer turn order, water/OOB penalties, wind)
rather than the negotiated Phase 1 slice, and uses a different physics
architecture (a single server-computed shot replayed on the client via a
duration heuristic, rather than a live client-side fixed-timestep
simulation) that is not compatible with this spec's camera/animation design
without a rewrite.

Resolution, confirmed with the user after an audit (see conversation):

- The pre-existing files are left completely untouched — not read from, not
  imported, not built upon. A backup snapshot was taken before any further
  work, purely as a safety net.
- This spec's module directory is **`client/src/games/golf-preview/`**
  (not `client/src/games/golf/` as originally drafted), specifically to
  avoid any naming collision or confusion with the existing
  `client/src/games/pocket-golf/` work.
- Content values only — never code or imports — may be ported from the
  existing implementation as a reference starting point (e.g. club carry
  distances, terrain friction/restitution numbers, the ~145 m Palm Bay hole
  layout, HUD copy). Any such copied value must be marked in a short comment
  noting it was adapted from the existing `pocketGolf.ts`/`renderer.ts`
  reference values, so provenance stays traceable.
- The only shared file this phase touches is `client/src/main.ts` (one
  import + one `registerRoute("/golf-preview", ...)` line, mirroring the
  existing `/dev/motion-debug` precedent) — `router.ts` itself needs no
  change since it has no hardcoded route table. `hostLobby.ts`,
  `gameLauncher.ts`, `launcherArtwork.ts`, `catalog.ts`, `rooms.ts`,
  `socketHandlers.ts`, and the shared multiplayer protocol are not touched
  by this phase at all.
- Reconciling the two efforts (whether to eventually replace, merge with, or
  discard the pre-existing `pocket-golf` work) is an explicit open decision
  for the user, out of scope for this spec.
