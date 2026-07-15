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
reactive chibi character visible in every car, plus a supporting polish pass
(car shape softening, effects/camera personality, HUD, audio) so the game
matches the energy of its own marketing art.

This is a focused visual/feel pass, not a re-architecture. It preserves
Cycle 2's server-authoritative physics, protocol shape, and the recent
chase-camera smoothing fix.

## 2. Scope

In scope:

- A visible, reactive chibi driver character in every car (human and AI).
- Softening the sharpest edges of the car silhouette (both the procedural
  fallback and, where the model allows, the imported GLTF car).
- Effects and car-mesh "personality" (squash/stretch, drift sparkle) without
  reintroducing camera shake.
- Rounding out remaining sharp-cornered HUD elements to match the existing
  warm pastel palette.
- A couple of new procedurally-synthesized SFX (collision, finish).

Out of scope (explicitly not this cycle):

- Redesigning the car body into a full go-kart silhouette (evaluated and
  deferred as a separate, larger effort).
- Any server/protocol changes. Everything here derives from state the client
  already receives.
- Reintroducing camera position shake. `06e4389` removed it deliberately for
  causing motion sickness; this cycle must not regress that.
- New gameplay mechanics (e.g. a boost system). None exists today, and
  reactivity is designed around the mechanics that do exist (steering,
  accel/brake, drift, collision, finish).

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
  excited (happy eyes, open smile — used for drift), startled (wide eyes,
  small round mouth — used for collision). Swapped via visibility toggles
  between small pre-built mesh pairs, no shaders/textures. Large, simple
  silhouettes over detail, since small facial nuance won't read at gameplay
  distance.
- **"A few distinct looks":** 4 fixed hairstyle+haircolor combinations
  (spiky like the reference art, ponytail, buzzcut, curly), assigned
  deterministically by `playerNumber % 4`. The racing suit/gloves stay
  tinted to the player's own car color, matching the existing paint-color
  pattern, so "this is your car" identification is unaffected.
- Built entirely from primitives (spheres/capsules/cones), same technique
  the current tiny bust already uses — no new asset files, no licensing
  concerns, cheap to render, easy to recolor per player.

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

## 5. Car Shape Softening

- **Procedural fallback (`cars.ts`):** shrink/round the front and rear wing
  geometry, fatten the tire profile slightly. This car is only visible
  briefly during GLTF load (or if loading fails), but should still look
  friendlier next to the new character rather than clashing with it.
- **Primary GLTF car (`assetScene.ts`):** exact treatment is an
  implementation-time discovery step — inspect the actual Kenney model's
  node names to see whether wing-like shapes exist as separate, hideable/
  scalable nodes, or whether what appeared wing-like in existing screenshots
  was actually the procedural fallback. If separate nodes exist, soften them
  similarly; if not, this is limited to material/proportion adjustments
  (e.g. wheel scale) rather than reshaping geometry. No full kart-body
  redesign in this cycle (see Section 2).

## 6. Effects & Camera Personality

Hard constraint: **no camera position shake.** `06e4389` ("Smooth out chase
camera: remove shake, clamp step, ease collision slower") removed it
deliberately for causing motion sickness. This cycle must not reintroduce
it, directly or indirectly (e.g. no new speed-linked camera jitter).

Instead, "personality" comes from:

- **Squash-and-stretch on the car mesh itself** (not the camera): a brief
  scale animation (~150ms) on `car.root` — compress vertically / stretch
  laterally — triggered by the same `impactStrength` signal the character
  uses. Originally scoped for landing after an off-track excursion; as of
  Cycle 4 the primary trigger is landing from a ramp jump (the falling edge
  of `airborne` in 4.9), scaled by fall distance/impact speed the same way
  a collision impact is scaled. Classic arcade-kart physicality that reads
  as "alive" without moving the camera.
- **Drift sparkle:** brighter, more colorful particles layered onto the
  existing pooled dust/burst system in `effects.ts`, spawned using the same
  continuous `driftAmount` signal from Section 4.4, within the existing
  particle count budget already governed by `quality.ts`.
- Camera code itself (`renderer.ts` camera section) is untouched.

## 7. HUD Styling

Round out the remaining sharp-cornered elements
(`.racing-leaderboard-row`, any panel still at 6-8px radius) to match the
18px radius already used by `.race-hud-panel` and the rounded pill buttons.
Add small circular rank badges (colored circle + position number) in place
of plain leaderboard text, and a subtle bounce-in transition when a car's
rank changes. Scoped to CSS/DOM in `components.css` and the HUD-building
code in `hostLobby.ts` — no new HUD data is needed.

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
- Drift sparkle particles stay within the existing `quality.ts` particle
  count caps (already governs the shared pool size).

## 10. Testing / Verification

- Dev server + Playwright screenshots (same pattern as
  `artifacts/racing-quality-pass/`), captured at Low/Medium/High quality
  presets.
- Explicit check per Section 4.8: screenshot the first hairstyle from the
  real chase camera and confirm legibility before building the rest.
- Manually drive through countdown -> race -> a deliberate collision -> a
  drift -> finish, confirming each triggers the right character
  reaction/expression and that celebration suppresses steering animation.
- Confirm no camera-shake regression (compare against pre-change chase-cam
  behavior).
- Run existing `shared/racingTrack.test.ts`,
  `server/games/racing.test.ts`, and
  `client/src/games/racing/interpolation.test.ts` — all should pass
  unchanged since no protocol/server changes are made.
- Full production build (`vite build`) succeeds without new bundle-size
  warnings beyond what Three.js already contributes.

## 11. Non-Goals (restated)

- No go-kart body redesign this cycle.
- No server/protocol changes.
- No camera shake, in any form.
- No new gameplay mechanics (no boost/nitro).
- No licensed/imported audio.

## 12. Open Questions For Implementation

- Does the Kenney GLTF car model expose separate, named wing/trim nodes
  that can be hidden or rescaled, or is the wing silhouette seen in earlier
  screenshots specific to the procedural fallback? Resolve by inspecting
  the loaded `THREE.Group` node names before deciding how much Section 5
  applies to the primary car.
- Exact numeric thresholds in Section 4.5 (`IMPACT_SPEED_DROP_THRESHOLD`,
  `IMPACT_MIN_SPEED`, `IMPACT_MAX_STEERING`) and Section 4.3's
  `MAX_ACCELERATION` clamp are implementation-time tuning, verified visually
  against real gameplay rather than fixed in this spec.
