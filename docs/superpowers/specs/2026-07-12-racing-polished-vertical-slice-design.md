# Pocket Formula - Harbor City GP Polished Vertical Slice Design

Date: 2026-07-12
Status: Draft for review before implementation
Cycle: Racing Cycle 2

## 1. Purpose

Cycle 1 delivered the verified Racing Foundation: motion-controller input,
server-authoritative track-relative racing physics, multiplayer lifecycle,
results/rematch, and a basic technical Three.js renderer. Cycle 2 turns that
foundation into one polished, original, high-quality browser arcade-racing
vertical slice: **Pocket Formula - Harbor City GP**.

Cycle 2 must preserve Cycle 1 architecture. It enhances the same game slice;
it does not rewrite the room system, motion-input pipeline, protocol shape,
server authority model, or Controller Test behavior.

## 2. Current Technical Baseline

Baseline captured by inspecting the verified Cycle 1 code at completion commit
`1e58444`.

- `shared/racingTrack.ts` defines one closed-loop Catmull-Rom oval,
  `TEST_OVAL_TRACK`, with `centerlinePoint()` and `centerlineTangentAngle()`.
- `server/games/racing.ts` is authoritative. Cars are represented by
  `progress`, `lateralOffset`, `headingError`, `yawRate`, `speed`, input
  channels, rank, lap, and finish fields.
- Racing physics runs with a fixed 60 Hz accumulator and emits volatile
  `game:state` snapshots every third physics step, approximately 20 Hz.
- Phones send normalized `steering`, `throttle`, and `brake` through
  `racing:input`; input is validated by server session, round id, and
  sequence.
- `client/src/games/racing/renderer.ts` is a functional technical renderer:
  one textured flat track ribbon, one primitive colored car per player, simple
  chase camera, two-snapshot interpolation, leader/focused-player camera
  target, basic lights, and explicit Three.js disposal.
- `client/src/pages/hostLobby.ts` selects the renderer by `gameType`, shows a
  DOM racing HUD/results screen, and preserves Controller Test routing.
- `client/src/controller/racingView.ts` provides the motion-driven phone
  controller states and telemetry; no Racing gameplay touch buttons exist.
- `README.md` documents that Cycle 1 is playable but not final, and that real
  phone motion on LAN generally needs HTTPS.

Visual baseline:

- The game is clearly playable but visibly prototype-quality.
- Cars are simple multi-box meshes with cylinder wheels.
- Road is a flat ribbon with a canvas-generated lane/edge texture.
- Environment is a flat green plane with no city, barriers, props, sky detail,
  curbs, grandstands, or finish presentation.
- Lighting is minimal and has no shadow strategy.
- HUD is functional DOM, not yet polished.
- There is no audio, no particles, no AI, and no collision feedback.
- Three.js is currently included in the main client bundle once host/join code
  imports Racing renderer/controller paths.

Performance baseline:

- Cycle 1 production build succeeded with a large client chunk warning after
  Three.js became reachable.
- No in-app renderer metrics overlay exists yet.
- No committed FPS/draw-call/triangle/memory baseline exists yet.
- Cycle 2 Task 1 must add development-only instrumentation and record real
  baseline numbers before increasing scene complexity.

## 3. Product Goal

Ship one polished, original Formula-inspired arcade racing vertical slice:

- One high-quality coastal modern city street circuit.
- Strong first-read screenshot quality: the still image should look like a
  real arcade racing game without explanation.
- Smooth motion quality: cars, wheels, camera, HUD, and effects should hide
  the 20 Hz network update cadence through interpolation and client-side
  presentation.
- Responsive game feel: steering, throttle, brake, off-track slowdown, camera,
  and audio should feel coherent and fun.
- Stable performance: target 60 FPS on the host laptop, with a stable 30 FPS
  fallback via quality presets.
- Reliable real-phone control: iPhone Safari and Android Chrome must pass
  HTTPS physical-device tests before Cycle 2 is considered complete.

## 4. Visual Identity

Working title: **Pocket Formula - Harbor City GP**

Tone:

- Bright, energetic, premium arcade racing.
- Clean esports broadcast presentation.
- Coastal modern city street circuit: harbor water, skyline, palm/coastal
  vegetation, clean barriers, modern buildings, grandstands, fencing, and
  trackside lighting.
- Original Formula-inspired cars, not replicas.

Fictional branding pool:

- Pocket Formula
- Harbor City GP
- Apex Dynamics
- Nova Racing
- Velocity Labs
- Pocket Energy
- Harbor Apex
- Skyline Motorsport
- GridLabs

Branding restrictions:

- No real racing brands, teams, manufacturers, sponsors, logos, copied
  liveries, or trade dress.
- Do not include Ferrari, F1, Formula 1 marks, Pirelli, real team colors as
  deliberate replicas, real manufacturer logos, or real sponsor boards.
- All art must be original, generated specifically for this project, or
  properly licensed for the project.

## 5. Architecture Constraints

Cycle 2 must preserve:

- Server authority for race physics, AI, collisions, ranking, finish order,
  results, rematch, and safety timeouts.
- Phone input contract: clients send only normalized steering/throttle/brake
  plus sequence and round id.
- Track-relative physics model: `progress`, `lateralOffset`, `headingError`,
  `yawRate`, and `speed` remain the core state.
- `game:state` discriminated by `gameType`.
- Existing room, QR, reconnect, countdown, results, rematch, and `game:end`
  lifecycle.
- Controller Test functionality and renderer behavior.
- Shared track source of truth. Visual road/curb/barrier placement must derive
  from `shared/racingTrack.ts` or deliberate extensions to it.

Cycle 2 may extend:

- Racing server state for AI/collision metadata if needed.
- Racing client renderer internals.
- Host Racing HUD/camera controls.
- Phone Racing feedback, such as vibration/screen flash for collisions.
- Asset-loading boundaries, quality settings, and development-only metrics.

## 6. Asset Strategy

Preferred near-term strategy:

- Procedural Three.js geometry/materials for environment, track details, and
  effects where practical.
- A project-local original Formula-style car asset may be introduced as glTF
  only if created specifically for this project or properly licensed.
- If a glTF car is used, keep a primitive fallback so Racing remains playable
  if the model fails to load.

Asset rules:

- Store reusable assets under a clear Racing asset path, for example
  `client/src/games/racing/assets/`.
- Include provenance notes for any non-procedural asset.
- Texture sizes must be budgeted. Favor canvas-generated or compressed
  lightweight textures.
- Do not add large binary assets without confirming they are necessary and
  licensed.

## 7. Art Bible

### Car

- Silhouette: compact original open-wheel Formula-inspired arcade car.
- Required shapes: main body, nose, front wing, rear wing, cockpit/driver
  silhouette, four visible wheels.
- Player colors apply to clear body/livery regions while shared black/carbon
  materials remain reused across all cars.
- Front wheels visibly steer with input/heading intent.
- Wheels rotate based on speed.
- Keep polygon count reasonable for up to 8 visible cars including AI.
- Share geometry/materials; do not load/clone full unique geometry per player.

### Track

- One polished street-circuit ribbon derived from the shared track.
- Materials: asphalt, painted edge lines, curbs, runoff/off-track surface,
  finish/start grid markings.
- Barriers follow track edges with consistent spacing.
- No visible seam at loop closure.
- UVs should be stable and avoid stretched markings.

### Environment

- Harbor city: waterfront edge, modern skyline, grandstands, fencing, palm or
  coastal vegetation, light poles, marshal posts, original sponsor boards.
- Repeated scenery must use instancing or merged geometry.
- Scene should read well from chase and spectator cameras.

### Lighting

- Clear sunny arcade lighting with warm directional sun and cool ambient fill.
- Controlled shadows from a limited set of objects.
- Tone mapping and exposure tuned so player colors remain readable.
- Optional bloom only if performance allows.

### HUD

- Esports-style overlay, clean and legible from laptop/projector distance.
- Must show position, speed, player/focus identity, progress, leaderboard,
  camera mode, countdown, off-track warning, and finish/results sequence.
- Avoid dense mobile-game clutter on the host display.

## 8. Performance Budgets

Targets:

- Preferred: stable 60 FPS on the real host laptop.
- Acceptable fallback: stable 30 FPS with Low/Medium quality presets.
- No continuous memory growth across repeated races/rematches/navigation.

Initial budgets, adjustable after Task 1 measurement:

- Device pixel ratio:
  - Low: max 1.0
  - Medium: max 1.25
  - High: max 1.5 or 2.0 only if measured stable
- Draw calls:
  - Low: target under 120
  - Medium: target under 180
  - High: target under 250
- Triangles:
  - Low: target under 150k visible
  - Medium: target under 300k visible
  - High: target under 500k visible
- Shadow maps:
  - Low: disabled or single low-resolution caster set
  - Medium: 1024 directional shadow map
  - High: 2048 maximum unless measured safe
- Particles:
  - Low: under 150 active
  - Medium: under 400 active
  - High: under 800 active
- Texture memory:
  - Keep Cycle 2 texture memory modest and visible in metrics.
  - Avoid unique high-resolution textures per car/player.

Task 1 must add a development-only overlay that records FPS, frame time, draw
calls, triangles, texture count, renderer memory, active cars, and quality
preset. Normal production mode must not show the overlay.

## 9. Rendering Design

`RacingRenderer` should evolve into a small renderer subsystem rather than one
monolithic file. Suggested internal modules:

- `renderer.ts`: implements `GameRenderer<RacingGameStatePayload>` and owns
  scene lifecycle.
- `track.ts`: track mesh, curbs, barriers, markings derived from shared track.
- `cars.ts`: car asset/model factory, player-color variants, animation.
- `environment.ts`: harbor city environment, instancing, skyline.
- `camera.ts`: camera modes and damping.
- `hud.ts` or host page glue: DOM HUD state rendering.
- `effects.ts`: particles, speed lines, skid marks, object pools.
- `audio.ts`: Web Audio lifecycle and event mapping.
- `quality.ts`: presets, pixel ratio, shadows, density.
- `metrics.ts`: development-only overlay and renderer stats.

The renderer must fully dispose of geometries, materials, textures, animation
handles, event listeners, audio nodes, particle pools, and DOM overlays on
destroy.

## 10. Camera System

Required modes:

- Normal chase.
- Close chase.
- Cockpit/hood.
- Spectator.
- Finish camera.

Behavior:

- Smooth position damping and smooth look-at damping.
- Speed-based field of view.
- Subtle acceleration/collision shake.
- Host camera-cycle control and focused-player selection.
- No nausea-inducing rapid swings, excessive shake, or sudden roll.

## 11. Audio Design

Audio must be original, generated specifically for the project, or properly
licensed. Web Audio synthesis is acceptable and preferred for initial Cycle 2.

Required sound groups:

- Engine loop with pitch tied to speed and throttle.
- Braking/tire scrub.
- Off-track rumble.
- Collision impact.
- Countdown and race start.
- Finish and UI feedback.

Lifecycle:

- User gesture constraints must be respected.
- Include mute and master volume controls.
- No duplicated `AudioContext`s after rematch/navigation.
- Clean teardown on renderer destroy and room leave.

## 12. AI Design

AI cars are authoritative server-side Racing participants. They use the same
track-relative car model where practical and should not be client-only ghosts.

Single-player target:

- Add approximately 3-7 AI cars.
- Difficulty/speed profiles create varied pacing.
- AI follows track geometry, uses lane variations, accelerates on straights,
  brakes before strong curves, and recovers from off-track states.

Protocol consideration:

- Existing `RacingPlayerState.playerNumber` assumes numeric entries. AI can
  use reserved player numbers beyond human slots if documented, or the
  protocol can be extended with a non-breaking `kind`/`isAi` field. The plan
  must choose explicitly before implementation.

## 13. Collision Design

Cycle 2 adds simple feedback collisions, not a full rigid-body simulation.

Required:

- Circle/capsule overlap in track/world space.
- Positional separation.
- Impact slowdown.
- Optional temporary steering disruption if it improves feel.
- Visual and audio feedback.
- Phone vibration where supported, with screen feedback fallback.

Collisions must be server-authoritative so cars no longer pass directly
through each other in gameplay. Client effects may predict/embellish the
feedback but not decide the race outcome.

## 14. Quality Presets

Presets:

- Low: stable gameplay first, minimal shadows/effects, low pixel ratio,
  reduced environment density.
- Medium: default, balanced shadows, moderate environment density, controlled
  particles.
- High: full visual target if measured stable on the host laptop.

Controls:

- Render pixel ratio.
- Shadow resolution/enabled state.
- Crowd/environment density.
- Particle count.
- Postprocessing/bloom if any.
- Optional detail effects.

Preset choice should be visible in the development metrics overlay and may be
host-selectable in the Racing HUD/settings.

## 15. Verification Gates

Cycle 2 is not complete unless all gates pass.

Gate A - Screenshot quality:

- A still screenshot immediately reads as a polished Formula-style arcade
  racing game.
- Track, cars, environment, lighting, and HUD all look intentional.

Gate B - Motion quality:

- Cars, wheels, camera, environment, effects, and HUD move smoothly.
- 20 Hz network stepping is not visibly obvious during normal play.

Gate C - Game feel:

- Steering, throttle, braking, off-track slowdown, camera, effects, and audio
  feel responsive and coherent.

Gate D - Performance:

- Stable target frame rate on the real host laptop.
- Stable fallback preset at 30 FPS.
- No continuous memory growth across repeated rematches/navigation.

Gate E - Phone reliability:

- Real iPhone Safari and Android Chrome tests pass over HTTPS.
- Landscape-left/right, permission grant/deny, recalibration, backgrounding,
  lock/unlock, Wi-Fi interruption, reconnect, and different motion update
  rates are verified.

## 16. Non-Goals

- No multiple tracks in Cycle 2. One polished track beats several unfinished
  tracks.
- No real-world racing brands or copied liveries.
- No full tire/weight-transfer simulation.
- No persistent online progression or matchmaking.
- No rewrite of Pocket Arena room/socket architecture.
- No breaking Controller Test.

## 17. Open Questions For Implementation Review

- Should AI use reserved numeric player numbers or should the protocol add a
  lightweight `kind: "human" | "ai"` field?
- Should audio be entirely Web Audio synthesis for Cycle 2, or may small
  project-local generated audio files be introduced with provenance?
- What exact host laptop should define the performance target?
- Is HTTPS local testing handled by a reverse proxy, a local certificate, or a
  deployment target?
