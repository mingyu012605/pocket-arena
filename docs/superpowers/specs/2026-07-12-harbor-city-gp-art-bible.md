# Pocket Formula - Harbor City GP Art Bible

Date: 2026-07-12
Status: Living reference for Cycle 2 asset decisions
Spec: `docs/superpowers/specs/2026-07-12-racing-polished-vertical-slice-design.md`
Plan: `docs/superpowers/plans/2026-07-12-racing-polished-slice-implementation.md`

This document records the concrete art decisions already embedded in the
renderer plus the decisions made when closing out the remaining Cycle 2
tasks. It exists so later tasks (lighting, HUD, effects, audio) stay
consistent with what earlier tasks already established, instead of each
task re-deriving its own palette or proportions.

## 1. Asset Strategy Decision

**Procedural only for this cycle.** No glTF model is introduced. There is no
licensed or project-authored 3D model available to import, and building one
outside this pipeline is out of scope for this pass. All geometry (car,
track, environment, props) is built with Three.js primitives and
canvas-generated textures, matching the design spec's "preferred near-term
strategy."

If a glTF car is introduced in a future cycle, it must follow these
conventions so it drops in without renderer changes:

- Coordinate orientation: +Z forward (nose), +Y up, matching the current
  procedural car's local axes.
- Unit scale: 1 unit = 1 meter, car footprint approximately 4.2m long x
  1.9m wide before the group-level 1.55x presentation scale.
- Material naming: a single `paint` material slot driving player livery
  color (set via `material.color`), separate from fixed `carbon`/`rubber`/
  `rim` slots that stay shared across players.
- Player-color slot: exactly one mesh/material subtree must accept a color
  override per player; everything else (wheels, wings, cockpit) stays
  shared geometry/material across all cars.
- Geometry sharing: wheel/rim geometry must be reused across all four
  wheels and across all cars, never cloned per-instance.
- A primitive fallback (the procedural car below) must remain in the
  codebase and activate automatically if the glTF fails to load.

## 2. Car Proportions and Scale

Original Pocket Arena open-wheel arcade car (not a replica of any real
team, manufacturer, or livery):

- Overall footprint (before 1.55x presentation scale): ~3.9m nose-to-tail,
  ~1.9m wide including front wing endplates.
- Silhouette must read as an open-wheel car from chase-camera distance
  (~12 world units behind, ~5.8 up): distinct nose taper, a raised
  mid-body "greenhouse" bump for the cockpit, and wheels that visibly
  protrude past the body's side profile.
- Body shapes use tapered wedge forms (stretched cylinders/cones with
  faceted cross-sections), not spheres - spheres under extreme
  non-uniform scale round off every edge and are the reason the previous
  car read as a flat blob from a distance. Hard edges at the nose taper,
  sidepod step, and rear deck are required for readability at a glance.
- Wings sized to read as crisp horizontal bars: front wing spans the full
  car width plus endplates, rear wing sits elevated on a strut above the
  rear deck with visible negative space beneath it.
- Cockpit opening is a visually distinct dark carbon recess with a
  contrasting bright helmet color, since the cockpit bump is the single
  most recognizable feature of an open-wheel silhouette.

## 3. Player Color System

- Each human player's `paint` material uses their assigned room color
  (already assigned at the room/lobby level, threaded through
  `RacingPlayerState.color`).
- Bot/AI cars use a fixed fallback palette, shared with the server's bot
  color assignment: `#f97316` (orange), `#22c55e` (green), `#a855f7`
  (purple), `#facc15` (yellow).
- Fixed shared materials across every car regardless of player color:
  carbon/carbon-fiber black (`#111827`), rubber black (`#09090b`), rim
  cyan-white (`#c7f9ff` with a light cyan emissive), accent yellow
  (`#fbbf24`) for the stripe/wing-tip accent.
- Accent stripe/helmet trim always uses the shared accent color, not the
  player color, so cars stay visually distinct from their own livery
  (avoids a single-color car reading as a flat silhouette).

## 4. Track Materials

- Asphalt: canvas-gradient ribbon texture, dark charcoal core
  (`#111827` -> `#5b6676` -> `#111827`) with painted edge lines
  (`#f8fafc` white, `#38bdf8` blue inner guide) and yellow center lane
  ticks (`#facc15`).
- Curbs: alternating red/white canvas stripe texture (`#fb7185` / white),
  laid as a dedicated ribbon strip outside the road edge, not overlapping
  the asphalt ribbon (avoids z-fighting).
- Runoff/grass: green gradient canvas texture (`#86efac` -> `#4ade80` ->
  `#22c55e`) with scattered blade-stroke detail at low opacity.
- Start grid: white box markers in a 5-lane pattern at the final straight.
- Finish line: checkerboard canvas texture, full track width.
- Barriers: instanced boxes in a warm cream (`#fff7cc`), matte, positioned
  just outside the curb ribbon.

## 5. Environment Palette and Lighting Direction

- Theme: bright coastal sports-city circuit ("Harbor City"). Water,
  modern skyline, palm trees, grandstands, sponsor boards - all original.
- Sky: gradient dome (`#38bdf8` horizon-blue -> `#b9f2ff` -> near-white
  haze), warm sun disc low in the west, soft cone "mountain" silhouettes
  and drifting cloud puffs for horizon depth.
- Key light: directional "sun" at `(60, 120, 40)`, warm white
  (`#fff7df`), the dominant shadow-casting light.
- Fill: hemisphere light, cool sky (`#f3fbff`) over warm ground bounce
  (`#36553d`), plus a cool rim light from the opposite side
  (`#8be8ff`) to keep car silhouettes readable against the bright sky.
- Buildings/skyline: cool blue-glass tone (`#bfdbfe`) with warm window
  accents (`#fff7ed`), kept simple (box massing, no unique per-building
  materials) since they are instanced/repeated along the horizon.

## 6. Sponsor Board System

All sponsor boards are fictional and generated on canvas at render time
(`buildSponsorTexture`). Current fictional brand pool used across boards
and gantries: **BOOST**, **TILT**, **RALLY**, **PHONE POWER**, **ARENA**,
**GO!**, plus the gantry banner **RACING RALLY**. Every board also renders
the "POCKET ARENA RACING" wordmark as a secondary line. New boards must
draw from this same fictional pool or extend it with equally generic,
non-trademark names - never a real sponsor, team, or manufacturer.

## 7. Texture Budgets

All textures are canvas-generated at runtime, not imported files, so
"budget" means canvas pixel dimensions kept deliberately small and shared:

- Track/curb/grass ribbon textures: 512x2048 max, tiled via
  `RepeatWrapping`, one instance shared across the whole ribbon.
- Crowd/sponsor board textures: 1024x256 or 512x160, one canvas per
  distinct board/crowd variant, reused via `MeshBasicMaterial` sharing
  where the same variant repeats.
- No texture exceeds 1024px on its longest edge. No unique per-car or
  per-instance textures - player color is a material color, never baked
  into a texture.

## 8. UI Typography and HUD Style

- Rounded-card game UI consistent with the rest of Pocket Arena's launcher
  design language (see `components.css` `.pa-*` classes) - not a
  separate visual language for Racing.
- HUD panels use the existing dark-glass rounded-panel treatment already
  established for the leaderboard/status/speedometer panels, high
  contrast text on a translucent dark backing so it stays legible over a
  bright sky background.
- Development-only diagnostics (frame stats, lifecycle counters, raw
  interpolation state) must never share styling with the real HUD - they
  stay a distinct monospace overlay, gated behind `?dev=1`, so a player
  never mistakes a debug readout for part of the game.

## 9. Branding Restrictions

No real racing brands, teams, manufacturers, sponsors, logos, copied
liveries, or trade dress. Explicitly banned regardless of context: Ferrari,
F1/Formula 1 marks, Pirelli, any real F1/IndyCar/NASCAR team name or
livery, any real tire/energy-drink/automotive sponsor. All car names, team
names, and sponsor names come from the fictional pool in this document or
follow its naming pattern (short, generic, arcade-energetic).

## 10. Provenance

Every asset in this cycle is procedural (canvas textures generated in
`renderer.ts`/`cars.ts`/`environment.ts`/`track.ts` at runtime, or Three.js
primitive geometry). No binary image, audio, or model files are introduced
in this cycle beyond the pre-existing `card-racing.webp` launcher key art
(already part of the repo before this cycle, used only as a distant
billboard texture). If a future cycle adds binary assets, this section must
be updated with source and license for each file before it is committed.
