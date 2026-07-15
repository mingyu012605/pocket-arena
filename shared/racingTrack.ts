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

interface ElevationSpline {
  arcLengths: number[]; // length n, one per waypoint, circular
  values: number[];     // y at each waypoint
  tangents: number[];   // Hermite tangent (dy/ds) at each waypoint
}

interface SampledCenterline {
  points: TrackPoint[];
  cumulativeLengths: number[];
  elevation: ElevationSpline;
}

/**
 * Standard Fritsch-Carlson monotone-cubic-Hermite spline, keyed on each
 * *waypoint's* arc-length position (not the fine 40x-oversampled points
 * x/z uses) - cheap, and guarantees no overshoot bump before a ramp's
 * takeoff lip or dip after a landing the way plain Catmull-Rom would.
 */
function buildElevationSpline(
  waypoints: TrackPoint[],
  sampled: { cumulativeLengths: number[] },
  trackLength: number
): ElevationSpline {
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
  const trackLengthValue = trackLength || cumulativeLengths[cumulativeLengths.length - 1]!;
  const elevation = buildElevationSpline(waypoints, { cumulativeLengths }, trackLengthValue);
  return { points, cumulativeLengths, elevation };
}

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

export function wrapProgress(progress: number, trackLength: number): number {
  const wrapped = progress % trackLength;
  return wrapped < 0 ? wrapped + trackLength : wrapped;
}

function sampleIndexFor(progress: number, cumulativeLengths: number[]): number {
  for (let i = 0; i < cumulativeLengths.length - 1; i++) {
    if (cumulativeLengths[i + 1]! >= progress) return i;
  }
  return cumulativeLengths.length - 2;
}

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

export function centerlineTangentAngle(track: TrackDefinition, progress: number): number {
  const ahead = centerlinePoint(track, progress + 1);
  const behind = centerlinePoint(track, progress - 1);
  return Math.atan2(ahead.x - behind.x, -(ahead.z - behind.z));
}

/** dy/ds via the same +-1 finite-difference pattern centerlineTangentAngle already uses for yaw. */
function centerlineSlope(track: TrackDefinition, progress: number): number {
  const ahead = centerlinePoint(track, progress + 1).y!;
  const behind = centerlinePoint(track, progress - 1).y!;
  return (ahead - behind) / 2;
}

function waypointIndexAt(track: TrackDefinition, progress: number): number {
  const { cumulativeLengths } = sampledFor(track);
  const wrapped = wrapProgress(progress, track.trackLength);
  const fineIndex = sampleIndexFor(wrapped, cumulativeLengths);
  return Math.floor(fineIndex / SEGMENT_SAMPLES) % track.waypoints.length;
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

/** Ramp waypoints only: the authored expected jump distance used to bound the airborne landing search. */
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
    y: center.y! + lateralOffset * Math.sin(bankAngle),
    z: center.z + perpendicularZ * lateralOffset,
    heading,
    slope,
    bankAngle,
    surfacePresent: segmentType !== "gap",
    segmentType
  };
}

/**
 * Shortest signed progress delta from `from` to `to` around the closed
 * loop - the short way, whether that means going forward through the wrap
 * or backward. Naively subtracting two raw progress values breaks near the
 * start/finish seam: two cars sitting right next to each other, one just
 * before the wrap and one just after, would otherwise look almost a full
 * lap apart instead of a few meters apart.
 */
export function shortestProgressDelta(track: TrackDefinition, from: number, to: number): number {
  const wrapLength = track.trackLength;
  let delta = (to - from) % wrapLength;
  if (delta > wrapLength / 2) delta -= wrapLength;
  if (delta < -wrapLength / 2) delta += wrapLength;
  return delta;
}

export const TEST_OVAL_TRACK = createTrack("harbor-city-rally", TEST_OVAL_WAYPOINTS, 34);
