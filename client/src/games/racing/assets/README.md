# Racing Assets

Art bible: `docs/superpowers/specs/2026-07-12-harbor-city-gp-art-bible.md`.

This directory is reserved for binary Racing assets (glTF models, baked
textures, audio files) if a future cycle introduces any. As of this cycle,
**no binary assets live here** - every car, track, and environment visual
is procedural (Three.js primitive geometry plus canvas-generated textures
built at runtime in `../renderer.ts`, `../cars.ts`, `../track.ts`, and
`../environment.ts`).

## Provenance ledger

| File | Source | License | Notes |
| --- | --- | --- | --- |
| _(none yet)_ | | | |

Every binary file added to this directory must get a row above with its
source and license before it is committed. No real racing brand,
manufacturer, sponsor, or copied livery is permitted regardless of source
or license - see the art bible's branding restrictions.

## glTF conventions (if a model is ever added)

See the art bible section 1 for the full contract. Summary: +Z forward,
+Y up, 1 unit = 1 meter, a single `paint` material slot for player-color
override, shared `carbon`/`rubber`/`rim` materials, and a working
procedural fallback if the model fails to load.
