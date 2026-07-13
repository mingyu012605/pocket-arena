import * as THREE from "three";
import type { GameRenderer } from "../gameRenderer";
import { TEST_OVAL_TRACK } from "../../../../shared/racingTrack";
import type { PublicRoomState, RacingGameStatePayload, RacingPlayerState } from "../../../../shared/protocol";
import { RacingMetricsOverlay, shouldShowRacingMetrics } from "./metrics";
import type { RacingLifecycleStats } from "./metrics";
import { getDefaultRacingQuality } from "./quality";
import type { RacingQualitySettings } from "./quality";
import { buildCarMesh } from "./cars";
import type { CarVisual } from "./cars";
import { buildTrackGroup } from "./track";
import { computeRacingCarWorldTransform } from "./carTransform";
import { buildHarborEnvironment, buildTracksideDetails, buildSkyDome, buildConfettiField } from "./environment";

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
