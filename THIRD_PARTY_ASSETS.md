# Third-Party Assets

This file lists every third-party (non-original) asset bundled into Pocket Arena, why it was chosen, and what its license requires. See also `client/src/assets/racing/ATTRIBUTION.md` for the same racing-model entries alongside the files they live next to.

## Classic Muscle car (vehicle chassis + wheel)

- **Asset name:** "Classic Muscle car"
- **Creator:** Lexyc16
- **Original source:** https://sketchfab.com/3d-models/classic-muscle-car-641efc889e5f4543bae51d0922e6f4b3
- **License:** CC-BY-4.0 ("CC Attribution" per Sketchfab's license field) - https://creativecommons.org/licenses/by/4.0/
- **Project files:** `client/src/assets/racing/models/chassis-draco.glb`, `client/src/assets/racing/models/wheel-draco.glb`
- **Modifications:** Re-exported as Draco-compressed GLB (already compressed upstream in the source project this was sourced through); no geometry or texture edits. At runtime, Pocket Arena clones the model per car and re-tints only the body-paint material to the player's color; tire, glass, and other materials are left as authored.
- **Attribution note:** The reference project this file was originally sourced through mis-transcribes the author's name as "Alexus16" in its generated source comments. This was checked directly against the live Sketchfab listing on 2026-07-13, which shows the author as **Lexyc16** — that is the name used here.

## Desert Race Game Prototype Map V2 (track landmark)

- **Asset name:** "Desert Race Game Prototype Map V2"
- **Creator:** Batuhan13
- **Original source:** https://sketchfab.com/3d-models/desert-race-game-prototype-map-v2-2ccd3dcbd197415d9f1b97c30b1248c5
- **License:** CC-BY-4.0 ("CC Attribution" per Sketchfab's license field) - https://creativecommons.org/licenses/by/4.0/
- **Project file:** `client/src/assets/racing/models/track-draco.glb`
- **Modifications:** Re-exported as Draco-compressed GLB; no geometry or texture edits. Used only as a distant, scaled-down background landmark near the harbor skyline - not as drivable track geometry (the actual road surface and collision boundaries remain Pocket Arena's own authored track, driven by `shared/racingTrack.ts` and the server-authoritative physics in `server/games/racing.ts`).
- **Attribution note:** Verified directly against the live Sketchfab listing on 2026-07-13; author and license match the source comments in the reference project this was sourced through.

## @pmndrs/assets (npm package)

- **Package:** `@pmndrs/assets` v1.7.0
- **License:** CC0 1.0 Universal (public domain) - see `node_modules/@pmndrs/assets/LICENSE`, independently verified to contain the full CC0 legal text
- **Assets used:** `normals/0004.webp` (asphalt normal map), `normals/0012.webp` (curb normal map), `textures/cloud.webp` (grass/runoff detail alpha map)
- **Project usage:** Imported directly in `client/src/games/racing/track.ts`; no attribution required by CC0, credited here for traceability.

## Draco decoder (three.js)

- **Files:** `client/public/draco/draco_decoder.js`, `client/public/draco/draco_decoder.wasm`, `client/public/draco/draco_wasm_wrapper.js`
- **Source:** `three/examples/jsm/libs/draco/gltf` (ships with the `three` npm package Pocket Arena already depends on)
- **License:** Apache-2.0 / BSD-style notices per the upstream Three.js/Draco distribution
