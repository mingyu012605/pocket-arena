import * as THREE from "three";
import type { GameRenderer } from "../gameRenderer";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";
import type { PublicRoomState, RacingGameStatePayload, RacingPlayerState } from "../../../../shared/protocol";

interface CarFrame {
  progress: number;
  lateralOffset: number;
  headingError: number;
  rank: number;
}

interface Snapshot {
  time: number;
  players: Map<number, CarFrame>;
}

const RENDER_DELAY_MS = 50;
const TRACK_SAMPLES = 240;
const CAMERA_DISTANCE = 16;
const CAMERA_HEIGHT = 8;

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
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 40);
  return texture;
}

function buildTrackMesh(): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;

  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const progress = (i / TRACK_SAMPLES) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    positions.push(center.x + nx * halfWidth, 0, center.z + nz * halfWidth);
    positions.push(center.x - nx * halfWidth, 0, center.z - nz * halfWidth);
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

  const material = new THREE.MeshStandardMaterial({ map: buildTrackTexture(), roughness: 0.8 });
  return new THREE.Mesh(geometry, material);
}

function buildCarMesh(color: string): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 3.2), new THREE.MeshStandardMaterial({ color }));
  body.position.y = 0.5;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 1.1), new THREE.MeshStandardMaterial({ color }));
  nose.position.set(0, 0.55, -1.65);
  group.add(nose);

  const wheelGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: "#101216" });
  const offsets: Array<[number, number]> = [
    [0.9, 1.1],
    [-0.9, 1.1],
    [0.9, -1.1],
    [-0.9, -1.1]
  ];

  for (const [x, z] of offsets) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.35, z);
    group.add(wheel);
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
  private cars = new Map<number, THREE.Group>();
  private colors = new Map<number, string>();
  private snapshots: Snapshot[] = [];
  private focusedPlayerNumber: number | null = null;
  private container: HTMLElement | null = null;

  constructor(room: PublicRoomState) {
    for (const player of room.players) this.colors.set(player.playerNumber, player.color);
  }

  mount(container: HTMLElement): void {
    this.container = container;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b0f1e");

    const { width, height } = this.containerSize();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
    camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.className = "game-canvas racing-canvas";
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#dfe9ff", "#101425", 1.1));
    const sun = new THREE.DirectionalLight("#ffffff", 1.2);
    sun.position.set(60, 120, 40);
    scene.add(sun);
    scene.add(buildTrackMesh());

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(280, 280),
      new THREE.MeshStandardMaterial({ color: "#162017", roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -100);
    scene.add(ground);

    for (const [playerNumber, color] of this.colors) {
      const car = buildCarMesh(color);
      car.visible = false;
      scene.add(car);
      this.cars.set(playerNumber, car);
    }

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    window.addEventListener("resize", this.handleResize);
  }

  applyState(state: RacingGameStatePayload): void {
    const players = new Map<number, CarFrame>(
      state.players.map((p: RacingPlayerState) => [
        p.playerNumber,
        { progress: p.progress, lateralOffset: p.lateralOffset, headingError: p.headingError, rank: p.rank }
      ])
    );
    this.snapshots.push({ time: performance.now(), players });
    if (this.snapshots.length > 2) this.snapshots.shift();
  }

  render(_timestamp: number): void {
    const { scene, camera, renderer } = this;
    if (!scene || !camera || !renderer) return;

    const positions = this.interpolate();
    let focused: { x: number; z: number; angle: number } | null = null;
    let leader: { x: number; z: number; angle: number; rank: number } | null = null;

    for (const [playerNumber, car] of this.cars) {
      const pos = positions.get(playerNumber);
      car.visible = Boolean(pos);
      if (!pos) continue;

      const center = centerlinePoint(TEST_OVAL_TRACK, pos.progress);
      const trackAngle = centerlineTangentAngle(TEST_OVAL_TRACK, pos.progress);
      const nx = Math.cos(trackAngle);
      const nz = Math.sin(trackAngle);
      const x = center.x + nx * pos.lateralOffset;
      const z = center.z + nz * pos.lateralOffset;
      const angle = trackAngle + pos.headingError;
      car.position.set(x, 0, z);
      car.rotation.y = -angle;

      if (playerNumber === this.focusedPlayerNumber) focused = { x, z, angle };
      if (!leader || pos.rank < leader.rank) leader = { x, z, angle, rank: pos.rank };
    }

    const target = focused ?? leader;
    if (target) {
      const behindX = target.x - Math.sin(target.angle) * CAMERA_DISTANCE;
      const behindZ = target.z - Math.cos(target.angle) * CAMERA_DISTANCE;
      camera.position.set(behindX, CAMERA_HEIGHT, behindZ);
      camera.lookAt(target.x, 1, target.z);
    }

    renderer.render(scene, camera);
  }

  setFocusedPlayer(playerNumber: number | null): void {
    this.focusedPlayerNumber = playerNumber;
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

  destroy(): void {
    window.removeEventListener("resize", this.handleResize);
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
    this.container = null;
  }
}
