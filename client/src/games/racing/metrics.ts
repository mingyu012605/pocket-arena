import * as THREE from "three";
import type { RacingQualityPreset } from "./quality";

interface RacingMetricsOptions {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  getActiveCars: () => number;
  getQualityPreset: () => RacingQualityPreset;
  getSnapshotHz: () => number;
  getLatestSnapshotAgeMs: () => number | null;
  getLifecycleStats: () => RacingLifecycleStats;
}

const METRICS_UPDATE_MS = 250;
const FRAME_WINDOW_MS = 60_000;

export interface RacingLifecycleStats {
  rendererInstances: number;
  resizeListeners: number;
  rafLoops: number;
  socketGameStateListeners: number;
}

export interface RacingPerformanceSample {
  fps: number;
  averageFrameTimeMs: number;
  p95FrameTimeMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
  qualityPreset: RacingQualityPreset;
  activeCars: number;
  snapshotHz: number;
  latestSnapshotAgeMs: number | null;
  viewport: { width: number; height: number };
  lifecycle: RacingLifecycleStats;
  webglRenderer: string;
}

declare global {
  interface Window {
    __pocketArenaRacingMetrics?: RacingPerformanceSample;
    __pocketArenaRacingDebug?: Partial<RacingLifecycleStats>;
  }
}

export function shouldShowRacingMetrics(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("dev") === "1";
}

export class RacingMetricsOverlay {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly getActiveCars: () => number;
  private readonly getQualityPreset: () => RacingQualityPreset;
  private readonly getSnapshotHz: () => number;
  private readonly getLatestSnapshotAgeMs: () => number | null;
  private readonly getLifecycleStats: () => RacingLifecycleStats;
  private readonly root: HTMLDivElement;
  private lastFrameAt = performance.now();
  private lastUpdateAt = performance.now();
  private frameCount = 0;
  private frameTimeTotal = 0;
  private frameTimes: Array<{ time: number; delta: number }> = [];
  private fps = 0;
  private frameTimeMs = 0;
  private p95FrameTimeMs = 0;
  private readonly webglRenderer: string;

  constructor({ container, renderer, getActiveCars, getQualityPreset, getSnapshotHz, getLatestSnapshotAgeMs, getLifecycleStats }: RacingMetricsOptions) {
    this.renderer = renderer;
    this.getActiveCars = getActiveCars;
    this.getQualityPreset = getQualityPreset;
    this.getSnapshotHz = getSnapshotHz;
    this.getLatestSnapshotAgeMs = getLatestSnapshotAgeMs;
    this.getLifecycleStats = getLifecycleStats;
    this.root = document.createElement("div");
    this.root.className = "racing-metrics-overlay";
    this.root.setAttribute("aria-label", "Racing performance metrics");
    container.appendChild(this.root);
    this.webglRenderer = this.detectWebglRenderer();
  }

  update(timestamp: number): void {
    const delta = Math.max(0, timestamp - this.lastFrameAt);
    this.lastFrameAt = timestamp;
    this.frameCount += 1;
    this.frameTimeTotal += delta;
    this.frameTimes.push({ time: timestamp, delta });
    while (this.frameTimes.length > 0 && timestamp - this.frameTimes[0]!.time > FRAME_WINDOW_MS) {
      this.frameTimes.shift();
    }

    if (timestamp - this.lastUpdateAt < METRICS_UPDATE_MS) return;

    const sorted = this.frameTimes.map((sample) => sample.delta).sort((a, b) => a - b);
    const windowSpan = this.frameTimes.length > 1 ? this.frameTimes[this.frameTimes.length - 1]!.time - this.frameTimes[0]!.time : 0;
    this.fps = windowSpan > 0 ? ((this.frameTimes.length - 1) * 1000) / windowSpan : 0;
    this.frameTimeMs =
      this.frameTimes.length > 0
        ? this.frameTimes.reduce((total, sample) => total + sample.delta, 0) / this.frameTimes.length
        : 0;
    this.p95FrameTimeMs = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)]! : 0;
    this.frameCount = 0;
    this.frameTimeTotal = 0;
    this.lastUpdateAt = timestamp;
    this.render();
  }

  destroy(): void {
    this.root.remove();
    delete window.__pocketArenaRacingMetrics;
  }

  private render(): void {
    const renderInfo = this.renderer.info.render;
    const memoryInfo = this.renderer.info.memory;
    const size = this.renderer.getSize(new THREE.Vector2());
    const sample: RacingPerformanceSample = {
      fps: this.fps,
      averageFrameTimeMs: this.frameTimeMs,
      p95FrameTimeMs: this.p95FrameTimeMs,
      drawCalls: renderInfo.calls,
      triangles: renderInfo.triangles,
      textures: memoryInfo.textures,
      geometries: memoryInfo.geometries,
      activeCars: this.getActiveCars(),
      qualityPreset: this.getQualityPreset(),
      pixelRatio: this.renderer.getPixelRatio(),
      snapshotHz: this.getSnapshotHz(),
      latestSnapshotAgeMs: this.getLatestSnapshotAgeMs(),
      viewport: { width: size.x, height: size.y },
      lifecycle: this.getLifecycleStats(),
      webglRenderer: this.webglRenderer
    };
    window.__pocketArenaRacingMetrics = sample;
    this.root.textContent = [
      `FPS ${sample.fps.toFixed(0)}`,
      `Frame ${sample.averageFrameTimeMs.toFixed(1)}ms`,
      `P95 ${sample.p95FrameTimeMs.toFixed(1)}ms`,
      `Snap ${sample.snapshotHz.toFixed(1)}Hz`,
      `Age ${sample.latestSnapshotAgeMs === null ? "n/a" : `${Math.round(sample.latestSnapshotAgeMs)}ms`}`,
      `Calls ${renderInfo.calls}`,
      `Tris ${renderInfo.triangles}`,
      `Textures ${memoryInfo.textures}`,
      `Geometries ${memoryInfo.geometries}`,
      `Cars ${this.getActiveCars()}`,
      `Quality ${this.getQualityPreset()}`,
      `DPR ${this.renderer.getPixelRatio().toFixed(2)}`,
      `RAF ${sample.lifecycle.rafLoops}`,
      `RR ${sample.lifecycle.rendererInstances}`,
      `Resize ${sample.lifecycle.resizeListeners}`,
      `GS ${sample.lifecycle.socketGameStateListeners}`,
      `GL ${sample.webglRenderer}`
    ].join(" | ");
  }

  private detectWebglRenderer(): string {
    const context = this.renderer.getContext();
    const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
    if (!debugInfo) return "unavailable";
    return String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
  }
}
