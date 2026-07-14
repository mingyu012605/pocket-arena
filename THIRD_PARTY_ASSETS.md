# Third-Party Assets

This file lists every third-party (non-original) asset bundled into Pocket Arena, why it was chosen, and what its license requires. See also `client/src/assets/racing/ATTRIBUTION.md` for the same racing entries alongside the files they live next to.

## Kenney Racing Kit (vehicle + stadium props)

- **Pack name:** "Racing Kit"
- **Creator:** Kenney (www.kenney.nl)
- **Original source:** https://kenney.nl/assets/racing-kit
- **License:** CC0 1.0 Universal (public domain) - http://creativecommons.org/publicdomain/zero/1.0/ - verified directly against the pack's own bundled `License.txt`, which explicitly states "This content is free to use in personal, educational and commercial projects."
- **Project files:** `client/src/assets/racing/models/kenney-race-car.glb`, `kenney-grandstand.glb`, `kenney-flag-checkers.glb`, `kenney-tree-large.glb`, `kenney-tree-small.glb`, `kenney-lightpost.glb`
- **Modifications:** No geometry edits. At runtime, Pocket Arena clones the car per player and re-tints only its neutral "grey" body-paint material to the player's color; tire and glass materials are left as authored. Stadium props (grandstand, flags, trees, light posts) are cloned and scattered along the start straight using the server's own track-centerline math, with no material changes beyond shadow settings.
- **Why this replaced the previous asset choice:** An earlier pass used a CC-BY-4.0 "Classic Muscle car" and a CC-BY-4.0 desert-diorama landmark (both sourced through a separate reference project). Visually, a realistic 1970s muscle car next to a desert mountain, a tropical harbor, and modern city towers read as unrelated projects stitched together rather than one identity. The Kenney pack supplies the car *and* the venue dressing from one consistent, CC0, low-poly arcade-racing art style, and requires no attribution complexity to use.

## @pmndrs/assets (npm package)

- **Package:** `@pmndrs/assets` v1.7.0
- **License:** CC0 1.0 Universal (public domain) - see `node_modules/@pmndrs/assets/LICENSE`, independently verified to contain the full CC0 legal text
- **Assets used:** `normals/0004.webp` (asphalt normal map), `normals/0012.webp` (curb normal map), `textures/cloud.webp` (grass/runoff detail alpha map)
- **Project usage:** Imported directly in `client/src/games/racing/track.ts`; no attribution required by CC0, credited here for traceability.
