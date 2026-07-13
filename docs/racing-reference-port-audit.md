# Racing Reference Port Audit — pmndrs/racing-game

Date: 2026-07-13
Reference repo: `C:\Users\mingyu\racing-game-reference` (shallow clone of https://github.com/pmndrs/racing-game, commit at clone time)
Reference license (code): MIT (`LICENSE.md`, Copyright 2021 pmndrs, contributors)
Reference stack: React + `@react-three/fiber` (R3F) + `@react-three/cannon` (client-side Cannon.js physics) + `@react-three/drei` helpers. Pocket Arena's Racing renderer is **vanilla Three.js**, no React, no client-side physics (server-authoritative). Every system below is judged on how much of that R3F/physics wrapping has to be stripped to reach the underlying Three.js technique.

## Licensing summary (important correction to the repo's own README)

The README states "CC0 assets only," but two of the three GLTF models actually in use carry explicit **CC-BY-4.0** attribution comments in their generated source files — not CC0:

| Asset | File | License | Source |
| --- | --- | --- | --- |
| Chassis ("Classic Muscle car") | `public/models/chassis-draco.glb`, generated into `src/models/vehicle/Chassis.tsx` | **CC-BY-4.0** | Sketchfab, author "Alexus16" |
| Track ("Desert Race Game Prototype Map V2") | `public/models/track-draco.glb`, generated into `src/models/track/Track.tsx` | **CC-BY-4.0** | Sketchfab, author "Batuhan13" |
| Wheel | `public/models/wheel-draco.glb`, `src/models/vehicle/Wheel.tsx` | No attribution comment found; consistent with the project's own CC0 claim | Project's own `assets/wheel.blend` |
| HDRI | `public/textures/dikhololo_night_1k.hdr` | CC0 (recognized Poly Haven asset name/convention) | Poly Haven |
| Audio (`public/sounds/*.mp3`) | engine, accelerate, boost, brake, crash, honk, train, water | No per-file attribution comment found; consistent with CC0 claim | — |

**Recommendation: do not port the chassis or track GLB files.** Both are CC-BY-4.0 (attribution required, not blanket-reusable the way the README implies) and both are recognizable, specific real-world-styled assets (a literal muscle car, a literal desert map) that would work against Pocket Arena's own original bright-coastal-arcade identity established in `docs/superpowers/specs/2026-07-12-harbor-city-gp-art-bible.md` — this is exactly the "existing game asset" the project's own constraints rule out, license aside. The wheel model, HDRI, and audio files appear safely reusable, but **only the techniques are recommended below**, not a wholesale asset import, to keep Pocket Arena's car/track fully original per the art bible. Where a technique is recommended, any literal file this audit says to copy is called out explicitly and nothing else should be copied.

## Per-system audit

### 1. Vehicle rendering
- **File**: `src/models/vehicle/Chassis.tsx`
- **What it does**: Loads a Draco-compressed GLTF via `useGLTF`, then renders one `<mesh>` per named sub-geometry/material pair (body paint, secondary paint, glass, brake lights, headlights, grille, undercarriage, turn signals, chrome, dashboard wheel, license plates, a small decorative cluster, and two dashboard needle pointers). Per-frame (`useFrame`) it lerps the brake-light color/emissive/opacity toward red when braking, lerps glass opacity/color for a first-person camera mode, rotates a decorative dashboard steering wheel toward the current steering input, rotates a speedometer needle mesh toward `speed/maxSpeed`, and lerps the body-paint material color toward the store's selected player color.
- **Dependencies**: `@react-three/drei` (`useGLTF`), `@react-three/cannon` (`useBox` for the physics body), `three-stdlib` GLTF types. The multi-mesh/multi-material breakdown itself has zero physics dependency.
- **Portable to vanilla Three.js?** Yes, easily, for the *pattern* (one `THREE.GLTFLoader` load, iterate named meshes, assign per-part materials, mutate material properties per frame) — this is exactly how a real GLTF-based car would integrate with Pocket Arena's existing `CarVisual` interface (swap the procedurally-built `cars.ts` meshes for GLTF-loaded ones, same public shape). The **physics binding (`useBox`) is not portable and not needed** — Pocket Arena's car position/rotation already comes from server snapshots via `computeRacingCarWorldTransform`.
- **Asset license**: CC-BY-4.0, real "Classic Muscle car" — **not recommended for direct reuse** (see summary above).
- **Connection to Pocket Arena's authoritative state**: None of the physics matters. What's reusable is the *presentation* pattern: brake-light emissive driven by `car.brake` (already how Pocket Arena's `brakeLight.material.opacity` works), and the paint-color lerp driven by the player's assigned color (Pocket Arena already does this by constructing a fresh `MeshPhysicalMaterial` per player instead of lerping — equivalent outcome, different mechanism, no change needed).
- **Difficulty**: Low to port the *pattern* (already effectively how `cars.ts` works); the model itself is not being ported.

### 2. Wheel animation / front-wheel steering
- **File**: `src/models/vehicle/Wheel.tsx`, steering visual in `src/models/vehicle/Chassis.tsx` line 117, drive logic in `src/models/vehicle/Vehicle.tsx` lines 77-79.
- **What it does**: Each wheel is its own GLTF-loaded group, scaled to the configured wheel radius. Steering is applied to the two front wheel *physics* bodies via `api.setSteeringValue`; visually, the dashboard's decorative wheel mesh (not the car's actual front wheels) rotates toward `±π` based on left/right input as instant driver-feedback flourish.
- **Dependencies**: `@react-three/cannon` (`useCompoundBody`) for the physics wheel; none for the visual rotation itself.
- **Portable?** Yes. Pocket Arena's `cars.ts` already does front-wheel steering rotation and speed-based spin directly on the wheel meshes (`car.frontWheels[i].rotation.y`, `wheel.rotation.x -= speed * k`) — functionally equivalent to what this reference does, just applied straight to the real wheel mesh instead of a decorative dashboard prop. No gap here; already implemented.
- **Asset license**: Wheel GLB has no attribution comment (likely project-original/CC0), but not being ported — Pocket Arena keeps its own procedural wheel geometry.
- **Connection to authoritative state**: Already wired: Pocket Arena's wheel rotation reads directly from interpolated server `speed`/`headingError`, no local physics needed.
- **Difficulty**: N/A — already done.

### 3. Chase camera
- **File**: `src/models/vehicle/Vehicle.tsx`, `useFrame` block, lines 82-112.
- **What it does**: Every frame, computes a *target* camera position from `steeringValue` and `speed` (camera slides sideways with steering, pulls back and up with speed, dips forward under braking), then `camera.position.lerp(target, delta)` for smoothing. Separately lerps `camera.rotation.z` for a banking/swivel effect proportional to steering×speed, adds a small continuous sinusoidal "sway" (amplitude scaled by speed, frequency higher when boosting) to `rotation.x`/`rotation.z` for an engine-vibration feel, and leans the chassis body itself (a *separate* small rotation on a child group, not the physics body) proportional to steering×speed.
- **Dependencies**: None beyond `three` (`MathUtils.lerp`) — this is the single most directly portable system in the whole reference repo, since it's pure per-frame math operating on numbers Pocket Arena already has (interpolated `steeringError`/`headingError` and `speed` from the server snapshot).
- **Portable?** Yes, very. Pocket Arena's `RacingRenderer.render()` already does lerp-based chase-camera positioning (`clampCameraToTrack`, `cameraConfig`, `camera.position.lerp`), but does **not** currently do: (a) a body-lean/roll effect, (b) continuous idle sway/vibration, (c) camera roll (`rotation.z` bank) tied to steering. All three are cheap, additive, and match the earlier art-bible/quality-pass request for "slight body lean during turns" that was never implemented.
- **Asset license**: N/A (pure code technique, no asset).
- **Connection to authoritative state**: Directly usable as-is — feed the server-interpolated `headingError` (as this reference's `steeringValue`) and `speed` into the same lerp formulas.
- **Difficulty**: Low. Recommended for the vertical slice.

### 4. Environment construction / road & terrain materials
- **File**: `src/models/track/Track.tsx`, `Heightmap.tsx`, `assets/track.blend`.
- **What it does**: One large GLTF (`track-draco.glb`) containing the entire hand-modeled desert circuit — road surface, painted center strip, guardrail "tube," mountains, terrain, a water plane using `@react-three/drei`'s `MeshDistortMaterial` for a rippling shader effect, plus decorative birds/grass blades/clouds as individual meshes rotated slowly per frame for ambient life. `Heightmap.tsx` separately builds a `THREE.PlaneGeometry` and displaces its vertices from a grayscale PNG heightmap texture for the surrounding terrain, entirely proceduraly (no GLTF needed for that part).
- **Dependencies**: `@react-three/drei` for `MeshDistortMaterial` (a real, MIT-licensed, portable Three.js shader material — `three-stdlib`'s `MeshDistortMaterial` can be used directly in vanilla Three.js, no React required).
- **Portable?** The *heightmap-driven terrain generation* technique (sample a grayscale texture, displace a plane's vertices, `computeVertexNormals()`) is 100% portable and asset-free if we author our own small heightmap PNG (or skip it — Pocket Arena's coastline/skyline is already built from primitive massing, which is a reasonable, cheaper alternative). The *water shader* (`MeshDistortMaterial`) is directly reusable via `three-stdlib` (already a transitive dependency of `three`'s examples ecosystem) for Pocket Arena's harbor water plane, which currently uses a flat `MeshStandardMaterial` — a real, low-effort upgrade.
- **Asset license**: Track GLB is CC-BY-4.0 ("Desert Race Game Prototype Map V2") — **not recommended for direct reuse** (wrong theme anyway: desert, not coastal).
- **Connection to authoritative state**: None needed — track geometry is static scenery, exactly like Pocket Arena's existing `track.ts`/`environment.ts`.
- **Difficulty**: Low for the water-shader swap; medium if also adding a heightmap-displaced terrain skirt (needs an authored heightmap texture, which must be original art, not ported).

### 5. Skid marks
- **File**: `src/effects/Skid.tsx`.
- **What it does**: A single `InstancedMesh` of `count` (500) flat planes (`size × size*2`), rotated flat via a one-time `geometry.rotateX(-Math.PI/2)`. Every frame, if braking hard at speed > 10, it stamps a new instance matrix at the current rear-wheel world position/chassis rotation into the next ring-buffer slot (wrapping at `count`), leaving a persistent trail of dark decal rectangles on the ground behind the car.
- **Dependencies**: None beyond `three`. Trivially portable.
- **Portable?** Yes, directly — this is a genuinely new technique Pocket Arena doesn't have yet (the quality pass's final report explicitly flagged "off-track feedback is dust particles, not ground skid-mark decals" as a known gap). This closes that gap cheaply: one shared `InstancedMesh`, one dark semi-transparent material, triggered from `car.brake > threshold && Math.abs(car.speed) > threshold`, stamped at the rear-wheel world positions the renderer already computes.
- **Asset license**: N/A.
- **Connection to authoritative state**: Trigger condition and wheel position both come directly from already-interpolated server snapshot data (`pos.brake`/`pos.speed` and the car's world transform) — no new state needed.
- **Difficulty**: Low. Recommended for the vertical slice.

### 6. Dust / particles
- **File**: `src/effects/Dust.tsx`.
- **What it does**: A ring-buffer `InstancedMesh` of small spheres. While sliding or braking, spawns two new instances per tick at the rear wheel positions (with small random jitter and an intensity-scaled random size); every other tick it shrinks all existing instances slightly (scale -= 0.005) rather than tracking per-particle age/velocity.
- **Dependencies**: None beyond `three`.
- **Portable?** Yes, but Pocket Arena's existing `client/src/games/racing/effects.ts` (built during the quality pass) is already a *more* capable pooled-particle system for this purpose — explicit per-particle velocity + gravity + lifetime, rather than "shrink in place." No regression to adopt this simpler pattern; not recommended to replace what exists. Worth borrowing one detail: this reference triggers dust from wheel-slip state, which Pocket Arena doesn't model — Pocket Arena's own off-track-speed trigger is the correct equivalent for a track-relative arcade physics model and should stay as-is.
- **Asset license**: N/A.
- **Connection to authoritative state**: Already wired in Pocket Arena (`RacingRenderer` calls `effects.spawnDust` from interpolated off-track/speed state).
- **Difficulty**: N/A — superseded by existing work.

### 7. Speed effects (boost)
- **File**: `src/effects/Boost.tsx`.
- **What it does**: A small fixed-count `InstancedMesh` of cubes emitted from two fixed rear-mounted points, animated backward and scaled down over a repeating time-modulo cycle, only visible while a "boost" input is held. This is a distinct game mechanic (a boost/nitro button) Pocket Arena's design does not have.
- **Dependencies**: None beyond `three`.
- **Portable?** The particle-cycling technique is portable, but there is no boost mechanic to attach it to in Pocket Arena's server physics, and adding one would be a physics/gameplay change out of scope for a visual pass.
- **Asset license**: N/A.
- **Connection to authoritative state**: Would require a new authoritative "boosting" flag server-side — out of scope.
- **Difficulty**: Not recommended for this slice (no corresponding mechanic).

### 8. Shadows and lighting
- **File**: `src/App.tsx`, lines 34-50.
- **What it does**: One low-intensity ambient light (0.1) plus one directional "sun" light with a large (4096²) shadow map and a shadow-camera frustum sized to the whole track (`±150` on every side), plus `@react-three/drei`'s `<Environment>` component loading an HDRI for image-based reflections/ambient lighting (this is what makes the car paint and glass look glossy rather than flat), plus `<Sky>` (drei's wrapper around `three/examples/jsm/objects/Sky.js`, a real physically-based atmospheric scattering sky that ships with three.js itself under the same MIT license).
- **Dependencies**: `@react-three/drei`'s `Sky`/`Environment` are thin React wrappers around plain `three` objects (`Sky` from `three/examples/jsm/objects/Sky.js`; `Environment` is a `PMREMGenerator` + HDR loader). Both are usable in vanilla Three.js directly, no React required.
- **Portable?** Yes. Two concrete, asset-free upgrades for Pocket Arena: (a) generate a procedural environment map via `THREE.PMREMGenerator` (even from a simple in-memory gradient scene, no HDRI file needed) and assign it to `scene.environment` so the car's `MeshPhysicalMaterial` clearcoat actually has something to reflect — right now it has no environment map at all, which is very likely a meaningful part of why the car still reads as "flat" up close; (b) `three/examples/jsm/objects/Sky.js` as an option to replace the current canvas-gradient sky dome for real atmospheric scattering, tuned toward a bright midday look (high turbidity/low rayleigh trends toward hazy-bright, matching the "bright, playful" mood better than the reference's default sunset-leaning tuning).
- **Asset license**: `Sky.js` ships with `three` (already a dependency) — no new license. No HDRI file is being ported (the reference's is night-themed and CC-BY-context-free but simply wrong for this project); a procedural `PMREMGenerator` environment needs no external file at all.
- **Connection to authoritative state**: None — pure lighting setup, same as Pocket Arena's existing `renderer.ts` mount-time lighting.
- **Difficulty**: Low for the procedural environment map (biggest visual return for the effort of anything in this audit); low-medium for swapping in `Sky.js` (needs tuning to avoid a moody/dark look).

### 9. HUD
- **Files**: `src/ui/Speed/Gauge.tsx` (SVG speedometer), `src/ui/Clock.tsx`, `src/ui/LeaderBoard.tsx`, `src/ui/Finished.tsx`.
- **What it does**: `Gauge.tsx` renders two overlaid inline SVGs — a angled "wedge" shape and a gradient-filled background whose gradient stop offset is updated every frame (via R3F's `addEffect`, i.e. tied to the render loop, not React state) to reflect `speed/maxSpeed`. The rest (`Clock`, `LeaderBoard`, `Finished`) are plain DOM/React overlays, conceptually identical to Pocket Arena's existing DOM HUD (`hostLobby.ts`).
- **Dependencies**: Plain SVG + DOM, no `three` dependency at all for the gauge — trivially portable to any DOM-based HUD, framework or not.
- **Portable?** Yes, directly and cheaply. Pocket Arena's current speedometer is a plain "144 / KM/H / DRIVE" text block; swapping in an angled SVG gauge with a speed-driven gradient fill (same visual idea, redrawn with Pocket Arena's own bright color palette, not copied pixel-for-pixel) is a fast, meaningful HUD polish item with zero licensing questions since it's simple procedural SVG markup, not an imported asset.
- **Asset license**: N/A (inline SVG markup, not an image asset).
- **Connection to authoritative state**: Directly - drive the gradient offset from the same interpolated `speed`/`maxSpeed` Pocket Arena's HUD already reads.
- **Difficulty**: Low.

### 10. Audio
- **Files**: `src/effects/audio/Engine.tsx` (and sibling `Accelerate.tsx`, `Boost.tsx`, `Brake.tsx`, `Honk.tsx`).
- **What it does**: Real recorded/produced `.mp3` samples played via `THREE.PositionalAudio` (wrapped by drei), with playback rate (pitch) lerped toward an RPM estimate and volume tied to speed — same *concept* Pocket Arena's Web Audio synthesis engine already implements (oscillator frequency/gain tied to speed in `audio.ts`), just sample-based instead of synthesized.
- **Dependencies**: `@react-three/drei`'s `<PositionalAudio>` wraps `THREE.PositionalAudio` directly — portable, but the interesting part (sample files) is what would need porting, not the wrapper.
- **Portable?** The pitch/volume-modulation *technique* is already implemented in Pocket Arena via synthesis. The sample files themselves have no explicit per-file license comment (unlike the two Sketchfab models), so they're plausibly covered by the project's CC0 claim, but "plausibly" is exactly the uncertainty this audit was told not to act on — **not recommending porting the audio files** without an explicit, individually-confirmed license for each one. Pocket Arena's existing zero-asset synthesized audio remains the safer choice and needs no change for this visual-focused slice.
- **Asset license**: Uncertain per-file (see above) — not ported.
- **Connection to authoritative state**: N/A (no change recommended).
- **Difficulty**: N/A — not recommended.

### 11. Loading states
- **File**: `src/ui/Intro.tsx`.
- **What it does**: Uses `@react-three/drei`'s `useProgress()`, a thin hook over Three.js's own global `THREE.DefaultLoadingManager`, to show a real "`loading NN%`" readout that only reaches "Click to start" once every queued texture/model finishes loading.
- **Dependencies**: `@react-three/drei` hook, but it's a thin wrapper — the underlying mechanism is plain `THREE.LoadingManager.onProgress`.
- **Portable?** Yes, directly and cheaply. Pocket Arena's current "Loading Racing..." text in `hostLobby.ts` is static (no real percentage). Wiring a `THREE.LoadingManager` through the renderer's texture/geometry construction and surfacing `itemsLoaded/itemsTotal` as a percentage is a small, real improvement with no licensing surface at all.
- **Asset license**: N/A.
- **Connection to authoritative state**: N/A (client-side asset loading only).
- **Difficulty**: Low.

## Recommended vertical-slice scope (from this audit)

In priority order by (visual impact) ÷ (implementation risk):

1. Procedural PMREM environment map for car paint/glass reflections (§8) — no asset, biggest single "looks expensive now" jump.
2. Chase-camera lean/sway/roll additions (§3) — no asset, directly reuses existing interpolated state.
3. Skid marks (§5) — no asset, closes a previously-flagged gap.
4. HUD speed gauge redraw as an original SVG wedge gauge (§9) — no asset, original artwork, not a copy.
5. Water shader swap for the harbor plane via `MeshDistortMaterial` (§4) — ships with `three`/`three-stdlib`, already a dependency.
6. Loading-manager-driven real progress percentage (§11) — no asset.

Not recommended for this slice: chassis/track GLB import (§1, §4 — CC-BY, wrong theme, conflicts with original-identity constraint), boost particles (§7 — no matching mechanic), sample-based audio (§10 — licensing not individually confirmed, no functional gap versus existing synthesis).
