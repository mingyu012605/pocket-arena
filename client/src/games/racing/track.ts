import * as THREE from "three";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";
import { computeRacingCarWorldTransform } from "./carTransform";
import asphaltNormalUrl from "@pmndrs/assets/normals/0004.webp";
import curbNormalUrl from "@pmndrs/assets/normals/0012.webp";
import terrainDetailUrl from "@pmndrs/assets/textures/cloud.webp";

const TRACK_SAMPLES = 320;
export const VISUAL_BARRIER_OFFSET = 2.6;

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
  asphalt.addColorStop(0, "#111827");
  asphalt.addColorStop(0.18, "#334155");
  asphalt.addColorStop(0.5, "#5b6676");
  asphalt.addColorStop(0.82, "#334155");
  asphalt.addColorStop(1, "#111827");
  ctx.fillStyle = asphalt;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, 30, canvas.height);
  ctx.fillRect(canvas.width - 30, 0, 30, canvas.height);
  ctx.fillStyle = "#ef4444";
  for (let y = 0; y < canvas.height; y += 86) {
    ctx.fillRect(0, y, 30, 43);
    ctx.fillRect(canvas.width - 30, y + 43, 30, 43);
  }
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(38, 0, 7, canvas.height);
  ctx.fillRect(canvas.width - 45, 0, 7, canvas.height);
  ctx.fillStyle = "#facc15";
  for (let y = 0; y < canvas.height; y += 112) {
    ctx.fillRect(canvas.width / 2 - 8, y, 16, 64);
  }
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#dbeafe";
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
      ctx.fillStyle = (x + y) % 2 === 0 ? "#ffffff" : "#0ea5e9";
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
    ctx.fillStyle = y % 64 === 0 ? "#fb7185" : "#ffffff";
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
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#86efac");
  gradient.addColorStop(0.48, "#4ade80");
  gradient.addColorStop(1, "#22c55e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.strokeStyle = i % 3 === 0 ? "#bbf7d0" : "#15803d";
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

function buildRibbonMesh(innerOffset: number, outerOffset: number, y: number, material: THREE.Material): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const progress = (i / TRACK_SAMPLES) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    positions.push(center.x + nx * outerOffset, y, center.z + nz * outerOffset);
    positions.push(center.x + nx * innerOffset, y, center.z + nz * innerOffset);
    uvs.push(0, i / TRACK_SAMPLES);
    uvs.push(1, i / TRACK_SAMPLES);
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
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, material);
}

export function buildTrackGroup(): THREE.Group {
  const group = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: "#596575",
    map: buildTrackTexture(),
    normalMap: loadRepeatTexture(asphaltNormalUrl, 2, 42),
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide
  });
  const runoffMaterial = new THREE.MeshStandardMaterial({
    color: "#7bdd88",
    map: buildGrassTexture(),
    alphaMap: loadRepeatTexture(terrainDetailUrl, 18, 18, THREE.SRGBColorSpace),
    roughness: 0.92,
    metalness: 0.01,
    side: THREE.DoubleSide
  });
  const lineMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc", side: THREE.DoubleSide });
  const laneGuideMaterial = new THREE.MeshBasicMaterial({ color: "#bae6fd", transparent: true, opacity: 0.72, side: THREE.DoubleSide });
  const curbMaterial = new THREE.MeshStandardMaterial({
    map: buildCurbTexture(),
    normalMap: loadRepeatTexture(curbNormalUrl, 1, 36),
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.78,
    side: THREE.DoubleSide
  });
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: "#fff7cc", roughness: 0.48, metalness: 0.02 });
  const startGridMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc" });

  const runoff = buildRibbonMesh(-halfWidth - 8.5, halfWidth + 8.5, LAYER_Y.runoff, runoffMaterial);
  const road = buildRibbonMesh(-halfWidth, halfWidth, LAYER_Y.road, roadMaterial);
  const curbRight = buildRibbonMesh(halfWidth, halfWidth + 1.05, LAYER_Y.curb, curbMaterial);
  const curbLeft = buildRibbonMesh(-halfWidth - 1.05, -halfWidth, LAYER_Y.curb, curbMaterial);
  for (const mesh of [runoff, road, curbRight, curbLeft]) mesh.receiveShadow = true;
  group.add(runoff, road);
  group.add(buildRibbonMesh(halfWidth - 0.38, halfWidth - 0.16, LAYER_Y.edgeLine, lineMaterial));
  group.add(buildRibbonMesh(-halfWidth + 0.16, -halfWidth + 0.38, LAYER_Y.edgeLine, lineMaterial));
  group.add(buildRibbonMesh(halfWidth * 0.32, halfWidth * 0.32 + 0.12, LAYER_Y.laneGuide, laneGuideMaterial));
  group.add(buildRibbonMesh(-halfWidth * 0.32 - 0.12, -halfWidth * 0.32, LAYER_Y.laneGuide, laneGuideMaterial));
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
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    for (const side of [-1, 1]) {
      const offset = side * (halfWidth + VISUAL_BARRIER_OFFSET);
      matrix.compose(
        new THREE.Vector3(center.x + nx * offset, 0.62, center.z + nz * offset),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0)),
        new THREE.Vector3(1, 1, 1)
      );
      barriers.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  group.add(barriers);

  const archMaterial = new THREE.MeshStandardMaterial({ color: "#38bdf8", roughness: 0.36, metalness: 0.12, emissive: "#0ea5e9", emissiveIntensity: 0.12 });
  for (let i = 0; i < 6; i++) {
    const progress = (i / 8) * TEST_OVAL_TRACK.trackLength + 18;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const arch = new THREE.Group();
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.28, 4.2, 0.28), archMaterial);
    const right = left.clone();
    const top = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 6, 0.24, 0.32), archMaterial);
    left.position.set(-halfWidth - 2.8, 2.1, 0);
    right.position.set(halfWidth + 2.8, 2.1, 0);
    top.position.set(0, 6.4, 0);
    left.position.y = 3.2;
    right.position.y = 3.2;
    left.scale.y = 1.52;
    right.scale.y = 1.52;
    arch.add(left, right, top);
    arch.position.set(center.x, 0, center.z);
    arch.rotation.y = -angle;
    group.add(arch);
  }

  const gantry = new THREE.Group();
  const gantryMaterial = new THREE.MeshStandardMaterial({ color: "#0ea5e9", roughness: 0.48, metalness: 0.08 });
  const signMaterial = new THREE.MeshStandardMaterial({ color: "#f97316", roughness: 0.35, metalness: 0.03 });
  const gantrySignMaterial = new THREE.MeshBasicMaterial({ map: buildSponsorTexture("RACING RALLY", "#facc15", "#2563eb") });
  for (const x of [-halfWidth - 2.8, halfWidth + 2.8]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 8.6, 0.35), gantryMaterial);
    post.position.set(x, 4.3, 0);
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 6.2, 1.05, 0.45), signMaterial);
  beam.position.set(0, 8.35, 0);
  gantry.add(beam);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(halfWidth * 1.9, 3), gantrySignMaterial);
  sign.position.set(0, 8.44, -0.27);
  gantry.add(sign);
  gantry.position.set(start.x, 0, start.z);
  gantry.rotation.y = -start.heading;
  group.add(gantry);
  return group;
}
