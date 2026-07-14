export interface RacingCarFrame {
  progress: number;
  lateralOffset: number;
  headingError: number;
  speed: number;
  rank: number;
  stale: boolean;
}

export interface RacingSnapshot {
  time: number;
  players: Map<number, RacingCarFrame>;
}

export const RENDER_DELAY_MS = 55;
export const MAX_EXTRAPOLATE_MS = 100;
export const MAX_SNAPSHOTS = 8;

const TWO_PI = Math.PI * 2;

/** Shortest signed delta from `from` to `to` around a loop of length `wrapLength` (e.g. lap progress, or 2*PI for angles). */
export function shortestDelta(from: number, to: number, wrapLength: number): number {
  if (!(wrapLength > 0)) return to - from;
  let delta = (to - from) % wrapLength;
  if (delta > wrapLength / 2) delta -= wrapLength;
  if (delta < -wrapLength / 2) delta += wrapLength;
  return delta;
}

function wrapValue(value: number, wrapLength: number): number {
  if (!(wrapLength > 0)) return value;
  const wrapped = value % wrapLength;
  return wrapped < 0 ? wrapped + wrapLength : wrapped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Server-authoritative snapshot buffer with wrap-aware interpolation.
 *
 * Pure/DOM-free by design: the renderer owns the THREE.js side, this module
 * only owns the small buffer of recent server snapshots and the math that
 * turns "current time" into a smoothed car frame. Progress is a position
 * along a closed loop, so naive linear interpolation between two raw
 * progress values breaks every lap: once progress wraps from near
 * `trackLength` back to 0, `next - prev` is a huge negative number and the
 * car appears to sweep backward across the entire track for one
 * interpolation window instead of continuing forward through the finish
 * line. `shortestDelta` fixes that by always blending the short way around
 * the loop, whether the car is lapping forward or briefly reversing.
 */
export class RacingInterpolationBuffer {
  private snapshots: RacingSnapshot[] = [];

  constructor(
    private readonly trackLength: number,
    private readonly maxLateralOffset = Infinity,
    private readonly renderDelayMs = RENDER_DELAY_MS,
    private readonly maxExtrapolateMs = MAX_EXTRAPOLATE_MS,
    private readonly maxSnapshots = MAX_SNAPSHOTS
  ) {}

  /** Clears all buffered snapshots. Call on rematch/reconnect so the old race's positions never blend with the new one's. */
  reset(): void {
    this.snapshots = [];
  }

  get size(): number {
    return this.snapshots.length;
  }

  /** The most recent raw (non-interpolated) server frame for a player, for dev-mode drift visualization. */
  latestRawFrame(playerNumber: number): RacingCarFrame | undefined {
    const last = this.snapshots[this.snapshots.length - 1];
    return last?.players.get(playerNumber);
  }

  addSnapshot(time: number, players: Map<number, RacingCarFrame>): void {
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && time === last.time) {
      this.snapshots[this.snapshots.length - 1] = { time, players };
      return;
    }
    if (last && time < last.time) {
      const index = this.snapshots.findIndex((snapshot) => snapshot.time > time);
      if (index === -1) this.snapshots.push({ time, players });
      else this.snapshots.splice(index, 0, { time, players });
    } else {
      this.snapshots.push({ time, players });
    }
    if (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
  }

  interpolate(now: number): Map<number, RacingCarFrame> {
    if (this.snapshots.length === 0) return new Map();
    if (this.snapshots.length === 1) return this.snapshots[0]!.players;

    const renderTime = now - this.renderDelayMs;
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
    const t = clamp(rawT, 0, 1);
    const result = new Map<number, RacingCarFrame>();

    for (const [playerNumber, nextFrame] of next.players) {
      const prevFrame = prev.players.get(playerNumber) ?? nextFrame;
      const progressDelta = shortestDelta(prevFrame.progress, nextFrame.progress, this.trackLength);
      const headingDelta = shortestDelta(prevFrame.headingError, nextFrame.headingError, TWO_PI);

      let progress = wrapValue(prevFrame.progress + progressDelta * t, this.trackLength);
      let lateralOffset = prevFrame.lateralOffset + (nextFrame.lateralOffset - prevFrame.lateralOffset) * t;
      const headingError = prevFrame.headingError + headingDelta * t;
      const speed = prevFrame.speed + (nextFrame.speed - prevFrame.speed) * t;

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

      result.set(playerNumber, { progress, lateralOffset, headingError, speed, rank: nextFrame.rank, stale: nextFrame.stale });
    }
    return result;
  }
}
