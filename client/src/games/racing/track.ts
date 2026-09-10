import * as THREE from "three";
import { TEST_OVAL_TRACK, sampleRacingTrackFrame } from "../../../../shared/racingTrack";
import { computeRacingCarWorldTransform } from "./carTransform";
import asphaltNormalUrl from "@pmndrs/assets/normals/0004.webp";
import curbNormalUrl from "@pmndrs/assets/normals/0012.webp";
import terrainDetailUrl from "@pmndrs/assets/textures/cloud.webp";

const TRACK_SAMPLES = 960;
export const VISUAL_BARRIER_OFFSET = 2.6;
const TERRAIN_FLUSH_OFFSET = TEST_OVAL_TRACK.trackHalfWidth + 26;
const TERRAIN_OUTER_OFFSET = TEST_OVAL_TRACK.trackHalfWidth + 260;

/**
 * Layer heights are spaced by at least 0.02 units and curbs sit flush with
 * the road (not below it) at their shared edge - the previous 0.005-unit
 * gaps between road/curb/line layers were thin enough, on a track spanning
 * hundreds of units, to read as z-fighting or a hairline gap at that seam
 * rather than an intentional curb step.
 */
const LAYER_Y = {
  runoff: 0.01,
  road: 0.03,
  curb: 0.03,
  edgeLine: 0.05,
  laneGuide: 0.06,
  finish: 0.08,
  startGrid: 0.09
};

function loadRepeatTexture(url: string, repeatX: number, repeatY: number, colorSpace?: THREE.ColorSpace): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 12;
  if (colorSpace) texture.colorSpace = colorSpace;
  return texture;
}

export function buildTrackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 2048;
  const ctx = canvas.getContext("2d")!;
  const asphalt = ctx.createLinearGradient(0, 0, canvas.width, 0);
  asphalt.addColorStop(0, "#090d14");
  asphalt.addColorStop(0.18, "#182231");
  asphalt.addColorStop(0.5, "#2f3d52");
  asphalt.addColorStop(0.82, "#182231");
  asphalt.addColorStop(1, "#090d14");
  ctx.fillStyle = asphalt;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, 30, canvas.height);
  ctx.fillRect(canvas.width - 30, 0, 30, canvas.height);
  ctx.fillStyle = "#cbd5e1";
  for (let y = 0; y < canvas.height; y += 86) {
    ctx.fillRect(0, y, 30, 43);
    ctx.fillRect(canvas.width - 30, y + 43, 30, 43);
  }
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(36, 0, 9, canvas.height);
  ctx.fillRect(canvas.width - 45, 0, 9, canvas.height);
  ctx.fillStyle = "#e5e7eb";
  for (let y = 0; y < canvas.height; y += 112) {
    ctx.fillRect(canvas.width / 2 - 8, y, 16, 64);
  }
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#cbd5e1";
  for (let y = 24; y < canvas.height; y += 112) {
    ctx.fillRect(canvas.width * 0.32 - 3, y, 6, 54);
    ctx.fillRect(canvas.width * 0.68 - 3, y + 54, 6, 54);
  }
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.fillRect(x, y, Math.random() > 0.6 ? 2 : 1, 1);
  }
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = "#0f172a";
  for (let y = 0; y < canvas.height; y += 44) {
    ctx.beginPath();
    ctx.moveTo(54, y);
    ctx.lineTo(canvas.width - 54, y + 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 34);
  texture.anisotropy = 12;
  return texture;
}

export function buildCheckerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#f8fafc" : "#111827";
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

export function buildCurbTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < canvas.height; y += 32) {
    ctx.fillStyle = y % 64 === 0 ? "#111827" : "#f8fafc";
    ctx.fillRect(0, y, canvas.width, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 32);
  return texture;
}

export function buildGrassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  // Muted from a brighter, more saturated lime-green gradient - it was
  // pulling the eye away from the road (the surface that actually matters
  // while driving) instead of reading as a background surface.
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#a3c583");
  gradient.addColorStop(0.48, "#719c5f");
  gradient.addColorStop(1, "#47734f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.strokeStyle = i % 3 === 0 ? "#e7ffd1" : "#347a46";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 5 + Math.random() * 9, y + 2 + Math.random() * 7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 10);
  texture.anisotropy = 4;
  return texture;
}

function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function racingTracksideTerrainY(progress: number, lateralOffset: number): number {
  const absOffset = Math.abs(lateralOffset);
  if (absOffset <= TERRAIN_FLUSH_OFFSET) {
    return sampleRacingTrackFrame(TEST_OVAL_TRACK, progress, lateralOffset).y;
  }

  const side = Math.sign(lateralOffset) || 1;
  const inner = sampleRacingTrackFrame(TEST_OVAL_TRACK, progress, side * TERRAIN_FLUSH_OFFSET);
  const t = smoothStep((absOffset - TERRAIN_FLUSH_OFFSET) / Math.max(1, TERRAIN_OUTER_OFFSET - TERRAIN_FLUSH_OFFSET));
  return inner.y + (0.02 - inner.y) * t;
}

export function buildSponsorTexture(title: string, accent: string, bg: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, bg);
  gradient.addColorStop(1, "#0f172a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,.16)";
  for (let x = -40; x < canvas.width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 42, 0);
    ctx.lineTo(x + 108, canvas.height);
    ctx.lineTo(x + 66, canvas.height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = accent;
  ctx.fillRect(0, canvas.height - 18, canvas.width, 18);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 54px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, canvas.width / 2, 72);
  ctx.font = "800 22px Arial";
  ctx.fillStyle = "#dffbff";
  ctx.fillText("POCKET ARENA RACING", canvas.width / 2, 120);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Placeholder-only graybox tint per segment type, purely for playtest
// readability until Cycle 5's real environment art - deliberately not
// exported/reused anywhere the real art pass would need to touch.
const SEGMENT_GRAYBOX_COLOR: Record<string, [number, number, number]> = {
  flat: [1, 1, 1],
  ramp: [1, 0.65, 0.15],
  gap: [1, 0.25, 0.25],
  landing: [0.35, 1, 0.45],
  bank: [1, 1, 1]
};

/**
 * Uses the exact same `sampleRacingTrackFrame` the server's physics reads
 * (`shared/racingTrack.ts`) for both elevation and banking, so the visible
 * road surface can never drift out of sync with what the car actually
 * drives on - a mismatch here would be especially confusing right at a
 * landing, where the player is watching the road to judge where they'll
 * touch down.
 */
function buildRibbonMesh(innerOffset: number, outerOffset: number, yOffset: number, material: THREE.Material): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const stripCount = Math.max(1, Math.ceil(Math.abs(outerOffset - innerOffset) / 5));

  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const progress = (i / TRACK_SAMPLES) * TEST_OVAL_TRACK.trackLength;
    for (let strip = 0; strip <= stripCount; strip++) {
      const t = strip / stripCount;
      const offset = outerOffset + (innerOffset - outerOffset) * t;
      const frame = sampleRacingTrackFrame(TEST_OVAL_TRACK, progress, offset);
      positions.push(frame.x, frame.y + yOffset, frame.z);
      uvs.push(t, i / TRACK_SAMPLES);
      const [r, g, b] = SEGMENT_GRAYBOX_COLOR[frame.segmentType] ?? [1, 1, 1];
      colors.push(r, g, b);
    }
  }

  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const row = stripCount + 1;
    for (let strip = 0; strip < stripCount; strip++) {
      const a = i * row + strip;
      const b = a + 1;
      const c = (i + 1) * row + strip;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, material);
}

function buildTerrainApronMesh(
  innerOffset: number,
  outerOffset: number,
  yOffset: number,
  material: THREE.Material
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  // Muted along with the other grass colors above - these vertex colors
  // multiply on top of terrainApronMaterial's own (already muted) color and
  // texture, so leaving them this bright was silently undoing most of that
  // muting on the wide outer terrain apron.
  const groundColor = new THREE.Color("#6f9a56");
  const roadsideColor = new THREE.Color("#7ba85f");

  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const progress = (i / TRACK_SAMPLES) * TEST_OVAL_TRACK.trackLength;
    const inner = sampleRacingTrackFrame(TEST_OVAL_TRACK, progress, innerOffset);
    const outer = sampleRacingTrackFrame(TEST_OVAL_TRACK, progress, outerOffset);
    const outerY = racingTracksideTerrainY(progress, outerOffset);

    positions.push(outer.x, outerY + yOffset, outer.z);
    positions.push(inner.x, inner.y + yOffset, inner.z);
    uvs.push(0, i / TRACK_SAMPLES);
    uvs.push(1, i / TRACK_SAMPLES);
    colors.push(groundColor.r, groundColor.g, groundColor.b, roadsideColor.r, roadsideColor.g, roadsideColor.b);
  }

  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, material);
}

export function buildTrackGroup(): THREE.Group {
  const group = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: "#263449",
    map: buildTrackTexture(),
    normalMap: loadRepeatTexture(asphaltNormalUrl, 2, 42),
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide,
    // Multiplies with the asphalt map/color above rather than replacing it,
    // so the per-segment graybox tint (ramp/gap/landing) reads as a color
    // wash over the existing road texture, not a flat swap.
    vertexColors: true
  });
  const runoffMaterial = new THREE.MeshStandardMaterial({
    color: "#749e5c",
    map: buildGrassTexture(),
    alphaMap: loadRepeatTexture(terrainDetailUrl, 18, 18, THREE.SRGBColorSpace),
    roughness: 0.92,
    metalness: 0.01,
    side: THREE.DoubleSide,
    vertexColors: true
  });
  const terrainApronMaterial = new THREE.MeshStandardMaterial({
    color: "#77a95c",
    map: buildGrassTexture(),
    alphaMap: loadRepeatTexture(terrainDetailUrl, 24, 24, THREE.SRGBColorSpace),
    roughness: 0.94,
    metalness: 0.01,
    side: THREE.DoubleSide,
    vertexColors: true
  });
  const lineMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc", side: THREE.DoubleSide });
  const laneGuideMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc", transparent: true, opacity: 0.68, side: THREE.DoubleSide });
  // Was #111827 - nearly the same dark tone as the road asphalt itself, so
  // this buffer strip was invisible against the road and grass appeared to
  // start immediately at the track edge with no transition. A distinct,
  // neutral dirt/gravel gray reads as a clear off-track buffer instead.
  const shoulderMaterial = new THREE.MeshStandardMaterial({ color: "#8a8377", roughness: 0.88, metalness: 0.01, side: THREE.DoubleSide });
  const curbMaterial = new THREE.MeshStandardMaterial({
    map: buildCurbTexture(),
    normalMap: loadRepeatTexture(curbNormalUrl, 1, 36),
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.78,
    side: THREE.DoubleSide
  });
  // Neutral white/red barrier (was a pale cyan with a teal emissive glow -
  // running the full track length, that was a major contributor to the
  // scene's overall cyan cast). Matches the red/white curb for a coherent,
  // classic racing-barrier look instead.
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: "#f1f5f9", roughness: 0.42, metalness: 0.05 });
  const startGridMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc" });

  // Keep grass strictly outside the asphalt. A single wide runoff ribbon used
  // to pass under the road, which could bleed green through the asphalt on
  // steep/banked camera angles.
  const runoffLeft = buildRibbonMesh(-halfWidth - 26, -halfWidth - 7.45, LAYER_Y.runoff, runoffMaterial);
  const runoffRight = buildRibbonMesh(halfWidth + 7.45, halfWidth + 26, LAYER_Y.runoff, runoffMaterial);
  const terrainApronLeft = buildTerrainApronMesh(-TERRAIN_FLUSH_OFFSET, -TERRAIN_OUTER_OFFSET, LAYER_Y.runoff - 0.008, terrainApronMaterial);
  const terrainApronRight = buildTerrainApronMesh(TERRAIN_FLUSH_OFFSET, TERRAIN_OUTER_OFFSET, LAYER_Y.runoff - 0.008, terrainApronMaterial);
  const road = buildRibbonMesh(-halfWidth, halfWidth, LAYER_Y.road, roadMaterial);
  const shoulderRight = buildRibbonMesh(halfWidth + 1.1, halfWidth + 7.2, LAYER_Y.road, shoulderMaterial);
  const shoulderLeft = buildRibbonMesh(-halfWidth - 7.2, -halfWidth - 1.1, LAYER_Y.road, shoulderMaterial);
  const curbRight = buildRibbonMesh(halfWidth, halfWidth + 1.05, LAYER_Y.curb, curbMaterial);
  const curbLeft = buildRibbonMesh(-halfWidth - 1.05, -halfWidth, LAYER_Y.curb, curbMaterial);
  for (const mesh of [terrainApronLeft, terrainApronRight, runoffLeft, runoffRight, road, shoulderRight, shoulderLeft, curbRight, curbLeft]) mesh.receiveShadow = true;
  group.add(terrainApronLeft, terrainApronRight, runoffLeft, runoffRight, shoulderRight, shoulderLeft, road);
  group.add(buildRibbonMesh(halfWidth - 0.68, halfWidth - 0.28, LAYER_Y.edgeLine, lineMaterial));
  group.add(buildRibbonMesh(-halfWidth + 0.28, -halfWidth + 0.68, LAYER_Y.edgeLine, lineMaterial));
  group.add(buildRibbonMesh(halfWidth * 0.32, halfWidth * 0.32 + 0.22, LAYER_Y.laneGuide, laneGuideMaterial));
  group.add(buildRibbonMesh(-halfWidth * 0.32 - 0.22, -halfWidth * 0.32, LAYER_Y.laneGuide, laneGuideMaterial));
  group.add(curbRight, curbLeft);

  const start = computeRacingCarWorldTransform({ progress: 0, lateralOffset: 0, headingError: 0 });
  const finish = new THREE.Mesh(
    new THREE.BoxGeometry(halfWidth * 2.35, 0.05, 1.4),
    new THREE.MeshBasicMaterial({ map: buildCheckerTexture(), side: THREE.DoubleSide })
  );
  finish.position.set(start.x, LAYER_Y.finish, start.z);
  finish.rotation.y = -start.heading;
  group.add(finish);

  for (let lane = -2; lane <= 2; lane++) {
    for (let row = 0; row < 3; row++) {
      const markerProgress = TEST_OVAL_TRACK.trackLength - 6 - row * 5;
      const marker = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.04, 2.25), startGridMaterial);
      const transform = computeRacingCarWorldTransform({
        progress: markerProgress,
        lateralOffset: lane * 2,
        headingError: 0
      });
      marker.position.set(transform.x, LAYER_Y.startGrid, transform.z);
      marker.rotation.y = -transform.heading;
      group.add(marker);
    }
  }

  const barrierGeometry = new THREE.BoxGeometry(1.4, 1.2, 0.28);
  const barrierCountPerSide = 78;
  const barriers = new THREE.InstancedMesh(barrierGeometry, barrierMaterial, barrierCountPerSide * 2);
  const matrix = new THREE.Matrix4();
  let index = 0;
  for (let i = 0; i < barrierCountPerSide; i++) {
    const progress = (i / barrierCountPerSide) * TEST_OVAL_TRACK.trackLength;
    for (const side of [-1, 1]) {
      const offset = side * (halfWidth + VISUAL_BARRIER_OFFSET);
      const frame = sampleRacingTrackFrame(TEST_OVAL_TRACK, progress, offset);
      matrix.compose(
        new THREE.Vector3(frame.x, frame.y + 0.62, frame.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -frame.heading, 0)),
        new THREE.Vector3(1, 1, 1)
      );
      barriers.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  group.add(barriers);

  return group;
}
