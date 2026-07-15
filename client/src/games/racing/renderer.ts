import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { GameRenderer } from "../gameRenderer";
import { TEST_OVAL_TRACK } from "../../../../shared/racingTrack";
import type { PublicRoomState, RacingGameStatePayload, RacingPlayerState } from "../../../../shared/protocol";
import { RacingMetricsOverlay, shouldShowRacingMetrics } from "./metrics";
import type { RacingLifecycleStats } from "./metrics";
import { getDefaultRacingQuality } from "./quality";
import type { RacingQualitySettings } from "./quality";
import { buildCarMesh } from "./cars";
import type { CarVisual } from "./cars";
import { VISUAL_BARRIER_OFFSET, buildTrackGroup } from "./track";
import { computeRacingCarWorldTransform } from "./carTransform";
import { buildHarborEnvironment, buildTracksideDetails, buildSkyDome, buildConfettiField } from "./environment";
import { RacingInterpolationBuffer } from "./interpolation";
import type { RacingCarFrame } from "./interpolation";
import { RacingDevHelpers } from "./devHelpers";
import { RacingEffects } from "./effects";
import { buildImportedCarVisual, buildStadiumProps, loadRacingAssetLibrary, loadRacingCarScene } from "./assetScene";
import type { RacingAssetLibrary } from "./assetScene";

type CameraMode = "chase" | "wide" | "hood" | "spectator";
type CameraConfig = {
  distance: number;
  height: number;
  lookHeight: number;
  lookAhead: number;
  fov: number;
  damping: number;
  spectator: boolean;
  avoidScenery: boolean;
  avoidCars: boolean;
};

// Chase camera tuned so the whole car sits in the lower-center of frame with
// a clear view of the road ahead - distance/height pulled back and raised
// from values that put the camera almost on top of the car, and look-ahead
// increased so it targets a point well down the road instead of the car
// itself.
const CAMERA_DISTANCE = 17;
const CAMERA_HEIGHT = 5.8;
const CAMERA_LOOK_AHEAD = 3.4;
const CAMERA_MODES: CameraMode[] = ["chase", "wide", "hood", "spectator"];
const SNAPSHOT_HZ_WINDOW_MS = 5000;
const FRAME_BUDGET_MS = 1000 / 55;
const PIXEL_RATIO_STEP = 0.12;
const BOT_FALLBACK_COLORS = ["#f97316", "#22c55e", "#a855f7", "#facc15", "#38bdf8"];
/** Minimum clearance the hood/close camera keeps from any car it isn't following, so it can't end up inside another car's tub/cockpit geometry. */
const CAMERA_CAR_CLEARANCE = 2.6;
/** Gap kept between the camera and any scenery it collision-corrects against, so it stops just short of the surface instead of clipping into it. */
const CAMERA_COLLISION_MARGIN = 1.25;
/** Floor on how close collision correction may pull the camera in. This must stay longer than the look-ahead distance, or the corrected camera can end up in front of the followed car. */
const CAMERA_MIN_DISTANCE = CAMERA_LOOK_AHEAD + 5.5;
/** Collision raycasts touch large instanced scenery, so keep them below frame rate to avoid adding camera-related stutter. */
const CAMERA_COLLISION_SCAN_MS = 90;
const DEV_MODE = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("dev") === "1";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

// PLAYER_COLORS (shared/protocol.ts) is used by every game mode, so it can't
// be changed here without affecting Rhythm Battle/Table Tennis/etc. too.
// Player 1's default pale cyan reads poorly against this scene's own sky/
// lighting up close, so it's remapped to a more saturated racing red for
// the 3D car specifically - every other assigned color (bot fallbacks
// included) passes through unchanged.
function distinctCarColor(rawColor: string): string {
  return rawColor.toLowerCase() === "#22d3ee" ? "#e5233a" : rawColor;
}

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
  private readonly interpolationBuffer = new RacingInterpolationBuffer(TEST_OVAL_TRACK.trackLength, TEST_OVAL_TRACK.trackHalfWidth + 2.1);
  private lastRoundId: string | null = null;
  private focusedPlayerNumber: number | null = null;
  private container: HTMLElement | null = null;
  private metrics: RacingMetricsOverlay | null = null;
  private devHelpers: RacingDevHelpers | null = null;
  private effects: RacingEffects | null = null;
  private environmentTexture: THREE.Texture | null = null;
  private finishedPlayers = new Set<number>();
  private snapshotTimes: number[] = [];
  private lastSnapshotAt = 0;
  private readonly quality: RacingQualitySettings = getDefaultRacingQuality();
  private cameraInitialized = false;
  private cameraMode: CameraMode = "chase";
  private lastRaceStatus: RacingGameStatePayload["raceStatus"] | null = null;
  private lookTarget = new THREE.Vector3();
  /** Extra chase distance eased in when another car is close ahead, so nearby traffic can't fill the whole frame. */
  private trafficPullback = 0;
  private cameraRoll = 0;
  private readonly lastSkidSpawn = new Map<number, { x: number; z: number }>();
  private readonly visualYaw = new Map<number, number>();
  private readonly visualWheelSteer = new Map<number, number>();
  private pixelRatio = 1;
  private targetPixelRatio = 1;
  private frameDeltas: number[] = [];
  private lastFrameAt = 0;
  private lastQualityAdjustAt = 0;
  private assetLibrary: RacingAssetLibrary | null = null;
  private carAssetScene: THREE.Group | null = null;
  private assetLoadCancelled = false;
  private stadiumProps: THREE.Group | null = null;
  private assetLoadState: "loading" | "ready" | "fallback" = "loading";
  // Static environment/prop groups the chase camera should avoid so props
  // do not slice through the view during close chase framing.
  private cameraObstacles: THREE.Object3D[] = [];
  private readonly cameraCollisionRaycaster = new THREE.Raycaster();
  private cameraCollisionDistance = CAMERA_DISTANCE + CAMERA_LOOK_AHEAD;
  private cameraCollisionTargetDistance = CAMERA_DISTANCE + CAMERA_LOOK_AHEAD;
  private lastCameraCollisionScanAt = 0;

  constructor(room: PublicRoomState) {
    for (const player of room.players) this.colors.set(player.playerNumber, distinctCarColor(player.color));
  }

  mount(container: HTMLElement): void {
    racingLifecycleStats.rendererInstances += 1;
    this.assetLoadCancelled = false;
    this.container = container;
    const scene = new THREE.Scene();
    // Saturated but not pure-cyan sky - previous value read as an
    // overwhelming cyan cast once combined with the (also cyan) rim light
    // and venue accent colors below; this leans more toward a true sky
    // blue so the sky doesn't blend into every other surface in the scene.
    scene.background = new THREE.Color("#3f7ecf");
    scene.fog = new THREE.Fog("#7fb0dd", 150, 600);

    const { width, height } = this.containerSize();
    // Near plane pulled in from 0.1 - the close chase framing can put
    // camera-collision-corrected geometry (or another car) inside 0.1 units,
    // which would otherwise get near-clipped into a visible hole in the view.
    const camera = new THREE.PerspectiveCamera(66, width / height, 0.05, 2500);
    camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.targetPixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.pixelRatio = this.targetPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Pulled down further - combined with the very bright (2.1) sun below,
    // ACES was compressing highlights toward white and crushing color
    // saturation exactly where the player-color car paint tint lives (the
    // reported "washed out car" symptom). Lowering exposure here and the
    // sun's own intensity below both pull in the same direction.
    renderer.toneMappingExposure = 0.82;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "game-canvas racing-canvas";
    container.appendChild(renderer.domElement);

    // A procedural (asset-free) PBR environment map, so the car's clearcoat
    // paint/glass have something to reflect. Without scene.environment set,
    // MeshPhysicalMaterial has no specular highlight source beyond direct
    // lights and reads flat even with high clearcoat/metalness values - this
    // is a meaningful part of why the car still looked dull up close.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environmentTexture;
    pmremGenerator.dispose();
    this.environmentTexture = environmentTexture;

    // Neutral-leaning hemisphere fill - the previous sky-blue/teal-ground
    // pairing at 0.55 was, combined with the rim light below, tinting every
    // glossy surface in the scene (car paint, barriers, arches) toward
    // cyan. A softer, less saturated fill lets direct light and each
    // object's own material color carry the scene instead.
    scene.add(new THREE.HemisphereLight("#fef6e0", "#2c3a2e", 0.62));
    // One clear key light - a warm, moderate-intensity sun (down from 2.1,
    // which was overexposing/washing out the car's paint under ACES).
    const sun = new THREE.DirectionalLight("#ffd9a0", 1.5);
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
    // Faint, near-neutral backlight just to separate the car from a dark
    // background at some angles - not a strong color statement like the
    // previous saturated cyan rim (a major contributor to the scene's
    // overall cyan cast, since it tinted every reflective surface).
    const rimLight = new THREE.DirectionalLight("#dceeff", 0.28);
    rimLight.position.set(-80, 55, -120);
    scene.add(rimLight);
    scene.add(buildSkyDome());
    const trackGroup = buildTrackGroup();
    const harborEnvironment = buildHarborEnvironment(this.quality.environmentDensity);
    const tracksideDetails = buildTracksideDetails(this.quality.environmentDensity);
    scene.add(trackGroup);
    scene.add(harborEnvironment);
    scene.add(tracksideDetails);
    scene.add(buildConfettiField(Math.round(this.quality.particles * 1.25)));
    this.cameraObstacles = [trackGroup, harborEnvironment, tracksideDetails];

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 340),
      new THREE.MeshStandardMaterial({ color: "#36b978", roughness: 0.86, emissive: "#084a3d", emissiveIntensity: 0.05 })
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

    this.assetLoadState = "loading";
    loadRacingCarScene()
      .then((carScene) => {
        if (this.assetLoadCancelled || this.scene !== scene) return;
        this.carAssetScene = carScene;
        this.assetLoadState = "ready";
        for (const [playerNumber, car] of this.cars) {
          this.applyImportedCarVisual(playerNumber, car);
        }
      })
      .catch((err: unknown) => {
        if (this.assetLoadCancelled || this.scene !== scene) return;
        this.assetLoadState = "fallback";
        if (DEV_MODE) console.warn("Racing car asset load failed; using procedural fallback", err);
      });
    loadRacingAssetLibrary()
      .then((library) => {
        if (this.assetLoadCancelled || this.scene !== scene) return;
        this.assetLibrary = library;
        this.assetLoadState = "ready";
        this.stadiumProps = buildStadiumProps(library, this.quality.environmentDensity);
        scene.add(this.stadiumProps);
        this.cameraObstacles.push(this.stadiumProps);
        for (const [playerNumber, car] of this.cars) {
          this.applyImportedCarVisual(playerNumber, car);
        }
      })
      .catch((err: unknown) => {
        if (this.assetLoadCancelled || this.scene !== scene) return;
        if (!this.carAssetScene) this.assetLoadState = "fallback";
        if (DEV_MODE) console.warn("Racing asset load failed; using procedural fallback", err);
      });

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.effects = new RacingEffects(
      scene,
      Math.round(this.quality.particles * 0.3),
      Math.round(this.quality.particles * 0.4),
      Math.round(this.quality.particles * 0.5)
    );
    if (DEV_MODE) {
      this.devHelpers = new RacingDevHelpers(scene);
      this.devHelpers.addTrackAlignmentGuides(TEST_OVAL_TRACK, VISUAL_BARRIER_OFFSET);
    }
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
          steering: p.steering ?? 0,
          rank: p.rank,
          stale: p.inputStale ?? false
        }
      ])
    );
    for (const player of state.players) {
      this.ensureCarVisual(player.playerNumber, player.color);
      if (state.raceStatus === "racing" && this.lastRaceStatus === "countdown") {
        const { x, z } = computeRacingCarWorldTransform(player);
        if (Number.isFinite(x) && Number.isFinite(z)) this.effects?.triggerStartBurst(x, z);
      }
      if (player.finished && !this.finishedPlayers.has(player.playerNumber)) {
        this.finishedPlayers.add(player.playerNumber);
        const { x, z } = computeRacingCarWorldTransform(player);
        if (Number.isFinite(x) && Number.isFinite(z)) this.effects?.triggerFinishBurst(x, z);
      }
    }
    this.interpolationBuffer.addSnapshot(now, players);
    this.lastRaceStatus = state.raceStatus;
  }

  /** Clears buffered snapshots and camera continuity state. Called automatically on round change; also safe to call explicitly on reconnect. */
  resetInterpolation(): void {
    this.interpolationBuffer.reset();
    this.cameraInitialized = false;
    this.snapshotTimes = [];
    this.lastSnapshotAt = 0;
    this.finishedPlayers.clear();
    this.lastSkidSpawn.clear();
    this.visualYaw.clear();
    this.visualWheelSteer.clear();
    this.lastRaceStatus = null;
  }

  render(_timestamp: number): void {
    const { scene, camera, renderer } = this;
    if (!scene || !camera || !renderer) return;
    this.updateRenderBudget(_timestamp);

    const positions = this.interpolationBuffer.interpolate(performance.now());
    let focused: { x: number; z: number; cameraYaw: number; speed: number; progress: number; playerNumber: number; headingError: number } | null = null;
    let leader: { x: number; z: number; cameraYaw: number; speed: number; rank: number; progress: number; playerNumber: number; headingError: number } | null = null;
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
      const steering = pos.steering ?? 0;
      const visualSlip = clamp(pos.headingError * 0.85 + steering * 0.16, -0.62, 0.62);
      const targetYaw = -(heading + visualSlip);
      const previousYaw = this.visualYaw.get(playerNumber) ?? targetYaw;
      const smoothedYaw = previousYaw + shortestAngleDelta(previousYaw, targetYaw) * 0.34;
      this.visualYaw.set(playerNumber, smoothedYaw);
      car.root.rotation.y = smoothedYaw;
      const cameraYaw = -(heading + clamp(pos.headingError * 0.22, -0.24, 0.24));
      // Chassis lean: bank the body slightly into turns, proportional to how
      // hard the car is steering and how fast it's going. car.root.rotation.z
      // is never set anywhere else, so reading it back each frame doubles as
      // the lean's own persistent accumulator - no extra state map needed.
      const leanTarget = clamp((pos.headingError + steering * 0.12) * pos.speed * 0.01, -0.08, 0.08);
      car.root.rotation.z = car.root.rotation.z * 0.85 + leanTarget * 0.15;
      car.marker.visible = playerNumber === this.focusedPlayerNumber;
      for (const wheel of car.wheels) wheel.rotation.x -= pos.speed * 0.016;
      const wheelTarget = clamp(steering * 0.18 + pos.headingError * 0.035, -0.22, 0.22);
      const previousWheel = this.visualWheelSteer.get(playerNumber) ?? wheelTarget;
      const wheelAngle = previousWheel + (wheelTarget - previousWheel) * 0.12;
      this.visualWheelSteer.set(playerNumber, wheelAngle);
      for (const wheel of car.frontWheels) wheel.rotation.y = wheelAngle;
      const brakeOpacity = Math.max(0.18, Math.min(0.95, Math.abs(pos.headingError) * 0.2 + (pos.speed < 3 ? 0.18 : 0.28)));
      const brakeMaterial = car.brakeLight.material;
      if (brakeMaterial instanceof THREE.MeshBasicMaterial) brakeMaterial.opacity = brakeOpacity;
      const trailMaterial = car.speedTrail.material;
      if (trailMaterial instanceof THREE.MeshBasicMaterial) {
        // Capped much lower (was 0.72) - at a crowded start grid or high
        // speed, several cars' trails at near-full opacity read as large
        // stray transparent color blocks rather than a subtle streak.
        trailMaterial.opacity = Math.min(0.4, Math.max(0, (pos.speed - 8) / 38));
      }
      const glowMaterial = car.underglow.material;
      if (glowMaterial instanceof THREE.MeshBasicMaterial) {
        glowMaterial.opacity = 0.3 + Math.min(0.2, pos.speed / 140);
      }
      if (DEV_MODE) this.devHelpers?.updateCarBounds(playerNumber, car.root);
      if (Math.abs(pos.lateralOffset) > TEST_OVAL_TRACK.trackHalfWidth && Math.abs(pos.speed) > 3) {
        this.effects?.spawnDust(x, z, Math.min(1, Math.abs(pos.speed) / 20));
      }
      if (Math.abs(pos.headingError) > 0.2 && pos.speed > 6) {
        const last = this.lastSkidSpawn.get(playerNumber);
        if (!last || Math.hypot(x - last.x, z - last.z) > 0.35) {
          this.effects?.spawnSkid(x, z, heading);
          this.lastSkidSpawn.set(playerNumber, { x, z });
        }
      } else {
        this.lastSkidSpawn.delete(playerNumber);
      }

      otherCarPositions.push({ playerNumber, x, z });
      if (playerNumber === this.focusedPlayerNumber) focused = { x, z, cameraYaw, speed: pos.speed, progress: pos.progress, playerNumber, headingError: pos.headingError };
      if (!leader || pos.rank < leader.rank) leader = { x, z, cameraYaw, speed: pos.speed, rank: pos.rank, progress: pos.progress, playerNumber, headingError: pos.headingError };
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
      const forwardX = -Math.sin(target.cameraYaw);
      const forwardZ = -Math.cos(target.cameraYaw);
      // Ease the camera back a little when another car is close ahead of
      // the focused car, so nearby traffic can't fill the whole screen.
      // Only cars roughly in front (positive dot with the forward vector)
      // count - a car alongside or behind shouldn't push the camera out.
      let closestAheadDist = Infinity;
      if (!config.spectator) {
        for (const other of otherCarPositions) {
          if (other.playerNumber === target.playerNumber) continue;
          const dx = other.x - target.x;
          const dz = other.z - target.z;
          if (dx * forwardX + dz * forwardZ <= 0) continue;
          const dist = Math.hypot(dx, dz);
          if (dist < closestAheadDist) closestAheadDist = dist;
        }
      }
      const CLOSE_TRAFFIC_RANGE = 8;
      const MAX_TRAFFIC_PULLBACK = 3.5;
      const targetPullback =
        closestAheadDist < CLOSE_TRAFFIC_RANGE
          ? ((CLOSE_TRAFFIC_RANGE - closestAheadDist) / CLOSE_TRAFFIC_RANGE) * MAX_TRAFFIC_PULLBACK
          : 0;
      // Slow ease in both directions - pulling back and returning should
      // both read as a smooth, deliberate camera move, not a snap.
      this.trafficPullback += (targetPullback - this.trafficPullback) * 0.05;
      const effectiveDistance = config.distance + this.trafficPullback;
      // Behind the car is target MINUS forward*distance - this had been
      // flipped to a plus, which put the "chase" camera ahead of the car in
      // the same direction as the look-ahead point instead of behind it,
      // producing a broken, near-top-down view looking back at the car.
      const behindX = target.x - forwardX * effectiveDistance;
      const behindZ = target.z - forwardZ * effectiveDistance;
      // Removed the speed-linked position shake entirely - it read as
      // constant, un-smoothable jitter on top of everything else, and was
      // the main source of the "too shaky" feedback. Height still lifts
      // slightly with speed for a touch of energy, without oscillating.
      const desired = new THREE.Vector3(
        config.spectator ? target.x + 36 : behindX,
        config.height + Math.min(1.4, target.speed * 0.03),
        config.spectator ? target.z + 34 : behindZ
      );
      const desiredLook = new THREE.Vector3(
        target.x + forwardX * config.lookAhead,
        config.lookHeight,
        target.z + forwardZ * config.lookAhead
      );
      if (!config.spectator) {
        if (config.avoidCars) this.pushCameraClearOfOtherCars(desired, target.playerNumber, otherCarPositions);
        if (config.avoidScenery) this.raycastCameraCollision(desired, desiredLook, _timestamp);
      }
      if (!this.cameraInitialized) {
        camera.position.copy(desired);
        this.lookTarget.copy(desiredLook);
        this.cameraInitialized = true;
      } else {
        // Capped absolute step on top of the lerp - a plain lerp still
        // moves a fixed *fraction* of however far "desired" jumped that
        // frame, so a sudden target discontinuity (bouncing off a barrier,
        // snapping back on track after an off-track excursion) could still
        // move the camera several units in a single frame and read as a
        // cut. Clamping the step means the camera eases up to a big jump
        // over several frames instead of following it instantly.
        const step = desired.clone().sub(camera.position).multiplyScalar(config.damping);
        const MAX_CAMERA_STEP = 1.6;
        if (step.length() > MAX_CAMERA_STEP) step.setLength(MAX_CAMERA_STEP);
        camera.position.add(step);
      }
      this.lookTarget.lerp(desiredLook, config.spectator ? 0.16 : 0.5);
      camera.lookAt(this.lookTarget);
      // Bank the camera into turns (restrained - a couple degrees at most)
      // and add a very faint continuous sway so the chase cam reads as
      // handheld rather than a rigid rig, both tied to the same
      // interpolated state already used for positioning above. lookAt()
      // fully overwrites the camera's orientation, so this roll must be
      // applied afterward as a local Z rotation on top of it. Both were
      // cut down further (was +-0.05 roll / 0.01 sway) - combined with a
      // heading-error spike during a hard drift, they were adding visible
      // rotational jitter on top of any position movement.
      const rollTarget = config.spectator ? 0 : Math.max(-0.025, Math.min(0.025, -target.headingError * target.speed * 0.0005));
      this.cameraRoll += (rollTarget - this.cameraRoll) * 0.08;
      const sway = config.spectator ? 0 : Math.sin(_timestamp * 0.0021) * Math.min(0.004, target.speed * 0.0001);
      camera.rotation.z += this.cameraRoll + sway;
      // Was up to +8deg at high speed - pushed chase mode's FOV to 76,
      // clearly outside the requested 55-65deg moderate-perspective range.
      // Capped much lower so top speed still reads as "faster" without
      // tipping into a wide-angle look.
      camera.fov += (config.fov + Math.min(3, target.speed * 0.045) - camera.fov) * 0.08;
      camera.updateProjectionMatrix();
    }

    this.effects?.update(_timestamp);
    renderer.render(scene, camera);
    this.metrics?.update(_timestamp);
  }

  /**
   * Casts a ray from the camera's look-at point toward its desired chase
   * position; if track/venue geometry blocks that segment, pulls the
   * camera in to just short of the hit (CAMERA_COLLISION_MARGIN) instead of
   * letting it clip into or through the prop. CAMERA_MIN_DISTANCE floors how
   * close that correction can pull the camera in, so a prop crowding the
   * track can't push the camera so close the car fills the whole frame.
   * The raycast is throttled and the corrected distance is smoothed, so a
   * prop entering/leaving the ray eases the camera in and back out instead
   * of snapping it or taxing every frame.
   */
  private raycastCameraCollision(desired: THREE.Vector3, lookAt: THREE.Vector3, timestamp: number): void {
    if (this.cameraObstacles.length === 0) return;
    const offset = desired.clone().sub(lookAt);
    const distance = offset.length();
    if (distance < 3) return;
    const direction = offset.normalize();

    if (timestamp - this.lastCameraCollisionScanAt > CAMERA_COLLISION_SCAN_MS) {
      this.lastCameraCollisionScanAt = timestamp;
      this.cameraCollisionRaycaster.set(lookAt, direction);
      this.cameraCollisionRaycaster.far = distance;
      const hit = this.cameraCollisionRaycaster
        .intersectObjects(this.cameraObstacles, true)
        .find((candidate) => candidate.distance > 2.4 && candidate.distance < distance - 0.8 && candidate.object.visible);
      this.cameraCollisionTargetDistance = hit
        ? Math.max(CAMERA_MIN_DISTANCE, hit.distance - CAMERA_COLLISION_MARGIN)
        : distance;
    }

    // Slowed further (was 0.22) - a spinout suddenly putting scenery in the
    // ray was pulling the camera in noticeably fast, reading as a cut.
    this.cameraCollisionDistance += (this.cameraCollisionTargetDistance - this.cameraCollisionDistance) * 0.1;
    if (this.cameraCollisionDistance >= distance - 0.05) return;
    desired.copy(lookAt).addScaledVector(direction, this.cameraCollisionDistance);
    desired.y += 0.75;
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
      // Partial (not full) correction per car - at a crowded start grid,
      // several cars can each want to push the camera at once, and applying
      // each push at full strength compounded into a hard, visibly
      // lopsided shove to one side rather than a gentle, even nudge.
      const push = (CAMERA_CAR_CLEARANCE - dist) * 0.5;
      desired.x += (dx / dist) * push;
      desired.z += (dz / dist) * push;
    }
  }

  setFocusedPlayer(playerNumber: number | null): void {
    this.focusedPlayerNumber = playerNumber;
  }

  /** "loading" while the imported car/track-landmark GLBs are still in flight, "ready" once they're in the scene, "fallback" if loading failed and the procedural car/scene are being used permanently for this mount. */
  getAssetLoadState(): "loading" | "ready" | "fallback" {
    return this.assetLoadState;
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

  private cameraConfig(speed: number): CameraConfig {
    if (this.cameraMode === "wide") {
      return { distance: 19, height: 9.5, lookHeight: 1.8, lookAhead: 7.2, fov: 66, damping: 0.16, spectator: false, avoidScenery: true, avoidCars: false };
    }
    if (this.cameraMode === "hood") {
      return { distance: -1.6, height: 1.55, lookHeight: 1.15, lookAhead: 8.5, fov: 76, damping: 0.34, spectator: false, avoidScenery: true, avoidCars: true };
    }
    if (this.cameraMode === "spectator") {
      return {
        distance: 0,
        height: 24 + speed * 0.03,
        lookHeight: 1.8,
        lookAhead: 10,
        fov: 58,
        damping: 0.08,
        spectator: true,
        avoidScenery: false,
        avoidCars: false
      };
    }
    // Moderate FOV (was 68, +8 more at top speed - a wide-angle look the
    // brief explicitly asked to avoid). 60 base, capped well inside the
    // requested 55-65deg range even at the highest in-race speeds.
    return {
      distance: CAMERA_DISTANCE,
      height: CAMERA_HEIGHT,
      lookHeight: 1.1,
      lookAhead: 2.2,
      fov: 60,
      damping: 0.32,
      spectator: false,
      avoidScenery: false,
      avoidCars: false
    };
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
    if (color) this.colors.set(playerNumber, distinctCarColor(color));
    if (this.cars.has(playerNumber)) return;
    const scene = this.scene;
    if (!scene) return;
    const fallback = BOT_FALLBACK_COLORS[Math.abs(playerNumber) % BOT_FALLBACK_COLORS.length] ?? "#f97316";
    const car = buildCarMesh(this.colors.get(playerNumber) ?? fallback);
    this.applyImportedCarVisual(playerNumber, car);
    car.root.visible = false;
    scene.add(car.root);
    this.cars.set(playerNumber, car);
  }

  private applyImportedCarVisual(playerNumber: number, car: CarVisual): void {
    const carScene = this.assetLibrary?.carScene ?? this.carAssetScene;
    if (!carScene || car.importedRoot) return;
    const color = this.colors.get(playerNumber) ?? BOT_FALLBACK_COLORS[Math.abs(playerNumber) % BOT_FALLBACK_COLORS.length] ?? "#f97316";
    const imported = buildImportedCarVisual({ carScene }, color);
    imported.root.position.y = -0.2;
    car.body.visible = false;
    car.root.add(imported.root);
    car.importedRoot = imported.root;
    car.wheels = imported.wheels;
    car.frontWheels = imported.frontWheels;
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
      this.scene.environment = null;
      this.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      this.scene.clear();
    }
    this.environmentTexture?.dispose();
    this.environmentTexture = null;
    this.devHelpers = null;
    this.effects = null;
    this.assetLoadCancelled = true;
    this.assetLibrary = null;
    this.carAssetScene = null;
    this.stadiumProps = null;
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
