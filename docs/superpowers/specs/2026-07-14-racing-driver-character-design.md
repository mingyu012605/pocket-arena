# Racing Driver Character & Cute Polish Design

Date: 2026-07-14
Status: Approved for implementation (amended 2026-07-15 for Cycle 4 compatibility - see Section 3 note)
Cycle: Racing Cycle 3, implemented after Cycle 4 (see Section 3 note). Prerequisite
for the Cycle 5 Seoul/Tokyo city environment work, which explicitly preserves
this cycle's chibi driver and pastel-arcade identity.

## 1. Purpose

The racing launcher card art (`client/src/assets/launcher/card-racing.webp`)
shows a chibi kid with big spiky hair and big eyes, visibly gripping the
wheel of a rounded go-kart. The in-game car does not match: the driver is a
tiny, barely-visible helmet bump (`buildDriverBust()` in
`client/src/games/racing/assetScene.ts`), and the overall car/HUD read as
generic-arcade rather than "cute." This cycle closes that gap: a real,
reactive chibi character visible in every car, plus a supporting redesign
pass (exaggerated kart silhouette, effects, closer camera composition, a
structural HUD pass, audio) so the game matches the energy of its own
marketing art.

This is a focused visual/feel pass, not a re-architecture. It preserves
Cycle 2's server-authoritative physics and protocol shape. It revises one
earlier constraint from the chase-camera smoothing fix: camera *position*
(distance/height/look-ahead) is now in scope (Section 6.2), but camera
*shake* stays permanently out (see Non-Goals).

**Acceptance bar (added 2026-07-15, round 2):** the risk with a pass like
this is shipping something that is technically everything on the list but
still reads as barely different in play. So the bar is explicit: matched
before/after screenshots from the five fixed camera positions in Section 10
must look obviously different at a glance, with no caption needed to explain
what changed. If a reviewer needs the diff explained, or needs to zoom in to
see it, this cycle is not done - regardless of how much code changed
underneath.

## 2. Scope

In scope:

- A visible, reactive chibi driver character in every car (human and AI),
  meeting the explicit readability minimums in Section 4.7.
- A substantially exaggerated kart-like silhouette on the existing
  open-wheel car, with measurable before/after proportions (Section 5) -
  not a subtle softening pass. The car stays open-wheel (wings, exposed
  wheels, F1-derived silhouette); it does not become a fully enclosed
  go-kart body (see Non-Goals).
- Chase-camera framing (distance/height/look-ahead) retuned so the
  redesigned kart and driver read as larger and closer in the camera
  players actually use, not just in close-up screenshots (Section 6.2).
- Effects and car-mesh "personality": squash/stretch on impact/landing,
  drift smoke/streaks, and a jump takeoff effect, without reintroducing
  camera shake (Section 6.1).
- A structural HUD pass - rank emphasis, speed display, drift feedback,
  reduced screen footprint, consistent typography/spacing/icons - not just
  corner-radius rounding (Section 7).
- A couple of new procedurally-synthesized SFX (collision, finish).
- Matched before/after acceptance screenshots per Section 10, gating
  whether this cycle counts as complete.

Out of scope (explicitly not this cycle):

- A fully enclosed go-kart body redesign (evaluated and deferred as a
  separate, larger effort). The silhouette work in Section 5 pushes the
  *existing* open-wheel car hard toward exaggerated/chunky arcade
  proportions; it does not change its car-body category.
- Any server/protocol changes. Everything here derives from state the client
  already receives.
- Reintroducing camera position shake. `06e4389` removed it deliberately for
  causing motion sickness; this cycle must not regress that, even
  indirectly via the camera retuning in Section 6.2.
- Any new camera mode, or changes to the existing collision-avoidance/
  scenery-raycasting logic beyond retuning the distance/height/look-ahead
  constants it already reacts to (Section 6.2).
- New gameplay mechanics, including boost/nitro. None exists today (verified:
  no `boost`/`nitro` reference anywhere in client, server, or shared code),
  and reactivity is designed around the mechanics that do exist (steering,
  accel/brake, drift, airborne, collision, finish). No pose, effect, or HUD
  element in this spec references boost.

## 3. Current Baseline

> **2026-07-15 note:** this spec was written before Racing Cycle 4
> (elevation, jumps, the graybox obstacle circuit) was implemented. Cycle 4
> shipped first, so the baseline below is refreshed to match the current
> code rather than the pre-Cycle-4 snapshot this spec originally described.
> Nothing in Cycle 4 changes the plan in Sections 4-8; it adds one new input
> signal (`airborne`) that Section 4 now accounts for (see 4.1, 4.2, 4.9)
> and one new trigger case for the landing squash/stretch in Section 6.

- `client/src/games/racing/cars.ts` builds a fully procedural open-wheel
  fallback car (`buildCarMesh()`), shown briefly while the GLTF loads. It
  already has a tiny helmet/visor/eyes/cheeks driver bust built from
  primitives, using shared merged geometry for static trim and separate
  meshes only for parts that animate (wheels).
- `client/src/games/racing/assetScene.ts` loads a Kenney CC0 GLTF car
  (`buildImportedCarVisual()`) as the primary visual once loaded, and adds
  its own separate, even smaller primitive driver bust
  (`buildDriverBust()`). This is the car players see almost all the time.
- `client/src/games/racing/renderer.ts` drives per-frame car visuals
  (position, yaw, lean, wheel steering, brake light, speed trail, underglow,
  skid marks, dust) from interpolated snapshot state — see the per-car loop
  around lines 380-490. Drift/skid is already detected there via
  `Math.abs(pos.headingError) > 0.2 && pos.speed > 6`.
- As of Cycle 4, that interpolated snapshot
  (`RacingInterpolationBuffer`/`RacingCarFrame` in `interpolation.ts`) also
  carries `progress, lateralOffset, headingError, speed, steering, rank,
  stale, airborne` plus a track-frame `bankAngle` sampled alongside it.
  `airborne` is already used to pick a world-space vs. track-relative
  render path for the car body; the character system below is the first
  consumer that needs it for a pose decision.
- `client/src/games/racing/effects.ts` provides pooled particle systems
  (dust, confetti burst, skid marks) and `client/src/games/racing/audio.ts`
  provides Web-Audio-only synthesis (no imported/licensed audio, per the
  Cycle 2 art bible).
- The HUD (`client/src/styles/components.css`, `.race-hud-panel` etc.) has
  an existing warm pastel override (peach panels, coral borders, rounded
  pills) layered on top of an older dark-glass style, but several elements
  (`.racing-leaderboard-row`, some panel corners) still use small 6-8px
  radii inconsistent with the rest of the palette.
- No collision flag exists in client state. Server-side collision handling
  (`server/games/racing.ts`) reduces `speed` and kicks `yawRate` on both
  barrier and car-car contact, but only `speed`/`headingError`/`steering`
  reach the client's interpolated snapshot.
- No boost/nitro mechanic exists anywhere in the codebase.

## 4. Character System

### 4.1 Module shape

New module `client/src/games/racing/character.ts`:

```ts
export interface DriverInput {
  steering: number;       // -1..1, already available per-frame
  speed: number;           // interpolated car speed
  acceleration: number;    // caller-smoothed, see 4.3
  driftAmount: number;     // 0..1 continuous, see 4.4
  impactStrength: number;  // 0..1, see 4.5
  airborne: boolean;       // pos.airborne from the interpolated snapshot, see 4.9
  finished: boolean;
  deltaTime: number;
}

export interface DriverCharacter {
  root: THREE.Group;       // parented into the car's cockpit position
  update(input: DriverInput): void;
  reset(): void;
  dispose(): void;
}

export function buildDriverCharacter(
  playerNumber: number,
  color: THREE.ColorRepresentation
): DriverCharacter;
```

`character.ts` owns all internal animation state and smoothing. The
renderer's `render()` loop computes `DriverInput` from values it already has
(plus the two new derived signals below) and calls `update()` once per car
per frame — it does not reach into individual head/torso/arm transforms
itself. This avoids the steering/braking/drift/collision/celebration
animations fighting over the same rotations.

`CarVisual` (`cars.ts`) and `ImportedCarVisual` (`assetScene.ts`) each gain a
`character: DriverCharacter` field, built once per car alongside the
existing wheel/body setup and disposed alongside the rest of the car's
Three.js resources on car removal/renderer teardown.

### 4.2 Animation priority

Internally, `update()` blends toward one dominant pose based on priority,
highest first:

1. Finish celebration (see 4.6)
2. Collision reaction
3. Airtime pose (`airborne`, see 4.9)
4. Drift excitement (scaled by `driftAmount`)
5. Normal steering/acceleration lean

Lower-priority animations don't fight higher ones — e.g. once celebration
starts, steering-driven arm rotation stops applying until celebration ends.
Airtime sits above drift because `headingError` can stay large through a
jump's launch rotation, which would otherwise read as a drift pose while
airborne.

**State checklist mapping (added 2026-07-15, round 2).** The full reactive
vocabulary this system must cover: neutral steering, hard steering, drift
lean, airtime, soft landing, hard landing, collision reaction, win/excited
state. Every one of these maps onto a priority tier above, either as its own
tier or as a magnitude band within one — nothing here is a new signal beyond
`airborne` (4.9):

- **Win/excited** = tier 1 (finish celebration, 4.6).
- **Collision reaction / hard landing** = tier 2. Both are the same
  `impactStrength`-driven reaction (4.5); a hard landing is simply the
  falling-edge-of-`airborne` case of it (4.9). Above a tuned threshold
  (implementation-time, see Section 12) it plays the full startled-face +
  squash/stretch reaction; below it, **soft landing** just yields
  immediately back to tier 4/5 with a small squash - not a distinct tier,
  the low-magnitude end of the same one.
- **Airtime** = tier 3 (4.9), unchanged.
- **Drift lean** = tier 4 (4.4), unchanged.
- **Neutral steering / hard steering** = tier 5, and are not two separate
  states either - the existing steering/acceleration lean pose (4.1, 4.3)
  is already continuous, scaled by `|steering|` and `|acceleration|`.
  "Neutral" is that pose at small magnitude, "hard steering" is the same
  pose at large magnitude. No new pose logic, only confirming the existing
  continuous scaling reads as clearly different at both ends (verify in
  Section 10).

### 4.3 Smoothed acceleration

The renderer does not have a direct throttle/brake signal in the
interpolated snapshot (only `speed`/`steering`/`headingError`), and adding
one would mean threading new fields through the interpolation buffer for no
real benefit. Instead, `acceleration` is derived and smoothed once per car
per frame in the renderer, next to the existing `visualYaw`/
`visualWheelSteer` smoothing maps:

```ts
rawAcceleration = (pos.speed - previousSpeed.get(playerNumber)) / dt;
smoothed = lerp(previousAcceleration.get(playerNumber) ?? 0, rawAcceleration, 0.12);
acceleration = clamp(smoothed, -MAX, MAX);
```

This feeds the lean-back-on-accel / lean-forward-on-brake pose.

### 4.4 Continuous drift intensity

Replaces an on/off drift flag with a continuous value so lean, hair flutter,
and expression change gradually rather than snapping:

```ts
driftAmount = clamp((Math.abs(pos.headingError) - 0.12) / 0.35, 0, 1);
```

(Same underlying signal the renderer already uses for the skid-mark trigger
at `headingError > 0.2`, just expressed as a ramp instead of a threshold.)

### 4.5 Collision detection (client-derived, no protocol change)

No server collision flag exists, and adding one is out of scope. Instead,
the renderer infers an impact from a multi-condition check on state it
already has, guarding against false positives from braking, hard turns, or
normal deceleration:

```ts
speedDrop = previousSpeed.get(playerNumber) - pos.speed;
isImpact =
  speedDrop > IMPACT_SPEED_DROP_THRESHOLD &&
  previousSpeed.get(playerNumber) > IMPACT_MIN_SPEED &&
  Math.abs(pos.steering) < IMPACT_MAX_STEERING &&
  collisionCooldown.get(playerNumber) <= 0;
```

On a positive hit, `impactStrength` is set proportional to the speed drop
(clamped 0..1), a per-car cooldown starts (prevents re-triggering every
frame while still decelerating from the same hit), and it decays over a few
hundred ms. This reuses the same per-car `Map` pattern already established
for `visualYaw`/`lastSkidSpawn`.

### 4.6 Finish celebration

On the existing finish transition (`player.finished &&
!this.finishedPlayers.has(...)`, which already triggers confetti at
`renderer.ts:349`), the character rig starts a timed sequence instead of an
instant pose swap:

```text
0.0-0.2s  release the wheel (arms relax off the hands-on-wheel pose)
0.2-0.6s  raise arms
0.6-2.0s  bounce/wave, happy face
2.0s+     relaxed victory pose (steering animation stays suppressed)
```

### 4.7 Visual design

- **Deliberately oversized, not realistic.** Target: at normal chase-camera
  distance, hairstyle, eyes, gloves, and head movement must be recognizable
  without zooming in. Shoulders/gloves sit above the cockpit edge.
- **Face states — 3, kept simple:** neutral (open eyes, small smile),
  excited (happy eyes, open smile — used for drift and airtime, 4.9),
  startled (wide eyes, small round mouth — used for collision and hard
  landing). Swapped via visibility toggles between small pre-built mesh
  pairs, no shaders/textures. Large, simple silhouettes over detail, since
  small facial nuance won't read at gameplay distance.
- **"A few distinct looks":** 4 fixed hairstyle+haircolor combinations
  (spiky like the reference art, ponytail, buzzcut, curly), assigned
  deterministically by `playerNumber % 4`. The racing suit/gloves stay
  tinted to the player's own car color, matching the existing paint-color
  pattern, so "this is your car" identification is unaffected.
- Built entirely from primitives (spheres/capsules/cones), same technique
  the current tiny bust already uses — no new asset files, no licensing
  concerns, cheap to render, easy to recolor per player.

**Minimum readability requirements (added 2026-07-15, round 2).** These are
hard gates, checked against the actual gameplay chase camera (post Section
6.2 retune) — not a close-up/zoomed screenshot:

- Head + hairstyle silhouette must be clearly distinguishable at the default
  chase-camera distance in every drive state (steering, drift, airtime,
  landing, collision), not only when stationary.
- Both arms/gloves must read as visibly connected to the steering wheel
  during normal driving - no floating hands, no hands hidden inside the
  cockpit geometry.
- The active face state (4.7 above) must be legible from the chase camera
  during airtime, landing, and collision poses specifically, not just when
  neutral - these are exactly the moments the silhouette work in Section 5
  and the closer camera in 6.2 need to prove out together.
- No hair/helmet/shoulder geometry may intersect or clip through the car
  body or cockpit rim in any pose, checked across the full priority stack
  (4.2), not just the resting pose.
- Driver-to-car scale ratio, measured from the cockpit-opening geometry
  defined in Section 5: driver head height at least 55% of the cockpit
  opening height, shoulder width at least 70% of the cockpit opening width.
  This is the concrete form of "driver occupying a much larger portion of
  the vehicle" - checkable, not subjective.

### 4.8 Implementation order (de-risking)

Build and screenshot **one** hairstyle first, in the real chase camera, at
real gameplay distance, before building the other three. Confirm head,
eyes, arms, and steering movement are actually legible. Only after that
scale is confirmed should the remaining 3 hairstyle variants and full
reactivity (drift/collision/celebration) be built out. This avoids spending
effort on four characters that turn out to still read as tiny bumps.

### 4.9 Airtime pose (added 2026-07-15 for Cycle 4 compatibility)

Cycle 4 added ramp jumps as a core part of the circuit, so the character
needs a distinct pose for time spent airborne rather than holding its
last grounded steering pose through the flight. Driven directly by the
`airborne` boolean already present on the interpolated snapshot (no new
derived signal needed, unlike drift/impact):

- On the rising edge of `airborne` (false -> true), blend within ~150ms to
  an "airtime" pose: arms drawn in slightly off the wheel, a small forward
  lean, hair/suit trim given extra flutter amplitude. Reuses the same
  primitive-toggle approach as the face-state swap in 4.7 — no new mesh
  parts.
- Holds that pose for the full duration `airborne` stays true (flight time
  varies per jump; no fixed timer).
- On the falling edge (true -> false, i.e. landing), the pose immediately
  yields to whichever animation `impactStrength` produces that frame (see
  4.5/4.6) — a hard landing reads as an impact reaction, a soft one settles
  straight back to the steering pose. Airtime never fights the landing
  reaction because priority order (4.2) resolves collision above airtime.
- Face state during airtime uses the existing "excited" state (4.7) rather
  than adding a fourth face; a jump is a positive, high-energy moment, same
  register as drift.

## 5. Car Silhouette Redesign (expanded 2026-07-15, round 2)

Renamed from "Car Shape Softening" - the original wording ("shrink/round
the wing geometry, fatten the tire profile slightly") was vague enough that
implementation could satisfy it with changes too small to see at gameplay
distance. This section replaces it with measurable proportions, targeted
against the baseline already recorded in the Harbor City GP Art Bible
(`docs/superpowers/specs/2026-07-12-harbor-city-gp-art-bible.md` Section 2:
~3.9m nose-to-tail, ~1.9m wide, before the 1.55x presentation scale).

Target deltas, applied to both the procedural fallback (`cars.ts`) and the
primary GLTF car (`assetScene.ts`, to whatever extent its node structure
allows - see the open question in Section 12):

- **Length:** reduce nose-to-tail footprint from ~3.9m to roughly 3.0-3.2m
  (about -20%). This is the single biggest lever for reading as "kart" vs.
  "F1 car" at a glance.
- **Stance:** increase overall width (wheel-to-wheel, including tire bulge)
  from ~1.9m to roughly 2.15-2.3m (+15-20%), so wheels protrude visibly
  further past the body than today.
- **Wheels:** increase visible wheel radius by roughly +30-40% over the
  current model. Wheels should read as chunky, not just "present."
  Geometry is still shared/instanced across all four wheels and all cars,
  per the Art Bible's texture/geometry-sharing rules.
- **Nose:** lower the nose tip height by roughly -30% relative to its
  current ride height, sitting closer to the ground - the "lower front
  nose" from the requirements.
- **Cockpit opening:** increase the opening (the recess the driver bust
  sits in) by roughly +50% in area over the current geometry. This is a
  prerequisite for the driver-scale ratios required in Section 4.7 - a
  bigger driver needs a bigger opening to sit in without clipping.
- **Panel treatment:** this is a direct, explicit supersession of one
  clause in the Art Bible (Section 2): "hard edges at the nose taper,
  sidepod step, and rear deck are required for readability" is replaced,
  for this cycle onward, with filleted/rounded transitions at those same
  three features. The Art Bible's underlying goal - a silhouette that
  reads as open-wheel from chase-camera distance (nose taper, cockpit
  bump, protruding wheels) - is preserved; only the edge treatment
  changes, from faceted/hard to rounded/soft. The Art Bible should be
  updated to reflect this once implemented.

**Explicitly still out of scope:** the car stays open-wheel - front/rear
wings, exposed wheels, an F1-derived silhouette. It does not become a fully
enclosed go-kart shell. See Section 2 / Non-Goals.

- **Procedural fallback (`cars.ts`):** apply the deltas above directly.
  This car is only visible briefly during GLTF load (or if loading fails),
  but must still meet the same proportions - it's also the one used for the
  de-risking screenshot pass in Section 4.8.
- **Primary GLTF car (`assetScene.ts`):** exact treatment is an
  implementation-time discovery step — inspect the actual Kenney model's
  node names to see whether wing/wheel/nose shapes exist as separate,
  hideable/rescalable nodes, or whether what appeared wing-like in existing
  screenshots was actually the procedural fallback. If separate nodes exist,
  apply the same deltas via node-level scaling/repositioning; if the model
  can't reach these targets through scaling alone (e.g. no separable nose/
  cockpit geometry), the procedural fallback becomes the primary visual for
  this cycle instead of a brief loading placeholder - the measurable
  proportions take priority over keeping the imported model as primary.

## 6. Effects & Camera Composition

### 6.1 Effects & car-mesh personality

Hard constraint: **no camera position shake.** `06e4389` ("Smooth out chase
camera: remove shake, clamp step, ease collision slower") removed it
deliberately for causing motion sickness. This cycle must not reintroduce
it, directly or indirectly (e.g. no new speed-linked camera jitter). This
holds even with the camera retuning in 6.2 - "closer/lower" is a static
framing change, not a return of per-frame position noise.

"Personality" comes from:

- **Squash-and-stretch on the car mesh itself** (not the camera): a brief
  scale animation (~150ms) on `car.root` — compress vertically / stretch
  laterally — triggered by the same `impactStrength` signal the character
  uses. Originally scoped for landing after an off-track excursion; as of
  Cycle 4 the primary trigger is landing from a ramp jump (the falling edge
  of `airborne` in 4.9), scaled by fall distance/impact speed the same way
  a collision impact is scaled. Classic arcade-kart physicality that reads
  as "alive" without moving the camera.
- **Drift smoke/streaks** (expanded from "sparkle," round 2): the drift
  reaction needs to read as tire smoke/motion streaks, not just a sparkle
  accent - brighter, more colorful particles layered onto the existing
  pooled dust/burst system in `effects.ts`, spawned using the same
  continuous `driftAmount` signal from Section 4.4, within the existing
  particle count budget already governed by `quality.ts`.
- **Jump takeoff effect** (new, round 2): a brief upward puff/spark burst
  at the rising edge of `airborne` (4.9), distinct from the landing
  squash/stretch + impact effect at the falling edge - takeoff and landing
  should each have their own readable beat, not share one.
- No boost effect of any kind (see Non-Goals, Section 2).

### 6.2 Camera composition (new, round 2 - revises the earlier "camera untouched" constraint)

The kart/driver redesign in Sections 4-5 can't be judged fairly through the
existing distant framing - a bigger, cuter car and driver still read as
small and far away at the current camera settings. Chase-camera
`distance`/`height`/`look-ahead` (`renderer.ts`, currently `CAMERA_DISTANCE
= 17`, `CAMERA_HEIGHT = 5.8`, `CAMERA_LOOK_AHEAD = 3.4`) come into scope for
this cycle, retuned toward:

- Noticeably closer distance and lower height than today, so the kart
  occupies a clearly larger share of the frame.
- Road visibility ahead must stay intact - this is a framing change, not a
  return to the pre-`1a19223` "near-top-down staring back at the car" bug.
  That bug was a geometry sign error (camera placed in front of the car
  instead of behind it via `target + forward*distance` instead of
  `target - forward*distance`), not a consequence of being close - fixed
  distance/height values in the 11-14 / 4.5-5.5 range have worked
  correctly before (see `1a19223`, which retuned to `13.5`/`5.4` after
  fixing the sign bug), so this is re-tuning within a previously-validated
  range, not repeating a known-bad configuration.
- `CAMERA_MIN_DISTANCE` stays derived from `CAMERA_LOOK_AHEAD` (its current
  `CAMERA_LOOK_AHEAD + 5.5` formula), not a hardcoded constant, so the
  collision-avoidance floor still tracks whatever look-ahead value this
  cycle lands on.
- The existing camera-collision raycasting against scenery
  (`CAMERA_COLLISION_MARGIN`) and other cars (`CAMERA_CAR_CLEARANCE`) is
  retuned if needed for the new distance, but the mechanism itself
  (throttled raycast + smoothed correction) is unchanged.
- Elevation-aware framing from Cycle 4 (camera following car height through
  jumps) is preserved - the retune only changes the distance/height/
  look-ahead constants that elevation-aware logic already consumes.
- Implementation note: the code comment above these constants currently
  says look-ahead was "increased ... to target a point well down the road,"
  but the current value (`3.4`) is actually lower than both prior tuned
  values (`7.5`, then `9`) - the comment is stale relative to the code and
  should be corrected as part of this retune, not just the numbers.
- Exact final numbers are implementation-time tuning (consistent with
  Section 12's existing pattern), verified against the acceptance
  screenshots in Section 10, not fixed here.

## 7. HUD Redesign (expanded 2026-07-15, round 2)

Renamed from "HUD Styling" - corner-radius rounding alone isn't enough to
read as a structural change. This cycle restructures the existing
`.race-hud-panel`, `.racing-leaderboard-row`, and `.race-speedometer`
(`components.css`) rather than only re-skinning them:

- **Rank emphasis:** replace plain leaderboard text with a compact rank
  badge (colored circle keyed to the car's own player color + a large,
  bold position numeral), plus a subtle bounce-in transition when a car's
  rank changes. Rank must be scannable at a glance, not read word-by-word.
- **Speed display:** restyle `.race-speedometer` with bolder, more
  arcade-styled numerals and a clearer unit treatment - legible in
  peripheral vision while focused on the road, not just up close.
- **Drift feedback:** a small, secondary indicator reflecting the existing
  continuous `driftAmount` signal (4.4) - purely a cosmetic readout of
  state the game already has, no new mechanic. No boost indicator (Section
  2 Non-Goals).
- **Reduced screen footprint:** the combined HUD (panels + leaderboard +
  speedometer) should occupy visibly less of the frame than today, so more
  of the newly-closer camera view (6.2) and the redesigned kart are
  actually visible. Verified via the Section 10 acceptance screenshots,
  not a fixed pixel budget.
- **Typography/spacing/icon consistency:** all HUD text/icons draw from one
  consistent scale and the existing warm pastel palette - no element
  introduces its own one-off font size, icon style, or corner radius.
  18px radius (already used by `.race-hud-panel` and the rounded pill
  buttons) remains the shared corner treatment.

Scoped to CSS/DOM in `components.css` and the HUD-building code in
`hostLobby.ts` — no new HUD data is needed; every element above reflects
state the client already has.

## 8. Audio

Stays entirely Web Audio synthesis, per the existing project rule (no
imported/licensed audio). Two additions to `audio.ts`, both driven by
signals the character system already computes client-side:

- `playCollisionBoing()`: a short, bouncy pitch-drop blip on the same
  impact detection used for the character's startled reaction and the car's
  squash-and-stretch.
- A slightly more cheerful `playFinish()` arpeggio, extending the existing
  two-note version.

No changes to the engine loop, tire scrub, or off-track rumble.

## 9. Performance

- Character rig adds an estimated 6-10 extra draw calls and a couple
  thousand triangles per car (small primitives, same "separate meshes only
  for parts that must animate independently" rule the file already follows
  for wheels). Comfortably within the existing Cycle 2 budgets (up to 250
  draw calls / 500k triangles at High for up to 8 visible cars).
- No new quality-preset gating is planned up front. If implementation-time
  profiling shows a problem, the first thing to gate behind quality preset
  is the cosmetic hair-flutter wobble, not the core character or its
  reactivity.
- Drift smoke/streak and jump-takeoff particles stay within the existing
  `quality.ts` particle count caps (already governs the shared pool size).
- **Explicit regression gate (added round 2):** using the existing
  `RacingMetricsOverlay`/lifecycle-stats infrastructure already in
  `metrics.ts` (dev-only, `?dev=1`), measure frame time before and after
  this cycle at up to 8 visible cars, across Low/Medium/High quality
  presets. Average frame time must stay within `FRAME_BUDGET_MS` (currently
  `1000/55`) at Medium and above on typical laptop-class hardware (no
  discrete GPU assumed) - not just on the machine doing the implementation.
  If it doesn't, gate the newly-added cosmetic elements (hair flutter,
  smoke/streak density, takeoff effect) behind quality preset before
  cutting anything from the character/silhouette/camera work itself.

## 10. Testing / Verification

- Dev server + Playwright screenshots (same pattern as
  `artifacts/racing-quality-pass/`), captured at Low/Medium/High quality
  presets.
- Explicit check per Section 4.8: screenshot the first hairstyle from the
  real chase camera and confirm legibility before building the rest.
- Manually drive through countdown -> race -> a deliberate collision -> a
  drift -> a jump (airtime + landing) -> finish, confirming each triggers
  the right character reaction/expression per the state-checklist mapping
  in 4.2, and that celebration suppresses steering animation.
- Confirm no camera-shake regression (compare against pre-change chase-cam
  behavior), and confirm the retuned camera (6.2) doesn't reproduce the
  pre-`1a19223` near-top-down framing bug or lose road visibility.

**Acceptance-gate screenshots (added round 2, gates cycle completion per
the Section 1 acceptance bar):** matched before/after screenshots from the
same five fixed camera positions, same track location, same quality
preset:

1. Starting grid.
2. A normal straight (neutral steering).
3. A drift corner.
4. Mid-air on the circuit's jump section.
5. The moment of landing.

Each pair (pre-cycle baseline vs. post-cycle) must be placed side by side.
The cycle is **not** complete if a reviewer needs the difference explained,
or needs to zoom in to see it - both the kart/driver redesign (Sections 4-5)
and the camera retune (6.2) have to show up unmistakably in these five
frames, not just in isolated close-ups.

- Run existing `shared/racingTrack.test.ts`,
  `server/games/racing.test.ts`, and
  `client/src/games/racing/interpolation.test.ts` — all should pass
  unchanged since no protocol/server changes are made.
- Full production build (`vite build`) succeeds without new bundle-size
  warnings beyond what Three.js already contributes.
- Frame-time regression check per Section 9.

## 11. Non-Goals (restated)

- No fully enclosed go-kart body - car stays open-wheel even after the
  exaggerated silhouette redesign in Section 5 (see the explicit boundary
  there and in Section 2).
- No server/protocol changes.
- No camera shake, in any form - including indirectly via the Section 6.2
  distance/height retune.
- No new camera modes, and no changes to the collision-avoidance/scenery-
  raycasting mechanism itself beyond retuning the constants it consumes
  (Section 6.2).
- No new gameplay mechanics, including boost/nitro - verified absent from
  the codebase (Section 2). No pose, effect, or HUD element references it.
- No licensed/imported audio.

## 12. Open Questions For Implementation

- Does the Kenney GLTF car model expose separate, named wing/trim/wheel/
  nose/cockpit nodes that can be hidden or rescaled to reach the Section 5
  proportions, or is the wing silhouette seen in earlier screenshots
  specific to the procedural fallback? Resolve by inspecting the loaded
  `THREE.Group` node names before deciding how much of Section 5 applies to
  the primary car, and whether the procedural fallback needs to become the
  primary visual (Section 5's explicit fallback clause).
- Exact numeric thresholds in Section 4.5 (`IMPACT_SPEED_DROP_THRESHOLD`,
  `IMPACT_MIN_SPEED`, `IMPACT_MAX_STEERING`), Section 4.3's
  `MAX_ACCELERATION` clamp, and the new soft/hard landing `impactStrength`
  split referenced in 4.2 are implementation-time tuning, verified visually
  against real gameplay rather than fixed in this spec.
- Exact final `CAMERA_DISTANCE`/`CAMERA_HEIGHT`/`CAMERA_LOOK_AHEAD` values
  for Section 6.2 are implementation-time tuning within the ranges
  discussed there, verified against the Section 10 acceptance screenshots.
- Exact silhouette percentages in Section 5 are directional targets;
  implementation should hit them as closely as practical but the real gate
  is the Section 10 acceptance screenshots and the Section 4.7 driver-scale
  ratios, not the percentages themselves in isolation.
