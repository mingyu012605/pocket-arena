# Racing Elevation, Jumps & Obstacle Circuit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Racing real elevation — climbs, banking, two jumps, and a technical chicane — on a new circuit, with server-authoritative world-space airborne physics, deterministic landing, checkpoints, elevation-aware collisions, and graybox (placeholder) visuals, without touching the chibi driver, car shape, or camera-shake rules.

**Architecture:** `shared/racingTrack.ts` grows a canonical `sampleRacingTrackFrame()` that both the server physics and the client rendering call for every position/slope/bank/segment-type query. Grounded physics is untouched; a new airborne branch in `stepCar()` switches a flying car to world-space `(worldX, worldY, worldZ)` integration and projects it back onto `(progress, lateralOffset, headingError)` at a validated landing. The client mirrors this split: grounded frames keep today's progress-based rendering, airborne frames render server-sent world position directly.

**Tech Stack:** TypeScript, Three.js (client), Socket.IO (server-client transport), Vitest (`racingTrack.test.ts`, `racing.test.ts`, `interpolation.test.ts`).

## Global Constraints

- Single canonical track path — no branching route graph (spec Section 4).
- No full rigid-body suspension simulation — lightweight critically-damped settle only (spec Section 10).
- No general 3D collision solver — a vertical-separation gate on the existing arcade collision model only (spec Section 7).
- No changes to the chibi driver character, car shape, or camera position shake (Cycle 3's `06e4389` rule stands).
- No Cycle 5 environment/city art, CC0 assets, or lighting/material pass in this plan.
- `bankAngle`/`slope`/`segmentType` are static track-authoring data reachable via the shared module on both client and server — never added to the network protocol.
- Only genuinely dynamic per-car values go over the wire (spec Section 13): `airborne`, and while airborne, `worldX`/`worldY`/`worldZ`. `velocityX/Y/Z` are never sent.
- Checkpoints/lap completion only ever advance from real landed `progress` — never from the mid-flight projected-progress hint (spec Section 9).

## File Structure

| File | Responsibility |
|---|---|
| `shared/racingTrack.ts` | Track data model, Catmull-Rom (x/z) + monotonic Hermite (y), `sampleRacingTrackFrame` |
| `shared/racingTrack.test.ts` | Unit tests for the above |
| `shared/protocol.ts` | `RacingPlayerState` wire fields (`airborne`, `worldX/Y/Z`) |
| `server/types.ts` | `RacingCarState` internal fields (airborne state, checkpoint index) |
| `server/games/racing.ts` | `stepCar` grounded/airborne branches, landing, fall/respawn, checkpoints, collision gate |
| `server/games/racing.test.ts` | Unit tests for the above |
| `client/src/games/racing/interpolation.ts` | `RacingCarFrame`, world-space vs. progress-space interpolation switch |
| `client/src/games/racing/interpolation.test.ts` | Unit tests for the above |
| `client/src/games/racing/carTransform.ts` | Thin dispatcher: grounded → `sampleRacingTrackFrame`; airborne → interpolated world position |
| `client/src/games/racing/renderer.ts` | Camera height/pitch-roll following car height |
| `client/src/games/racing/track.ts` | Graybox ramp/gap/landing/bank color-coding |

## Global Constants Reference

These are introduced across tasks below; listed here once so every task uses the same names:

- `GRAVITY = 24` (units/s², arcade-tuned, not real-world 9.8 — tuned by playtesting per spec Section 19)
- `MIN_LAUNCH_SPEED = 14`
- `HARD_LANDING_PITCH_THRESHOLD = 0.55` (radians)
- `VOID_FALL_HEIGHT = 12` (units below any candidate surface)
- `MAX_AIRBORNE_MS = 4000`
- `COLLISION_VERTICAL_SEPARATION = 3.2` (units — roughly one car height plus margin)
- `RESPAWN_DELAY_MS = 1000`
- `RESPAWN_SPEED_FACTOR = 0.3`

---

### Task 1: Track elevation data model, monotonic Hermite spline, canonical sampler

**Files:**
- Modify: `shared/racingTrack.ts`
- Modify: `shared/racingTrack.test.ts`

**Interfaces:**
- Produces: `TrackSegmentType`, extended `TrackPoint { x, z, y?, bankAngle?, segmentType?, jumpSpan? }`, `RacingTrackFrame { x, y, z, heading, slope, bankAngle, surfacePresent, segmentType }`, `sampleRacingTrackFrame(track, progress, lateralOffset): RacingTrackFrame`. `centerlinePoint` now also returns `y` (existing `.x`/`.z` behavior unchanged).

- [ ] **Step 1: Write the failing tests for elevation + the sampler**

Add to `shared/racingTrack.test.ts` (after the existing `shortestProgressDelta` describe block):

```ts
import { createTrack, sampleRacingTrackFrame } from "./racingTrack";

describe("elevation interpolation", () => {
  it("defaults to flat (y=0) when waypoints omit y", () => {
    const point = centerlinePoint(TEST_OVAL_TRACK, TEST_OVAL_TRACK.trackLength / 3);
    expect(point.y).toBe(0);
  });

  it("interpolates elevation between two elevated waypoints", () => {
    const track = createTrack(
      "test-hill",
      [
        { x: 0, z: 0, y: 0 },
        { x: 100, z: 0, y: 20 },
        { x: 200, z: 0, y: 20 },
        { x: 300, z: 0, y: 0 }
      ],
      10
    );
    const quarter = centerlinePoint(track, track.trackLength * 0.25);
    const threeQuarter = centerlinePoint(track, track.trackLength * 0.75);
    expect(quarter.y).toBeGreaterThan(0);
    expect(quarter.y).toBeLessThan(20);
    expect(threeQuarter.y).toBeGreaterThan(0);
    expect(threeQuarter.y).toBeLessThan(20);
  });

  it("never overshoots past a waypoint's elevation between two waypoints moving the same direction", () => {
    const track = createTrack(
      "test-monotonic",
      [
        { x: 0, z: 0, y: 0 },
        { x: 50, z: 0, y: 5 },
        { x: 100, z: 0, y: 10 },
        { x: 150, z: 0, y: 10 },
        { x: 200, z: 0, y: 0 }
      ],
      10
    );
    for (let p = 0; p < track.trackLength; p += 1) {
      const y = centerlinePoint(track, p).y;
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeLessThanOrEqual(10.01);
    }
  });
});

describe("sampleRacingTrackFrame", () => {
  const bankedTrack = createTrack(
    "test-bank",
    [
      { x: 0, z: 0, y: 0, bankAngle: 0 },
      { x: 100, z: 0, y: 0, bankAngle: 0.3 },
      { x: 200, z: 0, y: 0, bankAngle: 0.3 },
      { x: 300, z: 0, y: 0, bankAngle: 0 }
    ],
    10
  );

  it("raises surface height with lateral offset on a banked segment", () => {
    const centered = sampleRacingTrackFrame(bankedTrack, bankedTrack.trackLength * 0.5, 0);
    const offset = sampleRacingTrackFrame(bankedTrack, bankedTrack.trackLength * 0.5, 5);
    expect(offset.y).toBeGreaterThan(centered.y);
  });

  it("reports surfacePresent false only inside a gap segment", () => {
    const gapTrack = createTrack(
      "test-gap",
      [
        { x: 0, z: 0, y: 0, segmentType: "flat" },
        { x: 100, z: 0, y: 0, segmentType: "gap" },
        { x: 200, z: 0, y: 0, segmentType: "landing" },
        { x: 300, z: 0, y: 0, segmentType: "flat" }
      ],
      10
    );
    const inGap = sampleRacingTrackFrame(gapTrack, gapTrack.trackLength * 0.2, 0);
    const onLanding = sampleRacingTrackFrame(gapTrack, gapTrack.trackLength * 0.6, 0);
    expect(inGap.surfacePresent).toBe(false);
    expect(onLanding.surfacePresent).toBe(true);
  });

  it("has no discontinuity in y at the loop seam", () => {
    const beforeSeam = sampleRacingTrackFrame(TEST_OVAL_TRACK, TEST_OVAL_TRACK.trackLength - 0.1, 0);
    const afterSeam = sampleRacingTrackFrame(TEST_OVAL_TRACK, 0.1, 0);
    expect(Math.abs(afterSeam.y - beforeSeam.y)).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- racingTrack.test.ts`
Expected: FAIL — `sampleRacingTrackFrame` is not exported, `y`/`bankAngle`/`segmentType` don't exist on `TrackPoint`/`createTrack`'s third argument shape.

- [ ] **Step 3: Extend the data model and add the monotonic Hermite elevation spline**

In `shared/racingTrack.ts`, replace the top of the file (through the `catmullRom` function) with:

```ts
export type TrackSegmentType = "flat" | "ramp" | "gap" | "landing" | "bank";

export interface TrackPoint {
  x: number;
  z: number;
  y?: number;
  bankAngle?: number;
  segmentType?: TrackSegmentType;
  jumpSpan?: number;
}

export interface TrackDefinition {
  id: string;
  waypoints: TrackPoint[];
  trackLength: number;
  trackHalfWidth: number;
}

export interface RacingTrackFrame {
  x: number;
  y: number;
  z: number;
  heading: number;
  slope: number;
  bankAngle: number;
  surfacePresent: boolean;
  segmentType: TrackSegmentType;
}

const TEST_OVAL_WAYPOINTS: TrackPoint[] = [
  { x: 0, z: 0 },
  { x: 175, z: -16 },
  { x: 355, z: -42 },
  { x: 455, z: -145 },
  { x: 418, z: -270 },
  { x: 285, z: -338 },
  { x: 145, z: -304 },
  { x: 42, z: -360 },
  { x: -150, z: -366 },
  { x: -310, z: -306 },
  { x: -405, z: -205 },
  { x: -356, z: -86 },
  { x: -448, z: 26 },
  { x: -306, z: 132 },
  { x: -126, z: 94 },
  { x: -24, z: 34 }
];

const SEGMENT_SAMPLES = 40;

function catmullRom(p0: TrackPoint, p1: TrackPoint, p2: TrackPoint, p3: TrackPoint, t: number): TrackPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const z =
    0.5 *
    (2 * p1.z +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return { x, z };
}
```

Then, after `buildSampledCenterline` (unchanged), add the elevation spline builder. This runs the standard Fritsch-Carlson monotone-cubic-Hermite algorithm keyed on each *waypoint's* arc-length position (not the fine 40x-oversampled points x/z uses) — cheap (one entry per waypoint) and guarantees no overshoot bump before a ramp or dip after a landing:

```ts
interface ElevationSpline {
  arcLengths: number[]; // length n, one per waypoint, circular
  values: number[];     // y at each waypoint
  tangents: number[];   // Hermite tangent (dy/ds) at each waypoint
}

function buildElevationSpline(waypoints: TrackPoint[], sampled: SampledCenterline, trackLength: number): ElevationSpline {
  const n = waypoints.length;
  const arcLengths = waypoints.map((_, i) => sampled.cumulativeLengths[i * SEGMENT_SAMPLES]!);
  const values = waypoints.map((wp) => wp.y ?? 0);

  const segmentLength = (i: number): number => {
    const start = arcLengths[i]!;
    const end = i + 1 < n ? arcLengths[i + 1]! : trackLength;
    const span = end - start;
    return span > 0 ? span : end - start + trackLength;
  };
  const delta = (i: number): number => (values[(i + 1) % n]! - values[i]!) / segmentLength(i);

  const rawTangents = values.map((_, i) => {
    const dPrev = delta((i - 1 + n) % n);
    const dNext = delta(i);
    return (dPrev + dNext) / 2;
  });

  // Fritsch-Carlson monotonicity correction: clamp each adjacent tangent
  // pair so the cubic never overshoots past either endpoint's value.
  const tangents = [...rawTangents];
  for (let i = 0; i < n; i++) {
    const d = delta(i);
    const next = (i + 1) % n;
    if (d === 0) {
      tangents[i] = 0;
      tangents[next] = 0;
      continue;
    }
    const alpha = tangents[i]! / d;
    const beta = tangents[next]! / d;
    const magnitude = Math.hypot(alpha, beta);
    if (magnitude > 3) {
      const tau = 3 / magnitude;
      tangents[i] = tau * alpha * d;
      tangents[next] = tau * beta * d;
    }
  }

  return { arcLengths, values, tangents };
}

function evaluateElevation(spline: ElevationSpline, trackLength: number, arcLength: number): number {
  const n = spline.arcLengths.length;
  const wrapped = ((arcLength % trackLength) + trackLength) % trackLength;
  let index = n - 1;
  for (let i = 0; i < n; i++) {
    const start = spline.arcLengths[i]!;
    const end = i + 1 < n ? spline.arcLengths[i + 1]! : trackLength;
    if (wrapped >= start && wrapped < end) {
      index = i;
      break;
    }
  }
  const nextIndex = (index + 1) % n;
  const start = spline.arcLengths[index]!;
  const end = index + 1 < n ? spline.arcLengths[index + 1]! : trackLength;
  const span = end - start || 1;
  const t = Math.min(1, Math.max(0, (wrapped - start) / span));
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const y0 = spline.values[index]!;
  const y1 = spline.values[nextIndex]!;
  const m0 = spline.tangents[index]!;
  const m1 = spline.tangents[nextIndex]!;
  return h00 * y0 + h10 * span * m0 + h01 * y1 + h11 * span * m1;
}
```

Extend the cache and `createTrack`/`sampledFor` to also build/store the elevation spline:

```ts
interface SampledCenterline {
  points: TrackPoint[];
  cumulativeLengths: number[];
  elevation: ElevationSpline;
}

function buildSampledCenterline(waypoints: TrackPoint[], trackLength: number): SampledCenterline {
  const points: TrackPoint[] = [];
  const n = waypoints.length;
  for (let i = 0; i < n; i++) {
    const p0 = waypoints[(i - 1 + n) % n]!;
    const p1 = waypoints[i]!;
    const p2 = waypoints[(i + 1) % n]!;
    const p3 = waypoints[(i + 2) % n]!;
    for (let s = 0; s < SEGMENT_SAMPLES; s++) {
      points.push(catmullRom(p0, p1, p2, p3, s / SEGMENT_SAMPLES));
    }
  }
  const cumulativeLengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const dist = Math.hypot(curr.x - prev.x, curr.z - prev.z);
    cumulativeLengths.push(cumulativeLengths[i - 1]! + dist);
  }
  const last = points[points.length - 1]!;
  const first = points[0]!;
  cumulativeLengths.push(
    cumulativeLengths[cumulativeLengths.length - 1]! + Math.hypot(first.x - last.x, first.z - last.z)
  );
  const partial = { points, cumulativeLengths };
  const trackLengthValue = trackLength || cumulativeLengths[cumulativeLengths.length - 1]!;
  const elevation = buildElevationSpline(waypoints, partial, trackLengthValue);
  return { ...partial, elevation };
}
```

`createTrack` and `sampledFor` need the track length available before elevation can be built, so reorder `createTrack` to compute `trackLength` from a length-only first pass, then build the full sampled centerline. Replace `createTrack`/`sampledFor` with:

```ts
const sampledCache = new Map<string, SampledCenterline>();

export function createTrack(id: string, waypoints: TrackPoint[], trackHalfWidth: number): TrackDefinition {
  const lengthOnlyPass = buildSampledCenterline(waypoints, 0);
  const trackLength = lengthOnlyPass.cumulativeLengths[lengthOnlyPass.cumulativeLengths.length - 1]!;
  const sampled = buildSampledCenterline(waypoints, trackLength);
  sampledCache.set(id, sampled);
  return { id, waypoints, trackLength, trackHalfWidth };
}

function sampledFor(track: TrackDefinition): SampledCenterline {
  let sampled = sampledCache.get(track.id);
  if (!sampled) {
    sampled = buildSampledCenterline(track.waypoints, track.trackLength);
    sampledCache.set(track.id, sampled);
  }
  return sampled;
}
```

Update `centerlinePoint` to also return `y` from the elevation spline:

```ts
export function centerlinePoint(track: TrackDefinition, progress: number): TrackPoint {
  const { points, cumulativeLengths, elevation } = sampledFor(track);
  const wrapped = wrapProgress(progress, track.trackLength);
  const index = sampleIndexFor(wrapped, cumulativeLengths);
  const nextIndex = (index + 1) % points.length;
  const segStart = cumulativeLengths[index]!;
  const segEnd = index + 1 < cumulativeLengths.length ? cumulativeLengths[index + 1]! : track.trackLength;
  const span = segEnd - segStart || 1;
  const t = Math.min(1, Math.max(0, (wrapped - segStart) / span));
  const a = points[index]!;
  const b = points[nextIndex]!;
  const y = evaluateElevation(elevation, track.trackLength, wrapped);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y };
}
```

`centerlineTangentAngle`, `shortestProgressDelta`, `wrapProgress`, `sampleIndexFor`, `wrapProgress` stay exactly as-is (x/z math untouched).

- [ ] **Step 4: Add segment metadata lookup and the canonical sampler**

Append to `shared/racingTrack.ts`:

```ts
function waypointIndexAt(track: TrackDefinition, progress: number): number {
  const { cumulativeLengths } = sampledFor(track);
  const wrapped = wrapProgress(progress, track.trackLength);
  const fineIndex = sampleIndexFor(wrapped, cumulativeLengths);
  return Math.floor(fineIndex / SEGMENT_SAMPLES) % track.waypoints.length;
}

/** dy/ds via the same +-1 finite-difference pattern centerlineTangentAngle already uses for yaw. */
function centerlineSlope(track: TrackDefinition, progress: number): number {
  const ahead = centerlinePoint(track, progress + 1).y;
  const behind = centerlinePoint(track, progress - 1).y;
  return (ahead - behind) / 2;
}

function segmentMetadataAt(track: TrackDefinition, progress: number): { bankAngle: number; segmentType: TrackSegmentType } {
  const n = track.waypoints.length;
  const index = waypointIndexAt(track, progress);
  const nextIndex = (index + 1) % n;
  const current = track.waypoints[index]!;
  const next = track.waypoints[nextIndex]!;
  const { cumulativeLengths } = sampledFor(track);
  const wrapped = wrapProgress(progress, track.trackLength);
  const segStart = cumulativeLengths[index * SEGMENT_SAMPLES]!;
  const segEnd = nextIndex === 0 ? track.trackLength : cumulativeLengths[nextIndex * SEGMENT_SAMPLES]!;
  const span = segEnd - segStart || 1;
  const t = Math.min(1, Math.max(0, (wrapped - segStart) / span));
  const bankAngle = (current.bankAngle ?? 0) + ((next.bankAngle ?? 0) - (current.bankAngle ?? 0)) * t;
  return { bankAngle, segmentType: current.segmentType ?? "flat" };
}

/** Ramp waypoints only: the authored expected jump distance used to bound the airborne landing search (Section 8/9 of the design spec). */
export function rampJumpSpanAt(track: TrackDefinition, progress: number): number | null {
  const index = waypointIndexAt(track, progress);
  const waypoint = track.waypoints[index]!;
  if (waypoint.segmentType !== "ramp") return null;
  return waypoint.jumpSpan ?? 30;
}

/**
 * Single canonical place that turns (progress, lateralOffset) into world
 * position plus surface metadata. `y` is already the surface height *at
 * that lateral offset* (banking tilts the cross-section), not the bare
 * centerline height - callers never redo the bank formula themselves.
 */
export function sampleRacingTrackFrame(track: TrackDefinition, progress: number, lateralOffset: number): RacingTrackFrame {
  const center = centerlinePoint(track, progress);
  const heading = centerlineTangentAngle(track, progress);
  const slope = centerlineSlope(track, progress);
  const { bankAngle, segmentType } = segmentMetadataAt(track, progress);
  const perpendicularX = Math.cos(heading);
  const perpendicularZ = Math.sin(heading);
  return {
    x: center.x + perpendicularX * lateralOffset,
    y: center.y + lateralOffset * Math.sin(bankAngle),
    z: center.z + perpendicularZ * lateralOffset,
    heading,
    slope,
    bankAngle,
    surfacePresent: segmentType !== "gap",
    segmentType
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- racingTrack.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If `createTrack`'s two-pass length computation trips a strict-null check on `cumulativeLengths[...]!`, the `!` assertions already used throughout this file cover it.

- [ ] **Step 7: Commit**

```bash
git add shared/racingTrack.ts shared/racingTrack.test.ts
git commit -m "feat(racing): add elevation, banking, and canonical track-frame sampler"
```

---

### Task 2: Protocol and car-state plumbing for airborne fields

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `server/types.ts`
- Modify: `client/src/games/racing/interpolation.ts`
- Modify: `client/src/games/racing/interpolation.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 directly (this task is pure type plumbing).
- Produces: `RacingPlayerState.airborne?: boolean`, `.worldX?/.worldY?/.worldZ?: number` (protocol); `RacingCarState` internal fields `airborne`, `worldX/Y/Z`, `velocityX/Y/Z`, `takeoffProgress`, `lastCheckpointIndex`, `projectedProgress`, `fallenAt` (server-internal, not all sent — Task 9 below defines exactly which cross into `RacingCarFrame`); `RacingCarFrame.airborne?/worldX?/worldY?/worldZ?` (client interpolation).

- [ ] **Step 1: Write the failing test for pass-through of the new optional frame fields**

Add to `client/src/games/racing/interpolation.test.ts` (create the block if the file doesn't already have a top-level `describe("RacingInterpolationBuffer")`; otherwise add inside it):

```ts
it("passes through airborne world-space fields unchanged when both snapshots are airborne", () => {
  const buffer = new RacingInterpolationBuffer(1000);
  const t0 = 1000;
  buffer.addSnapshot(t0, new Map([[1, { progress: 50, lateralOffset: 0, headingError: 0, speed: 20, rank: 1, stale: false, airborne: true, worldX: 10, worldY: 5, worldZ: 20 }]]));
  buffer.addSnapshot(t0 + 50, new Map([[1, { progress: 50, lateralOffset: 0, headingError: 0, speed: 20, rank: 1, stale: false, airborne: true, worldX: 12, worldY: 4.5, worldZ: 22 }]]));
  const result = buffer.interpolate(t0 + 80);
  const frame = result.get(1)!;
  expect(frame.airborne).toBe(true);
  expect(frame.worldX).toBeGreaterThan(10);
  expect(frame.worldX).toBeLessThan(12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- interpolation.test.ts`
Expected: FAIL — `RacingCarFrame` has no `airborne`/`worldX`/`worldY`/`worldZ` properties (TypeScript compile error surfaced by vitest).

- [ ] **Step 3: Add the protocol fields**

In `shared/protocol.ts`, modify `RacingPlayerState` (currently lines 175-194):

```ts
export interface RacingPlayerState {
  playerNumber: number;
  displayName?: string;
  color?: string;
  isBot?: boolean;
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  steering?: number;
  throttle?: number;
  brake?: number;
  inputStale?: boolean;
  lastInputAt?: number;
  collided?: boolean;
  rank: number;
  lap: number;
  finished: boolean;
  finishTime: number | null;
  airborne?: boolean;
  worldX?: number;
  worldY?: number;
  worldZ?: number;
}
```

- [ ] **Step 4: Add the server-internal car-state fields**

In `server/types.ts`, modify `RacingCarState` (currently lines 16-36) to add:

```ts
export interface RacingCarState {
  isBot?: boolean;
  displayName?: string;
  color?: string;
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  yawRate: number;
  steering: number;
  throttle: number;
  brake: number;
  lastInputAt: number;
  lastControllerInputAt: number | null;
  lastSequence: number;
  lastCollisionAt: number;
  rank: number;
  lap: number;
  finished: boolean;
  finishTime: number | null;
  airborne: boolean;
  worldX: number;
  worldY: number;
  worldZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  takeoffProgress: number;
  settleTimer: number;
  settleFromPitch: number;
  hardLanding: boolean;
  fallenAt: number | null;
  lastCheckpointIndex: number;
  projectedProgress: number;
}
```

- [ ] **Step 5: Add the client interpolation fields and world-space blending branch**

In `client/src/games/racing/interpolation.ts`, modify `RacingCarFrame` (currently lines 1-9):

```ts
export interface RacingCarFrame {
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  steering?: number;
  rank: number;
  stale: boolean;
  airborne?: boolean;
  worldX?: number;
  worldY?: number;
  worldZ?: number;
}
```

In the `interpolate()` method's per-player loop (currently around lines 122-147), branch on `airborne` before the existing progress-based math. Replace the loop body with:

```ts
    for (const [playerNumber, nextFrame] of next.players) {
      const prevFrame = prev.players.get(playerNumber) ?? nextFrame;

      if (nextFrame.airborne || prevFrame.airborne) {
        const prevWorld = prevFrame.airborne
          ? prevFrame
          : this.groundedWorldPosition(prevFrame);
        const nextWorld = nextFrame.airborne
          ? nextFrame
          : this.groundedWorldPosition(nextFrame);
        result.set(playerNumber, {
          progress: nextFrame.progress,
          lateralOffset: nextFrame.lateralOffset,
          headingError: prevFrame.headingError + shortestDelta(prevFrame.headingError, nextFrame.headingError, TWO_PI) * t,
          speed: prevFrame.speed + (nextFrame.speed - prevFrame.speed) * t,
          steering: nextFrame.steering,
          rank: nextFrame.rank,
          stale: nextFrame.stale,
          airborne: nextFrame.airborne,
          worldX: prevWorld.worldX! + (nextWorld.worldX! - prevWorld.worldX!) * t,
          worldY: prevWorld.worldY! + (nextWorld.worldY! - prevWorld.worldY!) * t,
          worldZ: prevWorld.worldZ! + (nextWorld.worldZ! - prevWorld.worldZ!) * t
        });
        continue;
      }

      const progressDelta = shortestDelta(prevFrame.progress, nextFrame.progress, this.trackLength);
      const headingDelta = shortestDelta(prevFrame.headingError, nextFrame.headingError, TWO_PI);

      let progress = wrapValue(prevFrame.progress + progressDelta * t, this.trackLength);
      let lateralOffset = prevFrame.lateralOffset + (nextFrame.lateralOffset - prevFrame.lateralOffset) * t;
      const headingError = prevFrame.headingError + headingDelta * t;
      const speed = prevFrame.speed + (nextFrame.speed - prevFrame.speed) * t;
      const steering =
        prevFrame.steering === undefined && nextFrame.steering === undefined
          ? undefined
          : (prevFrame.steering ?? nextFrame.steering ?? 0) + ((nextFrame.steering ?? prevFrame.steering ?? 0) - (prevFrame.steering ?? nextFrame.steering ?? 0)) * t;

      const extrapolateMs = rawT > 1 ? Math.min(this.maxExtrapolateMs, renderTime - next.time) : 0;
      if (extrapolateMs > 0 && !nextFrame.stale && Math.abs(speed) > 0.01) {
        const extrapolateSeconds = extrapolateMs / 1000;
        progress = wrapValue(progress + speed * Math.cos(headingError) * extrapolateSeconds, this.trackLength);
        lateralOffset = clamp(
          lateralOffset + speed * Math.sin(headingError) * extrapolateSeconds,
          -this.maxLateralOffset,
          this.maxLateralOffset
        );
      }

      result.set(playerNumber, { progress, lateralOffset, headingError, speed, steering, rank: nextFrame.rank, stale: nextFrame.stale, airborne: false });
    }
```

Add the grounded-endpoint world-position helper just above `interpolate()`, importing the sampler from the shared module:

```ts
import { sampleRacingTrackFrame } from "../../../../shared/racingTrack";
import { TEST_OVAL_TRACK } from "../../../../shared/racingTrack";
```

```ts
  /** For a mixed grounded/airborne interpolation pair (the takeoff/landing tick), gives the grounded endpoint an equivalent world position so both ends of the blend share a basis. */
  private groundedWorldPosition(frame: RacingCarFrame): { worldX: number; worldY: number; worldZ: number } {
    const sample = sampleRacingTrackFrame(TEST_OVAL_TRACK, frame.progress, frame.lateralOffset);
    return { worldX: sample.x, worldY: sample.y, worldZ: sample.z };
  }
```

(Task 11 replaces `TEST_OVAL_TRACK`'s waypoints in place, so this import needs no change later — the constant name and track id stay the same.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- interpolation.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS. `racing.test.ts`'s `makeCar()` helper (both the one in `server/games/racing.test.ts` and the production `makeCarState()` in `server/games/racing.ts`) will now fail to satisfy the widened `RacingCarState` type until Task 3 supplies real defaults — if this step fails here, that's expected and gets fixed in Task 3, not this task. Confirm the failure is specifically about missing `airborne`/`worldX`/etc. properties on those two object literals, not something else.

- [ ] **Step 8: Commit**

```bash
git add shared/protocol.ts server/types.ts client/src/games/racing/interpolation.ts client/src/games/racing/interpolation.test.ts
git commit -m "feat(racing): add airborne world-space fields to protocol and car state"
```

---

### Task 3: Server airborne launch and world-space projectile integration

**Files:**
- Modify: `server/games/racing.ts`
- Modify: `server/games/racing.test.ts`

**Interfaces:**
- Consumes: `sampleRacingTrackFrame`, `rampJumpSpanAt` from `shared/racingTrack.ts` (Task 1); `RacingCarState` airborne fields (Task 2).
- Produces: `stepCar()` now branches grounded/airborne; car becomes airborne with `velocityY > 0` on a proper ramp launch, or with the car's existing horizontal velocity and near-zero vertical velocity when it drives off a gap edge below `MIN_LAUNCH_SPEED`.

- [ ] **Step 1: Write the failing tests**

Add to `server/games/racing.test.ts`, and update `makeCar()`'s defaults (it currently returns a `RacingCarState` literal missing the new fields — Task 2 made this a type error):

```ts
function makeCar(overrides: Partial<RacingCarState> = {}): RacingCarState {
  return {
    progress: 0,
    lateralOffset: 0,
    headingError: 0,
    speed: 0,
    yawRate: 0,
    steering: 0,
    throttle: 0,
    brake: 0,
    lastInputAt: Date.now(),
    lastControllerInputAt: null,
    lastSequence: 0,
    lastCollisionAt: 0,
    rank: 1,
    lap: 1,
    finished: false,
    finishTime: null,
    airborne: false,
    worldX: 0,
    worldY: 0,
    worldZ: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    takeoffProgress: 0,
    settleTimer: 0,
    settleFromPitch: 0,
    hardLanding: false,
    fallenAt: null,
    lastCheckpointIndex: -1,
    projectedProgress: 0,
    ...overrides
  };
}
```

Add a new describe block:

```ts
import { createTrack } from "../../shared/racingTrack";

describe("airborne launch", () => {
  const rampTrack = createTrack(
    "test-ramp",
    [
      { x: 0, z: 0, y: 0, segmentType: "flat" },
      { x: 100, z: 0, y: 5, segmentType: "ramp", jumpSpan: 40 },
      { x: 160, z: 0, y: 0, segmentType: "gap" },
      { x: 220, z: 0, y: 0, segmentType: "landing" },
      { x: 300, z: 0, y: 0, segmentType: "flat" }
    ],
    12
  );

  it("launches airborne with upward velocity above the minimum launch speed", () => {
    const rampProgress = rampTrack.trackLength * (1 / 5) + 1;
    const car = makeCar({ progress: rampProgress, speed: 25, throttle: 1 });
    stepCar(rampTrack, car, 1 / 60);
    expect(car.airborne).toBe(true);
    expect(car.velocityY).toBeGreaterThan(0);
  });

  it("drops off the ramp edge without a launch arc below the minimum speed", () => {
    const rampProgress = rampTrack.trackLength * (1 / 5) + 1;
    const car = makeCar({ progress: rampProgress, speed: 5 });
    stepCar(rampTrack, car, 1 / 60);
    expect(car.airborne).toBe(true);
    expect(car.velocityY).toBeLessThanOrEqual(0.5);
  });

  it("integrates world-space position under gravity while airborne", () => {
    const rampProgress = rampTrack.trackLength * (1 / 5) + 1;
    const car = makeCar({ progress: rampProgress, speed: 25, throttle: 1 });
    stepCar(rampTrack, car, 1 / 60);
    const startY = car.worldY;
    const startVelocityY = car.velocityY;
    stepCar(rampTrack, car, 1 / 60);
    expect(car.velocityY).toBeLessThan(startVelocityY);
    expect(car.worldY).not.toBe(startY);
  });

  it("freezes progress at takeoff while airborne", () => {
    const rampProgress = rampTrack.trackLength * (1 / 5) + 1;
    const car = makeCar({ progress: rampProgress, speed: 25, throttle: 1 });
    stepCar(rampTrack, car, 1 / 60);
    const frozen = car.progress;
    for (let i = 0; i < 10; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.progress).toBe(frozen);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- racing.test.ts`
Expected: FAIL — `stepCar` has no airborne branch yet, `car.airborne` stays `false`.

- [ ] **Step 3: Implement the airborne launch and integration branch**

In `server/games/racing.ts`, add the new constants near the existing `RACING` object (after line 93's closing, or alongside the other top-level constants around line 80-94):

```ts
import { sampleRacingTrackFrame, rampJumpSpanAt, wrapProgress } from "../../shared/racingTrack";

const GRAVITY = 24;
const MIN_LAUNCH_SPEED = 14;
const AIR_STEER_AUTHORITY = 0.35; // fraction of grounded steeringResponsiveness, applied to velocity direction
```

(`wrapProgress` isn't currently exported from `shared/racingTrack.ts` — add `export` to its existing declaration as part of this step; it has no other callers to break.)

Update `makeCarState()` (currently lines 15-35) to supply the new defaults:

```ts
function makeCarState(overrides: Partial<RacingCarState> = {}): RacingCarState {
  return {
    progress: 0,
    lateralOffset: 0,
    headingError: 0,
    speed: 0,
    yawRate: 0,
    steering: 0,
    throttle: 0,
    brake: 0,
    lastInputAt: Date.now(),
    lastControllerInputAt: null,
    lastSequence: -1,
    lastCollisionAt: 0,
    rank: 1,
    lap: 1,
    finished: false,
    finishTime: null,
    airborne: false,
    worldX: 0,
    worldY: 0,
    worldZ: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    takeoffProgress: 0,
    settleTimer: 0,
    settleFromPitch: 0,
    hardLanding: false,
    fallenAt: null,
    lastCheckpointIndex: -1,
    projectedProgress: 0,
    ...overrides
  };
}
```

Split `stepCar` into a dispatcher plus the existing body renamed to the grounded case, and add the new airborne case. Replace the current `export function stepCar(...)` (lines 151-216) with:

```ts
export function stepCar(track: TrackDefinition, car: RacingCarState, dt: number): void {
  if (car.airborne) {
    stepAirborneCar(track, car, dt);
    return;
  }
  const frame = sampleRacingTrackFrame(track, car.progress, car.lateralOffset);
  if (!frame.surfacePresent) {
    launchAirborne(track, car, false);
    return;
  }
  stepGroundedCar(track, car, dt);
  const rampLaunch = frame.segmentType === "ramp" && car.speed >= MIN_LAUNCH_SPEED;
  const rampAtEdge = rampLaunch && sampleRacingTrackFrame(track, car.progress, car.lateralOffset).segmentType !== "ramp";
  if (rampAtEdge) launchAirborne(track, car, true);
}

function stepGroundedCar(track: TrackDefinition, car: RacingCarState, dt: number): void {
  const steering = Math.abs(car.steering) < 0.04 ? 0 : car.steering;
  const targetHeading = steering * Math.PI * 0.36;
  car.yawRate += (targetHeading - car.headingError) * RACING.steeringResponsiveness * dt;
  car.yawRate -= car.yawRate * RACING.yawDamping * dt;
  car.headingError += car.yawRate * dt;
  if (steering === 0) car.headingError += (0 - car.headingError) * Math.min(1, RACING.headingCentering * dt);
  car.headingError = Math.max(-MAX_HEADING_ERROR, Math.min(MAX_HEADING_ERROR, car.headingError));

  if (car.throttle > 0) {
    const force = car.speed < 0 ? RACING.brakeForce : RACING.acceleration;
    car.speed += car.throttle * force * dt;
  } else if (car.brake > 0) {
    const force = car.speed > 0.5 ? RACING.brakeForce : RACING.reverseAcceleration;
    car.speed -= car.brake * force * dt;
  } else {
    if (car.speed > 0) car.speed = Math.max(0, car.speed - RACING.coastDrag * dt);
    else if (car.speed < 0) car.speed = Math.min(0, car.speed + RACING.coastDrag * dt);
  }
  car.speed = Math.max(-RACING.maxReverseSpeed, Math.min(RACING.maxSpeed, car.speed));

  const grip = Math.min(1, Math.max(0.2, Math.abs(car.speed) / RACING.maxSpeed));
  const forwardSpeed = car.speed * Math.cos(car.headingError);
  const driftSpeed = car.speed * Math.sin(car.headingError) * RACING.lateralResponsiveness;
  const steeringSlip = steering * Math.max(3, Math.abs(car.speed)) * RACING.steeringSlip * (1 - grip * 0.45);
  car.progress += forwardSpeed * dt;
  const lateralSpeed = driftSpeed + steeringSlip;
  car.lateralOffset += lateralSpeed * dt;
  const gripRecovery = Math.min(1, RACING.driftGrip * dt * (0.45 + grip * 0.75));
  car.headingError += (0 - car.headingError) * gripRecovery * (steering === 0 ? 1 : 0.18);

  const barrierLimit = track.trackHalfWidth + RACING.barrierOffset;
  let hitBarrier = false;
  let repeatedBarrierContact = false;
  if (Math.abs(car.lateralOffset) > barrierLimit) {
    const side = Math.sign(car.lateralOffset);
    const penetration = Math.abs(car.lateralOffset) - barrierLimit;
    const now = Date.now();
    repeatedBarrierContact = now - car.lastCollisionAt < 140;
    hitBarrier = true;
    car.lateralOffset = side * (barrierLimit - 0.04);
    car.speed *= repeatedBarrierContact ? 0.995 : RACING.barrierSpeedRetention;
    car.yawRate += -side * Math.min(1.6, 0.35 + penetration * 0.08 + Math.abs(car.speed) * 0.02);
    car.headingError += -side * Math.min(0.16, 0.035 + penetration * 0.012);
    car.lastCollisionAt = now;
  }
  if (Math.abs(car.lateralOffset) > track.trackHalfWidth) {
    if (!hitBarrier) {
      car.speed *= RACING.offTrackSlowFactor;
    } else if (!repeatedBarrierContact) {
      car.speed *= 0.98;
    }
    if (Math.abs(car.speed) < 5) {
      const edge = Math.sign(car.lateralOffset) * track.trackHalfWidth * 0.92;
      car.lateralOffset += (edge - car.lateralOffset) * Math.min(1, dt * 2.4);
    } else {
      const edge = Math.sign(car.lateralOffset) * track.trackHalfWidth * 0.98;
      car.lateralOffset += (edge - car.lateralOffset) * Math.min(1, dt * 0.85);
    }
  }

  if (car.progress < 0) car.progress = 0;
  if (car.progress >= track.trackLength && car.speed > 0 && !car.finished) {
    car.finished = true;
  }
}

/** Converts track-relative state into world-space flight state. `properLaunch` distinguishes a real ramp launch (arc from the ramp's exit slope) from driving too slowly off an edge (keeps existing horizontal velocity, near-zero vertical velocity). */
function launchAirborne(track: TrackDefinition, car: RacingCarState, properLaunch: boolean): void {
  const frame = sampleRacingTrackFrame(track, car.progress, car.lateralOffset);
  car.airborne = true;
  car.takeoffProgress = car.progress;
  car.worldX = frame.x;
  car.worldY = frame.y;
  car.worldZ = frame.z;
  const forwardX = Math.cos(frame.heading);
  const forwardZ = Math.sin(frame.heading);
  car.velocityX = forwardX * car.speed;
  car.velocityZ = forwardZ * car.speed;
  car.velocityY = properLaunch ? Math.max(2, frame.slope) * Math.max(car.speed, MIN_LAUNCH_SPEED) * 0.5 : Math.min(0, frame.slope);
}

function stepAirborneCar(track: TrackDefinition, car: RacingCarState, dt: number): void {
  const steering = Math.abs(car.steering) < 0.04 ? 0 : car.steering;
  if (steering !== 0) {
    const speedXZ = Math.hypot(car.velocityX, car.velocityZ) || 1;
    const currentHeading = Math.atan2(car.velocityZ, car.velocityX);
    const targetHeading = currentHeading + steering * RACING.steeringResponsiveness * AIR_STEER_AUTHORITY * dt;
    car.velocityX = Math.cos(targetHeading) * speedXZ;
    car.velocityZ = Math.sin(targetHeading) * speedXZ;
  }
  car.velocityY -= GRAVITY * dt;
  const prevWorldY = car.worldY;
  car.worldX += car.velocityX * dt;
  car.worldY += car.velocityY * dt;
  car.worldZ += car.velocityZ * dt;
  car.speed = Math.hypot(car.velocityX, car.velocityZ);

  tryLandOrFall(track, car, prevWorldY, dt);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- racing.test.ts`
Expected: The four new "airborne launch" tests PASS. Existing grounded tests still reference `stepCar` by the same name/signature, so they continue to pass unchanged. `tryLandOrFall` doesn't exist yet — stub it now so this compiles, with the real implementation arriving in Task 4:

```ts
function tryLandOrFall(_track: TrackDefinition, _car: RacingCarState, _prevWorldY: number, _dt: number): void {
  // Implemented in Task 4 of the Cycle 4 implementation plan.
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/games/racing.ts server/games/racing.test.ts
git commit -m "feat(racing): server-side ramp launch and world-space airborne integration"
```

---

### Task 4: Deterministic landing selection and settle

**Files:**
- Modify: `server/games/racing.ts`
- Modify: `server/games/racing.test.ts`

**Interfaces:**
- Consumes: `sampleRacingTrackFrame`, `rampJumpSpanAt`, `wrapProgress`, `shortestProgressDelta` from `shared/racingTrack.ts`; `tryLandOrFall` stub from Task 3.
- Produces: a real `tryLandOrFall()` that lands the car deterministically (earliest-crossing-time, then smallest-lateral-error) or leaves it falling; `settleTimer`/`hardLanding` drive a short post-landing speed/pitch settle.

- [ ] **Step 1: Write the failing tests**

Add to `server/games/racing.test.ts`, reusing the `rampTrack` fixture from Task 3 (hoist it to a shared `const` at the top of the file if it's currently scoped inside the `describe("airborne launch", ...)` block):

```ts
describe("landing", () => {
  it("lands within the landing zone's lateral bounds and re-grounds", () => {
    const car = makeCar({ progress: rampTrack.trackLength * (1 / 5) + 1, speed: 30, throttle: 1 });
    for (let i = 0; i < 120 && car.airborne; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.airborne).toBe(false);
    expect(car.progress).toBeGreaterThan(rampTrack.trackLength * (1 / 5));
    expect(car.progress).toBeLessThan(rampTrack.trackLength * (3 / 5));
  });

  it("does not land laterally outside the landing zone's bounds", () => {
    const car = makeCar({ progress: rampTrack.trackLength * (1 / 5) + 1, lateralOffset: 40, speed: 30, throttle: 1 });
    for (let i = 0; i < 30; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.airborne).toBe(true);
  });

  it("resolves overlapping landing candidates by earliest crossing time", () => {
    const stackedTrack = createTrack(
      "test-stacked",
      [
        { x: 0, z: 0, y: 0, segmentType: "flat" },
        { x: 100, z: 0, y: 10, segmentType: "ramp", jumpSpan: 60 },
        { x: 160, z: 0, y: 10, segmentType: "gap" },
        { x: 220, z: 0, y: 3, segmentType: "landing" },
        { x: 280, z: 0, y: 0, segmentType: "flat" }
      ],
      12
    );
    const car = makeCar({ progress: stackedTrack.trackLength * (1 / 5) + 1, speed: 35, throttle: 1 });
    for (let i = 0; i < 150 && car.airborne; i++) stepCar(stackedTrack, car, 1 / 60);
    expect(car.airborne).toBe(false);
    expect(car.worldY).toBeGreaterThan(1);
  });

  it("does not tunnel through a thin landing surface at a coarser timestep", () => {
    const car60 = makeCar({ progress: rampTrack.trackLength * (1 / 5) + 1, speed: 30, throttle: 1 });
    const car30 = makeCar({ progress: rampTrack.trackLength * (1 / 5) + 1, speed: 30, throttle: 1 });
    for (let i = 0; i < 120 && car60.airborne; i++) stepCar(rampTrack, car60, 1 / 60);
    for (let i = 0; i < 60 && car30.airborne; i++) stepCar(rampTrack, car30, 1 / 30);
    expect(car60.airborne).toBe(false);
    expect(car30.airborne).toBe(false);
  });

  it("applies a longer settle and a speed reduction on a hard (steep) landing", () => {
    const car = makeCar({ progress: rampTrack.trackLength * (1 / 5) + 1, speed: 30, throttle: 1 });
    car.velocityY = -40; // force a steep descent angle
    for (let i = 0; i < 120 && car.airborne; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.settleTimer).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- racing.test.ts`
Expected: FAIL — the stubbed `tryLandOrFall` never lands anything, so cars stay `airborne` forever (loops exhaust their iteration budget without `car.airborne` going `false`).

- [ ] **Step 3: Implement deterministic landing selection**

Replace the Task 3 stub in `server/games/racing.ts` with:

```ts
interface LandingCandidate {
  progress: number;
  crossingFraction: number;
  lateralError: number;
}

function tryLandOrFall(track: TrackDefinition, car: RacingCarState, prevWorldY: number, dt: number): void {
  const jumpSpan = rampJumpSpanAt(track, car.takeoffProgress) ?? 30;
  const searchStart = car.takeoffProgress;
  const searchEnd = car.takeoffProgress + jumpSpan * 1.5;
  const descending = car.velocityY < 0;

  let best: LandingCandidate | null = null;
  if (descending) {
    const SEARCH_STEP = 2;
    for (let p = searchStart; p <= searchEnd; p += SEARCH_STEP) {
      const wrapped = wrapProgress(p, track.trackLength);
      if (shortestProgressDelta(track, car.takeoffProgress, wrapped) <= 0) continue; // strictly ahead of takeoff
      const frame = sampleRacingTrackFrame(track, wrapped, 0);
      if (!frame.surfacePresent) continue;

      const lateral = lateralErrorAt(track, wrapped, car.worldX, car.worldZ);
      if (Math.abs(lateral) > track.trackHalfWidth) continue;

      const candidateSurfaceY = sampleRacingTrackFrame(track, wrapped, lateral).y;
      if (!(prevWorldY > candidateSurfaceY && car.worldY <= candidateSurfaceY)) continue;

      const crossingFraction = clamp01((prevWorldY - candidateSurfaceY) / (prevWorldY - car.worldY || 1));
      const pitch = Math.atan2(-car.velocityY, Math.hypot(car.velocityX, car.velocityZ) || 1);
      if (Math.abs(pitch) > Math.PI * 0.47) continue; // sideways/backwards approach rejected

      if (
        !best ||
        crossingFraction < best.crossingFraction ||
        (crossingFraction === best.crossingFraction && Math.abs(lateral) < Math.abs(best.lateralError))
      ) {
        best = { progress: wrapped, crossingFraction, lateralError: lateral };
      }
    }
  }

  if (best) {
    land(track, car, best, dt);
    return;
  }

  const outsideWindow = shortestProgressDelta(track, car.takeoffProgress, wrapProgress(car.progress, track.trackLength)) > jumpSpan * 1.5;
  const belowVoid = car.worldY < prevWorldY - VOID_FALL_HEIGHT_MARGIN && car.velocityY < 0;
  if (outsideWindow || belowVoid) {
    markFallen(car);
  }
}

const VOID_FALL_HEIGHT_MARGIN = 12;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lateralErrorAt(track: TrackDefinition, progress: number, worldX: number, worldZ: number): number {
  const heading = sampleRacingTrackFrame(track, progress, 0).heading;
  const center = sampleRacingTrackFrame(track, progress, 0);
  const dx = worldX - center.x;
  const dz = worldZ - center.z;
  return dx * Math.cos(heading) + dz * Math.sin(heading);
}

function land(track: TrackDefinition, car: RacingCarState, candidate: LandingCandidate, _dt: number): void {
  const pitch = Math.atan2(-car.velocityY, Math.hypot(car.velocityX, car.velocityZ) || 1);
  const hardLanding = Math.abs(pitch) > HARD_LANDING_PITCH_THRESHOLD;
  const landingHeading = Math.atan2(car.velocityZ, car.velocityX);
  const trackHeading = sampleRacingTrackFrame(track, candidate.progress, candidate.lateralError).heading;

  car.airborne = false;
  car.progress = candidate.progress;
  car.lateralOffset = candidate.lateralError;
  car.headingError = shortestAngleDelta(trackHeading, landingHeading);
  car.speed = Math.hypot(car.velocityX, car.velocityZ);
  car.velocityX = 0;
  car.velocityY = 0;
  car.velocityZ = 0;
  car.hardLanding = hardLanding;
  car.settleTimer = hardLanding ? 0.25 : 0.12;
  car.settleFromPitch = pitch;
  if (hardLanding) car.speed *= 0.85;
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function markFallen(car: RacingCarState): void {
  if (car.fallenAt === null) car.fallenAt = Date.now();
}
```

Add `HARD_LANDING_PITCH_THRESHOLD` alongside the other new constants from Task 3:

```ts
const HARD_LANDING_PITCH_THRESHOLD = 0.55;
```

Wire the settle into `stepGroundedCar` so a hard landing's speed reduction and pitch actually decay — add at the top of `stepGroundedCar` (before the existing steering logic):

```ts
function stepGroundedCar(track: TrackDefinition, car: RacingCarState, dt: number): void {
  if (car.settleTimer > 0) {
    car.settleTimer = Math.max(0, car.settleTimer - dt);
    car.settleFromPitch *= Math.max(0, 1 - dt / 0.12);
  }
  const steering = Math.abs(car.steering) < 0.04 ? 0 : car.steering;
  // ...unchanged from here down
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- racing.test.ts`
Expected: PASS for all five new "landing" tests plus everything from Tasks 1-3.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/games/racing.ts server/games/racing.test.ts
git commit -m "feat(racing): deterministic landing selection with settle and hard-landing penalty"
```

---

### Task 5: Projected progress for ranking during flight

**Files:**
- Modify: `server/games/racing.ts`
- Modify: `server/games/racing.test.ts`

**Interfaces:**
- Consumes: landing-search machinery from Task 4 (reuses the same bounded window, not a new mechanism).
- Produces: `car.projectedProgress` updated every tick while airborne, forward-only and clamped; `updateRanks()` sorts by it when a car is airborne.

- [ ] **Step 1: Write the failing tests**

Add to `server/games/racing.test.ts`:

```ts
describe("projected progress during flight", () => {
  it("advances projectedProgress forward while airborne without moving real progress", () => {
    const car = makeCar({ progress: rampTrack.trackLength * (1 / 5) + 1, speed: 30, throttle: 1 });
    stepCar(rampTrack, car, 1 / 60);
    const frozenProgress = car.progress;
    const firstProjected = car.projectedProgress;
    for (let i = 0; i < 5 && car.airborne; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.progress).toBe(frozenProgress);
    expect(car.projectedProgress).toBeGreaterThanOrEqual(firstProjected);
  });

  it("clamps projectedProgress to the authored jumpSpan window", () => {
    const car = makeCar({ progress: rampTrack.trackLength * (1 / 5) + 1, speed: 30, throttle: 1 });
    stepCar(rampTrack, car, 1 / 60);
    const jumpSpan = rampJumpSpanAt(rampTrack, car.takeoffProgress) ?? 30;
    for (let i = 0; i < 200 && car.airborne; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.projectedProgress).toBeLessThanOrEqual(car.takeoffProgress + jumpSpan * 1.5 + 0.01);
  });

  it("ranks an airborne car by projectedProgress, not frozen progress", () => {
    const room = createRoom({ gameType: "racing", maxPlayers: 4, hostToken: "h" } as any);
    room.gameState = createRacingGameState(room);
    const gameState = room.gameState;
    if (gameState.gameType !== "racing") throw new Error("expected racing state");
    const flying = makeCar({ progress: 500, projectedProgress: 550, airborne: true });
    const grounded = makeCar({ progress: 520, projectedProgress: 520, airborne: false });
    gameState.cars.set(1, flying);
    gameState.cars.set(2, grounded);
    stepPhysics(room, 1 / 60);
    expect(flying.rank).toBeLessThan(grounded.rank);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- racing.test.ts`
Expected: FAIL — `projectedProgress` never advances (stays at its initial value), and `updateRanks` still sorts by raw `progress` for every car.

- [ ] **Step 3: Implement the projected-progress update and rank change**

In `server/games/racing.ts`, add the projection update inside `stepAirborneCar` (after the position integration, before calling `tryLandOrFall`):

```ts
function stepAirborneCar(track: TrackDefinition, car: RacingCarState, dt: number): void {
  const steering = Math.abs(car.steering) < 0.04 ? 0 : car.steering;
  if (steering !== 0) {
    const speedXZ = Math.hypot(car.velocityX, car.velocityZ) || 1;
    const currentHeading = Math.atan2(car.velocityZ, car.velocityX);
    const targetHeading = currentHeading + steering * RACING.steeringResponsiveness * AIR_STEER_AUTHORITY * dt;
    car.velocityX = Math.cos(targetHeading) * speedXZ;
    car.velocityZ = Math.sin(targetHeading) * speedXZ;
  }
  car.velocityY -= GRAVITY * dt;
  const prevWorldY = car.worldY;
  car.worldX += car.velocityX * dt;
  car.worldY += car.velocityY * dt;
  car.worldZ += car.velocityZ * dt;
  car.speed = Math.hypot(car.velocityX, car.velocityZ);

  updateProjectedProgress(track, car);
  tryLandOrFall(track, car, prevWorldY, dt);
}

/**
 * Display/ranking-only estimate of forward position while airborne - never
 * read by checkpoint or lap logic (spec Section 9). Reuses the same bounded
 * nearest-point search as landing (Task 4) rather than a second mechanism.
 */
function updateProjectedProgress(track: TrackDefinition, car: RacingCarState): void {
  const jumpSpan = rampJumpSpanAt(track, car.takeoffProgress) ?? 30;
  const windowEnd = car.takeoffProgress + jumpSpan * 1.5;
  const SEARCH_STEP = 4;
  let nearest = car.takeoffProgress;
  let nearestDistSq = Infinity;
  for (let p = car.takeoffProgress; p <= windowEnd; p += SEARCH_STEP) {
    const wrapped = wrapProgress(p, track.trackLength);
    const center = sampleRacingTrackFrame(track, wrapped, 0);
    const distSq = (center.x - car.worldX) ** 2 + (center.z - car.worldZ) ** 2;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = wrapped;
    }
  }
  const advanced = shortestProgressDelta(track, car.takeoffProgress, nearest);
  car.projectedProgress = car.takeoffProgress + Math.max(0, Math.min(jumpSpan * 1.5, advanced));
}
```

Update `updateRanks` (currently around line 218) to sort by the projected value for airborne cars:

```ts
function updateRanks(gameState: RacingGameState): void {
  const rankValue = (car: RacingCarState): number => (car.airborne ? car.projectedProgress : car.progress);
  const entries = [...gameState.cars.entries()].sort(([, a], [, b]) => rankValue(b) - rankValue(a));
  entries.forEach(([, car], index) => {
    car.rank = index + 1;
  });
}
```

Initialize `projectedProgress` at launch too, in `launchAirborne` (append at the end of that function):

```ts
  car.projectedProgress = car.progress;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- racing.test.ts`
Expected: PASS for the three new tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/games/racing.ts server/games/racing.test.ts
git commit -m "feat(racing): projected progress for ranking during flight, gated off checkpoints"
```

---

### Task 6: Fall detection and respawn

**Files:**
- Modify: `server/games/racing.ts`
- Modify: `server/games/racing.test.ts`

**Interfaces:**
- Consumes: `markFallen()` from Task 4 (already sets `car.fallenAt`); checkpoint progress values (added this task) as respawn anchors.
- Produces: `applyFallRecovery(room, now)` called from `stepPhysics`, respawning a fallen car after `RESPAWN_DELAY_MS` at its last checkpoint with a speed penalty and fully reset airborne state.

- [ ] **Step 1: Write the failing tests**

Add to `server/games/racing.test.ts`:

```ts
describe("fall recovery", () => {
  it("marks a car fallen when it exits the search window without landing", () => {
    const car = makeCar({ progress: rampTrack.trackLength * (1 / 5) + 1, speed: 30, throttle: 1, lateralOffset: 40 });
    for (let i = 0; i < 200 && car.fallenAt === null; i++) stepCar(rampTrack, car, 1 / 60);
    expect(car.fallenAt).not.toBeNull();
  });

  it("respawns a fallen car at its last checkpoint after the delay, fully resetting airborne state", () => {
    const car = makeCar({
      progress: 999,
      lateralOffset: 40,
      airborne: true,
      velocityX: 5,
      velocityY: -3,
      velocityZ: 2,
      fallenAt: Date.now() - (RESPAWN_DELAY_MS + 50),
      lastCheckpointIndex: 0
    });
    const checkpoints = [0, 200, 400, 600];
    respawnFallenCar(rampTrack, car, checkpoints);
    expect(car.airborne).toBe(false);
    expect(car.velocityX).toBe(0);
    expect(car.velocityY).toBe(0);
    expect(car.velocityZ).toBe(0);
    expect(car.fallenAt).toBeNull();
    expect(car.progress).toBe(checkpoints[0]);
    expect(car.lateralOffset).toBe(0);
    expect(car.speed).toBeLessThanOrEqual(RACING.maxSpeed * RESPAWN_SPEED_FACTOR + 0.01);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- racing.test.ts`
Expected: FAIL — `respawnFallenCar` and `RESPAWN_DELAY_MS`/`RESPAWN_SPEED_FACTOR` don't exist yet.

- [ ] **Step 3: Implement respawn and wire it into the physics loop**

Add constants alongside the others introduced in Tasks 3-4:

```ts
const RESPAWN_DELAY_MS = 1000;
const RESPAWN_SPEED_FACTOR = 0.3;
```

Add the respawn function and a room-level sweep in `server/games/racing.ts`:

```ts
export function respawnFallenCar(track: TrackDefinition, car: RacingCarState, checkpoints: number[]): void {
  const anchor = checkpoints[Math.max(0, car.lastCheckpointIndex)] ?? 0;
  car.airborne = false;
  car.progress = anchor;
  car.lateralOffset = 0;
  car.headingError = 0;
  car.velocityX = 0;
  car.velocityY = 0;
  car.velocityZ = 0;
  car.speed = Math.min(car.speed, RACING.maxSpeed) * RESPAWN_SPEED_FACTOR;
  car.settleTimer = 0;
  car.hardLanding = false;
  car.fallenAt = null;
}

function applyFallRecovery(room: InternalRoom, now: number, checkpoints: number[]): void {
  if (room.gameState?.gameType !== "racing") return;
  const track = trackFor(room);
  for (const car of room.gameState.cars.values()) {
    if (car.fallenAt !== null && now - car.fallenAt >= RESPAWN_DELAY_MS) {
      respawnFallenCar(track, car, checkpoints);
    }
  }
}
```

Call it from `stepPhysics` (currently lines 312-326), after the existing per-car loop and before `resolveCollisions` — `applyFallRecovery` needs the checkpoint list, which Task 7 defines as `CHECKPOINT_PROGRESS_VALUES`; use a placeholder single-checkpoint array here (`[0]`) so this task is independently testable, and Task 7 replaces the call site:

```ts
export function stepPhysics(room: InternalRoom, dt: number): void {
  if (room.gameState?.gameType !== "racing") return;
  const track = trackFor(room);
  const now = Date.now();
  const startedAt = room.gameState.startedAt ?? now;
  for (const [playerNumber, car] of room.gameState.cars) {
    if (car.finished) continue;
    if (car.isBot || isBotPlayerNumber(playerNumber)) applyBotInput(playerNumber, car);
    else applyInputTimeout(car, now);
    stepCar(track, car, dt);
    if (car.finished) car.finishTime = now - startedAt;
  }
  applyFallRecovery(room, now, [0]);
  resolveCollisions(track, room.gameState, now);
  updateRanks(room.gameState);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- racing.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/games/racing.ts server/games/racing.test.ts
git commit -m "feat(racing): fall detection and checkpoint-anchored respawn"
```

---

### Task 7: Checkpoints (lap/route validity, real respawn anchors)

**Files:**
- Modify: `server/games/racing.ts`
- Modify: `server/games/racing.test.ts`

**Interfaces:**
- Consumes: `shortestProgressDelta` (already imported); `applyFallRecovery` from Task 6 (this task supplies its real checkpoint list, replacing the `[0]` placeholder).
- Produces: `checkpointsFor(track)`, `advanceCheckpoint(track, car, checkpoints)` called from the grounded physics step, gating lap/finish completion on non-decreasing checkpoint order using real landed `progress` only.

- [ ] **Step 1: Write the failing tests**

Add to `server/games/racing.test.ts`:

```ts
describe("checkpoints", () => {
  it("advances lastCheckpointIndex as a car crosses checkpoints in order", () => {
    const track = TEST_OVAL_TRACK;
    const checkpoints = [0, track.trackLength * 0.25, track.trackLength * 0.5, track.trackLength * 0.75];
    const car = makeCar({ progress: checkpoints[1] + 1, lastCheckpointIndex: 0 });
    advanceCheckpoint(track, car, checkpoints);
    expect(car.lastCheckpointIndex).toBe(1);
  });

  it("does not regress lastCheckpointIndex on a manufactured backward jump", () => {
    const track = TEST_OVAL_TRACK;
    const checkpoints = [0, track.trackLength * 0.25, track.trackLength * 0.5, track.trackLength * 0.75];
    const car = makeCar({ progress: checkpoints[1] + 1, lastCheckpointIndex: 2 });
    advanceCheckpoint(track, car, checkpoints);
    expect(car.lastCheckpointIndex).toBe(2);
  });

  it("does not let the mid-flight projected-progress hint advance checkpoints", () => {
    const track = TEST_OVAL_TRACK;
    const checkpoints = [0, track.trackLength * 0.25, track.trackLength * 0.5, track.trackLength * 0.75];
    const car = makeCar({
      progress: checkpoints[0] + 1,
      projectedProgress: checkpoints[3] + 1,
      airborne: true,
      lastCheckpointIndex: 0
    });
    advanceCheckpoint(track, car, checkpoints);
    expect(car.lastCheckpointIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- racing.test.ts`
Expected: FAIL — `advanceCheckpoint` doesn't exist yet.

- [ ] **Step 3: Implement checkpoints and wire fall-recovery to the real list**

Add to `server/games/racing.ts`:

```ts
/**
 * Roughly one checkpoint per major section (start straight, each jump's
 * landing, the banked sweeper, the chicane) - exact placement is authored
 * alongside the Task 11 circuit layout. A generic quarter/half/three-quarter
 * spread is used here so checkpoints exist and are independently testable
 * before that authoring pass.
 */
export function checkpointsFor(track: TrackDefinition): number[] {
  return [0, track.trackLength * 0.25, track.trackLength * 0.5, track.trackLength * 0.75];
}

/** Uses only the car's real, landed `progress` - never `projectedProgress`, so mid-flight state can never advance a checkpoint. Takes `track` directly (rather than reconstructing one) so the wrap-aware delta uses the real track length. */
export function advanceCheckpoint(track: TrackDefinition, car: RacingCarState, checkpoints: number[]): void {
  if (car.airborne) return;
  for (let i = 0; i < checkpoints.length; i++) {
    if (i <= car.lastCheckpointIndex) continue;
    const delta = shortestProgressDelta(track, checkpoints[i]!, car.progress);
    if (delta >= 0 && delta < track.trackLength / checkpoints.length) {
      car.lastCheckpointIndex = i;
    }
  }
}
```

Call `advanceCheckpoint` from `stepPhysics`'s per-car loop, and switch `applyFallRecovery`'s placeholder `[0]` to the real list:

```ts
export function stepPhysics(room: InternalRoom, dt: number): void {
  if (room.gameState?.gameType !== "racing") return;
  const track = trackFor(room);
  const checkpoints = checkpointsFor(track);
  const now = Date.now();
  const startedAt = room.gameState.startedAt ?? now;
  for (const [playerNumber, car] of room.gameState.cars) {
    if (car.finished) continue;
    if (car.isBot || isBotPlayerNumber(playerNumber)) applyBotInput(playerNumber, car);
    else applyInputTimeout(car, now);
    stepCar(track, car, dt);
    advanceCheckpoint(track, car, checkpoints);
    if (car.finished) car.finishTime = now - startedAt;
  }
  applyFallRecovery(room, now, checkpoints);
  resolveCollisions(track, room.gameState, now);
  updateRanks(room.gameState);
}
```

`respawnFallenCar` (Task 6) already indexes `checkpoints[car.lastCheckpointIndex]` — no change needed there now that real checkpoint progress values are passed in.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- racing.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/games/racing.ts server/games/racing.test.ts
git commit -m "feat(racing): checkpoint-gated lap validity using landed progress only"
```

---

### Task 8: Elevation-aware collisions

**Files:**
- Modify: `server/games/racing.ts`
- Modify: `server/games/racing.test.ts`

**Interfaces:**
- Consumes: `sampleRacingTrackFrame` (Task 1); `car.airborne` (Task 2/3).
- Produces: `resolveCollisions` skips any pair where either car is airborne, and gates grounded pairs by vertical separation.

- [ ] **Step 1: Write the failing tests**

Add to `server/games/racing.test.ts`:

```ts
describe("elevation-aware collisions", () => {
  const stackedTrack = createTrack(
    "test-stacked-collision",
    [
      { x: 0, z: 0, y: 0, segmentType: "flat" },
      { x: 100, z: 0, y: 0, segmentType: "flat" }
    ],
    12
  );

  it("does not collide two grounded cars at very different track elevations", () => {
    const elevatedTrack = createTrack(
      "test-elevated-pair",
      [
        { x: 0, z: 0, y: 0, segmentType: "flat" },
        { x: 100, z: 0, y: 10, segmentType: "flat" },
        { x: 200, z: 0, y: 10, segmentType: "flat" },
        { x: 300, z: 0, y: 0, segmentType: "flat" }
      ],
      12
    );
    const carA = makeCar({ progress: 5, lateralOffset: 1 });
    const carB = makeCar({ progress: elevatedTrack.trackLength * 0.5 + 5, lateralOffset: 1 });
    stepCar(elevatedTrack, carA, 0);
    stepCar(elevatedTrack, carB, 0);
    const gameState: RacingGameState = {
      gameType: "racing",
      trackId: elevatedTrack.id,
      cars: new Map([[1, carA], [2, carB]]),
      finishOrder: [],
      focusedPlayerNumber: 1,
      startedAt: Date.now(),
      endedAt: null
    };
    resolveCollisions(elevatedTrack, gameState, Date.now());
    expect(carA.speed).toBe(0);
    expect(carB.speed).toBe(0);
  });

  it("still collides two grounded cars at the same elevation", () => {
    const carA = makeCar({ progress: 5, lateralOffset: 0, speed: 20 });
    const carB = makeCar({ progress: 6, lateralOffset: 0.5, speed: 20 });
    const gameState: RacingGameState = {
      gameType: "racing",
      trackId: stackedTrack.id,
      cars: new Map([[1, carA], [2, carB]]),
      finishOrder: [],
      focusedPlayerNumber: 1,
      startedAt: Date.now(),
      endedAt: null
    };
    resolveCollisions(stackedTrack, gameState, Date.now());
    expect(carA.speed).toBeLessThan(20);
  });

  it("excludes airborne cars from collision resolution entirely", () => {
    const carA = makeCar({ progress: 5, lateralOffset: 0, speed: 20, airborne: true });
    const carB = makeCar({ progress: 6, lateralOffset: 0.5, speed: 20 });
    const gameState: RacingGameState = {
      gameType: "racing",
      trackId: stackedTrack.id,
      cars: new Map([[1, carA], [2, carB]]),
      finishOrder: [],
      focusedPlayerNumber: 1,
      startedAt: Date.now(),
      endedAt: null
    };
    resolveCollisions(stackedTrack, gameState, Date.now());
    expect(carA.speed).toBe(20);
    expect(carB.speed).toBe(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- racing.test.ts`
Expected: FAIL — the first and third tests currently still collide (no height/airborne gate exists).

- [ ] **Step 3: Implement the gates**

Add the constant alongside the others:

```ts
const COLLISION_VERTICAL_SEPARATION = 3.2;
```

Modify `resolveCollisions` (currently around lines 282-310) to skip airborne cars entirely, and modify `resolveCollisionPair` (currently lines 230-274) to add the vertical-separation check before its existing distance math:

```ts
function resolveCollisions(track: TrackDefinition, gameState: RacingGameState, now: number): void {
  const entries = [...gameState.cars.entries()].filter(([, car]) => !car.airborne);
  const impulseApplied = new Set<string>();
  for (let pass = 0; pass < COLLISION_RESOLUTION_PASSES; pass++) {
    let resolvedAny = false;
    for (let i = 0; i < entries.length; i++) {
      const [playerNumberA, carA] = entries[i]!;
      if (carA.finished) continue;
      for (let j = i + 1; j < entries.length; j++) {
        const [playerNumberB, carB] = entries[j]!;
        if (carB.finished) continue;
        const pairKey = `${Math.min(playerNumberA, playerNumberB)}:${Math.max(playerNumberA, playerNumberB)}`;
        const resolved = resolveCollisionPair(
          track,
          playerNumberA,
          carA,
          playerNumberB,
          carB,
          now,
          !impulseApplied.has(pairKey)
        );
        if (!resolved) continue;
        impulseApplied.add(pairKey);
        resolvedAny = true;
      }
    }
    if (!resolvedAny) break;
  }
}
```

```ts
function resolveCollisionPair(
  track: TrackDefinition,
  playerNumberA: number,
  carA: RacingCarState,
  playerNumberB: number,
  carB: RacingCarState,
  now: number,
  applyImpulse: boolean
): boolean {
  const heightA = sampleRacingTrackFrame(track, carA.progress, carA.lateralOffset).y;
  const heightB = sampleRacingTrackFrame(track, carB.progress, carB.lateralOffset).y;
  if (Math.abs(heightA - heightB) > COLLISION_VERTICAL_SEPARATION) return false;

  const longitudinal = shortestProgressDelta(track, carA.progress, carB.progress);
  const lateral = carB.lateralOffset - carA.lateralOffset;
  const normalizedLongitudinal = longitudinal / COLLISION_LONGITUDINAL_RADIUS;
  const normalizedLateral = lateral / COLLISION_LATERAL_RADIUS;
  const normalizedDistance = Math.hypot(normalizedLongitudinal, normalizedLateral);
  if (normalizedDistance >= 1) return false;

  let normalLongitudinal = 0;
  let normalLateral = playerNumberA < playerNumberB ? 1 : -1;
  if (normalizedDistance > 0.0001) {
    normalLongitudinal = normalizedLongitudinal / normalizedDistance;
    normalLateral = normalizedLateral / normalizedDistance;
  }

  const separationRatio = 1 - normalizedDistance;
  const progressPush = normalLongitudinal * COLLISION_LONGITUDINAL_RADIUS * separationRatio * 0.55;
  const lateralPush = normalLateral * COLLISION_LATERAL_RADIUS * separationRatio * 0.55;
  carA.progress = Math.max(0, carA.progress - progressPush);
  carB.progress = Math.max(0, carB.progress + progressPush);
  carA.lateralOffset -= lateralPush;
  carB.lateralOffset += lateralPush;
  clampCollisionLateral(track, carA);
  clampCollisionLateral(track, carB);

  if (applyImpulse) {
    carA.speed *= COLLISION_SPEED_FACTOR;
    carB.speed *= COLLISION_SPEED_FACTOR;
    carA.yawRate += -normalLateral * 0.32;
    carB.yawRate += normalLateral * 0.32;
    carA.headingError += -normalLateral * 0.035;
    carB.headingError += normalLateral * 0.035;
    carA.lastCollisionAt = now;
    carB.lastCollisionAt = now;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- racing.test.ts`
Expected: PASS — all three new tests, plus every existing collision test (same elevation, so the new height gate never triggers for them).

- [ ] **Step 5: Typecheck and full server test suite**

Run: `npm run typecheck && npm test -- racing.test.ts racingTrack.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/games/racing.ts server/games/racing.test.ts
git commit -m "feat(racing): vertical-separation collision gate and airborne collision exclusion"
```

---

### Task 9: Client — carTransform dispatcher and renderer wiring for airborne frames

**Files:**
- Modify: `client/src/games/racing/carTransform.ts`
- Modify: `client/src/games/racing/renderer.ts`

**Interfaces:**
- Consumes: `sampleRacingTrackFrame` (Task 1); `RacingCarFrame.airborne/worldX/worldY/worldZ` and the interpolation buffer's world-space blending (Task 2).
- Produces: `computeRacingCarWorldTransform` returns `{x, y, z, heading}` (adds `y`), sourced from the server's world-space state while airborne and from the sampler while grounded; the renderer positions cars at their real height instead of always `y=0`, and the `applyState`/`render` snapshot plumbing forwards the new fields.

- [ ] **Step 1: Rewrite `carTransform.ts` as a thin dispatcher**

Replace the full contents of `client/src/games/racing/carTransform.ts`:

```ts
import { TEST_OVAL_TRACK, sampleRacingTrackFrame } from "../../../../shared/racingTrack";

export interface CarFrame {
  progress: number;
  lateralOffset: number;
  headingError: number;
  airborne?: boolean;
  worldX?: number;
  worldY?: number;
  worldZ?: number;
}

export interface WorldCarTransform {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export function computeRacingCarWorldTransform(frame: CarFrame): WorldCarTransform {
  if (frame.airborne && frame.worldX !== undefined && frame.worldY !== undefined && frame.worldZ !== undefined) {
    const heading = Math.atan2(0, 1); // yaw for an airborne car is driven by the renderer's own visual-lean smoothing, not recomputed here
    return { x: frame.worldX, y: frame.worldY, z: frame.worldZ, heading };
  }
  const sample = sampleRacingTrackFrame(TEST_OVAL_TRACK, frame.progress, frame.lateralOffset);
  return { x: sample.x, y: sample.y, z: sample.z, heading: sample.heading };
}
```

- [ ] **Step 2: Update the renderer to consume `y` and pass through airborne frame fields**

In `client/src/games/racing/renderer.ts`, `applyState()` (currently lines 313-357), extend the mapped `RacingCarFrame` literal to carry the new fields through from `RacingPlayerState`:

```ts
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
          stale: p.inputStale ?? false,
          airborne: p.airborne ?? false,
          worldX: p.worldX,
          worldY: p.worldY,
          worldZ: p.worldZ
        }
      ])
    );
```

In `render()` (currently lines 372-448), the car-positioning line currently reads `car.root.position.set(x, 0, z)` (line 395) — change it to use the transform's `y`:

```ts
      const { x, y, z, heading } = computeRacingCarWorldTransform(pos);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(heading)) {
        if (DEV_MODE) console.warn("Invalid Racing car transform", { playerNumber, pos, x, y, z, heading });
        continue;
      }
      car.root.position.set(x, y, z);
```

An airborne car's `heading` from `computeRacingCarWorldTransform` is a placeholder (`atan2(0,1) = 0`) per Task 9 Step 1 — the existing `visualYaw` smoothing map a few lines below already eases `car.root.rotation.y` toward `targetYaw` over several frames rather than snapping, so a car keeps its last grounded heading through most of a jump instead of visibly resetting to zero; this is acceptable for Cycle 4's graybox pass and is noted as an open follow-up rather than fixed here, since the spec left visual pitch/roll as "cosmetic/derived" without mandating a specific yaw-during-flight source.

- [ ] **Step 3: Manual verification (no automated test — this is a rendering wire-up)**

Run: `npm run typecheck`
Expected: PASS — `WorldCarTransform` and `CarFrame` are both used consistently through `renderer.ts` and `track.ts` (which also calls `computeRacingCarWorldTransform` for the finish line/grid markers — those call sites pass literals without `airborne`, which is `undefined`/falsy, so they fall through to the grounded branch unchanged).

Run: `npm test`
Expected: PASS — no test directly exercises `carTransform.ts` today (it's covered indirectly through the renderer, which isn't unit-tested), so this step's real verification is the typecheck plus Task 12's manual playtest.

- [ ] **Step 4: Commit**

```bash
git add client/src/games/racing/carTransform.ts client/src/games/racing/renderer.ts
git commit -m "feat(racing): render airborne cars at their real world-space height"
```

---

### Task 10: Camera height, pitch/roll, and graybox elevation visuals

**Files:**
- Modify: `client/src/games/racing/renderer.ts`
- Modify: `client/src/games/racing/track.ts`

**Interfaces:**
- Consumes: `sampleRacingTrackFrame` (Task 1); the `y`-aware `computeRacingCarWorldTransform` (Task 9).
- Produces: chase/spectator camera height follows the focused/leader car's height; the track ribbon mesh follows elevation and color-codes ramp/gap/landing/bank segments.

- [ ] **Step 1: Camera height follows car height**

In `renderer.ts`, `render()`'s target-tracking (currently lines 378-380 declare `focused`/`leader` without a height field, and lines 446-447 populate them) — add `y` to both object shapes and their population:

```ts
    let focused: { x: number; y: number; z: number; cameraYaw: number; speed: number; progress: number; playerNumber: number; headingError: number } | null = null;
    let leader: { x: number; y: number; z: number; cameraYaw: number; speed: number; rank: number; progress: number; playerNumber: number; headingError: number } | null = null;
```

```ts
      if (playerNumber === this.focusedPlayerNumber) focused = { x, y, z, cameraYaw, speed: pos.speed, progress: pos.progress, playerNumber, headingError: pos.headingError };
      if (!leader || pos.rank < leader.rank) leader = { x, y, z, cameraYaw, speed: pos.speed, rank: pos.rank, progress: pos.progress, playerNumber, headingError: pos.headingError };
```

(`y` is already destructured from `computeRacingCarWorldTransform(pos)` in Task 9 Step 2, so it's in scope at this point in `render()`.)

Then in the camera-target block (currently lines 501-510 build `desired`/`desiredLook` with a hardcoded `config.height`), add the target's world height on top of the existing config height/look height, keeping all existing damping/easing untouched:

```ts
      const desired = new THREE.Vector3(
        config.spectator ? target.x + 36 : behindX,
        config.height + target.y + Math.min(1.4, target.speed * 0.03),
        config.spectator ? target.z + 34 : behindZ
      );
      const desiredLook = new THREE.Vector3(
        target.x + forwardX * config.lookAhead,
        config.lookHeight + target.y,
        target.z + forwardZ * config.lookAhead
      );
```

No other camera code changes — collision raycasting, damping, roll/sway, and FOV easing all already operate on the resulting `desired`/`desiredLook` vectors generically and need no elevation-specific change. No camera position shake is introduced (Global Constraints).

- [ ] **Step 2: Graybox color-coding for ramp/gap/landing/bank segments**

In `track.ts`, `buildRibbonMesh()` currently samples only `x/z` per-vertex via `centerlinePoint`/`centerlineTangentAngle` and writes a single shared `y` parameter for the whole ribbon (flat). Extend it to sample the track's real elevation per-vertex and to vary vertex color by segment type, so the graybox reads as ramp/gap/landing/bank without needing new art assets. Replace `buildRibbonMesh`:

```ts
import { sampleRacingTrackFrame } from "../../../../shared/racingTrack";

const SEGMENT_GRAYBOX_COLOR: Record<string, [number, number, number]> = {
  flat: [1, 1, 1],
  ramp: [1, 0.65, 0.15],
  gap: [1, 0.25, 0.25],
  landing: [0.35, 1, 0.45],
  bank: [1, 1, 1]
};

function buildRibbonMesh(innerOffset: number, outerOffset: number, yOffset: number, material: THREE.Material): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const progress = (i / TRACK_SAMPLES) * TEST_OVAL_TRACK.trackLength;
    const outer = sampleRacingTrackFrame(TEST_OVAL_TRACK, progress, outerOffset);
    const inner = sampleRacingTrackFrame(TEST_OVAL_TRACK, progress, innerOffset);
    positions.push(outer.x, outer.y + yOffset, outer.z);
    positions.push(inner.x, inner.y + yOffset, inner.z);
    uvs.push(0, i / TRACK_SAMPLES);
    uvs.push(1, i / TRACK_SAMPLES);
    const [r, g, b] = SEGMENT_GRAYBOX_COLOR[outer.segmentType] ?? [1, 1, 1];
    colors.push(r, g, b, r, g, b);
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
```

Every material passed into `buildRibbonMesh` (in `buildTrackGroup`) needs `vertexColors: true` added so the per-vertex graybox tint actually renders (it multiplies with the existing `map`/base `color`, so the asphalt texture is still visible, just tinted by segment). Update the four ribbon materials in `buildTrackGroup`:

```ts
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: "#364a63",
    map: buildTrackTexture(),
    normalMap: loadRepeatTexture(asphaltNormalUrl, 2, 42),
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide,
    vertexColors: true
  });
  const runoffMaterial = new THREE.MeshStandardMaterial({
    color: "#4bd383",
    map: buildGrassTexture(),
    alphaMap: loadRepeatTexture(terrainDetailUrl, 18, 18, THREE.SRGBColorSpace),
    roughness: 0.92,
    metalness: 0.01,
    side: THREE.DoubleSide,
    vertexColors: true
  });
```

(`curbMaterial` and the line/lane-guide materials can keep `vertexColors` off — they're deliberately thin trim strips where the tint would be barely visible and isn't needed to read ramp/gap/landing at a glance; only `road` and `runoff`, the two widest surfaces, need it.)

Every other `buildRibbonMesh` caller in `buildTrackGroup` (curbs, edge lines, lane guides) keeps its existing call signature — the function's parameter list is unchanged (`innerOffset, outerOffset, yOffset, material`), only its internal vertex sampling changed, so no call site needs editing.

- [ ] **Step 3: Manual verification**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run dev`, open the host page, start a Racing room, and visually confirm (on the still-flat `TEST_OVAL_TRACK` at this point, since Task 11 hasn't authored elevation into it yet) that the track renders identically to before this task — the graybox coloring only becomes visible once Task 11 introduces non-`"flat"` segments. This is expected; the purpose of this step is confirming no regression, not seeing new colors yet.

- [ ] **Step 4: Commit**

```bash
git add client/src/games/racing/renderer.ts client/src/games/racing/track.ts
git commit -m "feat(racing): camera follows car elevation, graybox segment-type coloring"
```

---

### Task 11: New elevated circuit layout

**Files:**
- Modify: `shared/racingTrack.ts`
- Modify: `shared/racingTrack.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-10 (this task only changes waypoint data, not code paths).
- Produces: `TEST_OVAL_WAYPOINTS` (and its exported `TEST_OVAL_TRACK` constant, same id/name — no consumer needs to change import paths) now describes the full spec Section 15 lap: esses climb, Jump 1 (confidence jump), banked sweeper, chicane, Jump 2 "Skyline Leap" (crossing over an earlier lower section), downhill return.

- [ ] **Step 1: Update the existing baseline tests that assert flatness**

`racingTrack.test.ts`'s elevation tests from Task 1 already assert `y === 0` for `TEST_OVAL_TRACK` specifically (the "defaults to flat" test) — since this task makes `TEST_OVAL_TRACK` genuinely elevated, that assertion is now wrong for this track (it was only ever meant to test the *default*, not this specific track). Change it to use a fresh flat fixture instead of `TEST_OVAL_TRACK`:

```ts
  it("defaults to flat (y=0) when waypoints omit y", () => {
    const flatTrack = createTrack("test-flat-default", [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }, { x: 300, z: 0 }], 10);
    const point = centerlinePoint(flatTrack, flatTrack.trackLength / 3);
    expect(point.y).toBe(0);
  });
```

- [ ] **Step 2: Author the elevated waypoints**

Replace `TEST_OVAL_WAYPOINTS` in `shared/racingTrack.ts` with an elevation-authored version of the same 16-point loop shape, adding `y`/`segmentType`/`bankAngle`/`jumpSpan` at the points corresponding to the spec's Section 15 layout (esses → Jump 1 → banked sweeper → chicane → Jump 2 "Skyline Leap" → downhill):

```ts
const TEST_OVAL_WAYPOINTS: TrackPoint[] = [
  { x: 0, z: 0, y: 0, segmentType: "flat" },
  { x: 175, z: -16, y: 0, segmentType: "flat" },
  { x: 355, z: -42, y: 4, segmentType: "flat" },
  { x: 455, z: -145, y: 9, segmentType: "ramp", jumpSpan: 32 },
  { x: 418, z: -270, y: 9, segmentType: "gap" },
  { x: 285, z: -338, y: 5, segmentType: "landing" },
  { x: 145, z: -304, y: 5, segmentType: "bank", bankAngle: 0.35 },
  { x: 42, z: -360, y: 3, segmentType: "bank", bankAngle: 0.35 },
  { x: -150, z: -366, y: 0, segmentType: "flat" },
  { x: -310, z: -306, y: 0, segmentType: "flat" },
  { x: -405, z: -205, y: 6, segmentType: "ramp", jumpSpan: 55 },
  { x: -356, z: -86, y: 6, segmentType: "gap" },
  { x: -448, z: 26, y: 1, segmentType: "landing" },
  { x: -306, z: 132, y: 1, segmentType: "flat" },
  { x: -126, z: 94, y: 0, segmentType: "flat" },
  { x: -24, z: 34, y: 0, segmentType: "flat" }
];
```

Note for the implementer: waypoints 8-9 (`{-150,-366}`/`{-310,-306}`) are the deliberate "technical chicane" — a tightening pair of corners between the two jumps, using the existing flat cornering feel with no new authoring needed beyond what's already there. Waypoint 10's ramp (`{-405,-205}`, jumpSpan 55) is "Skyline Leap" — its landing at waypoint 12 (`{-448,26}`) sits at `y: 1`, well below the elevated waypoints 2-3 (`y: 4-9`) it visually arcs over; because it's a different stretch of the same single loop rather than a literal crossing of identical `x/z` coordinates, this authoring approximates the "crosses over an earlier lower section" set-piece from the spec without requiring the loop to self-intersect in `x/z` — true geometric self-crossing is a further authoring refinement, not a physics requirement, and can be adjusted here without touching any code from Tasks 1-10.

Exact numeric tuning (ramp angles read from these `y` deltas, gap lengths implied by `jumpSpan`, bank strength) is explicitly left for playtesting per spec Section 19 — this waypoint set is a concrete, testable starting point, not a final authored value.

- [ ] **Step 3: Run the full shared test suite**

Run: `npm test -- racingTrack.test.ts`
Expected: PASS — including the loop-seam continuity test, which now exercises a genuinely elevated seam (waypoint 15 at `y:0` back to waypoint 0 at `y:0`, so it still closes at the same height).

- [ ] **Step 4: Run the full server test suite**

Run: `npm test -- racing.test.ts`
Expected: PASS. Watch specifically for any existing grounded test that assumed a perfectly flat track incidentally still passing — e.g. tests using `lateralOffset`/`headingError` assertions don't depend on `y` at all, so they should be unaffected, but this is exactly the kind of regression Task 11's full-suite run exists to catch before Task 12.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/racingTrack.ts shared/racingTrack.test.ts
git commit -m "feat(racing): author the elevated jump/obstacle circuit layout"
```

---

### Task 12: Full regression, build, and playtest pass

**Files:**
- None modified — verification only. If any step below surfaces a real bug, fix it in the file it belongs to and note which task's work it corrects.

- [ ] **Step 1: Full automated test suite**

Run: `npm test`
Expected: PASS — every suite from Tasks 1-11 (`racingTrack.test.ts`, `racing.test.ts`, `interpolation.test.ts`) plus any other existing suite in the repo (Table Tennis, Rhythm Battle, etc.) unaffected by this work.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS for both `tsconfig.client.json` and `tsconfig.server.json`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: PASS, with no new bundle-size warning beyond what Three.js already contributes (per spec Section 18's build-regression check).

- [ ] **Step 4: Desktop playtest**

Run: `npm run dev`, open the host page, create a Racing room, and drive (or use Controller Test / a second browser tab as a phone stand-in) through a full lap: countdown → esses → Jump 1 → banked sweeper → chicane → Jump 2 "Skyline Leap" → finish. Confirm:
- The car visibly leaves the ground at each ramp and follows a real arc, not a snap-to-centerline curve.
- Steering has a light but real effect on the flight path while airborne.
- Landing re-grounds cleanly; deliberately landing badly (approach at a steep angle) produces a visibly longer settle and a brief speed drop rather than a crash or a snap.
- Deliberately missing a jump (steer off the landing zone or brake before it) triggers a fall and a respawn at the last checkpoint after about a second.
- The leaderboard doesn't visibly freeze or glitch for a car mid-jump.
- The chase camera rises and falls with the car through both jumps, with no shake reintroduced.
- No two cars visibly collide across the Skyline Leap's stacked levels.

- [ ] **Step 5: Phone-controller playtest**

Using `npm run dev:phone` (per the earlier Cloudflare-tunnel automation already set up in this project) and a real phone: create a room, scan the QR, complete motion calibration, and drive the same full lap. Confirm air-steering feels responsive rather than either weightless or unresponsive, and that phone input isn't dropped or delayed specifically during the airborne segments (a common failure mode if a client-side change accidentally stopped forwarding `racing:input` while `airborne` is true — verify it does not).

- [ ] **Step 6: Final commit (only if Steps 1-5 surfaced fixes)**

```bash
git add -A
git commit -m "fix(racing): address regressions found in Cycle 4 full playtest pass"
```

If no fixes were needed, skip this step — there's nothing to commit.

---

## Self-Review Notes

- **Spec coverage:** Section 4/5 → Task 1. Section 6 (banking) → Task 1 (bank formula) + Task 8 (collision height read uses the same `.y`). Section 7 (collisions) → Task 8. Section 8 (airborne flight, search window) → Tasks 3-4. Section 9 (projected progress) → Task 5. Section 10 (landing, determinism, settle) → Task 4. Section 11 (checkpoints) → Task 7. Section 12 (fall/respawn) → Task 6. Section 13 (client world-space rendering) → Tasks 2 (types) + 9 (dispatcher/renderer wiring). Section 14 (camera) → Task 10 Step 1. Section 15 (circuit) → Task 11. Section 16 (graybox) → Task 10 Step 2. Section 18 (tests) → distributed across every task's Step 1, plus Task 12's full sweep.
- **Placeholder scan:** none found — an earlier draft of Task 7 Step 3 left a broken false-start snippet with a "delete this" note; it's been replaced with the correct `advanceCheckpoint(track, car, checkpoints)` implementation directly, and the Step 1 test calls were updated to match its real three-argument signature.
- **Type consistency:** `RacingCarState` (Task 2) → consumed identically by `stepCar`/`stepGroundedCar`/`stepAirborneCar`/`launchAirborne`/`tryLandOrFall`/`land`/`respawnFallenCar`/`advanceCheckpoint`/`resolveCollisionPair` (Tasks 3-8) with no renamed fields. `RacingTrackFrame` (Task 1) fields (`x,y,z,heading,slope,bankAngle,surfacePresent,segmentType`) are read with the same names in every later task. `RacingCarFrame` (Task 2) fields match what `renderer.ts` (Task 9) destructures. `computeRacingCarWorldTransform`'s return type gains `y` in Task 9 and every call site (`renderer.ts`, `track.ts`) is updated in the same or a later task (Task 9 Step 2, Task 10 Step 2) — no call site is left destructuring the old 3-field shape.
