import * as THREE from "three";
import type { RacingQualityPreset } from "./quality";

interface RacingMetricsOptions {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  getActiveCars: () => number;
  getQualityPreset: () => RacingQualityPreset;
}

const METRICS_UPDATE_MS = 250;

export function shouldShowRacingMetrics(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("dev") === "1";
}

export class RacingMetricsOverlay {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly getActiveCars: () => number;
  private readonly getQualityPreset: () => RacingQualityPreset;
  private readonly root: HTMLDivElement;
  private lastFrameAt = performance.now();
  private lastUpdateAt = performance.now();
  private frameCount = 0;
  private frameTimeTotal = 0;
  private fps = 0;
  private frameTimeMs = 0;

  constructor({ container, renderer, getActiveCars, getQualityPreset }: RacingMetricsOptions) {
    this.renderer = renderer;
    this.getActiveCars = getActiveCars;
    this.getQualityPreset = getQualityPreset;
    this.root = document.createElement("div");
    this.root.className = "racing-metrics-overlay";
    this.root.setAttribute("aria-label", "Racing performance metrics");
    container.appendChild(this.root);
  }

  update(timestamp: number): void {
    const delta = Math.max(0, timestamp - this.lastFrameAt);
    this.lastFrameAt = timestamp;
    this.frameCount += 1;
    this.frameTimeTotal += delta;

    if (timestamp - this.lastUpdateAt < METRICS_UPDATE_MS) return;

    const elapsed = Math.max(1, timestamp - this.lastUpdateAt);
    this.fps = (this.frameCount * 1000) / elapsed;
    this.frameTimeMs = this.frameTimeTotal / Math.max(1, this.frameCount);
    this.frameCount = 0;
    this.frameTimeTotal = 0;
    this.lastUpdateAt = timestamp;
    this.render();
  }

  destroy(): void {
    this.root.remove();
  }

  private render(): void {
    const renderInfo = this.renderer.info.render;
    const memoryInfo = this.renderer.info.memory;
    this.root.textContent = [
      `FPS ${this.fps.toFixed(0)}`,
      `Frame ${this.frameTimeMs.toFixed(1)}ms`,
      `Calls ${renderInfo.calls}`,
      `Tris ${renderInfo.triangles}`,
      `Textures ${memoryInfo.textures}`,
      `Geometries ${memoryInfo.geometries}`,
      `Cars ${this.getActiveCars()}`,
      `Quality ${this.getQualityPreset()}`,
      `DPR ${this.renderer.getPixelRatio().toFixed(2)}`
    ].join(" | ");
  }
}
