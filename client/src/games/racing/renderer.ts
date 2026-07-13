import * as THREE from "three";
import type { GameRenderer } from "../gameRenderer";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";
import type { PublicRoomState, RacingGameStatePayload, RacingPlayerState } from "../../../../shared/protocol";
import { RacingMetricsOverlay, shouldShowRacingMetrics } from "./metrics";
import type { RacingLifecycleStats } from "./metrics";
import { getDefaultRacingQuality } from "./quality";
import type { RacingQualitySettings } from "./quality";
import { buildCarMesh } from "./cars";
import type { CarVisual } from "./cars";
import { buildTrackGroup, buildSponsorTexture } from "./track";
import { computeRacingCarWorldTransform } from "./carTransform";

const racingKeyArtUrl = new URL("../../assets/launcher/card-racing.webp", import.meta.url).href;

interface CarFrame {
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  rank: number;
}

type CameraMode = "chase" | "close" | "hood" | "spectator";

interface Snapshot {
  time: number;
  players: Map<number, CarFrame>;
}

const RENDER_DELAY_MS = 85;
const MAX_EXTRAPOLATE_MS = 70;
const MAX_SNAPSHOTS = 6;
const CAMERA_DISTANCE = 12;
const CAMERA_HEIGHT = 5.8;
const CAMERA_LOOK_AHEAD = 10;
const CAMERA_MODES: CameraMode[] = ["chase", "close", "hood", "spectator"];
const SNAPSHOT_HZ_WINDOW_MS = 5000;
const FRAME_BUDGET_MS = 1000 / 55;
const PIXEL_RATIO_STEP = 0.12;
const BOT_FALLBACK_COLORS = ["#f97316", "#22c55e", "#a855f7", "#facc15", "#38bdf8"];

const racingLifecycleStats = {
  rendererInstances: 0,
  resizeListeners: 0
};

function readHostLifecycleStats(): Pick<RacingLifecycleStats, "rafLoops" | "socketGameStateListeners"> {
  const debug = window.__pocketArenaRacingDebug ?? {};
  return {
    rafLoops: debug.rafLoops ?? 0,
    socketGameStateListeners: debug.socketGameStateListeners ?? 0
  };
}

function buildCrowdTexture(seed = 0): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const colors = ["#f97316", "#22c55e", "#38bdf8", "#ec4899", "#facc15", "#a855f7", "#ffffff"];
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#1d4ed8");
  sky.addColorStop(1, "#0f172a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < 5; row++) {
    const y = 38 + row * 38;
    ctx.fillStyle = row % 2 === 0 ? "rgba(255,255,255,.16)" : "rgba(15,23,42,.35)";
    ctx.fillRect(0, y + 16, canvas.width, 12);
    for (let i = 0; i < 70; i++) {
      const x = ((i * 37 + row * 19 + seed * 23) % canvas.width) + 5;
      const color = colors[(i + row + seed) % colors.length]!;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 8 + ((i + row) % 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 7, y + 8, 14, 17);
      if ((i + row + seed) % 5 === 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 11, y + 12);
        ctx.lineTo(x - 22, y - 4);
        ctx.moveTo(x + 11, y + 12);
        ctx.lineTo(x + 22, y - 4);
        ctx.stroke();
      }
    }
  }
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = "900 32px Arial";
  ctx.textAlign = "center";
  ctx.fillText("RALLY CROWD", canvas.width / 2, 232);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function buildHarborEnvironment(density: number): THREE.Group {
  const group = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 150),
    new THREE.MeshStandardMaterial({ color: "#38bdf8", roughness: 0.48, metalness: 0.08, emissive: "#0ea5e9", emissiveIntensity: 0.08 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.035, 70);
  group.add(water);

  const buildingMaterial = new THREE.MeshStandardMaterial({ color: "#bfdbfe", roughness: 0.7, metalness: 0.02 });
  const windowMaterial = new THREE.MeshBasicMaterial({ color: "#fff7ed" });
  const count = Math.max(8, Math.round(22 * density));
  for (let i = 0; i < count; i++) {
    const height = 8 + ((i * 17) % 26);
    const width = 5 + (i % 4);
    const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, 7), buildingMaterial);
    building.position.set(-125 + i * (250 / count), height / 2 - 0.02, -245 - (i % 3) * 9);
    building.castShadow = true;
    building.receiveShadow = true;
    group.add(building);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, height * 0.72, 0.04), windowMaterial);
    windows.position.set(building.position.x, height * 0.54, building.position.z + 3.52);
    group.add(windows);
  }

  const grandstandMaterial = new THREE.MeshStandardMaterial({ color: "#2563eb", roughness: 0.48, metalness: 0.08 });
  for (const side of [-1, 1]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(38, 5, 7), grandstandMaterial);
    stand.position.set(side * 54, 2.5, -22);
    stand.rotation.y = side * 0.28;
    stand.castShadow = true;
    group.add(stand);
    const crowd = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 7.2),
      new THREE.MeshBasicMaterial({ map: buildCrowdTexture(side > 0 ? 1 : 2), side: THREE.DoubleSide })
    );
    crowd.position.set(side * 54, 6.5, -18.3);
    crowd.rotation.y = stand.rotation.y;
    group.add(crowd);
  }

  const foregroundStandMaterial = new THREE.MeshStandardMaterial({ color: "#2563eb", roughness: 0.48, metalness: 0.06 });
  const foregroundSeatMaterial = new THREE.MeshBasicMaterial({ color: "#fbbf24" });
  const foregroundCrowdColors = ["#f97316", "#22c55e", "#38bdf8", "#ec4899", "#facc15"];
  const foregroundStand = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(46, 7, 10), foregroundStandMaterial);
  base.position.set(0, 3.5, 0);
  foregroundStand.add(base);
  for (let row = 0; row < 4; row++) {
    const seats = new THREE.Mesh(new THREE.BoxGeometry(42, 0.5, 0.7), foregroundSeatMaterial);
    seats.position.set(0, 4.6 + row * 0.65, -3.5 + row * 1.8);
    foregroundStand.add(seats);
    for (let i = 0; i < 14; i++) {
      const fan = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 8, 6),
        new THREE.MeshBasicMaterial({ color: foregroundCrowdColors[(i + row) % foregroundCrowdColors.length]! })
      );
      fan.position.set(-19 + i * 2.9, 5.1 + row * 0.65, -3.1 + row * 1.8);
      foregroundStand.add(fan);
    }
  }
  foregroundStand.position.set(48, 0, -28);
  foregroundStand.rotation.y = -0.48;
  const foregroundCrowd = new THREE.Mesh(
    new THREE.PlaneGeometry(43, 10),
    new THREE.MeshBasicMaterial({ map: buildCrowdTexture(7), side: THREE.DoubleSide })
  );
  foregroundCrowd.position.set(0, 7.7, -1.8);
  foregroundCrowd.rotation.x = -0.04;
  foregroundStand.add(foregroundCrowd);
  group.add(foregroundStand);

  const megaStandMaterial = new THREE.MeshStandardMaterial({ color: "#1e40af", roughness: 0.45, metalness: 0.12 });
  for (const [x, z, rotationY, seed] of [
    [-88, -70, 0.42, 11],
    [88, -120, -0.42, 13]
  ] as const) {
    const stand = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(58, 12, 16), megaStandMaterial);
    base.position.set(0, 6, 0);
    stand.add(base);
    const crowd = new THREE.Mesh(
      new THREE.PlaneGeometry(56, 13),
      new THREE.MeshBasicMaterial({ map: buildCrowdTexture(seed), side: THREE.DoubleSide })
    );
    crowd.position.set(0, 12.8, -8.2);
    stand.add(crowd);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(64, 1.2, 20), new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.32, metalness: 0.04 }));
    roof.position.set(0, 20, -2);
    roof.rotation.x = 0.16;
    stand.add(roof);
    stand.position.set(x, 0, z);
    stand.rotation.y = rotationY;
    group.add(stand);
  }

  const boardMaterial = new THREE.MeshStandardMaterial({ color: "#fb7185", roughness: 0.42 });
  const poleMaterial = new THREE.MeshStandardMaterial({ color: "#0f766e", roughness: 0.38, metalness: 0.12 });
  for (let i = 0; i < Math.round(18 * density); i++) {
    const progress = (i / 18) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    const board = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.35, 0.16), boardMaterial);
    board.position.set(center.x + nx * side * 11, 1.35, center.z + nz * side * 11);
    board.rotation.y = -angle;
    group.add(board);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), poleMaterial);
    pole.position.set(board.position.x, 1.6, board.position.z);
    group.add(pole);
  }

  const palmTrunkMaterial = new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.8 });
  const palmLeafMaterial = new THREE.MeshStandardMaterial({ color: "#22c55e", roughness: 0.82 });
  for (let i = 0; i < Math.round(16 * density); i++) {
    const x = -120 + i * 16;
    const z = i % 2 === 0 ? 34 : -228;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 6, 8), palmTrunkMaterial);
    trunk.position.set(x, 3, z);
    group.add(trunk);
    const leaves = new THREE.Group();
    for (let j = 0; j < 5; j++) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 4.8), palmLeafMaterial);
      leaf.position.y = 6.25;
      leaf.rotation.y = (j / 5) * Math.PI * 2;
      leaf.rotation.x = 0.36;
      leaves.add(leaf);
    }
    leaves.position.set(x, 0, z);
    group.add(leaves);
  }

  group.add(buildKeyArtBackdrop());

  return group;
}

function buildTracksideDetails(density: number): THREE.Group {
  const group = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const matrix = new THREE.Matrix4();

  const coneCount = Math.max(24, Math.round(64 * density));
  const coneGeometry = new THREE.CylinderGeometry(0.06, 0.3, 0.82, 12);
  const coneMaterial = new THREE.MeshStandardMaterial({ color: "#fb6b21", roughness: 0.5, metalness: 0.02, emissive: "#7c2d12", emissiveIntensity: 0.08 });
  const cones = new THREE.InstancedMesh(coneGeometry, coneMaterial, coneCount);
  for (let i = 0; i < coneCount; i++) {
    const progress = (i / coneCount) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    matrix.compose(
      new THREE.Vector3(center.x + nx * side * (halfWidth + 3.2), 0.42, center.z + nz * side * (halfWidth + 3.2)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    cones.setMatrixAt(i, matrix);
  }
  group.add(cones);

  const stackCount = Math.max(10, Math.round(18 * density));
  const tireGeometry = new THREE.CylinderGeometry(0.62, 0.62, 0.28, 18);
  const tireMaterial = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.74, metalness: 0.02 });
  const tires = new THREE.InstancedMesh(tireGeometry, tireMaterial, stackCount * 3);
  let tireIndex = 0;
  for (let i = 0; i < stackCount; i++) {
    const progress = ((i + 0.35) / stackCount) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    for (let stack = 0; stack < 3; stack++) {
      matrix.compose(
        new THREE.Vector3(center.x + nx * side * (halfWidth + 5.3), 0.18 + stack * 0.28, center.z + nz * side * (halfWidth + 5.3)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, -angle, 0)),
        new THREE.Vector3(1, 1, 1)
      );
      tires.setMatrixAt(tireIndex, matrix);
      tireIndex += 1;
    }
  }
  group.add(tires);

  const boardSpecs = [
    ["BOOST", "#f97316", "#0f172a"],
    ["TILT", "#38bdf8", "#1d4ed8"],
    ["RALLY", "#facc15", "#7c3aed"],
    ["PHONE POWER", "#22c55e", "#0f766e"],
    ["ARENA", "#ec4899", "#be123c"],
    ["GO!", "#ffffff", "#f97316"]
  ] as const;
  for (let i = 0; i < boardSpecs.length; i++) {
    const [title, accent, bg] = boardSpecs[i]!;
    const progress = ((i + 0.5) / boardSpecs.length) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 3),
      new THREE.MeshBasicMaterial({ map: buildSponsorTexture(title, accent, bg), side: THREE.DoubleSide })
    );
    board.position.set(center.x + nx * side * (halfWidth + 8.2), 2.5, center.z + nz * side * (halfWidth + 8.2));
    board.rotation.y = -angle + (side > 0 ? -0.22 : Math.PI + 0.22);
    group.add(board);
  }

  const poleMaterial = new THREE.MeshStandardMaterial({ color: "#164e63", roughness: 0.36, metalness: 0.2 });
  const lampMaterial = new THREE.MeshBasicMaterial({ color: "#fff7ad" });
  for (let i = 0; i < Math.round(10 * density); i++) {
    const progress = (i / 10) * TEST_OVAL_TRACK.trackLength + 14;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 8, 10), poleMaterial);
    pole.position.set(center.x + nx * side * (halfWidth + 7), 4, center.z + nz * side * (halfWidth + 7));
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), lampMaterial);
    lamp.position.set(pole.position.x, 8.1, pole.position.z);
    group.add(lamp);
  }

  return group;
}

function buildKeyArtBackdrop(): THREE.Group {
  const group = new THREE.Group();
  const texture = new THREE.TextureLoader().load(racingKeyArtUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const screenSpecs: Array<[number, number, number, number, number]> = [
    [42, 22, -46, -0.72, 44],
    [-58, 22, -82, 0.34, 58],
    [62, 19, -132, -0.36, 48],
    [-92, 18, -178, 0.42, 46]
  ];

  const frameMaterial = new THREE.MeshStandardMaterial({ color: "#0f6fcb", roughness: 0.35, metalness: 0.18 });
  for (const [x, y, z, rotationY, width] of screenSpecs) {
    const height = width * 0.5625;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    board.position.set(x, y, z);
    board.rotation.y = rotationY;
    group.add(board);

    const top = new THREE.Mesh(new THREE.BoxGeometry(width + 2, 0.8, 0.8), frameMaterial);
    const bottom = top.clone();
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.8, height + 2, 0.8), frameMaterial);
    const right = left.clone();
    top.position.set(x, y + height / 2 + 0.8, z);
    bottom.position.set(x, y - height / 2 - 0.8, z);
    left.position.set(x - width / 2 - 0.8, y, z);
    right.position.set(x + width / 2 + 0.8, y, z);
    for (const item of [top, bottom, left, right]) item.rotation.y = rotationY;
    group.add(top, bottom, left, right);
  }
  return group;
}

function buildSkyDome(): THREE.Group {
  const group = new THREE.Group();
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 64;
  skyCanvas.height = 512;
  const skyCtx = skyCanvas.getContext("2d")!;
  const skyGradient = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
  skyGradient.addColorStop(0, "#38bdf8");
  skyGradient.addColorStop(0.44, "#b9f2ff");
  skyGradient.addColorStop(1, "#f8fbff");
  skyCtx.fillStyle = skyGradient;
  skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide })
  );
  group.add(dome);

  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(24, 48),
    new THREE.MeshBasicMaterial({ color: "#fde68a", transparent: true, opacity: 0.92, side: THREE.DoubleSide })
  );
  sun.position.set(-145, 110, -350);
  sun.rotation.y = 0.3;
  group.add(sun);

  const mountainMaterial = new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.42, side: THREE.DoubleSide });
  for (let i = 0; i < 8; i++) {
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(22 + (i % 3) * 9, 38 + (i % 4) * 8, 4), mountainMaterial);
    mountain.position.set(-170 + i * 48, 18, -330 - (i % 2) * 18);
    mountain.rotation.y = Math.PI / 4;
    mountain.scale.z = 0.62;
    group.add(mountain);
  }

  const cloudMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 18; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3 + ((i + j) % 3), 12, 8), cloudMaterial);
      puff.scale.set(1.8, 0.42, 0.8);
      puff.position.set(j * 4.2, 0, (j % 2) * 1.4);
      cloud.add(puff);
    }
    cloud.position.set(-160 + i * 19, 42 + (i % 5) * 4, -260 - (i % 4) * 22);
    cloud.rotation.y = (i % 3) * 0.2;
    group.add(cloud);
  }
  return group;
}

function buildConfettiField(count: number): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(0.28, 0.75);
  const material = new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide, vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const colors = ["#f97316", "#facc15", "#22c55e", "#38bdf8", "#ec4899", "#8b5cf6"];
  for (let i = 0; i < count; i++) {
    const x = -120 + Math.random() * 240;
    const y = 5 + Math.random() * 40;
    const z = -250 + Math.random() * 210;
    matrix.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)),
      new THREE.Vector3(1, 1, 1)
    );
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]!));
  }
  return mesh;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    for (const value of Object.values(item)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    item.dispose();
  }
}

export class RacingRenderer implements GameRenderer<RacingGameStatePayload> {
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private cars = new Map<number, CarVisual>();
  private colors = new Map<number, string>();
  private snapshots: Snapshot[] = [];
  private focusedPlayerNumber: number | null = null;
  private container: HTMLElement | null = null;
  private metrics: RacingMetricsOverlay | null = null;
  private snapshotTimes: number[] = [];
  private lastSnapshotAt = 0;
  private readonly quality: RacingQualitySettings = getDefaultRacingQuality();
  private cameraInitialized = false;
  private cameraMode: CameraMode = "chase";
  private lookTarget = new THREE.Vector3();
  private cameraShake = 0;
  private pixelRatio = 1;
  private targetPixelRatio = 1;
  private frameDeltas: number[] = [];
  private lastFrameAt = 0;
  private lastQualityAdjustAt = 0;

  constructor(room: PublicRoomState) {
    for (const player of room.players) this.colors.set(player.playerNumber, player.color);
  }

  mount(container: HTMLElement): void {
    racingLifecycleStats.rendererInstances += 1;
    this.container = container;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#b9f2ff");
    scene.fog = new THREE.Fog("#bfefff", 120, 420);

    const { width, height } = this.containerSize();
    const camera = new THREE.PerspectiveCamera(66, width / height, 0.1, 2500);
    camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.targetPixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.pixelRatio = this.targetPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "game-canvas racing-canvas";
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#f3fbff", "#36553d", 1.7));
    const sun = new THREE.DirectionalLight("#fff7df", 2.1);
    sun.position.set(60, 120, 40);
    sun.castShadow = this.quality.shadows;
    sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    sun.shadow.camera.left = -130;
    sun.shadow.camera.right = 130;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -240;
    scene.add(sun);
    const rimLight = new THREE.DirectionalLight("#8be8ff", 0.85);
    rimLight.position.set(-80, 55, -120);
    scene.add(rimLight);
    scene.add(buildSkyDome());
    scene.add(buildTrackGroup());
    scene.add(buildHarborEnvironment(this.quality.environmentDensity));
    scene.add(buildTracksideDetails(this.quality.environmentDensity));
    scene.add(buildConfettiField(this.quality.particles));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 340),
      new THREE.MeshStandardMaterial({ color: "#68d977", roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -100);
    ground.receiveShadow = true;
    scene.add(ground);

    for (const [playerNumber, color] of this.colors) {
      const car = buildCarMesh(color);
      car.root.visible = false;
      scene.add(car.root);
      this.cars.set(playerNumber, car);
    }

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    if (shouldShowRacingMetrics()) {
      this.metrics = new RacingMetricsOverlay({
        container,
        renderer,
        getActiveCars: () => this.activeCarCount(),
        getQualityPreset: () => this.quality.preset,
        getSnapshotHz: () => this.snapshotHz(),
        getLatestSnapshotAgeMs: () => this.latestSnapshotAgeMs(),
        getLifecycleStats: () => this.lifecycleStats()
      });
    }
    window.addEventListener("resize", this.handleResize);
    racingLifecycleStats.resizeListeners += 1;
  }

  applyState(state: RacingGameStatePayload): void {
    const now = performance.now();
    this.lastSnapshotAt = now;
    this.snapshotTimes.push(now);
    while (this.snapshotTimes.length > 0 && now - this.snapshotTimes[0]! > SNAPSHOT_HZ_WINDOW_MS) {
      this.snapshotTimes.shift();
    }
    const players = new Map<number, CarFrame>(
      state.players.map((p: RacingPlayerState) => [
        p.playerNumber,
        {
          progress: p.progress,
          lateralOffset: p.lateralOffset,
          headingError: p.headingError,
          speed: p.speed,
          rank: p.rank
        }
      ])
    );
    for (const player of state.players) {
      this.ensureCarVisual(player.playerNumber, player.color);
    }
    this.snapshots.push({ time: now, players });
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
  }

  render(_timestamp: number): void {
    const { scene, camera, renderer } = this;
    if (!scene || !camera || !renderer) return;
    this.updateRenderBudget(_timestamp);

    const positions = this.interpolate();
    let focused: { x: number; z: number; heading: number; speed: number } | null = null;
    let leader: { x: number; z: number; heading: number; speed: number; rank: number } | null = null;

    for (const [playerNumber, car] of this.cars) {
      const pos = positions.get(playerNumber);
      car.root.visible = Boolean(pos);
      if (!pos) continue;

      const { x, z, heading } = computeRacingCarWorldTransform(pos);
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(heading)) {
        if (new URLSearchParams(window.location.search).get("dev") === "1") {
          console.warn("Invalid Racing car transform", { playerNumber, pos, x, z, heading });
        }
        continue;
      }
      car.root.position.set(x, 0, z);
      car.root.rotation.y = -heading;
      car.marker.visible = playerNumber === this.focusedPlayerNumber;
      for (const wheel of car.wheels) wheel.rotation.x -= pos.speed * 0.025;
      for (const wheel of car.frontWheels) wheel.rotation.y = Math.max(-0.45, Math.min(0.45, pos.headingError * 0.75));
      const brakeOpacity = Math.max(0.18, Math.min(0.95, Math.abs(pos.headingError) * 0.2 + (pos.speed < 3 ? 0.18 : 0.28)));
      const brakeMaterial = car.brakeLight.material;
      if (brakeMaterial instanceof THREE.MeshBasicMaterial) brakeMaterial.opacity = brakeOpacity;
      const trailMaterial = car.speedTrail.material;
      if (trailMaterial instanceof THREE.MeshBasicMaterial) {
        trailMaterial.opacity = Math.min(0.72, Math.max(0, (pos.speed - 8) / 38));
      }
      const glowMaterial = car.underglow.material;
      if (glowMaterial instanceof THREE.MeshBasicMaterial) {
        glowMaterial.opacity = 0.18 + Math.min(0.24, pos.speed / 140);
      }

      if (playerNumber === this.focusedPlayerNumber) focused = { x, z, heading, speed: pos.speed };
      if (!leader || pos.rank < leader.rank) leader = { x, z, heading, speed: pos.speed, rank: pos.rank };
    }

    const target = focused ?? leader;
    if (target) {
      const config = this.cameraConfig(target.speed);
      const behindX = target.x - Math.sin(target.heading) * config.distance;
      const behindZ = target.z + Math.cos(target.heading) * config.distance;
      this.cameraShake = this.cameraShake * 0.88 + Math.min(0.08, target.speed * 0.0015);
      const shakeX = Math.sin(_timestamp * 0.029) * this.cameraShake;
      const shakeY = Math.cos(_timestamp * 0.023) * this.cameraShake;
      const desired = new THREE.Vector3(
        config.spectator ? target.x + 36 : behindX + shakeX,
        config.height + Math.min(3, target.speed * 0.06) + shakeY,
        config.spectator ? target.z + 34 : behindZ
      );
      if (!this.cameraInitialized) {
        camera.position.copy(desired);
        this.lookTarget.set(target.x, 1.6, target.z);
        this.cameraInitialized = true;
      } else {
        camera.position.lerp(desired, config.damping);
      }
      const desiredLook = new THREE.Vector3(
        target.x + Math.sin(target.heading) * CAMERA_LOOK_AHEAD,
        config.lookHeight,
        target.z - Math.cos(target.heading) * CAMERA_LOOK_AHEAD
      );
      this.lookTarget.lerp(desiredLook, 0.16);
      camera.lookAt(this.lookTarget);
      camera.fov += (config.fov + Math.min(8, target.speed * 0.12) - camera.fov) * 0.08;
      camera.updateProjectionMatrix();
    }

    renderer.render(scene, camera);
    this.metrics?.update(_timestamp);
  }

  setFocusedPlayer(playerNumber: number | null): void {
    this.focusedPlayerNumber = playerNumber;
  }

  cycleCameraMode(): CameraMode {
    const current = CAMERA_MODES.indexOf(this.cameraMode);
    this.cameraMode = CAMERA_MODES[(current + 1) % CAMERA_MODES.length]!;
    this.cameraInitialized = false;
    return this.cameraMode;
  }

  getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  private cameraConfig(speed: number): { distance: number; height: number; lookHeight: number; fov: number; damping: number; spectator: boolean } {
    if (this.cameraMode === "close") return { distance: 10, height: 4.8, lookHeight: 1.35, fov: 70, damping: 0.2, spectator: false };
    if (this.cameraMode === "hood") return { distance: -1.6, height: 1.55, lookHeight: 1.15, fov: 76, damping: 0.34, spectator: false };
    if (this.cameraMode === "spectator") return { distance: 0, height: 24 + speed * 0.03, lookHeight: 1.8, fov: 58, damping: 0.08, spectator: true };
    return { distance: CAMERA_DISTANCE, height: CAMERA_HEIGHT, lookHeight: 1.55, fov: 70, damping: 0.18, spectator: false };
  }

  private interpolate(): Map<number, CarFrame> {
    if (this.snapshots.length === 0) return new Map();
    if (this.snapshots.length === 1) return this.snapshots[0]!.players;
    const renderTime = performance.now() - RENDER_DELAY_MS;
    let prev = this.snapshots[0]!;
    let next = this.snapshots[this.snapshots.length - 1]!;
    for (let i = 1; i < this.snapshots.length; i++) {
      const candidate = this.snapshots[i]!;
      if (candidate.time >= renderTime) {
        prev = this.snapshots[i - 1] ?? prev;
        next = candidate;
        break;
      }
    }
    if (renderTime > next.time && this.snapshots.length >= 2) {
      prev = this.snapshots[this.snapshots.length - 2]!;
      next = this.snapshots[this.snapshots.length - 1]!;
    }
    const span = next.time - prev.time || 1;
    const rawT = (renderTime - prev.time) / span;
    const t = Math.min(1, Math.max(0, rawT));
    const extrapolateSeconds = rawT > 1 ? Math.min(MAX_EXTRAPOLATE_MS, renderTime - next.time) / 1000 : 0;
    const result = new Map<number, CarFrame>();

    for (const [playerNumber, nextFrame] of next.players) {
      const prevFrame = prev.players.get(playerNumber) ?? nextFrame;
      const frame = {
        progress: prevFrame.progress + (nextFrame.progress - prevFrame.progress) * t,
        lateralOffset: prevFrame.lateralOffset + (nextFrame.lateralOffset - prevFrame.lateralOffset) * t,
        headingError: prevFrame.headingError + (nextFrame.headingError - prevFrame.headingError) * t,
        speed: prevFrame.speed + (nextFrame.speed - prevFrame.speed) * t,
        rank: nextFrame.rank
      };
      if (extrapolateSeconds > 0 && Math.abs(frame.speed) > 0.01) {
        frame.progress += frame.speed * Math.cos(frame.headingError) * extrapolateSeconds;
        frame.lateralOffset += frame.speed * Math.sin(frame.headingError) * extrapolateSeconds;
        frame.lateralOffset = Math.max(-TEST_OVAL_TRACK.trackHalfWidth * 1.6, Math.min(TEST_OVAL_TRACK.trackHalfWidth * 1.6, frame.lateralOffset));
      }
      result.set(playerNumber, frame);
    }
    return result;
  }

  private containerSize(): { width: number; height: number } {
    const width = this.container?.clientWidth || 800;
    const height = this.container?.clientHeight || 500;
    return { width, height };
  }

  private handleResize = (): void => {
    if (!this.camera || !this.renderer) return;
    const { width, height } = this.containerSize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private updateRenderBudget(timestamp: number): void {
    const renderer = this.renderer;
    if (!renderer || !this.quality.adaptivePixelRatio) return;
    if (this.lastFrameAt > 0) {
      const delta = timestamp - this.lastFrameAt;
      if (Number.isFinite(delta) && delta > 0 && delta < 250) {
        this.frameDeltas.push(delta);
        if (this.frameDeltas.length > 90) this.frameDeltas.shift();
      }
    }
    this.lastFrameAt = timestamp;
    if (timestamp - this.lastQualityAdjustAt < 1200 || this.frameDeltas.length < 30) return;
    this.lastQualityAdjustAt = timestamp;

    const average = this.frameDeltas.reduce((total, delta) => total + delta, 0) / this.frameDeltas.length;
    const sorted = [...this.frameDeltas].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? average;
    let nextPixelRatio = this.pixelRatio;
    if (p90 > FRAME_BUDGET_MS * 1.45 || average > FRAME_BUDGET_MS * 1.22) {
      nextPixelRatio = Math.max(1, this.pixelRatio - PIXEL_RATIO_STEP);
    } else if (p90 < FRAME_BUDGET_MS * 1.05 && average < FRAME_BUDGET_MS * 0.92) {
      nextPixelRatio = Math.min(this.targetPixelRatio, this.pixelRatio + PIXEL_RATIO_STEP * 0.5);
    }

    if (Math.abs(nextPixelRatio - this.pixelRatio) >= 0.04) {
      this.pixelRatio = Number(nextPixelRatio.toFixed(2));
      renderer.setPixelRatio(this.pixelRatio);
      const { width, height } = this.containerSize();
      renderer.setSize(width, height, false);
    }
  }

  private activeCarCount(): number {
    let count = 0;
    for (const car of this.cars.values()) {
      if (car.root.visible) count += 1;
    }
    return count;
  }

  private ensureCarVisual(playerNumber: number, color?: string): void {
    if (color) this.colors.set(playerNumber, color);
    if (this.cars.has(playerNumber)) return;
    const scene = this.scene;
    if (!scene) return;
    const fallback = BOT_FALLBACK_COLORS[Math.abs(playerNumber) % BOT_FALLBACK_COLORS.length] ?? "#f97316";
    const car = buildCarMesh(this.colors.get(playerNumber) ?? fallback);
    car.root.visible = false;
    scene.add(car.root);
    this.cars.set(playerNumber, car);
  }

  private snapshotHz(): number {
    if (this.snapshotTimes.length < 2) return 0;
    const span = this.snapshotTimes[this.snapshotTimes.length - 1]! - this.snapshotTimes[0]!;
    return span > 0 ? ((this.snapshotTimes.length - 1) * 1000) / span : 0;
  }

  private latestSnapshotAgeMs(): number | null {
    return this.lastSnapshotAt === 0 ? null : performance.now() - this.lastSnapshotAt;
  }

  private lifecycleStats(): RacingLifecycleStats {
    const hostStats = readHostLifecycleStats();
    return {
      rendererInstances: racingLifecycleStats.rendererInstances,
      resizeListeners: racingLifecycleStats.resizeListeners,
      rafLoops: hostStats.rafLoops,
      socketGameStateListeners: hostStats.socketGameStateListeners
    };
  }

  destroy(): void {
    window.removeEventListener("resize", this.handleResize);
    racingLifecycleStats.resizeListeners = Math.max(0, racingLifecycleStats.resizeListeners - 1);
    this.metrics?.destroy();
    this.metrics = null;
    if (this.scene) {
      this.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      this.scene.clear();
    }
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.cars.clear();
    this.snapshots = [];
    this.snapshotTimes = [];
    this.lastSnapshotAt = 0;
    this.cameraInitialized = false;
    this.container = null;
    racingLifecycleStats.rendererInstances = Math.max(0, racingLifecycleStats.rendererInstances - 1);
  }
}
