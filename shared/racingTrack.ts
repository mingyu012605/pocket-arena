export interface TrackPoint {
  x: number;
  z: number;
}

export interface TrackDefinition {
  id: string;
  waypoints: TrackPoint[];
  trackLength: number;
  trackHalfWidth: number;
}

const TEST_OVAL_WAYPOINTS: TrackPoint[] = [
  { x: 0, z: 0 },
  { x: 110, z: -12 },
  { x: 175, z: -70 },
  { x: 168, z: -150 },
  { x: 92, z: -206 },
  { x: 12, z: -228 },
  { x: -72, z: -218 },
  { x: -155, z: -176 },
  { x: -182, z: -108 },
  { x: -132, z: -48 },
  { x: -58, z: -18 }
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

interface SampledCenterline {
  points: TrackPoint[];
  cumulativeLengths: number[];
}

function buildSampledCenterline(waypoints: TrackPoint[]): SampledCenterline {
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
  return { points, cumulativeLengths };
}

const sampledCache = new Map<string, SampledCenterline>();

export function createTrack(id: string, waypoints: TrackPoint[], trackHalfWidth: number): TrackDefinition {
  const sampled = buildSampledCenterline(waypoints);
  sampledCache.set(id, sampled);
  const trackLength = sampled.cumulativeLengths[sampled.cumulativeLengths.length - 1]!;
  return { id, waypoints, trackLength, trackHalfWidth };
}

function sampledFor(track: TrackDefinition): SampledCenterline {
  let sampled = sampledCache.get(track.id);
  if (!sampled) {
    sampled = buildSampledCenterline(track.waypoints);
    sampledCache.set(track.id, sampled);
  }
  return sampled;
}

function wrapProgress(progress: number, trackLength: number): number {
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
  const { points, cumulativeLengths } = sampledFor(track);
  const wrapped = wrapProgress(progress, track.trackLength);
  const index = sampleIndexFor(wrapped, cumulativeLengths);
  const nextIndex = (index + 1) % points.length;
  const segStart = cumulativeLengths[index]!;
  const segEnd = index + 1 < cumulativeLengths.length ? cumulativeLengths[index + 1]! : track.trackLength;
  const span = segEnd - segStart || 1;
  const t = Math.min(1, Math.max(0, (wrapped - segStart) / span));
  const a = points[index]!;
  const b = points[nextIndex]!;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function centerlineTangentAngle(track: TrackDefinition, progress: number): number {
  const ahead = centerlinePoint(track, progress + 1);
  const behind = centerlinePoint(track, progress - 1);
  return Math.atan2(ahead.x - behind.x, -(ahead.z - behind.z));
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

export const TEST_OVAL_TRACK = createTrack("harbor-city-rally", TEST_OVAL_WAYPOINTS, 30);
