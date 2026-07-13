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
import { buildTrackGroup } from "./track";
import { computeRacingCarWorldTransform } from "./carTransform";
import { buildHarborEnvironment, buildTracksideDetails, buildSkyDome, buildConfettiField } from "./environment";
import { RacingInterpolationBuffer } from "./interpolation";
import type { RacingCarFrame } from "./interpolation";
import { RacingDevHelpers } from "./devHelpers";
import { RacingEffects } from "./effects";

type CameraMode = "chase" | "close" | "hood" | "spectator";

const CAMERA_DISTANCE = 12;
const CAMERA_HEIGHT = 5.8;
const CAMERA_LOOK_AHEAD = 10;
const CAMERA_MODES: CameraMode[] = ["chase", "close", "hood", "spectator"];
const SNAPSHOT_HZ_WINDOW_MS = 5000;
const FRAME_BUDGET_MS = 1000 / 55;
const PIXEL_RATIO_STEP = 0.12;
const BOT_FALLBACK_COLORS = ["#f97316", "#22c55e", "#a855f7", "#facc15", "#38bdf8"];
/** Keep the chase/close camera inside the barrier ring (barriers sit at halfWidth + 2.2). */
const CAMERA_TRACK_MARGIN = TEST_OVAL_TRACK.trackHalfWidth + 1.6;
/** Minimum clearance the hood/close camera keeps from any car it isn't following, so it can't end up inside another car's tub/cockpit geometry. */
const CAMERA_CAR_CLEARANCE = 2.6;
const DEV_MODE = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("dev") === "1";

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
  private readonly interpolationBuffer = new RacingInterpolationBuffer(TEST_OVAL_TRACK.trackLength, TEST_OVAL_TRACK.trackHalfWidth * 1.6);
  private lastRoundId: string | null = null;
  private focusedPlayerNumber: number | null = null;
  private container: HTMLElement | null = null;
  private metrics: RacingMetricsOverlay | null = null;
  private devHelpers: RacingDevHelpers | null = null;
  private effects: RacingEffects | null = null;
  private finishedPlayers = new Set<number>();
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
    sun.shadow.bias = -0.0015;
    sun.shadow.normalBias = 0.4;
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
    this.effects = new RacingEffects(scene, Math.round(this.quality.particles * 0.3), Math.round(this.quality.particles * 0.4));
    if (DEV_MODE) this.devHelpers = new RacingDevHelpers(scene);
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
    if (state.roundId !== this.lastRoundId) {
      // A new race started without this renderer being torn down and
      // remounted (results -> countdown doesn't remount). Without this, the
      // old race's high-progress snapshots would blend against the new
      // race's progress=0 snapshots and the car would visibly sweep
      // backward across the whole track for one interpolation window.
      this.resetInterpolation();
      this.lastRoundId = state.roundId;
    }
    const now = performance.now();
    this.lastSnapshotAt = now;
    this.snapshotTimes.push(now);
    while (this.snapshotTimes.length > 0 && now - this.snapshotTimes[0]! > SNAPSHOT_HZ_WINDOW_MS) {
      this.snapshotTimes.shift();
    }
    const players = new Map<number, RacingCarFrame>(
      state.players.map((p: RacingPlayerState) => [
        p.playerNumber,
        {
          progress: p.progress,
          lateralOffset: p.lateralOffset,
          headingError: p.headingError,
          speed: p.speed,
          rank: p.rank,
          stale: p.inputStale ?? false
        }
      ])
    );
    for (const player of state.players) {
      this.ensureCarVisual(player.playerNumber, player.color);
      if (player.finished && !this.finishedPlayers.has(player.playerNumber)) {
        this.finishedPlayers.add(player.playerNumber);
        const { x, z } = computeRacingCarWorldTransform(player);
        if (Number.isFinite(x) && Number.isFinite(z)) this.effects?.triggerFinishBurst(x, z);
      }
    }
    this.interpolationBuffer.addSnapshot(now, players);
  }

  /** Clears buffered snapshots and camera continuity state. Called automatically on round change; also safe to call explicitly on reconnect. */
  resetInterpolation(): void {
    this.interpolationBuffer.reset();
    this.cameraInitialized = false;
    this.snapshotTimes = [];
    this.lastSnapshotAt = 0;
    this.finishedPlayers.clear();
  }

  render(_timestamp: number): void {
    const { scene, camera, renderer } = this;
    if (!scene || !camera || !renderer) return;
    this.updateRenderBudget(_timestamp);

    const positions = this.interpolationBuffer.interpolate(performance.now());
    let focused: { x: number; z: number; heading: number; speed: number; progress: number; playerNumber: number } | null = null;
    let leader: { x: number; z: number; heading: number; speed: number; rank: number; progress: number; playerNumber: number } | null = null;
    const otherCarPositions: Array<{ playerNumber: number; x: number; z: number }> = [];

    for (const [playerNumber, car] of this.cars) {
      const pos = positions.get(playerNumber);
      car.root.visible = Boolean(pos);
      if (!pos) {
        this.devHelpers?.removeCarBounds(playerNumber);
        continue;
      }

      const { x, z, heading } = computeRacingCarWorldTransform(pos);
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(heading)) {
        if (DEV_MODE) console.warn("Invalid Racing car transform", { playerNumber, pos, x, z, heading });
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
      if (DEV_MODE) this.devHelpers?.updateCarBounds(playerNumber, car.root);
      if (Math.abs(pos.lateralOffset) > TEST_OVAL_TRACK.trackHalfWidth && Math.abs(pos.speed) > 3) {
        this.effects?.spawnDust(x, z, Math.min(1, Math.abs(pos.speed) / 20));
      }

      otherCarPositions.push({ playerNumber, x, z });
      if (playerNumber === this.focusedPlayerNumber) focused = { x, z, heading, speed: pos.speed, progress: pos.progress, playerNumber };
      if (!leader || pos.rank < leader.rank) leader = { x, z, heading, speed: pos.speed, rank: pos.rank, progress: pos.progress, playerNumber };
    }

    if (DEV_MODE) {
      const focusedPlayer = this.focusedPlayerNumber;
      const rawFrame = focusedPlayer !== null ? this.interpolationBuffer.latestRawFrame(focusedPlayer) : undefined;
      if (rawFrame) {
        const raw = computeRacingCarWorldTransform(rawFrame);
        this.devHelpers?.showSamplePoint(raw.x, 0.4, raw.z);
      } else {
        this.devHelpers?.hideSamplePoint();
      }
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
      if (!config.spectator) {
        this.clampCameraToTrack(desired, target.progress, config.distance);
        this.pushCameraClearOfOtherCars(desired, target.playerNumber, otherCarPositions);
      }
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

    this.effects?.update(_timestamp);
    renderer.render(scene, camera);
    this.metrics?.update(_timestamp);
  }

  /**
   * The chase/close camera trails the car by a fixed world-space offset
   * along the car's own heading. On a sharp corner the track curves away
   * underneath that trailing point faster than the car turns, so the
   * "behind" point can land outside the track surface - past the barrier
   * ring - even though the car itself is still comfortably on track. This
   * approximates the camera's own nearest centerline reference (using the
   * chase distance as a progress offset, which is accurate enough since
   * the distance is small relative to how sharply this track curves) and
   * pulls the desired position back inside the barrier margin if needed.
   */
  private clampCameraToTrack(desired: THREE.Vector3, targetProgress: number, distance: number): void {
    const refProgress = targetProgress - distance;
    const center = centerlinePoint(TEST_OVAL_TRACK, refProgress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, refProgress);
    const perpX = Math.cos(angle);
    const perpZ = Math.sin(angle);
    const forwardX = -Math.sin(angle);
    const forwardZ = Math.cos(angle);
    const dx = desired.x - center.x;
    const dz = desired.z - center.z;
    const lateral = dx * perpX + dz * perpZ;
    if (Math.abs(lateral) <= CAMERA_TRACK_MARGIN) return;
    const along = dx * forwardX + dz * forwardZ;
    const clampedLateral = Math.sign(lateral) * CAMERA_TRACK_MARGIN;
    desired.x = center.x + perpX * clampedLateral + forwardX * along;
    desired.z = center.z + perpZ * clampedLateral + forwardZ * along;
  }

  /** Prevents the hood/close camera from ending up inside another car's tub/cockpit geometry when cars are bunched together (start grid, close racing). */
  private pushCameraClearOfOtherCars(
    desired: THREE.Vector3,
    targetPlayerNumber: number,
    otherCarPositions: Array<{ playerNumber: number; x: number; z: number }>
  ): void {
    for (const other of otherCarPositions) {
      if (other.playerNumber === targetPlayerNumber) continue;
      const dx = desired.x - other.x;
      const dz = desired.z - other.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= CAMERA_CAR_CLEARANCE || dist < 1e-4) continue;
      const push = CAMERA_CAR_CLEARANCE - dist;
      desired.x += (dx / dist) * push;
      desired.z += (dz / dist) * push;
    }
  }

  setFocusedPlayer(playerNumber: number | null): void {
    this.focusedPlayerNumber = playerNumber;
  }

  cycleCameraMode(): CameraMode {
    const current = CAMERA_MODES.indexOf(this.cameraMode);
    this.cameraMode = CAMERA_MODES[(current + 1) % CAMERA_MODES.length]!;
    // Deliberately does not reset cameraInitialized: leaving it true means the
    // next frame's lerp eases into the new mode's desired position/FOV over
    // several frames instead of hard-cutting the camera there instantly.
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
      this.devHelpers?.dispose(this.scene);
      this.effects?.dispose(this.scene);
      this.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      this.scene.clear();
    }
    this.devHelpers = null;
    this.effects = null;
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.cars.clear();
    this.interpolationBuffer.reset();
    this.lastRoundId = null;
    this.finishedPlayers.clear();
    this.snapshotTimes = [];
    this.lastSnapshotAt = 0;
    this.cameraInitialized = false;
    this.container = null;
    racingLifecycleStats.rendererInstances = Math.max(0, racingLifecycleStats.rendererInstances - 1);
  }
}
