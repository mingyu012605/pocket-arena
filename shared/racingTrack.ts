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
  { x: 60, z: -10 },
  { x: 100, z: -50 },
  { x: 100, z: -150 },
  { x: 60, z: -190 },
  { x: 0, z: -200 },
  { x: -60, z: -190 },
  { x: -100, z: -150 },
  { x: -100, z: -50 },
  { x: -60, z: -10 }
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

export const TEST_OVAL_TRACK = createTrack("test-oval", TEST_OVAL_WAYPOINTS, 6);
