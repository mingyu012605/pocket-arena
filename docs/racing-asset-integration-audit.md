# Racing Asset Integration Audit

This audit covers assets inspected for the first asset-based Pocket Arena Racing graphics pass. Assets with unclear or missing per-asset licensing were not copied.

**Superseded 2026-07-13:** the "Classic Muscle car" chassis/wheel and "Desert Race Game Prototype Map V2" landmark documented below were replaced in a follow-up art-direction pass. Visually, a realistic muscle car next to a desert landmark, a tropical harbor, and modern city towers read as unrelated projects combined rather than one identity. They were replaced with Kenney's CC0 "Racing Kit" (car + grandstand/flags/trees/light posts, one consistent art style) - see `THIRD_PARTY_ASSETS.md` for the current, authoritative asset list. This document is kept as a historical record of what was evaluated and why.

## Selected Assets

| Asset | Source path | App path | Type | License | Attribution | Size / polycount | Textures | Web suitability | Optimization |
|---|---|---|---|---|---|---|---|---|---|
| Classic Muscle car chassis | `C:\Users\mingyu\racing-game-reference\public\models\chassis-draco.glb` | `client/src/assets/racing/models/chassis-draco.glb` | Draco-compressed GLB vehicle body/interior/lights | CC-BY-4.0, documented in `src/models/vehicle/Chassis.tsx` | Required: Lexyc16 / Sketchfab / CC-BY-4.0 (verified directly against the live Sketchfab listing on 2026-07-13; the reference repo's own source comment misspells the author as "Alexus16") | 42.7 KB; 13 meshes; 11 materials; 6,995 vertices; 5,822 triangles | Embedded material colors, no external textures observed | Good: small compressed model, suitable for per-car cloning | Requires Draco decoder; no further conversion needed |
| Classic Muscle car wheel | `C:\Users\mingyu\racing-game-reference\public\models\wheel-draco.glb` | `client/src/assets/racing/models/wheel-draco.glb` | Draco-compressed GLB wheel | CC-BY-4.0 via same vehicle source comments | Required: Lexyc16 / Sketchfab / CC-BY-4.0 (see chassis row - same source, verified same day) | 4.8 KB; 1 mesh; 2 materials; 426 vertices; 512 triangles | Embedded material colors, no external textures observed | Excellent: very small and reusable for animated wheel clones | Requires Draco decoder; no further conversion needed |
| Desert Race Game Prototype Map V2 | `C:\Users\mingyu\racing-game-reference\public\models\track-draco.glb` | `client/src/assets/racing/models/track-draco.glb` | Draco-compressed GLB terrain/trackside landmark set | CC-BY-4.0, documented in `src/models/track/Track.tsx` | Required: Batuhan13 / Sketchfab / CC-BY-4.0 | 621.1 KB; 31 meshes; 13 materials; 298,474 vertices; 120,720 triangles | Embedded material colors/palette references, no external texture files copied | Usable as a backdrop/landmark, too heavy to duplicate or use for collision | Loaded once as a distant scaled scene landmark; keep out of camera/road path |
| `@pmndrs/assets` normal map `0004.webp` | `node_modules/@pmndrs/assets/normals/0004.webp.js` | bundled by Vite import | WebP normal map for asphalt | CC0 1.0 Universal from package `LICENSE` | None required | 512x512 per package README | Packaged WebP | Good: optimized and self-hosted via npm package | Direct import is acceptable because Racing is already lazy-loaded |
| `@pmndrs/assets` normal map `0012.webp` | `node_modules/@pmndrs/assets/normals/0012.webp.js` | bundled by Vite import | WebP normal map for curb/concrete | CC0 1.0 Universal | None required | 512x512 per package README | Packaged WebP | Good | Direct import in lazy Racing chunk |
| `@pmndrs/assets` texture `cloud.webp` | `node_modules/@pmndrs/assets/textures/cloud.webp.js` | bundled by Vite import | WebP texture used as terrain noise/detail | CC0 1.0 Universal | None required | 512x512 per package README | Packaged WebP | Good | Direct import in lazy Racing chunk |

## Inspected But Not Selected

| Asset | Path | Reason |
|---|---|---|
| `@pmndrs/assets/models/suzi.glb` | `node_modules/@pmndrs/assets/models/suzi.glb.js` | License is clear CC0, but it is not a racing vehicle or trackside asset. |
| `@pmndrs/assets/models/bunny.glb` | `node_modules/@pmndrs/assets/models/bunny.glb.js` | License is clear CC0, but it does not fit the Racing vertical slice. |
| Reference `.blend` source files | `C:\Users\mingyu\racing-game-reference\assets\*.blend` | Not copied; GLBs are already optimized for web use and have documented provenance. |
| Reference sounds | `C:\Users\mingyu\racing-game-reference\public\sounds\*.mp3` | Not copied in this pass; licensing is less clearly documented per file than the selected models. |

## License Notes

- The reference repository root uses MIT for project code and the README says CC0 assets, but individual generated model source files document the selected vehicle and track GLBs as CC-BY-4.0 Sketchfab assets. This pass treats the individual source-file license comments as authoritative and adds attribution.
- No asset with unclear licensing was copied.
- The `@pmndrs/assets` npm package is CC0 1.0 Universal and explicitly describes its assets as optimized/compressed for web use.
