# Pocket Formula - Harbor City GP Polished Slice Implementation Plan

Date: 2026-07-12
Status: Resumed - see Resumption Audit below
Spec: `docs/superpowers/specs/2026-07-12-racing-polished-vertical-slice-design.md`

## Resumption Audit (2026-07-12, later session)

This plan was drafted and then partially implemented across a working tree
that was never checkpointed with the per-task commits this plan requires.
Before continuing, the working tree was audited task-by-task against the
requirements below. Findings:

- **Task 1 (Baseline/metrics)**: code done (`metrics.ts`, `quality.ts`,
  `?dev=1` gating, `destroy()` cleanup all present and correct). Baseline
  capture deliverable was missing and has now been captured fresh under
  `artifacts/racing-quality-pass/` with a real GPU (Intel Arc, not
  SwiftShader software rendering): **60.8 FPS at High preset, 4 cars,
  1366x768, 303 draw calls, 37k triangles**. Draw calls already exceed this
  plan's own High budget (250) - flagged for Task 14. FPS itself is healthy;
  earlier same-day artifacts showing 5-8 FPS were software-rendering
  artifacts from a headless/no-GPU capture, not a real regression.
- **Task 2 (Code splitting)**: done and already committed prior to this
  session (`hostLobby.ts` dynamic-imports the renderer; commit history
  includes "Verify Racing slice and split renderer chunk").
- **Task 3 (Asset pipeline/art bible)**: not started. No art-bible doc, no
  `assets/` directory.
- **Task 4 (Car model)**: functionally substantial (body/nose/cockpit/wings/
  wheels/mirrors/brake light/speed trail/underglow all exist in
  `renderer.ts`'s `buildCarMesh`, with speed-based wheel spin and steering
  animation already wired in `render()`), but **not yet split into
  `cars.ts`** and, per a fresh screenshot, **reads as a flat indistinct
  blob from chase distance** - this fails the plan's and the user's bar and
  needs real silhouette/readability work, not just code organization.
- **Task 5 (Track surface)**: functionally substantial (asphalt ribbon,
  edge lines, curbs, start grid, finish line, runoff, barriers, gantry all
  exist), not yet split into `track.ts`. Needs visual review for seams/UV
  stretching under real driving, not just a fresh eye on a screenshot.
- **Task 6 (Environment)**: functionally substantial (harbor water, skyline
  buildings, grandstands with crowd textures, palm trees, light poles,
  sponsor boards, sky dome, confetti field all exist), not yet split into
  `environment.ts`. Missing: marshals/trackside characters, real fencing
  distinct from barriers. Palm tree placement is mechanically regular
  (fixed 16-unit spacing) and reads as repetitive.
- **Task 7 (Lighting/tone)**: substantial (hemisphere + directional sun +
  rim light, ACES tone mapping, exposure 1.18, shadow toggle via quality
  preset). Needs tuning pass alongside car/environment fixes, not a
  from-scratch build.
- **Task 8 (Camera system)**: chase/close/hood/spectator modes exist with
  basic lerp damping and speed-based FOV/shake, but a fresh code read found
  concrete, unfixed bugs - see "Task 8 expanded scope" below. This is
  where this session's root-cause investigation landed and is the next
  task to execute in full.
- **Task 9 (HUD)**: built inline in `hostLobby.ts` (`updateRacingHud`), not
  extracted to `hud.ts`. Has leaderboard/position/speed/status; needs audit
  against the full requirement list (countdown lights, off-track warning,
  connection-stale warning) plus the dev-looking "Input" debug panel
  currently visible in normal (non-dev) gameplay per the fresh screenshot -
  that must be gated behind `?dev=1` or restyled as a real HUD element.
- **Task 10 (Audio)**: not started. No `audio.ts`, no Web Audio usage found.
- **Task 11 (Effects)**: partially present inline (speed trail, underglow,
  confetti field) but no object-pooled tire smoke/off-track dust/skid marks
  and no `effects.ts` module. Mostly not started.
- **Task 12 (AI opponents)**: done. Server already fills the grid to 4 cars
  with reserved player numbers (101+, `BOT_PLAYER_START`), and
  `applyBotInput` gives bots real autonomous throttle/brake/steering
  (cruise speed, lane targeting, wave variation) - the design decision this
  task calls out was already made and implemented. Client already renders
  bot cars via `ensureCarVisual` with bot color/name fallback.
- **Task 13 (Collisions)**: not started. No car-to-car overlap/separation
  logic in `stepPhysics`/`stepCar`.
- **Task 14 (Quality presets/optimization)**: presets exist
  (`quality.ts`: Low/Medium/High with pixel ratio, shadows, environment
  density, particle count) and adaptive pixel ratio runs in the render
  loop, but draw-call/triangle budgets are not yet met (see Task 1 finding)
  and no dedicated optimization pass (instancing audit, material/geometry
  sharing audit) has happened.
- **Task 15 (Physical phone/production verification)**: not started (final
  gate, unblocked by everything above).

Net effect: this session resumes at **Task 3** (quick, mostly
documentation), then **Task 4/5/6** (finish + modularize + fix the car
readability problem), continuing straight through the remaining tasks in
order. Each task from here on gets its own commit as originally specified,
including retroactively committing the already-correct parts of Tasks 1/2/4/
5/6/7/8/12/14 as those tasks are closed out, so history reflects real
checkpoints going forward.

## Task 8 Expanded Scope - Camera System and Network Interpolation

A fresh code read (this session) found concrete, previously-undocumented
bugs that belong in Task 8 because they are camera- and motion-smoothness
issues at heart. These are additive to Task 8's original requirements below,
not a replacement:

1. **Lap-wrap interpolation bug** - `RacingRenderer.interpolate()`
   (`renderer.ts`) linearly blends `progress`/`lateralOffset` between
   snapshots with no modulo-aware shortest-path logic. Every lap, when
   `progress` wraps from near `trackLength` back to `0`, the car visually
   sweeps backward across the entire track for one interpolation window.
   Fix: extract the snapshot buffer and interpolation math into a new pure,
   DOM/WebGL-free module `client/src/games/racing/interpolation.ts` with a
   wrap-aware shortest-delta helper, fully unit-testable.
2. **Renderer/snapshot buffer survives rematch, host state does not reset
   it** - `hostLobby.ts`'s `renderRoom()` only tears down/remounts
   `RacingRenderer` when `isPlaying` flips false-to-true or true-to-false;
   going from `results` straight into the next `countdown` never triggers
   that, so the same renderer instance (and its 6-slot snapshot buffer)
   survives the rematch and collides with the new race's `progress = 0`
   snapshots. `lastRacingState` is also never cleared. Fix: track the
   already-existing `roundId` (present on `PublicRoomState` and
   `RacingGameStatePayload` today, just unused for this) and call a new
   `renderer.resetInterpolation()` plus clear `lastRacingState` whenever it
   changes.
3. **No camera collision avoidance** - chase camera is a fixed world-space
   offset with no raycast/clamp against barrier or car geometry; hood mode
   places the camera inside the car's own cockpit/helmet mesh (offset 1.6
   units vs. a nose that extends ~3.2 units at the current body scale).
   Fix: correct the hood offset math and add a raycast-based clamp pulling
   the chase camera back inside the barrier ring.
4. **Extrapolation isn't gated on input staleness** - the renderer always
   extrapolates up to 70ms regardless of whether the server-side input for
   that car actually went stale. Fix: surface the server's existing
   `lastInputAt`/timeout as an additive `RacingPlayerState` field so the
   client can gate extrapolation on real staleness rather than guessing.
5. **No dev-mode visual debug helpers** - `metrics.ts` is text-only today;
   add, behind `?dev=1` only, a camera-frustum helper, per-car bounding-box
   wireframes, and a marker showing the raw server sample point vs. the
   interpolated render point.

Required tests (added to Task 8's verification): heading/progress
interpolation across the wrap boundary, delayed snapshots, duplicate
snapshots, out-of-order snapshots, stale-input neutralization, and
`resetInterpolation()` behavior for rematch/reconnect - all against the new
pure `interpolation.ts` module, no WebGL context required.

## Goal

Turn the verified Cycle 1 Racing Foundation into one polished, original,
high-quality browser arcade-racing vertical slice: **Pocket Formula - Harbor
City GP**.

Cycle 1 is preserved. This plan must not rewrite the verified systems:

- Server remains authoritative.
- Phones send normalized steering/throttle/brake.
- Racing physics remains track-relative.
- Controller Test remains functional.
- `game:state` remains discriminated by `gameType`.
- Existing room, QR, reconnection, countdown, results, and rematch flows
  remain intact.

This plan prioritizes one polished track over multiple unfinished tracks.
Visual quality, performance, game feel, and real-phone HTTPS testing are
acceptance requirements. Assets must be original, generated specifically for
this project, or properly licensed. No real racing branding is allowed.

## Global Workflow

For every task:

1. Inspect current files before editing.
2. Implement only that task.
3. Run `npm.cmd run typecheck`.
4. Run `npm.cmd test` or the task-specific test plus full suite when risk
   warrants.
5. Run `npm.cmd run build`.
6. Run the app when the task affects runtime behavior.
7. Capture a screenshot when the task affects visuals.
8. Record FPS/draw calls/triangles when the task affects rendering.
9. Review the actual diff.
10. Commit the task separately.
11. Report temporary assets and remaining visual weaknesses.

Do not approve visual work only because TypeScript and tests pass.

## Performance Budgets

Initial budgets, refined after Task 1 measurement:

- Preferred frame rate: stable 60 FPS on the host laptop.
- Acceptable fallback: stable 30 FPS on Low/Medium.
- Draw calls:
  - Low under 120
  - Medium under 180
  - High under 250
- Visible triangles:
  - Low under 150k
  - Medium under 300k
  - High under 500k
- Pixel ratio:
  - Low max 1.0
  - Medium max 1.25
  - High max 1.5 by default, 2.0 only if measured stable
- Shadow map:
  - Low off or minimal
  - Medium 1024
  - High 2048 maximum unless measured safe
- Active particles:
  - Low under 150
  - Medium under 400
  - High under 800

## Task 1 - Baseline and Performance Instrumentation

**Files likely touched**

- `client/src/games/racing/renderer.ts`
- Create `client/src/games/racing/metrics.ts`
- Create or modify `client/src/games/racing/quality.ts`
- Possibly `client/src/pages/hostLobby.ts`
- Documentation under `.superpowers/sdd/` or a plan progress note

**Scope**

Add a development-only Racing performance overlay and capture the current
technical renderer baseline before adding detail.

**Requirements**

- Overlay only appears behind an explicit development flag, for example
  `?racingDebug=1`, `localStorage`, or non-production plus explicit opt-in.
- Normal production mode must not show the overlay.
- Metrics:
  - FPS
  - frame time
  - Three renderer draw calls
  - triangles
  - texture count
  - renderer memory
  - active cars
  - quality preset
  - pixel ratio
- Record baseline numbers for the current technical renderer at desktop host
  size, ideally both idle and during a race.
- Add cleanup so overlay timers/DOM are removed in `destroy()`.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Run app with and without debug flag.
- Screenshot baseline technical renderer.
- Record baseline FPS/draw calls/triangles/textures.
- Confirm production build without flag has no visible metrics overlay.

**Commit message**

`Add Racing performance metrics overlay and capture Cycle 2 baseline`

## Task 2 - Racing-Only Code Splitting

**Files likely touched**

- `client/src/pages/hostLobby.ts`
- `client/src/pages/join.ts` only if needed for controller bundle split
- `client/src/games/racing/renderer.ts`
- `vite.config.ts` only if manual chunk naming is needed

**Scope**

Lazy-load Three.js and Racing renderer only when a Racing room starts. Landing
and Controller Test should not eagerly load the Racing/Three chunk.

**Requirements**

- Use dynamic `import("../games/racing/renderer")` from Racing-only host path.
- Keep `ControllerTestRenderer` eager or unchanged.
- Do not break the `GameRenderer<TState>` contract.
- Ensure renderer lifecycle handles asynchronous load cancellation if the host
  navigates away or room status changes before import resolves.
- Avoid duplicate Socket.IO listeners after remount/navigation.
- Preserve Controller Test behavior.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Inspect production chunks: Racing/Three should be separated from initial
  landing/Controller Test path.
- Run Controller Test and confirm no Racing chunk is fetched before starting a
  Racing room.
- Run Racing and confirm chunk loads on demand.

**Commit message**

`Code-split Racing renderer so Three loads only for Racing rooms`

## Task 3 - Asset Pipeline and Art Bible

**Files likely touched**

- Create `docs/superpowers/specs/2026-07-12-harbor-city-gp-art-bible.md`
- Create `client/src/games/racing/assets/README.md`
- Possibly create placeholder asset directories

**Scope**

Document the concrete art pipeline and asset rules before introducing
non-trivial assets.

**Requirements**

- Define car proportions and scale.
- Define track materials, curb colors, barrier design, runoff design.
- Define player color system.
- Define environment palette and lighting direction.
- Define UI typography and HUD style.
- Define original sponsor-board system.
- Define texture size budgets.
- Define glTF conventions if glTF is used:
  - coordinate orientation
  - unit scale
  - material naming
  - player-color material slots
  - geometry sharing expectations
- Include provenance requirements for every non-procedural asset.
- Explicitly ban Ferrari, F1, Pirelli, real teams, real manufacturers, real
  sponsors, and copied liveries.

**Verification**

- Documentation self-review against Cycle 2 design spec.
- No binary assets added in this task unless tiny placeholders are necessary.
- `git diff` confirms this is documentation/pipeline only.

**Commit message**

`Document Harbor City GP art bible and asset pipeline`

## Task 4 - Detailed Formula-Style Car

**Files likely touched**

- Create `client/src/games/racing/cars.ts`
- Modify `client/src/games/racing/renderer.ts`
- Possibly add project-local original glTF under `client/src/games/racing/assets/`
- Add `client/src/games/racing/assets/README.md` provenance entry if asset added

**Scope**

Replace technical box cars with an optimized original Formula-inspired car,
with a primitive fallback if the model fails to load.

**Requirements**

- Car includes:
  - body
  - four visible wheels
  - front wing
  - rear wing
  - cockpit/driver silhouette
  - player-color material regions
- Wheel rotation based on speed.
- Front-wheel steering animation.
- Shared geometry/materials across players.
- Do not duplicate full model data per player.
- Reasonable polygon count documented in metrics.
- Fallback primitive remains playable.
- No real branding or copied livery.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Run Racing and capture screenshot.
- Record FPS/draw calls/triangles with 1 and 4 cars.
- Verify player colors are distinct.
- Verify fallback path manually or with forced-load failure.

**Commit message**

`Replace Racing box cars with original Formula-style car model`

## Task 5 - Track Surface and Curbs

**Files likely touched**

- Create `client/src/games/racing/track.ts`
- Modify `client/src/games/racing/renderer.ts`
- Possibly extend `shared/racingTrack.ts` with visual metadata only if needed
- Tests for shared track seam/geometry helpers if shared logic changes

**Scope**

Upgrade the technical ribbon into a polished street-circuit surface derived
from the shared track source of truth.

**Requirements**

- Asphalt material.
- Painted track edge lines.
- Curbs.
- Start grid.
- Finish line.
- Runoff/off-track surface.
- Barrier placement.
- Track signs.
- Correct normals and UVs.
- Consistent track width.
- No visible seam at loop closure.
- Do not fork or duplicate track geometry independent from shared track data.

**Verification**

- `npm.cmd run typecheck`
- Relevant shared tests if track helpers change.
- `npm.cmd test`
- `npm.cmd run build`
- Screenshot at start/finish seam and at curves.
- Metrics before/after.
- Visual review: no seam, stretched UVs, or floating barriers.

**Commit message**

`Polish Racing track surface with asphalt, curbs, grid, and barriers`

## Task 6 - Environment Vertical Slice

**Files likely touched**

- Create `client/src/games/racing/environment.ts`
- Modify `client/src/games/racing/renderer.ts`
- Possibly add procedural texture helpers

**Scope**

Build one coherent Harbor City GP environment around the existing track.

**Requirements**

- Grandstands.
- Crowd silhouettes.
- Modern buildings.
- Palm trees or coastal vegetation.
- Light poles.
- Fencing.
- Track marshals or simple trackside props.
- Original sponsor banners.
- Background skyline.
- Sky/environment map or procedural sky.
- Use instancing or merged geometry for repeated scenery.
- Avoid hundreds of individual unique-material meshes.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Screenshot from chase and spectator viewpoints.
- Metrics with Low/Medium/High placeholder settings if available.
- Confirm draw calls stay near budget.

**Commit message**

`Build Harbor City GP environment with instanced trackside scenery`

## Task 7 - Lighting, Shadows, and Tone

**Files likely touched**

- `client/src/games/racing/renderer.ts`
- `client/src/games/racing/environment.ts`
- `client/src/games/racing/cars.ts`
- `client/src/games/racing/quality.ts`

**Scope**

Make the scene look intentional and premium even when stationary.

**Requirements**

- Directional sunlight.
- Ambient/environment lighting.
- Physically reasonable material response.
- Controlled shadows.
- Tone mapping.
- Exposure tuning.
- Optional subtle bloom only if performance allows and can be disabled.
- Limit shadow casters and shadow map cost.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Screenshot with car stationary at start grid.
- Metrics with shadows on/off.
- Confirm Low preset can disable/reduce shadows.

**Commit message**

`Tune Racing lighting, shadows, and tone for polished presentation`

## Task 8 - Camera System

**Files likely touched**

- Create `client/src/games/racing/camera.ts`
- Modify `client/src/games/racing/renderer.ts`
- Modify `client/src/pages/hostLobby.ts`
- Possibly styles for camera HUD control

**Scope**

Replace the simple chase camera with a multi-mode camera system.

**Requirements**

- Normal chase camera.
- Close chase camera.
- Cockpit/hood camera.
- Spectator camera.
- Finish camera.
- Smooth position damping.
- Smooth look-at damping.
- Speed-based field of view.
- Subtle acceleration/collision shake.
- Host camera-cycle control.
- Focused-player selection.
- Avoid nausea-inducing motion.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Run Racing and cycle all modes.
- Screenshot each mode.
- Verify focused-player row still works.
- Verify no duplicate listeners after navigation/rematch.

**Commit message**

`Add polished Racing camera modes with damping and speed FOV`

## Task 9 - Professional Racing HUD

**Files likely touched**

- Create or modify `client/src/games/racing/hud.ts`
- Modify `client/src/pages/hostLobby.ts`
- Modify `client/src/styles/components.css` or create `client/src/styles/racingHost.css`

**Scope**

Upgrade Racing host HUD and finish/result presentation.

**Requirements**

- Current position.
- Player name/color.
- Speedometer.
- Race progress.
- Leaderboard.
- Focused-player indicator.
- Countdown lights.
- Pause/status indicator where applicable.
- Restart/rematch affordance.
- Camera mode.
- Off-track warning.
- Finish/result sequence.
- Readable at laptop and projector resolutions.
- No duplicate Socket.IO listeners after remount/navigation.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Screenshot laptop and projector-ish wide viewport.
- Verify results/rematch/change game.
- Verify text does not overlap at narrow desktop widths.

**Commit message**

`Upgrade Racing host HUD with speedometer, leaderboard, and finish flow`

## Task 10 - Audio System

**Files likely touched**

- Create `client/src/games/racing/audio.ts`
- Modify `client/src/games/racing/renderer.ts`
- Modify `client/src/pages/hostLobby.ts`
- Styles for mute/volume controls

**Scope**

Add original/properly licensed Racing audio with clean lifecycle.

**Requirements**

- Engine loop.
- Engine pitch based on speed.
- Throttle response.
- Braking/tire scrub.
- Off-track rumble.
- Collision sound hook, even if collision arrives in Task 13.
- Countdown.
- Race start.
- Finish.
- UI feedback.
- Mute control.
- Master volume.
- Clean teardown.
- No duplicated `AudioContext`s after rematch/navigation.
- Respect browser user-gesture constraints.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Manual audio check with mute/unmute/rematch/navigation.
- Confirm no new AudioContext per rematch after teardown.
- Asset provenance documented if audio files are added.

**Commit message**

`Add Racing audio system with engine, countdown, finish, and clean teardown`

## Task 11 - Speed and Surface Effects

**Files likely touched**

- Create `client/src/games/racing/effects.ts`
- Modify `client/src/games/racing/renderer.ts`
- Possibly `client/src/games/racing/quality.ts`

**Scope**

Add performance-conscious visual effects using object pools.

**Requirements**

- Speed streaks.
- Subtle camera vibration hook.
- Tire smoke.
- Off-track dust.
- Impact sparks hook.
- Skid marks.
- Finish celebration.
- Object pools; do not allocate particle objects every frame.
- Quality preset controls active particle count.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Metrics with effects active.
- Memory check across repeated races/rematches.
- Screenshot/video capture if available.
- Confirm Low preset reduces/disables expensive effects.

**Commit message**

`Add pooled Racing speed, dust, skid, and finish effects`

## Task 12 - AI Opponents

**Files likely touched**

- `server/games/racing.ts`
- `server/types.ts`
- `shared/protocol.ts`
- `server/games/racing.test.ts`
- Client renderer/HUD files as needed to distinguish AI

**Scope**

Add simple authoritative AI cars for single-player races.

**Design decision required before editing**

Choose one:

- Use reserved numeric player numbers above human slots and optional display
  names/colors, or
- Extend `RacingPlayerState` with a non-breaking `kind: "human" | "ai"` and
  possibly `displayName`.

Document the chosen approach in the task report.

**Requirements**

- 3-7 AI cars in single-player.
- AI follows track geometry.
- AI steers using heading error and existing car model where practical.
- AI accelerates on straights.
- AI brakes before strong curves.
- Slight lane variations.
- Recovery after leaving track.
- Multiple difficulty/speed profiles.
- Server-authoritative.
- Human multiplayer remains functional.

**Verification**

- `npm.cmd run typecheck`
- Targeted Racing tests:
  - AI created only when expected.
  - AI progresses around track.
  - AI slows for curvature.
  - AI ranking/finish participates correctly.
  - Human input validation remains intact.
- `npm.cmd test`
- `npm.cmd run build`
- Manual single-player race against AI.
- Metrics with max AI count.

**Commit message**

`Add authoritative Racing AI opponents for single-player races`

## Task 13 - Basic Collisions

**Files likely touched**

- `server/games/racing.ts`
- `server/games/racing.test.ts`
- `shared/protocol.ts` if collision event/feedback fields are needed
- `client/src/games/racing/effects.ts`
- `client/src/controller/racingView.ts` for vibration/screen feedback

**Scope**

Add simple car-to-car collision response and feedback.

**Requirements**

- Circle/capsule overlap detection.
- Correct near start/finish wrap.
- Positional separation.
- Impact slowdown.
- Optional temporary steering disruption.
- Visual/audio feedback hooks.
- Phone vibration where supported.
- Screen feedback fallback.
- No full destructive rigid-body simulation.
- Cars no longer pass directly through each other without feedback.

**Verification**

- `npm.cmd run typecheck`
- Targeted Racing collision tests:
  - overlap detected
  - separation applied
  - speed reduced
  - wrap-around collision works near seam
  - no collision when far apart
- `npm.cmd test`
- `npm.cmd run build`
- Manual multi-car collision check.
- Verify feedback without breaking phone controls.

**Commit message**

`Add basic authoritative Racing collisions with impact feedback`

## Task 14 - Quality Presets and Optimization

**Files likely touched**

- `client/src/games/racing/quality.ts`
- `client/src/games/racing/renderer.ts`
- Environment/effects/lighting modules
- Host HUD/settings controls

**Scope**

Finalize Low/Medium/High presets and optimize scene cost.

**Requirements**

- Low, Medium, High presets.
- Presets control:
  - render pixel ratio
  - shadow resolution/enabled state
  - crowd density
  - environment object count
  - particles
  - postprocessing
  - optional detail effects
- Profile each preset.
- Reduce:
  - unnecessary material variations
  - draw calls
  - render-loop allocations
  - texture memory
  - duplicate geometries
  - unbounded particles
- Preset changes must be reflected in metrics overlay.

**Verification**

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- Run Racing on each preset.
- Record FPS/draw calls/triangles/textures/memory for each preset.
- Repeated rematch/navigation memory check.
- Confirm Low/Medium meet performance fallback target.

**Commit message**

`Add Racing quality presets and optimize rendering cost`

## Task 15 - Physical Phone and Production Verification

**Files likely touched**

- `README.md`
- Cycle 2 completion report under `.superpowers/sdd/` or docs
- Minor fixes only if verification finds bugs

**Scope**

Complete final Cycle 2 verification. This task may fix narrow bugs found by
the verification process, but must not add major new features.

**Required HTTPS physical tests**

- iPhone Safari.
- Android Chrome.
- Landscape-left.
- Landscape-right.
- Permission grant.
- Permission deny.
- Recalibration.
- Screen rotation.
- Backgrounding.
- Phone lock/unlock.
- Wi-Fi interruption.
- Reconnect.
- Different motion update rates.

**Complete flow**

QR -> permission -> landscape -> calibration -> ready -> countdown -> race ->
results -> rematch.

**Quality gates**

- Gate A screenshot quality.
- Gate B motion quality.
- Gate C game feel.
- Gate D performance.
- Gate E phone reliability.

**Production checks**

- `npm.cmd install`
- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- `npm start` or approved HTTPS deployment start.
- `/` serves hashed production assets.
- No `/@vite/client`.
- No `/src/main.ts`.
- SPA deep links return app shell.
- Local/Network/QR URLs print correctly.
- Controller Test still works.
- Racing 1-player with AI works.
- Racing 2-4 human players works where devices are available.
- Results/rematch/change-game work.
- No duplicate listeners, intervals, animation loops, AudioContexts, or
  particle growth across repeated rematches.
- Working tree clean.

**Commit message**

`Complete Pocket Formula Cycle 2 verification and documentation`

## Final Completion Report Requirements

The final Cycle 2 report must include:

1. Every commit created.
2. Files added/changed.
3. Typecheck result.
4. Test count and result.
5. Build result.
6. Production/HTTPS smoke result.
7. Screenshot quality assessment.
8. Motion quality assessment.
9. Game-feel assessment.
10. Performance metrics by preset.
11. Controller Test regression result.
12. Racing host/controller flow result.
13. iPhone Safari HTTPS result.
14. Android Chrome HTTPS result.
15. Remaining limitations, if any.
16. Working-tree cleanliness.

Do not call Cycle 2 complete until the visual, performance, game-feel, and
physical-phone gates pass.

## Plan Self-Review

Spec coverage:

- Baseline/performance instrumentation maps to Task 1.
- Code splitting maps to Task 2.
- Asset pipeline/art bible maps to Task 3.
- Formula-style car maps to Task 4.
- Track/curbs/barriers maps to Task 5.
- Harbor City GP environment maps to Task 6.
- Lighting/shadows/tone maps to Task 7.
- Camera system maps to Task 8.
- Professional HUD maps to Task 9.
- Audio maps to Task 10.
- Speed/surface effects maps to Task 11.
- AI opponents maps to Task 12.
- Collisions maps to Task 13.
- Quality presets/optimization maps to Task 14.
- Physical-phone/production verification maps to Task 15.

Architecture preservation:

- No task rewrites room lifecycle, QR flow, controller validation, or
  Controller Test.
- Server authority remains for physics, AI, collision, ranking, finish, and
  results.
- Shared track remains the source of truth for rendered track geometry.
- Client visual systems enhance `RacingRenderer` and related Racing-only
  modules.

Risk ordering:

- Metrics before detail.
- Code splitting before adding more Racing bundle weight.
- Art bible before assets.
- Visual car/track/environment before lighting/camera/HUD.
- Audio/effects after core visual read.
- AI before collision so collision can include AI interactions.
- Optimization before final physical verification.

Stop point:

- This plan is the required pre-implementation artifact. Do not begin Cycle 2
  implementation until this plan and the design spec have been reviewed.
