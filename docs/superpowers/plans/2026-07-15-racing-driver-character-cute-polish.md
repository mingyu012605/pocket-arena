# Racing Driver Character & Cute Polish (Cycle 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a chibi driver character, an exaggerated open-wheel kart silhouette, a closer chase camera, richer effects/HUD, and matched before/after acceptance screenshots that make the racing game obviously read as a polished arcade kart racer.

**Architecture:** A new pure-logic-plus-mesh module (`character.ts`) computes reactive driver poses from state the renderer already interpolates (steering, speed, headingError, airborne, finished) and owns its own Three.js primitives, parented into each car. The existing procedural (`cars.ts`) and imported-GLTF (`assetScene.ts`) car builders are reshaped in place via named scale-multiplier constants rather than hand-edited per magic number. Camera, effects, audio, and HUD changes are narrow, targeted edits to the existing renderer/effects/audio/HUD files. A Playwright script (following the project's existing `artifacts/racing-quality-pass/*.mjs` pattern) captures the mandatory before/after acceptance screenshots.

**Tech Stack:** TypeScript, Three.js r170, Vitest (unit tests), Playwright (visual/acceptance verification), vanilla DOM/CSS for the HUD.

**Spec:** `docs/superpowers/specs/2026-07-14-racing-driver-character-design.md` (as amended 2026-07-15, rounds 1-2). Every task below cites the spec section it implements.

## Global Constraints

- No server or protocol changes anywhere in this plan (spec §2, §11). Every new client behavior derives from `RacingCarFrame` fields the client already receives (`progress, lateralOffset, headingError, speed, steering, rank, stale, airborne`) plus a track-frame `bankAngle`.
- No boost/nitro pose, effect, or HUD element anywhere (spec §2, §11) — verified absent from the codebase; do not reintroduce it.
- No camera position shake, in any form, including indirectly via the camera retune in Task 7 (spec §6.1, §11).
- The car stays open-wheel (wings, exposed wheels, F1-derived silhouette) — no fully enclosed go-kart body (spec §2, §5, §11).
- No licensed/imported audio — Web Audio synthesis only (spec §8, §11).
- Every visual task's real acceptance gate is the Section 10 screenshot comparison, not code review alone: a reviewer must see an obvious difference without an explanation (spec §1 "Acceptance bar").
- Run `npm run typecheck` and `npm run test` after every task that touches `.ts` files; run `npm run build` before the final task.

---

## File Structure

New files:
- `client/src/games/racing/character.ts` — pure derived-signal functions (acceleration, drift amount, impact detection, pose priority resolution) plus the Three.js `DriverCharacter` builder. Pure functions are exported separately from the mesh builder so the decision logic is unit-testable without a WebGL context, matching this codebase's existing split between `interpolation.ts` (pure, tested) and `cars.ts`/`assetScene.ts` (Three.js, screenshot-verified).
- `client/src/games/racing/character.test.ts` — Vitest coverage for the pure functions above, following the existing `interpolation.test.ts` pattern.
- `artifacts/racing-quality-pass/cycle3-visual/before-after-capture.mjs` — acceptance-gate screenshot script, adapted from the existing `artifacts/racing-quality-pass/before-after-compare.mjs` pattern.

Modified files:
- `client/src/games/racing/cars.ts` — silhouette scale constants, remove the inline driver-bust primitives (now owned by `character.ts`), wire `character` field into `CarVisual`.
- `client/src/games/racing/assetScene.ts` — remove `buildDriverBust`, wire `character` field into `ImportedCarVisual`, GLTF node investigation for silhouette treatment.
- `client/src/games/racing/renderer.ts` — camera constants, per-car `DriverInput` computation and `character.update()` call, squash/stretch on `car.root.scale`, jump-takeoff/landing effect triggers, character disposal wiring.
- `client/src/games/racing/effects.ts` — `spawnDriftSmoke()`, `triggerJumpTakeoff()`, reusing the existing pooled burst system.
- `client/src/games/racing/audio.ts` — `playCollisionBoing()`, extended `playFinish()`.
- `client/src/pages/hostLobby.ts` — rank badge markup, drift-feedback indicator, reduced HUD footprint.
- `client/src/styles/components.css` — rank badge styles, `.racing-leaderboard-row` radius fix, bolder speedometer numerals, drift meter styles.
- `docs/superpowers/specs/2026-07-12-harbor-city-gp-art-bible.md` — record the hard-edge → rounded-panel supersession from spec §5.

---

### Task 1: Character derived-signal math (pure, TDD)

**Files:**
- Create: `client/src/games/racing/character.ts`
- Create: `client/src/games/racing/character.test.ts`

**Interfaces:**
- Produces (consumed by Task 2 and Task 6):
  ```ts
  export function clamp(value: number, min: number, max: number): number;
  export function computeAcceleration(speed: number, previousSpeed: number, previousAcceleration: number, dtSeconds: number, maxAcceleration: number): number;
  export function computeDriftAmount(headingError: number): number;
  export interface ImpactThresholds { speedDropThreshold: number; minSpeed: number; maxSteering: number }
  export function detectImpact(speed: number, previousSpeed: number, steering: number, cooldownRemaining: number, thresholds: ImpactThresholds): { isImpact: boolean; impactStrength: number };
  export const DEFAULT_IMPACT_THRESHOLDS: ImpactThresholds;
  export const MAX_ACCELERATION: number;
  export const HARD_LANDING_IMPACT_THRESHOLD: number;
  export function classifyLanding(impactStrength: number): "soft" | "hard";
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/games/racing/character.test.ts
import { describe, expect, it } from "vitest";
import {
  clamp,
  computeAcceleration,
  computeDriftAmount,
  detectImpact,
  classifyLanding,
  DEFAULT_IMPACT_THRESHOLDS,
  HARD_LANDING_IMPACT_THRESHOLD
} from "./character";

describe("clamp", () => {
  it("clamps below the minimum", () => {
    expect(clamp(-5, 0, 1)).toBe(0);
  });
  it("clamps above the maximum", () => {
    expect(clamp(5, 0, 1)).toBe(1);
  });
  it("passes through values already in range", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe("computeAcceleration", () => {
  it("smooths a sudden speed increase toward the raw acceleration over repeated calls", () => {
    let smoothed = 0;
    // Speed jumps from 0 to 10 over 1 second, held constant afterward.
    smoothed = computeAcceleration(10, 0, smoothed, 1, 20);
    expect(smoothed).toBeCloseTo(10 * 0.12, 5);
    smoothed = computeAcceleration(10, 10, smoothed, 1, 20);
    // With a zero raw acceleration on this call, smoothed relaxes toward 0.
    expect(smoothed).toBeLessThan(10 * 0.12);
    expect(smoothed).toBeGreaterThan(0);
  });

  it("clamps to the max magnitude even for a huge instantaneous speed jump", () => {
    const smoothed = computeAcceleration(1000, 0, 0, 0.001, 20);
    expect(smoothed).toBeLessThanOrEqual(20);
  });

  it("clamps to the negative max magnitude for a huge braking event", () => {
    const smoothed = computeAcceleration(0, 1000, 0, 0.001, 20);
    expect(smoothed).toBeGreaterThanOrEqual(-20);
  });

  it("returns 0 for a zero time delta rather than dividing by zero", () => {
    expect(computeAcceleration(10, 0, 0, 0, 20)).toBe(0);
  });
});

describe("computeDriftAmount", () => {
  it("is 0 at and below the 0.12 threshold", () => {
    expect(computeDriftAmount(0)).toBe(0);
    expect(computeDriftAmount(0.12)).toBe(0);
    expect(computeDriftAmount(-0.1)).toBe(0);
  });

  it("ramps linearly between 0.12 and 0.47", () => {
    expect(computeDriftAmount(0.12 + 0.35 / 2)).toBeCloseTo(0.5, 5);
  });

  it("saturates at 1 for large heading error", () => {
    expect(computeDriftAmount(5)).toBe(1);
  });

  it("is symmetric for negative heading error", () => {
    expect(computeDriftAmount(-0.47)).toBeCloseTo(computeDriftAmount(0.47), 5);
  });
});

describe("detectImpact", () => {
  it("flags an impact on a large sudden speed drop while going mostly straight", () => {
    const result = detectImpact(2, 15, 0.05, 0, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(true);
    expect(result.impactStrength).toBeGreaterThan(0);
    expect(result.impactStrength).toBeLessThanOrEqual(1);
  });

  it("does not flag normal braking (speed drop below threshold)", () => {
    const result = detectImpact(13, 15, 0, 0, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(false);
    expect(result.impactStrength).toBe(0);
  });

  it("does not flag a hard turn even with a big speed drop (steering too large)", () => {
    const result = detectImpact(2, 15, 0.9, 0, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(false);
  });

  it("does not flag while still under cooldown from a previous impact", () => {
    const result = detectImpact(2, 15, 0.05, 0.2, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(false);
  });

  it("does not flag a drop starting from a low previous speed", () => {
    const result = detectImpact(0, 3, 0.05, 0, DEFAULT_IMPACT_THRESHOLDS);
    expect(result.isImpact).toBe(false);
  });
});

describe("classifyLanding", () => {
  it("classifies impact strength below the hard-landing threshold as soft", () => {
    expect(classifyLanding(HARD_LANDING_IMPACT_THRESHOLD - 0.01)).toBe("soft");
  });
  it("classifies impact strength at or above the hard-landing threshold as hard", () => {
    expect(classifyLanding(HARD_LANDING_IMPACT_THRESHOLD)).toBe("hard");
    expect(classifyLanding(1)).toBe("hard");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- character.test.ts`
Expected: FAIL with "Cannot find module './character'" (the file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

```ts
// client/src/games/racing/character.ts
// Pure derived-signal math for the driver-character reactive system (spec
// docs/superpowers/specs/2026-07-14-racing-driver-character-design.md
// Sections 4.3, 4.4, 4.5, 4.9). Kept free of Three.js/DOM so it can be unit
// tested directly, the same split already used between interpolation.ts
// (pure) and cars.ts/assetScene.ts (Three.js, screenshot-verified).

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Spec 4.3: derives and smooths a throttle/brake-equivalent signal from consecutive speed samples, since the interpolated snapshot has no direct throttle/brake field. */
export function computeAcceleration(
  speed: number,
  previousSpeed: number,
  previousAcceleration: number,
  dtSeconds: number,
  maxAcceleration: number
): number {
  if (dtSeconds <= 0) return 0;
  const raw = (speed - previousSpeed) / dtSeconds;
  const smoothed = previousAcceleration + (raw - previousAcceleration) * 0.12;
  return clamp(smoothed, -maxAcceleration, maxAcceleration);
}

export const MAX_ACCELERATION = 20;

/** Spec 4.4: continuous drift intensity, replacing an on/off flag - same underlying signal as the renderer's existing skid-mark trigger (`headingError > 0.2`), expressed as a 0..1 ramp instead of a threshold. */
export function computeDriftAmount(headingError: number): number {
  return clamp((Math.abs(headingError) - 0.12) / 0.35, 0, 1);
}

export interface ImpactThresholds {
  speedDropThreshold: number;
  minSpeed: number;
  maxSteering: number;
}

/** Starting values per spec 4.5/Section 12 ("implementation-time tuning, verified visually against real gameplay"). Speed/steering are in the same units as RacingCarFrame.speed/steering. */
export const DEFAULT_IMPACT_THRESHOLDS: ImpactThresholds = {
  speedDropThreshold: 4,
  minSpeed: 3,
  maxSteering: 0.5
};

/** Spec 4.5: infers an impact (collision or hard landing) from a multi-condition check on state already available, guarding against false positives from braking, hard turns, or normal deceleration. */
export function detectImpact(
  speed: number,
  previousSpeed: number,
  steering: number,
  cooldownRemaining: number,
  thresholds: ImpactThresholds = DEFAULT_IMPACT_THRESHOLDS
): { isImpact: boolean; impactStrength: number } {
  const speedDrop = previousSpeed - speed;
  const isImpact =
    speedDrop > thresholds.speedDropThreshold &&
    previousSpeed > thresholds.minSpeed &&
    Math.abs(steering) < thresholds.maxSteering &&
    cooldownRemaining <= 0;
  return { isImpact, impactStrength: isImpact ? clamp(speedDrop / 20, 0, 1) : 0 };
}

/** Spec 4.2/4.9 state-checklist mapping: the magnitude band inside the shared impactStrength-driven reaction that distinguishes a hard landing (full startled-face + squash/stretch) from a soft one (settles straight back to the steering pose). Starting value per Section 12 ("implementation-time tuning, verified visually"). */
export const HARD_LANDING_IMPACT_THRESHOLD = 0.45;

export function classifyLanding(impactStrength: number): "soft" | "hard" {
  return impactStrength >= HARD_LANDING_IMPACT_THRESHOLD ? "hard" : "soft";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- character.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/games/racing/character.ts client/src/games/racing/character.test.ts
git commit -m "feat(racing): add pure driver-character signal math (accel/drift/impact/landing)"
```

---

### Task 2: Character pose priority resolution (pure, TDD)

**Files:**
- Modify: `client/src/games/racing/character.ts`
- Modify: `client/src/games/racing/character.test.ts`

**Interfaces:**
- Consumes: `clamp` from Task 1 (same file).
- Produces (consumed by Task 3):
  ```ts
  export type DriverPose = "celebration" | "collision" | "airtime" | "drift" | "steering";
  export interface DriverInput {
    steering: number;
    speed: number;
    acceleration: number;
    driftAmount: number;
    impactStrength: number;
    airborne: boolean;
    finished: boolean;
    deltaTime: number;
  }
  export function resolveActivePose(input: DriverInput): DriverPose;
  export type FaceState = "neutral" | "excited" | "startled";
  export function resolveFaceState(pose: DriverPose): FaceState;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// append to client/src/games/racing/character.test.ts
import { resolveActivePose, resolveFaceState } from "./character";
import type { DriverInput } from "./character";

function driverInput(overrides: Partial<DriverInput> = {}): DriverInput {
  return {
    steering: 0,
    speed: 0,
    acceleration: 0,
    driftAmount: 0,
    impactStrength: 0,
    airborne: false,
    finished: false,
    deltaTime: 1 / 60,
    ...overrides
  };
}

describe("resolveActivePose", () => {
  it("returns steering as the default pose", () => {
    expect(resolveActivePose(driverInput())).toBe("steering");
  });

  it("returns drift when driftAmount is above 0", () => {
    expect(resolveActivePose(driverInput({ driftAmount: 0.4 }))).toBe("drift");
  });

  it("returns airtime when airborne, overriding drift", () => {
    expect(resolveActivePose(driverInput({ airborne: true, driftAmount: 0.9 }))).toBe("airtime");
  });

  it("returns collision when impactStrength is above 0, overriding airtime", () => {
    expect(resolveActivePose(driverInput({ airborne: true, impactStrength: 0.6 }))).toBe("collision");
  });

  it("returns celebration when finished, overriding everything else", () => {
    expect(
      resolveActivePose(driverInput({ finished: true, impactStrength: 0.9, airborne: true, driftAmount: 1 }))
    ).toBe("celebration");
  });
});

describe("resolveFaceState", () => {
  it("maps drift and airtime to excited", () => {
    expect(resolveFaceState("drift")).toBe("excited");
    expect(resolveFaceState("airtime")).toBe("excited");
  });
  it("maps collision to startled", () => {
    expect(resolveFaceState("collision")).toBe("startled");
  });
  it("maps steering and celebration to neutral", () => {
    expect(resolveFaceState("steering")).toBe("neutral");
    expect(resolveFaceState("celebration")).toBe("neutral");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- character.test.ts`
Expected: FAIL with "resolveActivePose is not exported" / "resolveFaceState is not exported".

- [ ] **Step 3: Write the minimal implementation**

```ts
// append to client/src/games/racing/character.ts

/** Spec 4.2 priority order plus the 4.9 airtime tier, highest priority first: celebration > collision > airtime > drift > steering. */
export type DriverPose = "celebration" | "collision" | "airtime" | "drift" | "steering";

export interface DriverInput {
  steering: number;
  speed: number;
  acceleration: number;
  driftAmount: number;
  impactStrength: number;
  airborne: boolean;
  finished: boolean;
  deltaTime: number;
}

export function resolveActivePose(input: DriverInput): DriverPose {
  if (input.finished) return "celebration";
  if (input.impactStrength > 0) return "collision";
  if (input.airborne) return "airtime";
  if (input.driftAmount > 0) return "drift";
  return "steering";
}

/** Spec 4.7: 3 face states shared across poses - airtime reuses "excited" (same positive-energy register as drift), collision reuses "startled" for both plain collisions and hard landings. */
export type FaceState = "neutral" | "excited" | "startled";

export function resolveFaceState(pose: DriverPose): FaceState {
  if (pose === "collision") return "startled";
  if (pose === "drift" || pose === "airtime") return "excited";
  return "neutral";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- character.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add client/src/games/racing/character.ts client/src/games/racing/character.test.ts
git commit -m "feat(racing): add driver-character pose/face-state priority resolution"
```

---

### Task 3: First chibi driver character (one hairstyle, de-risking screenshot)

Spec §4.8 requires building and screenshotting **one** hairstyle first, at real gameplay distance, before building the other three - this task does exactly that and stops for visual confirmation before Task 4 continues.

**Files:**
- Modify: `client/src/games/racing/character.ts` (add the Three.js mesh builder)
- Modify: `client/src/games/racing/cars.ts` (remove old inline driver-bust primitives, attach `character`)
- Modify: `client/src/games/racing/renderer.ts` (wire `DriverInput` computation + `character.update()` into the per-car render loop)

**Interfaces:**
- Consumes: `DriverPose`, `FaceState`, `resolveActivePose`, `resolveFaceState`, `computeAcceleration`, `computeDriftAmount`, `detectImpact`, `MAX_ACCELERATION`, `DEFAULT_IMPACT_THRESHOLDS` from Tasks 1-2.
- Produces (consumed by Task 4 and later):
  ```ts
  export interface DriverCharacter {
    root: THREE.Group;
    update(input: DriverInput): void;
    reset(): void;
    dispose(): void;
  }
  export function buildDriverCharacter(playerNumber: number, color: THREE.ColorRepresentation): DriverCharacter;
  ```
  `CarVisual.character: DriverCharacter` (cars.ts), `ImportedCarVisual.character: DriverCharacter` (assetScene.ts, wired in Task 4).

- [ ] **Step 1: Add the mesh builder to `character.ts`**

This is hairstyle 0 ("spiky", `playerNumber % 4 === 0`) only - the other three hairstyles are Task 4. Sized well above the current tiny bust (helmet radius 0.26 in the old `cars.ts` bust) to meet the spec's driver-scale minimums (§4.7: head height >= 55% of the cockpit-opening height, shoulder width >= 70% of the cockpit-opening width) - exact sizing is confirmed against the Step 4 screenshot below, per spec §4.8's explicit de-risking requirement, and may need a follow-up tuning pass before Task 4 proceeds.

```ts
// append to client/src/games/racing/character.ts
import * as THREE from "three";

const SUIT_MATERIAL_CACHE = new Map<string, THREE.MeshStandardMaterial>();
function suitMaterial(color: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const key = String(color);
  let material = SUIT_MATERIAL_CACHE.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.02 });
    SUIT_MATERIAL_CACHE.set(key, material);
  }
  return material;
}

// Shared (non-player-colored) materials/geometry - one instance reused across
// every car's character, matching the geometry/material-sharing rule already
// established in cars.ts for wheel/trim meshes.
const HEAD_MATERIAL = new THREE.MeshStandardMaterial({ color: "#fde9d0", roughness: 0.5, metalness: 0.01 });
const GLOVE_MATERIAL = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.5, metalness: 0.02 });
const HAIR_MATERIAL_SPIKY = new THREE.MeshStandardMaterial({ color: "#2c1810", roughness: 0.6, metalness: 0.02 });
const EYE_MATERIAL_OPEN = new THREE.MeshBasicMaterial({ color: "#0f172a" });
const EYE_MATERIAL_EXCITED = new THREE.MeshBasicMaterial({ color: "#0f172a" });
const EYE_MATERIAL_STARTLED = new THREE.MeshBasicMaterial({ color: "#ffffff" });
const MOUTH_MATERIAL = new THREE.MeshBasicMaterial({ color: "#fb7185" });

const HEAD_GEOMETRY = new THREE.SphereGeometry(0.24, 16, 12);
const HAIR_SPIKE_GEOMETRY = new THREE.ConeGeometry(0.05, 0.22, 6);
const TORSO_GEOMETRY = new THREE.CapsuleGeometry(0.16, 0.18, 4, 10);
const ARM_GEOMETRY = new THREE.CapsuleGeometry(0.05, 0.24, 4, 8);
const GLOVE_GEOMETRY = new THREE.SphereGeometry(0.065, 10, 8);
const EYE_OPEN_GEOMETRY = new THREE.SphereGeometry(0.022, 8, 6);
const EYE_EXCITED_GEOMETRY = new THREE.SphereGeometry(0.026, 8, 6);
const EYE_STARTLED_GEOMETRY = new THREE.SphereGeometry(0.03, 8, 6);
const MOUTH_NEUTRAL_GEOMETRY = new THREE.BoxGeometry(0.05, 0.012, 0.01);
const MOUTH_EXCITED_GEOMETRY = new THREE.SphereGeometry(0.028, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
const MOUTH_STARTLED_GEOMETRY = new THREE.SphereGeometry(0.02, 8, 6);

function buildSpikyHair(): THREE.Group {
  const hair = new THREE.Group();
  const spikeLayout: Array<[number, number, number, number, number]> = [
    [0, 0.12, -0.02, 0, 0],
    [0.09, 0.1, -0.01, 0, -0.3],
    [-0.09, 0.1, -0.01, 0, 0.3],
    [0.05, 0.11, 0.08, 0.35, -0.15],
    [-0.05, 0.11, 0.08, 0.35, 0.15],
    [0, 0.11, 0.12, 0.5, 0]
  ];
  for (const [x, y, z, rotX, rotZ] of spikeLayout) {
    const spike = new THREE.Mesh(HAIR_SPIKE_GEOMETRY, HAIR_MATERIAL_SPIKY);
    spike.position.set(x, y, z);
    spike.rotation.set(rotX, 0, rotZ);
    hair.add(spike);
  }
  return hair;
}

/** playerNumber % 4 selects the hairstyle; only case 0 (spiky) exists until Task 4 adds the remaining three. */
function buildHair(playerNumber: number): THREE.Group {
  const style = playerNumber % 4;
  if (style === 0) return buildSpikyHair();
  // Tasks 4 adds ponytail (1), buzzcut (2), curly (3); until then every
  // player falls back to spiky so no car is left without hair.
  return buildSpikyHair();
}

interface FaceMeshes {
  group: THREE.Group;
  eyes: Record<FaceState, THREE.Object3D>;
  mouths: Record<FaceState, THREE.Object3D>;
}

function buildFace(): FaceMeshes {
  const group = new THREE.Group();
  const eyes: Partial<Record<FaceState, THREE.Group>> = {};
  const mouths: Partial<Record<FaceState, THREE.Object3D>> = {};

  const eyeGeometryByState: Record<FaceState, THREE.BufferGeometry> = {
    neutral: EYE_OPEN_GEOMETRY,
    excited: EYE_EXCITED_GEOMETRY,
    startled: EYE_STARTLED_GEOMETRY
  };
  const eyeMaterialByState: Record<FaceState, THREE.Material> = {
    neutral: EYE_MATERIAL_OPEN,
    excited: EYE_MATERIAL_EXCITED,
    startled: EYE_MATERIAL_STARTLED
  };
  for (const state of ["neutral", "excited", "startled"] as FaceState[]) {
    const pair = new THREE.Group();
    for (const x of [-0.075, 0.075]) {
      const eye = new THREE.Mesh(eyeGeometryByState[state], eyeMaterialByState[state]);
      eye.position.set(x, 0.02, 0.21);
      pair.add(eye);
    }
    pair.visible = false;
    group.add(pair);
    eyes[state] = pair;
  }

  const mouthGeometryByState: Record<FaceState, THREE.BufferGeometry> = {
    neutral: MOUTH_NEUTRAL_GEOMETRY,
    excited: MOUTH_EXCITED_GEOMETRY,
    startled: MOUTH_STARTLED_GEOMETRY
  };
  for (const state of ["neutral", "excited", "startled"] as FaceState[]) {
    const mouth = new THREE.Mesh(mouthGeometryByState[state], MOUTH_MATERIAL);
    mouth.position.set(0, -0.06, 0.22);
    if (state === "excited") mouth.rotation.x = Math.PI;
    mouth.visible = false;
    group.add(mouth);
    mouths[state] = mouth;
  }

  return { group, eyes: eyes as Record<FaceState, THREE.Object3D>, mouths: mouths as Record<FaceState, THREE.Object3D> };
}

export interface DriverCharacter {
  root: THREE.Group;
  update(input: DriverInput): void;
  reset(): void;
  dispose(): void;
}

const POSE_LERP_SPEED = 1 / 0.15; // ~150ms blend, per spec 4.9's takeoff blend timing, reused for every pose transition.

/**
 * Builds one chibi driver character: head/hair/torso/arms parented into
 * `root`, seated at the cockpit position the caller (cars.ts/assetScene.ts)
 * positions `root` at. `update()` blends toward whichever pose
 * `resolveActivePose` picks each frame; `character.ts` owns all of the
 * internal blend state so callers never reach into individual transforms.
 */
export function buildDriverCharacter(playerNumber: number, color: THREE.ColorRepresentation): DriverCharacter {
  const root = new THREE.Group();
  root.name = "driver-character";

  const head = new THREE.Mesh(HEAD_GEOMETRY, HEAD_MATERIAL);
  head.position.set(0, 0.42, 0);
  root.add(head);

  const hair = buildHair(playerNumber);
  hair.position.copy(head.position);
  root.add(hair);

  const face = buildFace();
  face.group.position.copy(head.position);
  root.add(face.group);

  const torso = new THREE.Mesh(TORSO_GEOMETRY, suitMaterial(color));
  torso.position.set(0, 0.2, 0);
  root.add(torso);

  const leftArm = new THREE.Mesh(ARM_GEOMETRY, suitMaterial(color));
  leftArm.position.set(-0.16, 0.2, 0.14);
  leftArm.rotation.z = 0.3;
  root.add(leftArm);
  const leftGlove = new THREE.Mesh(GLOVE_GEOMETRY, GLOVE_MATERIAL);
  leftGlove.position.set(-0.24, 0.09, 0.24);
  root.add(leftGlove);

  const rightArm = new THREE.Mesh(ARM_GEOMETRY, suitMaterial(color));
  rightArm.position.set(0.16, 0.2, 0.14);
  rightArm.rotation.z = -0.3;
  root.add(rightArm);
  const rightGlove = new THREE.Mesh(GLOVE_GEOMETRY, GLOVE_MATERIAL);
  rightGlove.position.set(0.24, 0.09, 0.24);
  root.add(rightGlove);

  let activeFace: FaceState = "neutral";
  face.eyes.neutral.visible = true;
  face.mouths.neutral.visible = true;

  let previousSpeed = 0;
  let previousAcceleration = 0;
  let collisionCooldown = 0;
  let poseBlend = 0; // 0 = fully in the previous pose's transform, 1 = fully in the current one
  let currentPose: DriverPose = "steering";

  function setFace(next: FaceState): void {
    if (next === activeFace) return;
    face.eyes[activeFace].visible = false;
    face.mouths[activeFace].visible = false;
    face.eyes[next].visible = true;
    face.mouths[next].visible = true;
    activeFace = next;
  }

  function update(input: DriverInput): void {
    const acceleration = input.acceleration;
    const { isImpact, impactStrength } = detectImpact(input.speed, previousSpeed, input.steering, collisionCooldown, DEFAULT_IMPACT_THRESHOLDS);
    collisionCooldown = isImpact ? 0.35 : Math.max(0, collisionCooldown - input.deltaTime);
    previousSpeed = input.speed;
    previousAcceleration = acceleration;

    const pose = resolveActivePose({ ...input, impactStrength: isImpact ? impactStrength : input.impactStrength });
    if (pose !== currentPose) {
      currentPose = pose;
      poseBlend = 0;
    }
    poseBlend = clamp(poseBlend + input.deltaTime * POSE_LERP_SPEED, 0, 1);
    setFace(resolveFaceState(currentPose));

    // Base steering/acceleration lean (spec 4.2 tier 5, continuous - "hard
    // steering" is this same pose at large |steering|, not a separate state).
    const steerLean = clamp(input.steering * 0.6, -0.5, 0.5);
    const accelLean = clamp(-acceleration * 0.02, -0.2, 0.2);
    root.rotation.z = steerLean * 0.4;
    root.rotation.x = accelLean;

    if (currentPose === "airtime") {
      // Spec 4.9: arms drawn in slightly off the wheel, small forward lean.
      leftArm.rotation.z = 0.55;
      rightArm.rotation.z = -0.55;
      root.rotation.x += 0.15;
    } else if (currentPose === "drift") {
      leftArm.rotation.z = 0.3 + input.driftAmount * 0.15;
      rightArm.rotation.z = -0.3 - input.driftAmount * 0.15;
    } else if (currentPose === "collision") {
      leftArm.rotation.z = 0.15;
      rightArm.rotation.z = -0.15;
    } else if (currentPose === "celebration") {
      leftArm.rotation.z = 1.4;
      rightArm.rotation.z = -1.4;
      root.rotation.x = -0.1;
    } else {
      leftArm.rotation.z = 0.3;
      rightArm.rotation.z = -0.3;
    }
  }

  function reset(): void {
    previousSpeed = 0;
    previousAcceleration = 0;
    collisionCooldown = 0;
    poseBlend = 0;
    currentPose = "steering";
    setFace("neutral");
  }

  function dispose(): void {
    // HEAD_MATERIAL/GLOVE_MATERIAL/hair/eye/mouth materials and geometries
    // are shared module-level singletons (disposed once, not per-character -
    // see the shared-material comment above). Only per-character resources
    // (the suit material, keyed by color and cached, and this character's
    // own Group hierarchy) are this function's responsibility; the shared
    // scene-wide THREE.Scene.traverse() cleanup in renderer.ts's destroy()
    // already disposes every mesh's geometry/material exactly once when the
    // renderer itself tears down, so this is a no-op kept for interface
    // symmetry with RacingEffects/RacingAudio's own dispose()/destroy().
  }

  return { root, update, reset, dispose };
}
```

- [ ] **Step 2: Wire `character` into `CarVisual` and remove the old inline driver-bust primitives (`cars.ts`)**

Remove lines 239-257 of `client/src/games/racing/cars.ts` (the `helmet`/`visor`/eye/cheek primitives built directly inside `buildCarMesh`) and replace with a `character` field:

```ts
// client/src/games/racing/cars.ts - add to the CarVisual interface (near line 4-14)
export interface CarVisual {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  brakeLight: THREE.Mesh;
  speedTrail: THREE.Mesh;
  underglow: THREE.Mesh;
  marker: THREE.Mesh;
  character: DriverCharacter;
  importedRoot?: THREE.Group;
}
```

Add the import at the top of `cars.ts`:

```ts
import { buildDriverCharacter } from "./character";
import type { DriverCharacter } from "./character";
```

Delete the `helmet`/`visor`/eye/cheek block (the code currently at lines 239-257, from `const helmet = new THREE.Mesh(HELMET_GEOMETRY, HELMET);` through the eye/cheek `for` loop's closing brace).

`buildCarMesh(color: string)` does not currently receive a `playerNumber` - only `color`, and `buildDriverCharacter` needs one to pick a hairstyle (Task 4). Change the function signature to `export function buildCarMesh(color: string, playerNumber: number): CarVisual {`, and update both call sites in `renderer.ts` (`buildCarMesh(color)` at the mount-time car-building loop around line 251, and `buildCarMesh(this.colors.get(playerNumber) ?? fallback)` in `ensureCarVisual` around line 790) to `buildCarMesh(color, playerNumber)` / `buildCarMesh(this.colors.get(playerNumber) ?? fallback, playerNumber)` - both call sites already have `playerNumber` in scope.

In place of the deleted helmet block, build and position the character at the same cockpit location the old helmet used (`position.set(0, 1.14, -0.4)` was the old helmet's world position within `body`):

```ts
  const character = buildDriverCharacter(playerNumber, color);
  character.root.position.set(0, 0.78, -0.4);
  body.add(character.root);
```

Update the return statement at the end of `buildCarMesh` to include `character`:

```ts
  return { root: group, body, wheels, frontWheels, brakeLight, speedTrail, underglow, marker, character };
```

The now-unused `HELMET_GEOMETRY`, `VISOR_GEOMETRY`, `DRIVER_EYE_GEOMETRY`, `DRIVER_CHEEK_GEOMETRY`, `HELMET`, `VISOR`, `DRIVER_EYE`, `DRIVER_CHEEK` constants (lines 20-23, 31-34) become dead code - remove them.

- [ ] **Step 3: Wire `DriverInput` computation and `character.update()` into `renderer.ts`**

Add per-car smoothing state maps next to the existing `visualYaw`/`visualWheelSteer` maps (around line 129-134):

```ts
  private readonly previousCharacterSpeed = new Map<number, number>();
  private readonly previousCharacterAcceleration = new Map<number, number>();
```

Add the import at the top of `renderer.ts`:

```ts
import { computeAcceleration, computeDriftAmount, MAX_ACCELERATION } from "./character";
```

Inside the per-car loop in `render()`, immediately after the existing skid-mark block (after the `if (Math.abs(pos.headingError) > 0.2 ...) { ... } else { this.lastSkidSpawn.delete(playerNumber); }` block, i.e. right before `otherCarPositions.push(...)` around line 478), add:

```ts
      const prevCharSpeed = this.previousCharacterSpeed.get(playerNumber) ?? pos.speed;
      const prevCharAccel = this.previousCharacterAcceleration.get(playerNumber) ?? 0;
      const acceleration = computeAcceleration(pos.speed, prevCharSpeed, prevCharAccel, Math.max(1 / 1000, (_timestamp - this.lastFrameAt) / 1000), MAX_ACCELERATION);
      this.previousCharacterSpeed.set(playerNumber, pos.speed);
      this.previousCharacterAcceleration.set(playerNumber, acceleration);
      const driftAmount = computeDriftAmount(pos.headingError);
      car.character.update({
        steering,
        speed: pos.speed,
        acceleration,
        driftAmount,
        impactStrength: 0, // detectImpact runs inside character.update() itself using its own internal previous-speed state
        airborne: pos.airborne ?? false,
        finished: focused?.playerNumber === playerNumber ? false : false, // finished-state wiring is Task 4 (needs RacingPlayerState.finished threaded through positions, currently only available on `state.players`, not the interpolated frame)
        deltaTime: Math.max(1 / 1000, (_timestamp - this.lastFrameAt) / 1000)
      });
```

Note: `this.lastFrameAt` is already updated later in the same `render()` call by `updateRenderBudget()` (called at the top of `render()`), so at this point in the loop it still holds the *previous* frame's timestamp - exactly the delta this computation needs, matching the existing pattern `updateRenderBudget` itself uses for frame-delta tracking.

The `finished` wiring above is deliberately left as an explicit `false` with a comment, because `RacingCarFrame`/`RacingInterpolationBuffer` does not carry a `finished` flag today (only `state.players[].finished`, consumed separately in `applyState()` for the confetti trigger at line 359). Task 4 completes this by reading `this.finishedPlayers.has(playerNumber)` (already maintained by `applyState()`) instead of the placeholder `false` - deferred to Task 4 because celebration is not exercised by the single-hairstyle de-risking screenshot this task is building toward.

- [ ] **Step 4: Reset character on interpolation reset**

In `resetInterpolation()` (around line 370-383), add a loop to reset every car's character alongside the existing `visualYaw.clear()` etc:

```ts
    for (const car of this.cars.values()) car.character.reset();
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`assetScene.ts`'s `ImportedCarVisual` does not yet have a `character` field - that's fine, it isn't touched until Task 4, and `applyImportedCarVisual` in `renderer.ts` only replaces `car.body.visible = false` / adds `imported.root`, it doesn't construct a new `CarVisual`, so the procedural car's `character` from Step 2 stays attached and visible even once the GLTF import lands on top of it. This is a known, acceptable gap for this task only: until Task 4 gives the imported car its own character, the procedural car's character will render *underneath/behind* the imported car's hidden body. Confirm this visually in Step 6 below and note it in the commit message; Task 4 fixes it properly.)

- [ ] **Step 6: Manual screenshot verification (spec §4.8 de-risking gate)**

```bash
npm run dev
```

In another terminal, adapt the existing `artifacts/racing-quality-pass/before-after-compare.mjs` pattern (or run it directly against the dev server) to capture a single host-view screenshot of a stationary or slow-moving car at the starting grid, chase camera, default quality. Save it to `artifacts/racing-quality-pass/character-derisk-hairstyle0.png`.

Read the resulting PNG with the Read tool and confirm, against spec §4.7's minimum readability requirements:
- The head/hair silhouette is clearly visible above the cockpit rim, not a tiny bump.
- Both arms are visible extending toward where the wheel would be.
- No obvious clipping of hair/head through the car body.

If the character still reads as too small, increase `HEAD_GEOMETRY`'s radius (currently `0.24`) and the torso/arm proportions proportionally, and re-capture, before proceeding to Task 4 - this is exactly the iteration spec §4.8 requires before building the remaining three hairstyles.

- [ ] **Step 7: Commit**

```bash
git add client/src/games/racing/character.ts client/src/games/racing/cars.ts client/src/games/racing/renderer.ts artifacts/racing-quality-pass/character-derisk-hairstyle0.png
git commit -m "feat(racing): add first chibi driver character hairstyle, wire into procedural car"
```

---

### Task 4: Remaining hairstyles, full reactivity, and imported-car wiring

**Files:**
- Modify: `client/src/games/racing/character.ts` (ponytail/buzzcut/curly hairstyles, hairstyle selection, `impactStrength`/`finished` exposed properly)
- Modify: `client/src/games/racing/assetScene.ts` (remove `buildDriverBust`, attach `character` to `ImportedCarVisual`)
- Modify: `client/src/games/racing/renderer.ts` (fix the `finished`/`impactStrength` wiring deferred in Task 3, apply the character to the imported car, dispose the procedural character's redundancy once the import lands)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: `ImportedCarVisual.character: DriverCharacter` (assetScene.ts), consumed by `renderer.ts`'s `applyImportedCarVisual`.

- [ ] **Step 1: Add the three remaining hairstyles to `character.ts`**

```ts
// character.ts - materials/geometry alongside HAIR_MATERIAL_SPIKY
const HAIR_MATERIAL_PONYTAIL = new THREE.MeshStandardMaterial({ color: "#7c2d12", roughness: 0.55, metalness: 0.02 });
const HAIR_MATERIAL_BUZZCUT = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.7, metalness: 0.01 });
const HAIR_MATERIAL_CURLY = new THREE.MeshStandardMaterial({ color: "#facc15", roughness: 0.6, metalness: 0.02 });
const PONYTAIL_GEOMETRY = new THREE.CapsuleGeometry(0.035, 0.16, 4, 8);
const BUZZCUT_GEOMETRY = new THREE.SphereGeometry(0.245, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
const CURL_GEOMETRY = new THREE.SphereGeometry(0.055, 8, 6);

function buildPonytailHair(): THREE.Group {
  const hair = new THREE.Group();
  const cap = new THREE.Mesh(BUZZCUT_GEOMETRY, HAIR_MATERIAL_PONYTAIL);
  hair.add(cap);
  const tail = new THREE.Mesh(PONYTAIL_GEOMETRY, HAIR_MATERIAL_PONYTAIL);
  tail.position.set(0, 0.02, -0.22);
  tail.rotation.x = Math.PI * 0.42;
  hair.add(tail);
  return hair;
}

function buildBuzzcutHair(): THREE.Group {
  const hair = new THREE.Group();
  hair.add(new THREE.Mesh(BUZZCUT_GEOMETRY, HAIR_MATERIAL_BUZZCUT));
  return hair;
}

function buildCurlyHair(): THREE.Group {
  const hair = new THREE.Group();
  const layout: Array<[number, number, number]> = [
    [0, 0.15, 0], [0.1, 0.13, 0.02], [-0.1, 0.13, 0.02],
    [0.06, 0.14, -0.11], [-0.06, 0.14, -0.11], [0, 0.17, -0.06],
    [0.13, 0.1, -0.05], [-0.13, 0.1, -0.05]
  ];
  for (const [x, y, z] of layout) {
    const curl = new THREE.Mesh(CURL_GEOMETRY, HAIR_MATERIAL_CURLY);
    curl.position.set(x, y, z);
    hair.add(curl);
  }
  return hair;
}

// replaces the Task 3 stub `buildHair`
function buildHair(playerNumber: number): THREE.Group {
  const style = playerNumber % 4;
  if (style === 1) return buildPonytailHair();
  if (style === 2) return buildBuzzcutHair();
  if (style === 3) return buildCurlyHair();
  return buildSpikyHair();
}
```

- [ ] **Step 2: Expose `impactStrength`/`finished` reactivity properly and fix the Task-3 `finished` stub**

In `buildDriverCharacter`'s `update()`, the `input.impactStrength` parameter is currently ignored (Task 3's `character.update()` call site passes a placeholder `impactStrength: 0` and computes its own detection internally). Simplify: remove the internal `detectImpact`/`collisionCooldown` bookkeeping from `character.ts`'s `update()` (that duplicates work the renderer needs to do anyway for the squash/stretch trigger in Task 8 - doing it twice would let the two drift out of sync), and instead have the **renderer** compute `impactStrength` once per car per frame and pass it in directly, matching the spec's actual intent (4.5: "the renderer infers an impact"). Update `character.ts`:

```ts
  // remove: let previousSpeed / previousAcceleration / collisionCooldown local state and the detectImpact call inside update() -
  // the caller now computes and passes impactStrength directly.
  function update(input: DriverInput): void {
    const pose = resolveActivePose(input);
    if (pose !== currentPose) {
      currentPose = pose;
      poseBlend = 0;
    }
    poseBlend = clamp(poseBlend + input.deltaTime * POSE_LERP_SPEED, 0, 1);
    setFace(resolveFaceState(currentPose));

    const steerLean = clamp(input.steering * 0.6, -0.5, 0.5);
    const accelLean = clamp(-input.acceleration * 0.02, -0.2, 0.2);
    root.rotation.z = steerLean * 0.4;
    root.rotation.x = accelLean;

    if (currentPose === "airtime") {
      leftArm.rotation.z = 0.55;
      rightArm.rotation.z = -0.55;
      root.rotation.x += 0.15;
    } else if (currentPose === "drift") {
      leftArm.rotation.z = 0.3 + input.driftAmount * 0.15;
      rightArm.rotation.z = -0.3 - input.driftAmount * 0.15;
    } else if (currentPose === "collision") {
      leftArm.rotation.z = 0.15;
      rightArm.rotation.z = -0.15;
    } else if (currentPose === "celebration") {
      leftArm.rotation.z = 1.4;
      rightArm.rotation.z = -1.4;
      root.rotation.x = -0.1;
    } else {
      leftArm.rotation.z = 0.3;
      rightArm.rotation.z = -0.3;
    }
  }

  function reset(): void {
    poseBlend = 0;
    currentPose = "steering";
    setFace("neutral");
  }
```

Remove the now-unused `previousSpeed`/`previousAcceleration`/`collisionCooldown` variable declarations and the `detectImpact`/`DEFAULT_IMPACT_THRESHOLDS` import usage inside `buildDriverCharacter` (the exported `detectImpact` function itself stays in the module - the renderer calls it directly, see Step 3).

- [ ] **Step 3: Move impact detection to `renderer.ts` and complete the `DriverInput` call**

Add per-car impact-tracking state next to `previousCharacterSpeed`/`previousCharacterAcceleration` (from Task 3 Step 3):

```ts
  private readonly characterCollisionCooldown = new Map<number, number>();
```

Add to the `renderer.ts` import from `./character`:

```ts
import { computeAcceleration, computeDriftAmount, detectImpact, MAX_ACCELERATION, DEFAULT_IMPACT_THRESHOLDS } from "./character";
```

Replace the Task-3 `character.update()` call site with:

```ts
      const prevCharSpeed = this.previousCharacterSpeed.get(playerNumber) ?? pos.speed;
      const prevCharAccel = this.previousCharacterAcceleration.get(playerNumber) ?? 0;
      const frameDt = Math.max(1 / 1000, (_timestamp - this.lastFrameAt) / 1000);
      const acceleration = computeAcceleration(pos.speed, prevCharSpeed, prevCharAccel, frameDt, MAX_ACCELERATION);
      const cooldownRemaining = this.characterCollisionCooldown.get(playerNumber) ?? 0;
      const { isImpact, impactStrength } = detectImpact(pos.speed, prevCharSpeed, steering, cooldownRemaining, DEFAULT_IMPACT_THRESHOLDS);
      this.characterCollisionCooldown.set(playerNumber, isImpact ? 0.35 : Math.max(0, cooldownRemaining - frameDt));
      this.previousCharacterSpeed.set(playerNumber, pos.speed);
      this.previousCharacterAcceleration.set(playerNumber, acceleration);
      const driftAmount = computeDriftAmount(pos.headingError);
      const driverInput = {
        steering,
        speed: pos.speed,
        acceleration,
        driftAmount,
        impactStrength,
        airborne: pos.airborne ?? false,
        finished: this.finishedPlayers.has(playerNumber),
        deltaTime: frameDt
      };
      car.character.update(driverInput);
      if (car.importedCharacter) car.importedCharacter.update(driverInput);
```

(`car.importedCharacter` is introduced in Step 4 below - the imported GLTF car gets its own character instance, separate from the procedural fallback's, since both can exist simultaneously per the Task-3 Step 5 note.)

Also reset the new cooldown map in `resetInterpolation()` alongside the other per-car maps:

```ts
    this.characterCollisionCooldown.clear();
```

- [ ] **Step 4: Remove `buildDriverBust`, attach `character` to `ImportedCarVisual` (`assetScene.ts`)**

Delete the `buildDriverBust` function (lines 179-223) and its call site inside `buildImportedCarVisual` (`root.add(buildDriverBust(color));` at line 230). Add the import and interface field:

```ts
import { buildDriverCharacter } from "./character";
import type { DriverCharacter } from "./character";

export interface ImportedCarVisual {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  character: DriverCharacter;
}
```

`buildImportedCarVisual` needs a `playerNumber` to pick a hairstyle - change its signature to accept one:

```ts
export function buildImportedCarVisual(
  library: Pick<RacingAssetLibrary, "carScene">,
  color: string,
  playerNumber: number
): ImportedCarVisual {
  const root = cloneWithUniqueMaterials(library.carScene, color) as THREE.Group;
  root.name = "imported-arcade-car";
  root.scale.setScalar(CAR_SCALE);
  root.rotation.y = Math.PI;
  const character = buildDriverCharacter(playerNumber, color);
  character.root.scale.setScalar(1 / CAR_SCALE); // character is built in world-scale units; the imported root's own CAR_SCALE would otherwise blow it up
  character.root.position.set(0, 0.42 / CAR_SCALE, 0.05 / CAR_SCALE);
  root.add(character.root);
  const bounds = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  root.position.x = -center.x;
  root.position.z = -center.z;

  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === "wheelBackLeft" || object.name === "wheelBackRight") {
      wheels.push(object);
    } else if (object.name === "wheelFrontLeft" || object.name === "wheelFrontRight") {
      wheels.push(object);
      frontWheels.push(object);
    }
  });

  return { root, wheels, frontWheels, character };
}
```

- [ ] **Step 5: Wire the imported character into `renderer.ts` and hide the procedural one once the import lands**

Add `importedCharacter?: DriverCharacter` to `CarVisual` (`cars.ts`, alongside `importedRoot?`):

```ts
  importedRoot?: THREE.Group;
  importedCharacter?: DriverCharacter;
```

In `renderer.ts`'s `applyImportedCarVisual` (around line 797-808), pass `playerNumber` through and hide the procedural character once the import's own character is attached (mirroring the existing `car.body.visible = false` pattern):

```ts
  private applyImportedCarVisual(playerNumber: number, car: CarVisual): void {
    const carScene = this.assetLibrary?.carScene ?? this.carAssetScene;
    if (!carScene || car.importedRoot) return;
    const color = this.colors.get(playerNumber) ?? BOT_FALLBACK_COLORS[Math.abs(playerNumber) % BOT_FALLBACK_COLORS.length] ?? "#f97316";
    const imported = buildImportedCarVisual({ carScene }, color, playerNumber);
    imported.root.position.y = -0.2;
    car.body.visible = false;
    car.character.root.visible = false;
    car.root.add(imported.root);
    car.importedRoot = imported.root;
    car.importedCharacter = imported.character;
    car.wheels = imported.wheels;
    car.frontWheels = imported.frontWheels;
  }
```

Update the Step 3 call site's `if (car.importedCharacter) car.importedCharacter.update(driverInput);` guard to also skip updating the now-hidden procedural character once the import has landed, for a small render-cost saving (optional but consistent with "don't animate what's invisible"):

```ts
      if (!car.importedRoot) car.character.update(driverInput);
      else if (car.importedCharacter) car.importedCharacter.update(driverInput);
```

(Replaces the two-line Step-3 call with this either/or version.)

- [ ] **Step 6: Reset both characters on interpolation reset**

Update the Task-3 Step 4 loop in `resetInterpolation()`:

```ts
    for (const car of this.cars.values()) {
      car.character.reset();
      car.importedCharacter?.reset();
    }
```

- [ ] **Step 7: Typecheck and run existing tests**

Run: `npm run typecheck`
Run: `npm run test`
Expected: no errors; `interpolation.test.ts` and `character.test.ts` still pass unchanged (no protocol/pure-logic changes in this task).

- [ ] **Step 8: Manual verification**

```bash
npm run dev
```

Drive through countdown -> race -> a deliberate collision -> a drift -> a jump (airtime + landing) -> finish (matches spec §10's manual test sequence), confirming: all four hairstyles appear across bot cars (`playerNumber % 4`), the imported GLTF car's character is visible (not the procedural one hidden underneath it), and each pose transition (steering/drift/airtime/collision/celebration) visibly changes the character's arms/face.

- [ ] **Step 9: Commit**

```bash
git add client/src/games/racing/character.ts client/src/games/racing/cars.ts client/src/games/racing/assetScene.ts client/src/games/racing/renderer.ts
git commit -m "feat(racing): add remaining 3 hairstyles, wire full character reactivity into both car visuals"
```

---

### Task 5: Car silhouette redesign - procedural fallback

Spec §5. Introduces named scale-multiplier constants applied to the existing geometry/offset constants, rather than hand-editing each of the ~15 magic numbers independently - keeps every dependent offset (wings, endplates, struts, mirrors) moving together and correct by construction.

**Files:**
- Modify: `client/src/games/racing/cars.ts`

- [ ] **Step 1: Add silhouette scale constants and apply them to length-axis geometry/offsets**

At the top of `cars.ts`, after the existing material constants (after line 26), add:

```ts
// Silhouette redesign (Cycle 3 round 2, spec Section 5) - multipliers applied
// to the geometry/offset constants below so every dependent z-offset (wings,
// endplates, struts, mirrors) moves together with the tub/nose instead of
// ~15 magic numbers being hand-tuned independently and risking drift.
const LENGTH_SCALE = 0.8; // -20% nose-to-tail
const STANCE_SCALE = 1.18; // +18% wheel-to-wheel width
const WHEEL_SCALE = 1.35; // +35% wheel/rim radius
const NOSE_HEIGHT_SCALE = 0.7; // -30% nose ride height
const COCKPIT_SCALE = 1.22; // ~+49% cockpit-opening area (radius^2)
```

Apply `LENGTH_SCALE` to every geometry/position constant that drives car length (tub height, nose height+position, and every z-offset baked into the merged geometries). Update these existing lines:

```ts
const TUB_GEOMETRY = new THREE.CylinderGeometry(0.5, 0.66, 3.1 * LENGTH_SCALE, 8, 1);
const NOSE_GEOMETRY = new THREE.ConeGeometry(0.46, 1.7 * LENGTH_SCALE, 8);
const COCKPIT_GEOMETRY = new THREE.CylinderGeometry(0.4 * COCKPIT_SCALE, 0.5 * COCKPIT_SCALE, 0.62, 8);
const SIDEPOD_GEOMETRY = new THREE.CylinderGeometry(0.16, 0.24, 1.5 * LENGTH_SCALE, 6);
const WHEEL_GEOMETRY = new THREE.CylinderGeometry(0.44 * WHEEL_SCALE, 0.44 * WHEEL_SCALE, 0.32, 20);
const RIM_GEOMETRY = new THREE.CylinderGeometry(0.24 * WHEEL_SCALE, 0.24 * WHEEL_SCALE, 0.35, 16);
```

Increase radial segment counts on the faceted body geometry so the panel treatment reads as rounded rather than hard-edged (spec §5 "Panel treatment", explicitly superseding the Art Bible's hard-edge requirement - see Task 6):

```ts
const TUB_GEOMETRY = new THREE.CylinderGeometry(0.5, 0.66, 3.1 * LENGTH_SCALE, 16, 1);
const NOSE_GEOMETRY = new THREE.ConeGeometry(0.46, 1.7 * LENGTH_SCALE, 16);
const SIDEPOD_GEOMETRY = new THREE.CylinderGeometry(0.16, 0.24, 1.5 * LENGTH_SCALE, 12);
```
(radial segments 8->16 for tub/nose, 6->12 for sidepods; combined with the existing smooth per-vertex normals Three.js generates for `CylinderGeometry`/`ConeGeometry`, doubling the segment count is what actually removes the visible facets - no material/shading flag changes needed, since none of these materials currently set `flatShading`.)

Update `WHEEL_OFFSETS` (stance width on x, wheelbase on z, both length-axis-adjacent so both scale):

```ts
const WHEEL_OFFSETS: Array<[number, number]> = [
  [1.18 * STANCE_SCALE, 1.0 * LENGTH_SCALE],
  [-1.18 * STANCE_SCALE, 1.0 * LENGTH_SCALE],
  [1.18 * STANCE_SCALE, -1.15 * LENGTH_SCALE],
  [-1.18 * STANCE_SCALE, -1.15 * LENGTH_SCALE]
];
```

- [ ] **Step 2: Scale every z-offset in the merged-geometry bake calls**

In `CARBON_MERGED_GEOMETRY`'s bake list (lines 106-120 currently), multiply every z position component by `LENGTH_SCALE` (x/y stay as-is except where noted):

```ts
const CARBON_MERGED_GEOMETRY = mergeGeometries([
  bake(COCKPIT_GEOMETRY, { position: [0, 0.92, -0.35 * LENGTH_SCALE], rotation: [Math.PI / 2, 0, 0] }),
  bake(HALO_GEOMETRY, { position: [0, 1.08, -0.28 * LENGTH_SCALE], rotation: [Math.PI / 2, 0, Math.PI * 0.82] }),
  bake(new THREE.BoxGeometry(0.06, 0.36, 0.06), { position: [0, 0.92, -0.72 * LENGTH_SCALE] }),
  bake(MIRROR_ARM_GEOMETRY, { position: [-0.72 * STANCE_SCALE, 0.98, -0.7 * LENGTH_SCALE], rotation: [0, 0.28, 0] }),
  bake(MIRROR_ARM_GEOMETRY, { position: [0.72 * STANCE_SCALE, 0.98, -0.7 * LENGTH_SCALE], rotation: [0, -0.28, 0] }),
  bake(FRONT_WING_GEOMETRY, { position: [0, 0.32, -2.85 * LENGTH_SCALE] }),
  bake(FRONT_ENDPLATE_GEOMETRY, { position: [-1.78 * STANCE_SCALE, 0.38, -2.85 * LENGTH_SCALE] }),
  bake(FRONT_ENDPLATE_GEOMETRY, { position: [1.78 * STANCE_SCALE, 0.38, -2.85 * LENGTH_SCALE] }),
  bake(REAR_WING_GEOMETRY, { position: [0, 1.14, 1.78 * LENGTH_SCALE] }),
  bake(REAR_ENDPLATE_GEOMETRY, { position: [-1.28 * STANCE_SCALE, 1.1, 1.78 * LENGTH_SCALE] }),
  bake(REAR_ENDPLATE_GEOMETRY, { position: [1.28 * STANCE_SCALE, 1.1, 1.78 * LENGTH_SCALE] }),
  bake(REAR_STRUT_GEOMETRY, { position: [0, 0.76, 1.68 * LENGTH_SCALE] }),
  ...WHEEL_OFFSETS.map(([x, z]) => bake(TIRE_GROOVE_GEOMETRY, { position: [x, 0.44, z], rotation: [0, Math.PI / 2, 0] }))
]);

const ACCENT_MERGED_GEOMETRY = mergeGeometries([
  bake(CHARACTER_LINE_GEOMETRY, { position: [0.51 * STANCE_SCALE, 0.62, -0.85 * LENGTH_SCALE] }),
  bake(CHARACTER_LINE_GEOMETRY, { position: [-0.51 * STANCE_SCALE, 0.62, -0.85 * LENGTH_SCALE] }),
  bake(CHARACTER_LINE_GEOMETRY, { position: [0.51 * STANCE_SCALE, 0.62, 1.15 * LENGTH_SCALE] }),
  bake(CHARACTER_LINE_GEOMETRY, { position: [-0.51 * STANCE_SCALE, 0.62, 1.15 * LENGTH_SCALE] }),
  bake(FRONT_WING_ACCENT_GEOMETRY, { position: [0, 0.42, -3.04 * LENGTH_SCALE] }),
  bake(REAR_WING_ACCENT_GEOMETRY, { position: [0, 1.28, 1.54 * LENGTH_SCALE] })
]);

const MIRROR_MERGED_GEOMETRY = mergeGeometries([
  bake(MIRROR_GEOMETRY, { position: [-0.72 * 1.18 * STANCE_SCALE, 1, -0.78 * LENGTH_SCALE], rotation: [0, 0.28, 0] }),
  bake(MIRROR_GEOMETRY, { position: [0.72 * 1.18 * STANCE_SCALE, 1, -0.78 * LENGTH_SCALE], rotation: [0, -0.28, 0] })
]);

const HEADLIGHT_MERGED_GEOMETRY = mergeGeometries([
  bake(HEADLIGHT_GEOMETRY, { position: [-0.32 * STANCE_SCALE, 0.5, -2.88 * LENGTH_SCALE] }),
  bake(HEADLIGHT_GEOMETRY, { position: [0.32 * STANCE_SCALE, 0.5, -2.88 * LENGTH_SCALE] })
]);
```

`RIM_MERGED_GEOMETRY` already derives its positions from `WHEEL_OFFSETS` (already scaled in Step 1), so it needs no direct edit - only its `RIM_SPOKE_GEOMETRY` bakes stay geometrically unscaled (spokes rotate around the already-scaled rim center, unaffected by the parent offset's magnitude).

- [ ] **Step 3: Apply length/nose-height scaling inside `buildCarMesh` itself**

In `buildCarMesh` (around lines 213-218), scale the paint-merged geometry's z-offsets and the nose's y-position (ride height):

```ts
  const paintMergedGeometry = mergeGeometries([
    bake(TUB_GEOMETRY, { position: [0, 0.56, 0.15 * LENGTH_SCALE], rotation: [Math.PI / 2, 0, 0], scale: [1, 0.56, 1] }),
    bake(NOSE_GEOMETRY, { position: [0, 0.42 * NOSE_HEIGHT_SCALE, -2.05 * LENGTH_SCALE], rotation: [-Math.PI / 2, 0, 0], scale: [0.86, 1, 0.62] }),
    bake(SIDEPOD_GEOMETRY, { position: [-0.62 * STANCE_SCALE, 0.44, 0.35 * LENGTH_SCALE], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 0.85] }),
    bake(SIDEPOD_GEOMETRY, { position: [0.62 * STANCE_SCALE, 0.44, 0.35 * LENGTH_SCALE], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 0.85] })
  ]);
```

Also update the character's cockpit seat position from Task 3 Step 2 (`character.root.position.set(0, 0.78, -0.4)`) to move with the now-shorter nose: `character.root.position.set(0, 0.78, -0.4 * LENGTH_SCALE)`.

The `brakeLight`, `speedTrail`, `underglow`, `shadow`, and `marker` world positions/scales (lines 271-315) reference the rear of the car (`z: 1.72`, `z: 3.6`) and stay proportionally correct without edits **only** if scaled too - update their z-positions by `LENGTH_SCALE` as well for consistency:

```ts
  brakeLight.position.set(0, 0.74, 1.72 * LENGTH_SCALE);
  ...
  speedTrail.position.set(0, 0.08, 3.6 * LENGTH_SCALE);
```

- [ ] **Step 4: Typecheck and run tests**

Run: `npm run typecheck`
Run: `npm run test`
Expected: no errors; no existing test references these geometry constants by value, so nothing should break.

- [ ] **Step 5: Manual visual verification**

```bash
npm run dev
```

Screenshot the procedural fallback car (force it via `?quality=low` and blocking the GLTF network request, or by temporarily commenting out the `loadRacingCarScene()` call - revert before committing) at the same chase-camera position as Task 3's de-risking screenshot. Confirm visually: noticeably shorter/stubbier body, wider stance with wheels clearly protruding further, chunkier wheels, lower nose, no visible hard facets on the tub/nose. Save as `artifacts/racing-quality-pass/silhouette-procedural.png`.

- [ ] **Step 6: Commit**

```bash
git add client/src/games/racing/cars.ts artifacts/racing-quality-pass/silhouette-procedural.png
git commit -m "feat(racing): exaggerate procedural car silhouette (length/stance/wheels/nose/cockpit)"
```

---

### Task 6: Car silhouette redesign - imported GLTF car investigation

Spec §5, §12 (open question). The GLTF model's actual node structure is unknown until inspected - this task's first step is that investigation, and its outcome determines which of the two remaining steps applies.

**Files:**
- Modify: `client/src/games/racing/assetScene.ts`
- Modify: `client/src/games/racing/renderer.ts` (only if the fallback-promotion branch is taken)

- [ ] **Step 1: Inspect the loaded GLTF node structure**

```bash
npm run dev
```

With `?dev=1` in the host URL, open the browser console and run (or add a temporary one-line `console.log` in `assetScene.ts`'s `prepareScene()` before committing anything):

```ts
scene.traverse((object) => console.log(object.name, object.type));
```

Record the full node list. Look specifically for separate, named nodes for: front/rear wing, nose, wheels (already known: `wheelFrontLeft/Right`, `wheelBackLeft/Right` per the existing `buildImportedCarVisual` traversal), and the cockpit/body shell.

- [ ] **Step 2a (if separable nodes exist): apply the Task 5 deltas via node-level transforms**

For each separable node identified in Step 1 that corresponds to a Task 5 dimension (nose, wheels, cockpit/body), apply the same `LENGTH_SCALE`/`STANCE_SCALE`/`WHEEL_SCALE`/`NOSE_HEIGHT_SCALE` constants from `cars.ts` - export them from `cars.ts` instead of duplicating the literals:

```ts
// cars.ts - export the constants added in Task 5 Step 1
export const LENGTH_SCALE = 0.8;
export const STANCE_SCALE = 1.18;
export const WHEEL_SCALE = 1.35;
export const NOSE_HEIGHT_SCALE = 0.7;
```

```ts
// assetScene.ts - import and apply inside cloneWithUniqueMaterials or a new
// post-processing step in buildImportedCarVisual, targeting the exact node
// names recorded in Step 1 (this is illustrative; substitute the real names).
import { LENGTH_SCALE, STANCE_SCALE, WHEEL_SCALE, NOSE_HEIGHT_SCALE } from "./cars";

function applySilhouetteDeltas(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (/wheel/i.test(object.name)) {
      object.scale.multiplyScalar(WHEEL_SCALE);
      object.position.x *= STANCE_SCALE;
    }
    if (/nose/i.test(object.name)) {
      object.position.y *= NOSE_HEIGHT_SCALE;
      object.scale.z *= LENGTH_SCALE;
    }
  });
}
```

Call `applySilhouetteDeltas(root)` inside `buildImportedCarVisual` right after `cloneWithUniqueMaterials`. Skip to Step 3.

- [ ] **Step 2b (if the model has no separable nose/cockpit geometry): promote the procedural car to primary**

Per spec §5's explicit fallback clause, if Step 1 shows the wing/nose silhouette is monolithic (baked into one body mesh with no separate node to rescale), the measurable proportions take priority over keeping the GLTF as primary. In `renderer.ts`'s `mount()` and `ensureCarVisual()`, stop calling `applyImportedCarVisual`/the `loadRacingCarScene()`/`loadRacingAssetLibrary()` car-scene branch (leave stadium-prop loading untouched - only the car itself is affected):

```ts
// renderer.ts mount() - remove or guard out the loadRacingCarScene().then(...) block's
// applyImportedCarVisual calls for car visuals specifically, e.g.:
    loadRacingCarScene()
      .then((carScene) => {
        if (this.assetLoadCancelled || this.scene !== scene) return;
        this.carAssetScene = carScene;
        // Cycle 3 round 2 (spec Section 5): the Kenney GLTF car has no
        // separable nose/cockpit nodes (confirmed via the Step 1 node dump),
        // so it can't reach the required silhouette proportions - the
        // procedural car (cars.ts) stays primary instead of being replaced
        // once this loads. assetLoadState still reports "ready" so the
        // "Loading car model..." HUD banner clears normally.
        this.assetLoadState = "ready";
      })
      .catch((err: unknown) => {
        if (this.assetLoadCancelled || this.scene !== scene) return;
        this.assetLoadState = "fallback";
        if (DEV_MODE) console.warn("Racing car asset load failed; using procedural fallback", err);
      });
```

and remove the `for (const [playerNumber, car] of this.cars) { this.applyImportedCarVisual(playerNumber, car); }` calls tied to the car-scene promise specifically (the stadium-props promise's own `applyImportedCarVisual` calls, if any remain relevant to props rather than the car body, stay - re-check against the actual code before deleting, since `applyImportedCarVisual` currently reads `this.assetLibrary?.carScene ?? this.carAssetScene` and is called from both promise handlers).

- [ ] **Step 3: Typecheck, test, and visually verify**

Run: `npm run typecheck`
Run: `npm run test`

```bash
npm run dev
```

Screenshot the primary (post-decision) car visual at the same chase-camera position as Task 5 Step 5. Confirm it meets the same qualitative bar: shorter, wider, chunkier wheels, lower nose. Save as `artifacts/racing-quality-pass/silhouette-primary.png`.

- [ ] **Step 4: Commit**

```bash
git add client/src/games/racing/assetScene.ts client/src/games/racing/cars.ts client/src/games/racing/renderer.ts artifacts/racing-quality-pass/silhouette-primary.png
git commit -m "feat(racing): apply exaggerated silhouette to the primary car visual (GLTF node scaling or procedural promotion)"
```

---

### Task 7: Camera composition retune

Spec §6.2. Fixes a real inconsistency found while reading the code: the module-level `CAMERA_LOOK_AHEAD` constant (used only to derive `CAMERA_MIN_DISTANCE`) and the chase camera's actual per-frame look-ahead value (hardcoded separately as `lookAhead: 2.2` inside `cameraConfig()`) have silently drifted apart. This task unifies them.

**Files:**
- Modify: `client/src/games/racing/renderer.ts`

- [ ] **Step 1: Retune the camera constants and fix the stale comment**

Replace lines 35-42:

```ts
// Cycle 3 round 2 (spec Section 6.2): pulled closer/lower than the previous
// 17/5.8/3.4 so the redesigned kart and driver (Sections 4-5) actually read
// as bigger and closer through the camera players use, not just in
// close-up screenshots. Within the range validated by `1a19223` (13.5/5.4
// after that commit fixed a camera-position sign bug, not a "closeness"
// problem) - not a return to a known-bad configuration. CAMERA_LOOK_AHEAD
// is also now the single source of truth for the chase look-ahead value
// (previously duplicated as a separate hardcoded `2.2` inside
// cameraConfig()'s default branch, which had silently drifted out of sync
// with this constant - see the default branch below).
const CAMERA_DISTANCE = 13;
const CAMERA_HEIGHT = 4.8;
const CAMERA_LOOK_AHEAD = 6;
```

- [ ] **Step 2: Remove the duplicate hardcoded look-ahead in `cameraConfig()`**

In `cameraConfig()`'s default (chase) return object (currently lines 717-727), change `lookAhead: 2.2` to reference the constant:

```ts
    return {
      distance: CAMERA_DISTANCE,
      height: CAMERA_HEIGHT,
      lookHeight: 1.1,
      lookAhead: CAMERA_LOOK_AHEAD,
      fov: 60,
      damping: 0.32,
      spectator: false,
      avoidScenery: false,
      avoidCars: false
    };
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. `CAMERA_MIN_DISTANCE = CAMERA_LOOK_AHEAD + 5.5` (line 53, unedited) automatically recomputes to `11.5`, still correctly below the new `CAMERA_DISTANCE` of `13`.

- [ ] **Step 4: Manual verification against the two guardrails from spec §6.2**

```bash
npm run dev
```

Drive a lap in chase mode and confirm both:
1. **No near-top-down regression:** the camera stays behind and above the car (never appears to be looking back at it from in front) - this would indicate the `target - forward*distance` vs `target + forward*distance` sign is still correct (unedited by this task, but worth confirming nothing else regressed it).
2. **Road visibility:** enough road ahead is visible to react to upcoming corners/jumps, not just the car filling the frame.

Also confirm the closer framing shows through the elevation-aware camera during a jump (Cycle 4 behavior) without any new position jitter (no shake regression).

Capture a screenshot at the same starting-grid position used in Tasks 3/5/6 and save as `artifacts/racing-quality-pass/camera-retune.png` for a quick visual diff against the earlier screenshots.

- [ ] **Step 5: Commit**

```bash
git add client/src/games/racing/renderer.ts artifacts/racing-quality-pass/camera-retune.png
git commit -m "feat(racing): retune chase camera closer/lower, unify duplicated look-ahead constant"
```

---

### Task 8: Squash/stretch, drift smoke/streaks, jump takeoff effect

Spec §6.1.

**Files:**
- Modify: `client/src/games/racing/effects.ts`
- Modify: `client/src/games/racing/cars.ts` (export the presentation scale constant)
- Modify: `client/src/games/racing/renderer.ts` (wire squash/stretch onto `car.root.scale`, call the new effect triggers)

- [ ] **Step 1: Export the car's presentation scale from `cars.ts`**

`buildCarMesh` currently ends with `group.scale.setScalar(1.7)` (a bare literal). Export it as a named constant so `renderer.ts` can compute squash/stretch multipliers against the real base scale instead of duplicating the literal:

```ts
// cars.ts, near the other exported constants
export const CAR_PRESENTATION_SCALE = 1.7;
```

Update the `buildCarMesh` body: `group.scale.setScalar(CAR_PRESENTATION_SCALE);`

- [ ] **Step 2: Add `spawnDriftSmoke` and `triggerJumpTakeoff` to `effects.ts`, reusing the existing burst pool**

```ts
// effects.ts - add alongside the existing spawnDust/triggerFinishBurst/triggerStartBurst methods

  /** Spec 6.1: drift smoke/streaks, reusing the same vertex-colored burst pool as the confetti bursts (no new InstancedMesh/material) - a low, ground-hugging spawn pattern distinguishes it from the finish/start bursts' upward pop. Call at most a few times per second per car; caller (renderer.ts) throttles via driftAmount-gated spawn rate the same way spawnSkid is already throttled by distance. */
  spawnDriftSmoke(x: number, z: number, intensity: number): void {
    const count = Math.min(2, Math.round(intensity * 2));
    let spawned = 0;
    for (const slot of this.burstParticles) {
      if (spawned >= count) return;
      if (slot.active) continue;
      slot.active = true;
      slot.x = x + (Math.random() - 0.5) * 0.8;
      slot.y = 0.15 + Math.random() * 0.2;
      slot.z = z + (Math.random() - 0.5) * 0.8;
      slot.vx = (Math.random() - 0.5) * 0.6;
      slot.vy = 0.4 + Math.random() * 0.5;
      slot.vz = (Math.random() - 0.5) * 0.6;
      slot.maxLife = 0.4 + Math.random() * 0.25;
      slot.life = slot.maxLife;
      slot.scale = 0.35 + Math.random() * 0.25;
      spawned += 1;
    }
  }

  /** Spec 6.1: a brief upward puff at the rising edge of `airborne`, distinct from the falling-edge squash/stretch + impact effect - tighter, shorter-lived, more vertical than triggerStartBurst so takeoff and landing each read as their own beat. */
  triggerJumpTakeoff(x: number, y: number, z: number): void {
    let spawned = 0;
    for (const slot of this.burstParticles) {
      if (slot.active) continue;
      slot.active = true;
      slot.x = x + (Math.random() - 0.5) * 1.2;
      slot.y = y + 0.2;
      slot.z = z + (Math.random() - 0.5) * 1.2;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 1;
      slot.vx = Math.cos(angle) * speed;
      slot.vy = 1.5 + Math.random() * 1.2;
      slot.vz = Math.sin(angle) * speed;
      slot.maxLife = 0.35 + Math.random() * 0.2;
      slot.life = slot.maxLife;
      slot.scale = 0.4 + Math.random() * 0.25;
      spawned += 1;
      if (spawned >= 10) return;
    }
  }
```

- [ ] **Step 3: Wire squash/stretch, drift smoke, and jump takeoff into `renderer.ts`**

Add per-car squash/stretch and takeoff-tracking state next to the Task 4 maps:

```ts
  private readonly squashStretchStrength = new Map<number, number>();
  private readonly wasAirborne = new Map<number, boolean>();
  private readonly driftSmokeCooldown = new Map<number, number>();
```

Immediately after the `car.character.update(...)`/`car.importedCharacter.update(...)` call added in Task 4 Step 5, add:

```ts
      // Jump takeoff / landing squash-stretch (spec 6.1): rising edge of
      // airborne triggers a takeoff puff; falling edge triggers the
      // squash/stretch scale animation, scaled by the same impactStrength
      // signal driving the character's collision reaction (spec 6, "the
      // primary trigger is landing from a ramp jump").
      const nowAirborne = pos.airborne ?? false;
      const wasAirborneBefore = this.wasAirborne.get(playerNumber) ?? false;
      if (nowAirborne && !wasAirborneBefore) {
        this.effects?.triggerJumpTakeoff(x, y, z);
      }
      if (!nowAirborne && wasAirborneBefore && impactStrength > 0) {
        this.squashStretchStrength.set(playerNumber, impactStrength);
      }
      this.wasAirborne.set(playerNumber, nowAirborne);

      const currentSquash = this.squashStretchStrength.get(playerNumber) ?? 0;
      if (currentSquash > 0.001) {
        const decayed = currentSquash * 0.82; // ~150ms-scale decay at 60fps, matching the spec's ~150ms squash/stretch duration
        this.squashStretchStrength.set(playerNumber, decayed < 0.02 ? 0 : decayed);
        const squashAmount = currentSquash * 0.22;
        car.root.scale.set(
          CAR_PRESENTATION_SCALE * (1 + squashAmount),
          CAR_PRESENTATION_SCALE * (1 - squashAmount),
          CAR_PRESENTATION_SCALE * (1 + squashAmount)
        );
      } else {
        car.root.scale.setScalar(CAR_PRESENTATION_SCALE);
      }

      // Drift smoke (spec 6.1), throttled to a few spawns per second per car
      // the same way the existing skid-mark spawn is distance-throttled.
      const driftCooldown = this.driftSmokeCooldown.get(playerNumber) ?? 0;
      if (driftAmount > 0 && driftCooldown <= 0) {
        this.effects?.spawnDriftSmoke(x, z, driftAmount);
        this.driftSmokeCooldown.set(playerNumber, 0.08);
      } else {
        this.driftSmokeCooldown.set(playerNumber, Math.max(0, driftCooldown - frameDt));
      }
```

Also trigger the collision-only case (impact while grounded, not from a landing) - the existing `impactStrength > 0` check above only fires on the *falling edge of airborne*; grounded collisions (barrier/car-car contact) should trigger the same squash/stretch too, per spec 6.1's "triggered by the same impactStrength signal the character uses" (not landing-only). Broaden the trigger condition:

```ts
      if (impactStrength > 0 && (!nowAirborne || (!wasAirborneBefore && !nowAirborne))) {
        // Fires for grounded collisions. The landing case above already
        // covers the falling-edge-of-airborne path; this covers plain
        // barrier/car-car impacts while never airborne.
      }
```

Replace the two separate conditionals above with one combined check, since both paths set the same state:

```ts
      const nowAirborne = pos.airborne ?? false;
      const wasAirborneBefore = this.wasAirborne.get(playerNumber) ?? false;
      if (nowAirborne && !wasAirborneBefore) {
        this.effects?.triggerJumpTakeoff(x, y, z);
      }
      if (impactStrength > 0) {
        this.squashStretchStrength.set(playerNumber, impactStrength);
      }
      this.wasAirborne.set(playerNumber, nowAirborne);
```

(This replaces the earlier `if (!nowAirborne && wasAirborneBefore && impactStrength > 0)` block - `impactStrength` from `detectImpact` is already only nonzero when `detectImpact`'s own guards pass, which naturally covers both the landing case, since a hard landing produces a large `speedDrop`, and plain grounded collisions.)

Import `CAR_PRESENTATION_SCALE` from `cars.ts` at the top of `renderer.ts`:

```ts
import { buildCarMesh, CAR_PRESENTATION_SCALE } from "./cars";
```

Reset the three new maps in `resetInterpolation()`:

```ts
    this.squashStretchStrength.clear();
    this.wasAirborne.clear();
    this.driftSmokeCooldown.clear();
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck`
Run: `npm run test`

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Drive through a jump and a deliberate collision. Confirm: a brief upward puff at takeoff, a visible squash (car flattens/widens briefly) on hard landing and on collision, drift smoke appears while cornering hard, and none of this reintroduces camera shake (the car mesh scales, the camera position code from Task 7 is untouched).

- [ ] **Step 6: Commit**

```bash
git add client/src/games/racing/cars.ts client/src/games/racing/effects.ts client/src/games/racing/renderer.ts
git commit -m "feat(racing): add squash/stretch, drift smoke, and jump-takeoff effects"
```

---

### Task 9: Audio additions

Spec §8.

**Files:**
- Modify: `client/src/games/racing/audio.ts`
- Modify: `client/src/games/racing/renderer.ts` (trigger `playCollisionBoing()` from the same impact signal)

- [ ] **Step 1: Add `playCollisionBoing()` and extend `playFinish()`**

```ts
// audio.ts - add near the other play*/blip methods

  /** A short, bouncy pitch-drop blip on the same impact detection driving the character's startled reaction and the car's squash-and-stretch (spec 8). */
  playCollisionBoing(): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const osc = context.createOscillator();
    osc.type = "sine";
    const now = context.currentTime;
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.16);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.2);
  }
```

Extend the existing `playFinish()` (currently a two-note `660 -> 880` arpeggio) with a third, more cheerful note:

```ts
  playFinish(): void {
    this.blip(660, 0.14, 0.06, "triangle");
    window.setTimeout(() => this.blip(880, 0.22, 0.065, "triangle"), 130);
    window.setTimeout(() => this.blip(1174.66, 0.3, 0.055, "triangle"), 260);
  }
```

- [ ] **Step 2: Trigger `playCollisionBoing()` from the renderer's impact signal**

`renderer.ts` doesn't hold a `RacingAudio` instance - it's owned by `client/src/pages/hostLobby.ts`, which constructs `const racingAudio = new RacingAudio();` (line 107) and already calls `racingAudio.playFinish()` from a state-transition poll (line 659: `if (payload.raceStatus === "finished" && lastRaceStatus !== "finished") racingAudio.playFinish();`). Collision detection is per-frame client-derived state that only exists inside `renderer.ts`'s render loop (Task 8's `detectImpact` call), so `hostLobby.ts` can't replicate the same "poll the network payload" pattern for it - it needs a callback out of the renderer instead.

Add an optional constructor callback to `RacingRenderer` (`renderer.ts`):

```ts
  private readonly onImpact?: (playerNumber: number, strength: number) => void;

  constructor(room: PublicRoomState, onImpact?: (playerNumber: number, strength: number) => void) {
    for (const player of room.players) this.colors.set(player.playerNumber, distinctCarColor(player.color));
    this.onImpact = onImpact;
  }
```

Invoke it inside the per-car loop right where Task 8 Step 3 sets `this.squashStretchStrength.set(playerNumber, impactStrength);`:

```ts
      if (impactStrength > 0) {
        this.squashStretchStrength.set(playerNumber, impactStrength);
        this.onImpact?.(playerNumber, impactStrength);
      }
```

Wire it at the construction site in `hostLobby.ts` (line 214), passing a closure over the already-in-scope `racingAudio`:

```ts
        const racingRenderer = new LoadedRacingRenderer(room, () => racingAudio.playCollisionBoing());
```

(The callback ignores its `playerNumber`/`strength` arguments deliberately - `playCollisionBoing()` has no per-strength variation in this task, matching `playFinish()`'s own no-argument call pattern at line 659. A future cycle could thread `strength` through to vary pitch/volume if desired, but that's not required by spec §8.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

Trigger a collision and confirm the boing plays; finish a race and confirm the extended 3-note arpeggio plays.

- [ ] **Step 5: Commit**

```bash
git add client/src/games/racing/audio.ts client/src/games/racing/renderer.ts
git commit -m "feat(racing): add collision boing SFX, extend finish arpeggio to 3 notes"
```

---

### Task 10: HUD redesign

Spec §7.

**Files:**
- Modify: `client/src/styles/components.css`
- Modify: `client/src/pages/hostLobby.ts`

- [ ] **Step 1: Fix the leaderboard-row radius and add rank-badge styles to `components.css`**

Change `.racing-leaderboard-row`'s `border-radius: 6px` (line 442) to `18px`, matching `.race-hud-panel`. Add new styles after the existing `.race-position` rule (line 379-384):

```css
.race-rank-badge {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.race-rank-badge .race-rank-circle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  background: var(--player-color, #22d3ee);
  color: #05070f;
  font-weight: 800;
  font-size: 0.85rem;
  flex-shrink: 0;
  transition: transform 0.18s ease;
}
.race-rank-badge.rank-changed .race-rank-circle {
  transform: scale(1.25);
}
.race-rank-badge .race-rank-total {
  font-size: 0.72rem;
  color: #94a3b8;
  font-weight: 700;
}
.race-drift-meter {
  margin-top: 0.3rem;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.race-drift-meter-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #fb923c, #f472b6);
  transition: width 0.08s linear;
}
```

Restyle the speedometer numerals for a bolder, more arcade look (replace the existing `.race-speedometer strong` rule, line 494-498):

```css
.race-speedometer strong {
  display: block;
  font-size: 1.7rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 0.9;
}
```

Reduce the leaderboard panel's footprint slightly (`.race-hud-leaderboard`, line 373-378):

```css
.race-hud-leaderboard {
  top: 0.5rem;
  left: 0.5rem;
  width: min(104px, calc(100% - 1rem));
  padding: 0.28rem 0.38rem;
}
```

- [ ] **Step 2: Replace the plain rank text with the badge, add the drift meter (`hostLobby.ts`)**

Replace the existing `position` element construction (currently lines 317-319: `const position = document.createElement("p"); position.className = "race-position"; position.textContent = ...`):

```ts
    const position = document.createElement("div");
    position.className = "race-rank-badge";
    const rankCircle = document.createElement("span");
    rankCircle.className = "race-rank-circle";
    rankCircle.style.setProperty("--player-color", color);
    rankCircle.textContent = String(focused.rank);
    const rankTotal = document.createElement("span");
    rankTotal.className = "race-rank-total";
    rankTotal.textContent = `/ ${ranked.length}`;
    position.append(rankCircle, rankTotal);
    if (previousFocusedRank !== null && previousFocusedRank !== focused.rank) {
      position.classList.add("rank-changed");
      window.setTimeout(() => position.classList.remove("rank-changed"), 220);
    }
    previousFocusedRank = focused.rank;
```

This needs a module-level `previousFocusedRank` variable (mirroring the existing `focusedRacingPlayer` module-level variable already in this file) to detect rank changes across HUD rebuilds - add near the top of `hostLobby.ts` alongside the existing `let focusedRacingPlayer: number | null = null;`:

```ts
let previousFocusedRank: number | null = null;
```

Add a drift-feedback element after the speedometer block (after the existing `hud.appendChild(speed);` at line 393), reusing the same `computeDriftAmount` formula `character.ts` already exports rather than duplicating it:

```ts
    const driftMeter = document.createElement("div");
    driftMeter.className = "race-hud-panel race-drift-meter";
    driftMeter.style.position = "absolute";
    driftMeter.style.right = "0.55rem";
    driftMeter.style.bottom = "0.2rem";
    driftMeter.style.width = "92px";
    const driftFill = document.createElement("div");
    driftFill.className = "race-drift-meter-fill";
    driftFill.style.width = `${computeDriftAmount(focused.headingError) * 100}%`;
    driftMeter.appendChild(driftFill);
    hud.appendChild(driftMeter);
```

Add the import at the top of `hostLobby.ts`:

```ts
import { computeDriftAmount } from "../games/racing/character";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

Confirm: rank shows as a colored circle badge that briefly scales up when the focused car's rank changes, the leaderboard-row corners now match the 18px radius elsewhere, the speedometer number reads bolder, and a drift meter fills while cornering hard.

- [ ] **Step 5: Commit**

```bash
git add client/src/styles/components.css client/src/pages/hostLobby.ts
git commit -m "feat(racing): structural HUD pass - rank badge, drift meter, bolder speedometer, radius fix"
```

---

### Task 11: Performance regression verification

Spec §9.

**Files:**
- Create: `artifacts/racing-quality-pass/cycle3-perf-check.mjs` (adapted from the existing `artifacts/racing-quality-pass/perf-single.mjs` pattern already in this directory)

- [ ] **Step 1: Capture the pre-cycle baseline**

```bash
git stash
npm run dev
```

In another terminal, adapt `artifacts/racing-quality-pass/perf-single.mjs` (same host/phone Playwright setup, `?dev=1&quality=<preset>` URL params, reading `.racing-metrics-overlay` text) into a loop over `["low", "medium", "high"]`, each running for the same duration with 8 bot cars filling the grid, and log the parsed `Frame`/`P95` values from the overlay text. Save the output as `artifacts/racing-quality-pass/cycle3-perf-baseline.log`. Then:

```bash
git stash pop
```

- [ ] **Step 2: Capture post-cycle numbers with the same script**

```bash
npm run dev
```

Re-run the same script (now against the branch with all of Tasks 1-10 applied) and save as `artifacts/racing-quality-pass/cycle3-perf-after.log`.

- [ ] **Step 3: Compare against the spec's gate**

Per spec §9: average frame time must stay within `FRAME_BUDGET_MS` (`1000/55 ≈ 18.2ms`) at Medium and above. Compare the `after` log's Medium/High average-frame-time lines against this budget and against the `baseline` log's numbers.

If the budget is exceeded at Medium or High: per spec §9, gate the newly-added cosmetic elements first (hair-flutter wobble is out of scope for this plan's starter character rig, so start with drift-smoke/jump-takeoff particle counts and the character's per-frame pose-blend cost) behind the existing `quality.ts` preset tiers before touching the character/silhouette/camera work itself. This would be a follow-up task if triggered - not pre-written here per the spec's own "if it doesn't [pass], gate X" conditional, which can't be resolved without the actual measurement.

- [ ] **Step 4: Commit the perf script and logs**

```bash
git add artifacts/racing-quality-pass/cycle3-perf-check.mjs artifacts/racing-quality-pass/cycle3-perf-baseline.log artifacts/racing-quality-pass/cycle3-perf-after.log
git commit -m "test(racing): capture Cycle 3 before/after frame-time regression check"
```

---

### Task 12: Acceptance-gate screenshots and Art Bible update

Spec §10 (acceptance bar), §5 (Art Bible supersession note).

**Files:**
- Create: `artifacts/racing-quality-pass/cycle3-visual/before-after-capture.mjs`
- Modify: `docs/superpowers/specs/2026-07-12-harbor-city-gp-art-bible.md`

- [ ] **Step 1: Write the acceptance screenshot script**

Adapted from the existing `artifacts/racing-quality-pass/before-after-compare.mjs` (which already captures a "before" build on port 3001 and an "after" build on port 3000 at matched input sequences) - extend its single straight/corner capture into the five fixed positions spec §10 requires:

```js
// artifacts/racing-quality-pass/cycle3-visual/before-after-capture.mjs
import { chromium } from "@playwright/test";

async function installMotion(context) {
  await context.addInitScript(() => {
    let alpha = 0, beta = 0, gamma = 0;
    class FakeDeviceOrientationEvent extends Event {
      static async requestPermission() { return "granted"; }
      constructor(type, init = {}) {
        super(type);
        this.alpha = init.alpha ?? alpha;
        this.beta = init.beta ?? beta;
        this.gamma = init.gamma ?? gamma;
      }
    }
    class FakeDeviceMotionEvent extends Event { static async requestPermission() { return "granted"; } }
    Object.defineProperty(window, "DeviceOrientationEvent", { value: FakeDeviceOrientationEvent, configurable: true });
    Object.defineProperty(window, "DeviceMotionEvent", { value: FakeDeviceMotionEvent, configurable: true });
    Object.defineProperty(screen, "orientation", { value: { angle: 90, type: "landscape-primary" }, configurable: true });
    window.__setMotion = (nextBeta, nextGamma, nextAlpha = 0) => {
      beta = nextBeta; gamma = nextGamma; alpha = nextAlpha;
      window.dispatchEvent(new FakeDeviceOrientationEvent("deviceorientation", { beta, gamma, alpha }));
    };
  });
}

async function holdMotion(phone, beta, gamma, durationMs) {
  const steps = Math.ceil(durationMs / 35);
  for (let i = 0; i < steps; i++) {
    await phone.evaluate(([b, g]) => window.__setMotion(b, g), [beta, gamma]);
    await phone.waitForTimeout(35);
  }
}

async function completePreflight(phone) {
  await phone.getByRole("button", { name: "Enable Motion" }).click();
  await phone.evaluate(() => window.__setMotion(0, 0));
  await phone.getByRole("button", { name: "Center" }).click();
  await phone.evaluate(() => window.__setMotion(-20, 0));
  await phone.getByRole("button", { name: "Next" }).click();
  await phone.evaluate(() => window.__setMotion(0, 22));
  await phone.getByRole("button", { name: "Next" }).click();
  for (const [beta, gamma] of [[18, 0], [-18, 0], [0, 24], [0, -24]]) {
    for (let i = 0; i < 10; i++) {
      await phone.evaluate(([b, g]) => window.__setMotion(b, g), [beta, gamma]);
      await phone.waitForTimeout(35);
    }
  }
  await phone.waitForFunction(() => [...document.querySelectorAll("#racing-verification li")].every((el) => el.classList.contains("is-complete")));
  await phone.evaluate(() => window.__setMotion(0, 0));
  await phone.getByRole("button", { name: "Ready" }).click();
}

async function captureFor(baseUrl, outDir, label) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await installMotion(context);
  const host = await context.newPage();
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await host.goto(`${baseUrl}/host`, { waitUntil: "networkidle" });
  await host.getByRole("button", { name: "Play Now" }).first().click();
  await host.getByRole("button", { name: "1 Player" }).click();
  await host.waitForURL(/\/host\/lobby\//);
  const roomId = host.url().split("/").pop()?.split("?")[0];
  const session = await host.evaluate((id) => JSON.parse(sessionStorage.getItem(`pocket-arena:host:${id}`)), roomId);
  const url = new URL(session.slots[0].joinUrl);
  await phone.goto(`${baseUrl}${url.pathname}${url.search}`, { waitUntil: "networkidle" });
  await completePreflight(phone);

  // 1. Starting grid - screenshot immediately once racing status begins.
  await host.getByRole("button", { name: "Start Game" }).click();
  await host.waitForTimeout(400);
  await host.bringToFront();
  await host.screenshot({ path: `${outDir}/${label}-1-starting-grid.png` });

  // 2. Normal straight - hold straight throttle.
  await phone.bringToFront();
  await holdMotion(phone, 0, 34, 3000);
  await host.bringToFront();
  await host.waitForTimeout(100);
  await host.screenshot({ path: `${outDir}/${label}-2-normal-straight.png` });

  // 3. Drift corner - hard turn while at speed.
  await phone.bringToFront();
  await holdMotion(phone, -18, 30, 1600);
  await host.bringToFront();
  await host.waitForTimeout(100);
  await host.screenshot({ path: `${outDir}/${label}-3-drift-corner.png` });

  // 4/5. Airborne jump + landing - straighten out and hold speed into the
  // circuit's first jump (Cycle 4's authored layout); timings are
  // approximate and may need adjusting once run against the real track.
  await phone.bringToFront();
  await holdMotion(phone, 0, 34, 4000);
  await host.bringToFront();
  await host.waitForTimeout(100);
  await host.screenshot({ path: `${outDir}/${label}-4-airborne-jump.png` });
  await phone.bringToFront();
  await holdMotion(phone, 0, 34, 500);
  await host.bringToFront();
  await host.waitForTimeout(100);
  await host.screenshot({ path: `${outDir}/${label}-5-landing.png` });

  await browser.close();
}

const target = process.argv[2]; // "before" | "after"
const outDir = process.argv[3];
const port = target === "before" ? 3001 : 3000;
await captureFor(`http://127.0.0.1:${port}`, outDir, target);
console.log(`Saved ${target} screenshots to ${outDir}`);
```

- [ ] **Step 2: Capture the "before" set**

```bash
git stash
npm run dev # on port 3001, or whatever port this project's dev server config uses - confirm against vite.config.ts before running
```

```bash
node artifacts/racing-quality-pass/cycle3-visual/before-after-capture.mjs before artifacts/racing-quality-pass/cycle3-visual
```

```bash
git stash pop
```

- [ ] **Step 3: Capture the "after" set**

```bash
npm run dev
node artifacts/racing-quality-pass/cycle3-visual/before-after-capture.mjs after artifacts/racing-quality-pass/cycle3-visual
```

- [ ] **Step 4: Verify the acceptance bar**

Read all 10 resulting PNGs (5 before, 5 after) with the Read tool, matched pair by pair. Per spec §1/§10: confirm each pair is obviously different at a glance, with no caption needed - if any pair still looks nearly identical, that dimension (silhouette, driver, camera, effects, or HUD) needs another iteration pass on its corresponding task before this plan can be considered complete.

- [ ] **Step 5: Update the Art Bible's superseded panel-treatment clause**

In `docs/superpowers/specs/2026-07-12-harbor-city-gp-art-bible.md` Section 2, find the sentence "Hard edges at the nose taper, sidepod step, and rear deck are required for readability at a glance." and append a note:

```markdown
**Superseded 2026-07-15 (Cycle 3 round 2):** this clause is superseded by
`docs/superpowers/specs/2026-07-14-racing-driver-character-design.md`
Section 5 - panel transitions at these same three features are now
filleted/rounded, not hard-edged, as part of the exaggerated kart
silhouette redesign. The underlying goal (an open-wheel silhouette readable
from chase-camera distance) is unchanged; only the edge treatment is.
```

- [ ] **Step 6: Full production build**

Run: `npm run build`
Expected: succeeds without new bundle-size warnings beyond what Three.js already contributes (per spec §10).

- [ ] **Step 7: Run the full existing regression suite**

Run: `npm run test`
Expected: `shared/racingTrack.test.ts`, `server/games/racing.test.ts`, `client/src/games/racing/interpolation.test.ts`, and the new `character.test.ts` all pass.

- [ ] **Step 8: Commit**

```bash
git add artifacts/racing-quality-pass/cycle3-visual docs/superpowers/specs/2026-07-12-harbor-city-gp-art-bible.md
git commit -m "test(racing): capture Cycle 3 before/after acceptance screenshots, update Art Bible panel-treatment note"
```

---

## Self-Review Notes

**Spec coverage:** §4 (character system) -> Tasks 1-4. §5 (silhouette) -> Tasks 5-6. §6.1 (effects) -> Task 8. §6.2 (camera) -> Task 7. §7 (HUD) -> Task 10. §8 (audio) -> Task 9. §9 (performance) -> Task 11. §10 (acceptance screenshots + regression suite + build) -> Task 12. §11/§12 (non-goals, open questions) are constraints threaded through every task's Global Constraints and the GLTF-investigation branch in Task 6.

**Known deferred/conditional work:** Task 6's Step 2a vs 2b branch depends on a runtime investigation this plan cannot resolve in advance (spec's own open question). Task 9 Step 2's exact audio wiring depends on where `RacingAudio` is currently instantiated, which needs a quick grep before writing the final call site (flagged explicitly in that step rather than guessed). Task 11 Step 3's quality-gating fallback is conditional on the actual measured numbers and is intentionally left as a "if triggered, do X" rather than a pre-written diff, since a specific gate can't be designed against a measurement that doesn't exist yet.
