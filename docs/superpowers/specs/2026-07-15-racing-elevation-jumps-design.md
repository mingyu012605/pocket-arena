# Racing Elevation, Jumps & Obstacle Circuit Design

Date: 2026-07-15
Status: Draft for review before implementation
Cycle: Racing Cycle 4

## 1. Purpose

Player feedback on Cycle 3's polished-but-flat circuit: the track is visually
pleasant but "boring" (no elevation, no obstacles, no jump sections) and the
trackside environment is empty. This is a two-cycle response:

- **Cycle 4 (this spec):** give the track real elevation, jumps, gaps,
  banking, and a checkpoint/respawn system, and verify the driving feel is
  fun, on a graybox circuit with placeholder visuals. Lock the track shape
  and physics before any expensive art goes into it.
- **Cycle 5 (separate, later spec):** build a dense, believable
  Seoul/Tokyo-inspired fantasy arcade city around the now-finalized track,
  using heavily reskinned CC0 asset kits, unified color/lighting/signage,
  bright stylized arcade tone. Cycle 5 explicitly **preserves** the existing
  chibi driver character and pastel-arcade visual identity from Cycle 3 —
  this is not a pivot to graphical realism, only to a richer, denser city
  *layout*.

## 2. Scope

In scope:

- Extending the shared track representation with elevation (`y`), slope, and
  bank angle.
- A canonical track-frame sampler used by physics, rendering, camera, and
  respawn logic.
- Server-authoritative airborne physics: launch, free-flight in world space,
  landing detection, fall detection and respawn.
- A checkpoint system for lap/route validity and respawn anchoring.
- A new circuit layout replacing `TEST_OVAL_TRACK`'s flat waypoints with an
  elevation-featured lap: climbs, two jumps, a banked sweeper, and a technical
  chicane obstacle.
- Camera changes so chase/spectator cameras follow car height through jumps.
- Graybox (placeholder, readable, non-final) visuals for ramps, gaps,
  landings, and banking.
- Test coverage for the new physics, matching the existing
  `racingTrack.test.ts` / `racing.test.ts` conventions.

Out of scope (deferred to Cycle 5 or later):

- Any city/environment art, CC0 asset import, lighting/material pass.
- Any change to the chibi driver character or car shape.
- A branching multi-route track graph (see Section 4).
- Full rigid-body suspension simulation (see Section 7).
- New gameplay systems unrelated to elevation (boost/nitro, weapons, etc.).
- Reintroducing camera position shake (Cycle 3's `06e4389` rule stands).

## 3. Current Baseline

- `shared/racingTrack.ts`: one closed-loop Catmull-Rom oval over 2D
  `TrackPoint {x, z}` waypoints. `centerlinePoint(track, progress)` and
  `centerlineTangentAngle(track, progress)` are the only track queries.
- `server/games/racing.ts`: `stepCar()` is a pure function advancing
  `progress`, `lateralOffset`, `headingError`, `yawRate`, `speed` each tick
  from `steering`/`throttle`/`brake`. No vertical axis exists anywhere.
- `client/src/games/racing/carTransform.ts`:
  `computeRacingCarWorldTransform()` is the single choke point converting
  track-relative car state into world `{x, z, heading}` by sampling the
  centerline — used by the renderer and (independently) the camera math in
  `renderer.ts`.
- `client/src/games/racing/interpolation.ts`: `RacingCarFrame` /
  `RacingSnapshot` interpolate `progress` (wrap-aware), `lateralOffset`,
  `headingError`, `speed`, `steering` between server snapshots.
- Camera (`renderer.ts`) uses a fixed `CAMERA_HEIGHT` constant; nothing about
  camera position currently varies with car height, because cars have no
  height.
- No checkpoint concept exists. Lap completion is just
  `progress >= trackLength`.

## 4. Track & Elevation Data Model

`TrackPoint` gains `y` (world height in meters). Each waypoint additionally
carries authored per-segment metadata used by physics and the graybox
renderer:

```ts
type TrackSegmentType = "flat" | "ramp" | "gap" | "landing" | "bank";

interface TrackPoint {
  x: number;
  z: number;
  y: number;
  bankAngle?: number;       // radians, cross-section tilt; default 0
  segmentType?: TrackSegmentType; // default "flat"
  jumpSpan?: number;        // authored on "ramp" points only, see Section 7
}
```

**Single canonical path, confirmed.** There is one closed loop; a "shortcut"
is a jump that lets a skilled driver carry speed over ground that a slower
driver must corner through below — not a second route. This keeps every
existing consumer of the scalar `progress` (physics, collisions, protocol,
interpolation) unchanged in shape. A branching route graph is explicitly
rejected for this cycle.

**x/z keep Catmull-Rom** (unchanged — it already produces a good curve and
there's no reason to touch what works). **`y` uses a separate monotonic cubic
Hermite spline** over the same arc-length samples already produced by
`buildSampledCenterline`'s `cumulativeLengths`, with Fritsch-Carlson-style
tangent clamping at each waypoint. Plain Catmull-Rom on `y` was rejected
because it overshoots between control points — exactly the failure mode that
would put an unintended bump right before a ramp's takeoff lip or a dip right
after a landing. Monotonic Hermite guarantees the elevation curve never
overshoots past the value of a control point between two waypoints moving in
the same direction. `bankAngle` interpolates linearly between waypoints
(banking doesn't need shape-preservation the way elevation does).

## 5. Canonical Track Sampler

New shared function, `shared/racingTrack.ts`:

```ts
interface RacingTrackFrame {
  x: number;
  y: number;
  z: number;
  heading: number;        // existing tangent-angle yaw
  slope: number;          // dy/ds, rate of elevation change per arc length
  bankAngle: number;
  surfacePresent: boolean; // false inside a "gap" segment
  segmentType: TrackSegmentType;
}

function sampleRacingTrackFrame(
  track: TrackDefinition,
  progress: number,
  lateralOffset: number
): RacingTrackFrame;
```

This becomes the **single** place that knows how to turn
`(progress, lateralOffset)` into world position plus surface metadata. The
returned `y` is already the surface height *at that specific lateral
offset*, not the bare centerline height — banking tilts the cross-section,
so a car sitting away from center on a banked segment sits higher or lower
than the centerline itself:

```ts
y = centerlineY(progress) + lateralOffset * Math.sin(bankAngle);
```

Callers never redo this formula themselves; they just read `.y` off the
returned frame for their car's own `lateralOffset`.

`server/games/racing.ts` (physics), `client/src/games/racing/carTransform.ts`
(rendering), the camera code in `renderer.ts`, and respawn logic all call this
one function instead of separately re-deriving slope/bank/segment state.
`centerlinePoint` / `centerlineTangentAngle` remain as the lower-level curve
math `sampleRacingTrackFrame` is built on (still directly unit-tested in
`racingTrack.test.ts`), not replaced.

`bankAngle`, `slope`, and `segmentType` are **static track-authoring data**,
already reachable by both client and server today since
`shared/racingTrack.ts` is imported directly by both (the client already
imports `TEST_OVAL_TRACK` this way). They are not added to the network
protocol — only genuinely dynamic per-car values (Section 7) go over the
wire, consistent with the existing minimal-protocol philosophy (e.g. the
Cycle 3 driver-character spec deriving `acceleration` client-side instead of
adding a wire field).

## 6. Grounded Physics (unchanged, plus banking)

`stepCar()`'s existing grounded model (yaw/heading/drift/speed/collision) is
untouched. The only addition: the car's height while grounded is read each
tick from `sampleRacingTrackFrame(track, car.progress, car.lateralOffset).y`,
and grounded visual
pitch/roll are derived from `slope`/`bankAngle` at the car's current position
— not from consecutive network frames — so a banked lean reads correctly as
"this corner is banked" rather than being indistinguishable from drift lean.

## 7. Airborne Physics: World-Space Flight

**This is the one change to the original proposal, and it's a real fix, not
scope creep.** Deriving airborne `x/z` purely from `progress` would force a
flying car to curve through the air following the centerline's ground-path
curvature — visibly wrong the moment a jump spans any bend, and a hazard the
moment the loop crosses over/under itself near a jump (a jump physically
crossing over an earlier part of the track is exactly the kind of set-piece
moment Section 13 wants). So:

A car transitions to airborne whenever it reaches a progress where
`surfacePresent` is `false` (a `"gap"` segment) or crosses a `"ramp"`
segment's launch edge — this covers both a proper launch and a car that
simply drives too slowly off a ramp's lip and drops into the gap without a
real arc. The two cases share the same airborne state machine; only the
initial velocity differs.

**On takeoff above the ramp's minimum launch speed**: convert track-relative
state into world-space flight state:

```ts
interface AirborneState {
  worldX: number;
  worldY: number;
  worldZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  takeoffProgress: number;  // frozen, for bookkeeping and search bounding
}
```

`velocityX/Z` come from current speed and track heading at takeoff;
`velocityY` from the ramp's exit slope × speed. `progress` itself is frozen
at its takeoff value for the duration of the flight — it's not a meaningful
position while the car is off the path, but freezing it (rather than leaving
it stale-but-mutable) gives every other system a well-defined value to read.

**While airborne:** standard projectile integration —
`velocityY -= GRAVITY * dt`, then integrate all three world axes. Steering
gives **reduced, not zero, horizontal authority**: input rotates
`velocityX/Z` toward the steering-indicated direction at a small fraction of
the grounded turn rate. This is both the "pitch/roll response" and the
"some air control" arcade racers are expected to have — full grip-based
cornering makes no sense with no wheels on the ground, but zero control
feels bad. Visual pitch is derived from the velocity vector's angle
(nose-up ascending, nose-down descending); this stays cosmetic/derived, not
integrated state, matching how the driver-character spec derived
`acceleration` rather than adding new state.

**Landing search window:** rather than hand-authoring a takeoff-to-landing
zone pairing table, each `"ramp"` waypoint carries an authored `jumpSpan`
(expected forward distance, used both to size the graybox gap and to bound
the search). While airborne, landing candidates are only tested within
`[takeoffProgress, takeoffProgress + jumpSpan * 1.5]` — generous enough to
cover an undershoot/overshoot, tight enough that a lower or upper road
elsewhere on the loop (including one directly underneath, at a jump crossing
over an earlier section) is never a false-positive candidate.

## 8. Landing Conditions

Every physics tick while airborne, for each candidate segment inside the
search window from Section 7, landing occurs only when **all** of:

1. The car is descending (`velocityY < 0`).
2. The car's height **crosses the candidate segment's surface height from
   above between the previous and current tick** — i.e.
   `prevWorldY > candidateSurfaceY && nextWorldY <= candidateSurfaceY`. This
   crossing test (not a bare "am I below it") is what prevents tunnelling:
   a single large tick (e.g. during the `MAX_STEPS_PER_CALLBACK` catch-up
   loop) can't skip past a thin landing surface undetected.
3. The candidate segment is tagged `surfacePresent: true` (a `"landing"` or
   `"flat"` segment, never a `"gap"`).
4. The car's horizontal position at that progress is within the track's
   lateral bounds (`|lateralOffset| <= trackHalfWidth`, computed by
   projecting `worldX/worldZ` onto that candidate's local track frame).
5. The approach angle is within tolerance. Steep near-vertical landings past
   a configured pitch threshold still count as a valid landing (a **hard
   landing**: the settle below takes longer and applies a brief speed
   reduction, mirroring how off-track and barrier contact already cost
   speed elsewhere in `stepCar`), but landing sideways/backwards past a much
   larger threshold is rejected same as condition 4 failing, and the car
   keeps falling toward the fall-detection path in Section 10.

If none of the candidates in the window satisfy all conditions on a given
tick, the car keeps falling. On a valid landing: convert `worldX/worldZ`
back into `(progress, lateralOffset)` by a bounded nearest-point search
restricted to that one candidate's local neighborhood (cheap — it's a small
slice of the total centerline, not a global search), set `headingError` from
the velocity direction relative to the landing segment's tangent, zero
`velocityY` (or convert a fraction into the settle bounce below for a hard
landing), and resume grounded physics.

**Landing settle (confirmed lightweight):** a short critically-damped
"settle" eases any residual vertical velocity/pitch to the grounded pose,
reusing the same spring-toward-zero pattern already used for
`yawRate`/`headingError` decay. This is not a suspension simulation — no
per-wheel state, no spring-mass-damper ODE — just a scalar that decays to
zero, matching the existing codebase's established style for "arcade feel,
not physical simulation" (see the collision/drift model in Section 6's
unchanged code). A normal landing settles in ~120ms with no speed change; a
hard landing (condition 5 above) settles over a longer window (~250ms) and
applies a one-time speed reduction, the same shape as the existing barrier
and off-track speed penalties in `stepCar` — a hard landing should read as a
minor cost, not a run-ending event.

## 9. Checkpoints

Reframed from the original "anti-cheat" wording, which overstated the threat
model: the server already owns all physics, and clients only ever send
normalized `steering`/`throttle`/`brake` — there's no forged-position vector
to defend against. Checkpoints exist for:

- **Lap/route validity** — confirming a lap actually traversed the intended
  shape rather than an accidental progress jump from a physics edge case
  (e.g. collision-resolution push, or a landing-search edge case near a
  track self-crossing).
- **Safe respawn anchoring** — Section 10 respawns to the last checkpoint,
  not an arbitrary point.

An ordered list of checkpoint progress values is placed around the loop
(roughly one per major section: after the start straight, after each jump's
landing, after the banked sweeper, after the chicane). The server tracks
`lastCheckpointIndex` per car and only accepts forward lap/finish progress
when checkpoints were reached in non-decreasing order.

## 10. Fall Detection & Recovery

A car falls (rather than lands) when either:

- It exits the Section 7 search window's progress range without a valid
  landing (flew past every candidate), or
- Its height drops below a "fell into the void" threshold relative to any
  nearby surface, or
- It exceeds a maximum airborne duration.

On fall: after a short delay (~1s, matching typical kart-racer respawn
pacing — long enough to read as "you fell," short enough not to feel like a
punishment), respawn at the car's last checkpoint's grounded position and
heading, with a speed penalty (matching the existing off-track-slowdown
philosophy, just stronger since falling is a bigger mistake than running
wide). Respawn must fully reset `airborne`, `velocityX/Y/Z`, and any
in-progress settle state — a respawn that clears position but leaves stale
airborne state would corrupt the next physics tick.

## 11. Client: Interpolation & World Transform

`RacingCarFrame` (interpolation) and `RacingPlayerState` (protocol) gain:
`height` (world Y) and `airborne` (boolean, for renderer effects like
suppressing wheel-contact dust). `velocityX/Y/Z` are **not** sent — the
client only needs the resulting height/position each snapshot, same as it
already only receives `progress`/`lateralOffset` rather than the server's
internal `yawRate`. `computeRacingCarWorldTransform()` becomes a thin client
wrapper around `sampleRacingTrackFrame`, adding the car's own height (which
during flight diverges from the track surface height at its frozen
`progress` — the renderer trusts the server-sent `height` directly rather
than re-deriving it from track position, since only the server tracks true
airborne world-space state).

## 12. Camera

Chase/spectator camera height and look-at both gain the car's `height` (with
the same damping already applied to camera position generally — no new
easing system). No camera position shake, per the standing Cycle 3 rule.
Camera collision raycasting already tests against 3D scene geometry, so it
extends to elevated track sections with no changes needed.

## 13. New Circuit Layout

Replacing `TEST_OVAL_TRACK`'s flat waypoints with one lap composed of (in
order): start/finish straight (flat) → two sweeping corners (flat, as
today) → a rising set of esses climbing to a hillcrest → **Jump 1** (a
straight, modest ramp-gap-landing right at the hillcrest — the "confidence"
jump, low risk, teaches the mechanic) → a wide **banked sweeper** carrying
speed off the landing → a tightening **technical chicane** (flat, obstacle
section requiring braking — deliberate pacing contrast against the jumps) →
**Jump 2, "Skyline Leap"** (a larger ramp-gap-landing that arcs over an
earlier lower section of the same loop, the marquee "extreme" moment) → a
downhill run back to the start/finish straight.

Exact waypoint coordinates, ramp angles, gap lengths, and `jumpSpan` values
are implementation-time tuning, verified by playtesting rather than fixed
here — consistent with how prior cycles left exact numeric thresholds as
implementation-time discovery (e.g. the Cycle 3 impact-detection
thresholds).

## 14. Graybox Visuals (this cycle only)

The existing track ribbon material stretches over the new elevation.
Ramps/gaps/landings/banked sections get flat, distinct color-coding purely
for playtest readability (e.g. ramp = amber, gap edge = red/white hazard
stripe reusing the existing curb-stripe texture, landing = green, bank =
same asphalt tint with a visible tilt). No city props, no CC0 assets, no
car/driver changes — the current chibi car and driver ride the new elevation
as-is. This is explicitly disposable/placeholder pending Cycle 5.

## 15. Non-Goals

- No branching multi-route track graph.
- No full rigid-body suspension simulation.
- No environment/city art, CC0 assets, or lighting/material pass (Cycle 5).
- No chibi driver or car-shape changes.
- No camera position shake.
- No new non-elevation gameplay mechanics.

## 16. Testing / Acceptance Criteria

Extending the existing `racingTrack.test.ts` / `racing.test.ts` /
`interpolation.test.ts` suites, same style as current tests (direct calls to
pure functions over many fixed-`dt` ticks):

- `sampleRacingTrackFrame` returns correctly interpolated `y`/`slope`/
  `bankAngle` for elevated waypoints, with no discontinuity at the loop seam.
- Monotonic elevation interpolation never overshoots a waypoint's value
  between two waypoints moving the same direction (regression test against
  the Catmull-Rom-overshoot failure mode this was chosen to avoid).
- A car crossing a `"ramp"` segment above the minimum launch speed becomes
  airborne with `velocityY > 0`; below the minimum, it does not launch and
  instead falls naturally off the edge into the gap-falling path.
- An airborne car's world position follows the expected parabolic trajectory
  under fixed gravity, verified at **multiple fixed timesteps** (e.g. both
  `1/60` and a coarser step simulating a catch-up tick) to confirm the
  landing crossing-test doesn't tunnel through a thin landing surface at
  larger `dt`.
- A car landing within a landing zone's lateral bounds re-grounds and its
  `(progress, lateralOffset)` falls within the expected range.
- A car whose horizontal trajectory passes **laterally outside** a landing
  zone's bounds does not land there and continues falling.
- A car passing near a lower/upper road segment that is not the frozen
  takeoff's paired search window does not land on it (regression test for
  the self-crossing-loop hazard Section 7 exists to prevent).
- A car that fails to land within the search window or falls below the void
  threshold triggers fall detection and, after the delay, respawns at its
  last checkpoint with `airborne`, `velocityX/Y/Z`, and settle state fully
  reset.
- Checkpoints reject a manufactured backward/skipped progress jump.
- All existing `racingTrack.test.ts`, `racing.test.ts`, and
  `interpolation.test.ts` cases continue to pass unmodified where they test
  pre-existing grounded behavior.
- Manual playtest: full lap through countdown → esses → Jump 1 → banked
  sweeper → chicane → Jump 2 (including a deliberate miss to verify fall
  recovery) → finish, on both host-only and a real phone controller,
  confirming air-steering feels responsive rather than either weightless or
  unresponsive.
- Full production build (`vite build`) succeeds with no new bundle-size
  regressions beyond what the graybox additions require.

## 17. Open Questions For Implementation

- Exact `GRAVITY`, minimum launch speed, hard-landing pitch threshold, void
  fall-height threshold, and respawn speed-penalty constants are
  implementation-time tuning, verified by playtesting.
- Exact waypoint coordinates and `jumpSpan` values for the Section 13 layout
  are an implementation-time authoring pass, iterated against playtesting
  rather than fixed in this spec.
- Whether AI bot driving logic (`applyBotInput`) needs jump-specific
  behavior (e.g. always taking the ramp at speed) or can reuse its existing
  lane-following logic mostly unchanged through elevated sections is an
  implementation-time discovery step.
