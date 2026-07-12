import * as THREE from "three";
import type { GameRenderer } from "../gameRenderer";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";
import type { PublicRoomState, RacingGameStatePayload, RacingPlayerState } from "../../../../shared/protocol";
import { RacingMetricsOverlay, shouldShowRacingMetrics } from "./metrics";
import { getDefaultRacingQuality } from "./quality";
import type { RacingQualitySettings } from "./quality";

interface CarFrame {
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  rank: number;
}

interface WorldCarTransform {
  x: number;
  z: number;
  heading: number;
}

type CameraMode = "chase" | "close" | "hood" | "spectator";

interface CarVisual {
  root: THREE.Group;
  wheels: THREE.Mesh[];
  frontWheels: THREE.Mesh[];
  brakeLight: THREE.Mesh;
}

interface Snapshot {
  time: number;
  players: Map<number, CarFrame>;
}

const RENDER_DELAY_MS = 50;
const TRACK_SAMPLES = 240;
const CAMERA_DISTANCE = 16;
const CAMERA_HEIGHT = 8;
const CAMERA_LOOK_AHEAD = 8;
const CAMERA_MODES: CameraMode[] = ["chase", "close", "hood", "spectator"];

export function computeRacingCarWorldTransform(frame: Pick<CarFrame, "progress" | "lateralOffset" | "headingError">): WorldCarTransform {
  const center = centerlinePoint(TEST_OVAL_TRACK, frame.progress);
  const trackAngle = centerlineTangentAngle(TEST_OVAL_TRACK, frame.progress);
  const perpendicularX = Math.cos(trackAngle);
  const perpendicularZ = Math.sin(trackAngle);
  return {
    x: center.x + perpendicularX * frame.lateralOffset,
    z: center.z + perpendicularZ * frame.lateralOffset,
    heading: trackAngle + frame.headingError
  };
}

function buildTrackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#3a3f4b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8ecf9";
  ctx.fillRect(0, 0, 6, canvas.height);
  ctx.fillRect(canvas.width - 6, 0, 6, canvas.height);
  ctx.fillStyle = "#fbbf24";
  for (let y = 0; y < canvas.height; y += 32) {
    ctx.fillRect(canvas.width / 2 - 3, y, 6, 18);
  }
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#0f172a";
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 40);
  return texture;
}

function buildCheckerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#f8fafc" : "#05070c";
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

function buildCurbTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < canvas.height; y += 32) {
    ctx.fillStyle = y % 64 === 0 ? "#ef4444" : "#f8fafc";
    ctx.fillRect(0, y, canvas.width, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 32);
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

function buildTrackGroup(): THREE.Group {
  const group = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: "#343946",
    map: buildTrackTexture(),
    roughness: 0.86,
    metalness: 0.02
  });
  const lineMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc" });
  const curbMaterial = new THREE.MeshStandardMaterial({ map: buildCurbTexture(), roughness: 0.78 });
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: "#d8dee9", roughness: 0.55 });
  const startGridMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc" });

  group.add(buildRibbonMesh(-halfWidth, halfWidth, 0.02, roadMaterial));
  group.add(buildRibbonMesh(halfWidth - 0.38, halfWidth - 0.16, 0.035, lineMaterial));
  group.add(buildRibbonMesh(-halfWidth + 0.16, -halfWidth + 0.38, 0.035, lineMaterial));
  group.add(buildRibbonMesh(halfWidth, halfWidth + 1.05, 0.025, curbMaterial));
  group.add(buildRibbonMesh(-halfWidth - 1.05, -halfWidth, 0.025, curbMaterial));

  const start = computeRacingCarWorldTransform({ progress: 0, lateralOffset: 0, headingError: 0 });
  const finish = new THREE.Mesh(
    new THREE.BoxGeometry(halfWidth * 2.35, 0.05, 1.4),
    new THREE.MeshBasicMaterial({ map: buildCheckerTexture() })
  );
  finish.position.set(start.x, 0.08, start.z);
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
      marker.position.set(transform.x, 0.09, transform.z);
      marker.rotation.y = -transform.heading;
      group.add(marker);
    }
  }

  const barrierGeometry = new THREE.BoxGeometry(1.4, 1.2, 0.28);
  const barrierCountPerSide = 52;
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
      const offset = side * (halfWidth + 2.2);
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

  const gantry = new THREE.Group();
  const gantryMaterial = new THREE.MeshStandardMaterial({ color: "#121826", roughness: 0.48, metalness: 0.2 });
  const signMaterial = new THREE.MeshStandardMaterial({ color: "#0891b2", roughness: 0.35, metalness: 0.05 });
  for (const x of [-halfWidth - 2.8, halfWidth + 2.8]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.2, 0.35), gantryMaterial);
    post.position.set(x, 2.6, 0);
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 6.2, 1.05, 0.45), signMaterial);
  beam.position.set(0, 5.05, 0);
  gantry.add(beam);
  gantry.position.set(start.x, 0, start.z);
  gantry.rotation.y = -start.heading;
  group.add(gantry);
  return group;
}

function buildCarMesh(color: string): CarVisual {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.08 });
  const carbon = new THREE.MeshStandardMaterial({ color: "#090b10", roughness: 0.58, metalness: 0.12 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.55, 3.35), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.34, 1.65), paint);
  nose.position.set(0, 0.62, -2.15);
  nose.castShadow = true;
  group.add(nose);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 10), carbon);
  cockpit.scale.set(0.85, 0.55, 1.05);
  cockpit.position.set(0, 0.98, -0.25);
  cockpit.castShadow = true;
  group.add(cockpit);

  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 0.48), carbon);
  frontWing.position.set(0, 0.34, -2.85);
  frontWing.castShadow = true;
  group.add(frontWing);

  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.18, 0.58), carbon);
  rearWing.position.set(0, 1.14, 1.86);
  rearWing.castShadow = true;
  group.add(rearWing);

  const rearWingStrut = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.18), carbon);
  rearWingStrut.position.set(0, 0.78, 1.72);
  rearWingStrut.castShadow = true;
  group.add(rearWingStrut);

  const wheelGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
  const wheelMaterial = carbon;
  const offsets: Array<[number, number]> = [
    [0.9, 1.1],
    [-0.9, 1.1],
    [0.9, -1.1],
    [-0.9, -1.1]
  ];

  const wheels: THREE.Mesh[] = [];
  const frontWheels: THREE.Mesh[] = [];
  for (const [x, z] of offsets) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.35, z);
    wheel.castShadow = true;
    wheels.push(wheel);
    if (z < 0) frontWheels.push(wheel);
    group.add(wheel);
  }
  const brakeLight = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.12, 0.08),
    new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.2 })
  );
  brakeLight.position.set(0, 0.76, 1.72);
  group.add(brakeLight);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.65, 24),
    new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.28, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 1.55, 1);
  shadow.position.y = 0.045;
  group.add(shadow);
  group.scale.setScalar(1.35);
  return { root: group, wheels, frontWheels, brakeLight };
}

function buildHarborEnvironment(density: number): THREE.Group {
  const group = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 150),
    new THREE.MeshStandardMaterial({ color: "#0ea5b7", roughness: 0.62, metalness: 0.04 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.035, 70);
  group.add(water);

  const buildingMaterial = new THREE.MeshStandardMaterial({ color: "#9fb5c9", roughness: 0.7, metalness: 0.03 });
  const windowMaterial = new THREE.MeshBasicMaterial({ color: "#dff6ff" });
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

  const grandstandMaterial = new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.64 });
  const crowdMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc" });
  for (const side of [-1, 1]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(38, 5, 7), grandstandMaterial);
    stand.position.set(side * 54, 2.5, -22);
    stand.rotation.y = side * 0.28;
    stand.castShadow = true;
    group.add(stand);
    const crowd = new THREE.Mesh(new THREE.BoxGeometry(35, 1.8, 0.2), crowdMaterial);
    crowd.position.set(side * 54, 5.6, -18);
    crowd.rotation.y = stand.rotation.y;
    group.add(crowd);
  }

  const boardMaterial = new THREE.MeshStandardMaterial({ color: "#f43f5e", roughness: 0.42 });
  const poleMaterial = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.38, metalness: 0.25 });
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

  const palmTrunkMaterial = new THREE.MeshStandardMaterial({ color: "#8b5a2b", roughness: 0.8 });
  const palmLeafMaterial = new THREE.MeshStandardMaterial({ color: "#15803d", roughness: 0.82 });
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

  return group;
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
  private readonly quality: RacingQualitySettings = getDefaultRacingQuality();
  private cameraInitialized = false;
  private cameraMode: CameraMode = "chase";
  private lookTarget = new THREE.Vector3();
  private cameraShake = 0;

  constructor(room: PublicRoomState) {
    for (const player of room.players) this.colors.set(player.playerNumber, player.color);
  }

  mount(container: HTMLElement): void {
    this.container = container;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#9dccff");
    scene.fog = new THREE.Fog("#9dccff", 90, 360);

    const { width, height } = this.containerSize();
    const camera = new THREE.PerspectiveCamera(66, width / height, 0.1, 2500);
    camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "game-canvas racing-canvas";
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#eaf4ff", "#445b3d", 1.55));
    const sun = new THREE.DirectionalLight("#fff7df", 2.1);
    sun.position.set(60, 120, 40);
    sun.castShadow = this.quality.shadows;
    sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    sun.shadow.camera.left = -130;
    sun.shadow.camera.right = 130;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -240;
    scene.add(sun);
    scene.add(buildTrackGroup());
    scene.add(buildHarborEnvironment(this.quality.environmentDensity));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(280, 280),
      new THREE.MeshStandardMaterial({ color: "#3f7f3d", roughness: 1 })
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
        getQualityPreset: () => this.quality.preset
      });
    }
    window.addEventListener("resize", this.handleResize);
  }

  applyState(state: RacingGameStatePayload): void {
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
    this.snapshots.push({ time: performance.now(), players });
    if (this.snapshots.length > 2) this.snapshots.shift();
  }

  render(_timestamp: number): void {
    const { scene, camera, renderer } = this;
    if (!scene || !camera || !renderer) return;

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
      for (const wheel of car.wheels) wheel.rotation.x -= pos.speed * 0.025;
      for (const wheel of car.frontWheels) wheel.rotation.y = Math.max(-0.45, Math.min(0.45, pos.headingError * 0.75));
      const brakeOpacity = Math.max(0.18, Math.min(0.95, Math.abs(pos.headingError) * 0.2 + (pos.speed < 3 ? 0.18 : 0.28)));
      const brakeMaterial = car.brakeLight.material;
      if (brakeMaterial instanceof THREE.MeshBasicMaterial) brakeMaterial.opacity = brakeOpacity;

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
      this.lookTarget.lerp(desiredLook, 0.22);
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
    return { distance: CAMERA_DISTANCE, height: CAMERA_HEIGHT, lookHeight: 1.6, fov: 66, damping: 0.18, spectator: false };
  }

  private interpolate(): Map<number, CarFrame> {
    if (this.snapshots.length === 0) return new Map();
    if (this.snapshots.length === 1) return this.snapshots[0]!.players;
    const [prev, next] = this.snapshots as [Snapshot, Snapshot];
    const renderTime = performance.now() - RENDER_DELAY_MS;
    const span = next.time - prev.time || 1;
    const t = Math.min(1, Math.max(0, (renderTime - prev.time) / span));
    const result = new Map<number, CarFrame>();

    for (const [playerNumber, nextFrame] of next.players) {
      const prevFrame = prev.players.get(playerNumber) ?? nextFrame;
      result.set(playerNumber, {
        progress: prevFrame.progress + (nextFrame.progress - prevFrame.progress) * t,
        lateralOffset: prevFrame.lateralOffset + (nextFrame.lateralOffset - prevFrame.lateralOffset) * t,
        headingError: prevFrame.headingError + (nextFrame.headingError - prevFrame.headingError) * t,
        speed: prevFrame.speed + (nextFrame.speed - prevFrame.speed) * t,
        rank: nextFrame.rank
      });
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

  private activeCarCount(): number {
    let count = 0;
    for (const car of this.cars.values()) {
      if (car.root.visible) count += 1;
    }
    return count;
  }

  destroy(): void {
    window.removeEventListener("resize", this.handleResize);
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
    this.cameraInitialized = false;
    this.container = null;
  }
}
