export type RacingQualityPreset = "low" | "medium" | "high";
export type RacingQualitySelection = RacingQualityPreset | "auto";

export const DEFAULT_RACING_QUALITY_SELECTION: RacingQualitySelection = "auto";
export const RACING_QUALITY_STORAGE_KEY = "pocket-arena:racingQuality";

export interface RacingQualitySettings {
  preset: RacingQualityPreset;
  selection: RacingQualitySelection;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  environmentDensity: number;
  particles: number;
  adaptivePixelRatio: boolean;
}

/**
 * "Auto" picks a starting tier from rough device-capability signals, once,
 * at mount time - not a continuous benchmark loop, since environment
 * density/shadows/particle counts are baked into geometry at construction
 * and can't be cheaply swapped mid-race without a remount. The existing
 * per-frame adaptive pixel ratio (see renderer.ts) still fine-tunes within
 * whichever tier this picks.
 */
function resolveAutoPreset(): RacingQualityPreset {
  if (typeof navigator === "undefined") return "medium";
  const cores = navigator.hardwareConcurrency ?? 4;
  const pixelRatio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const isCoarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (cores <= 2 || (isCoarsePointer && pixelRatio >= 3)) return "low";
  if (cores >= 8 && !isCoarsePointer) return "high";
  return "medium";
}

function presetSettings(preset: RacingQualityPreset, selection: RacingQualitySelection): RacingQualitySettings {
  if (preset === "low") {
    return {
      preset,
      selection,
      maxPixelRatio: 1,
      shadows: false,
      shadowMapSize: 512,
      environmentDensity: 0.45,
      particles: 80,
      adaptivePixelRatio: true
    };
  }
  if (preset === "high") {
    return {
      preset,
      selection,
      maxPixelRatio: 1.65,
      shadows: true,
      shadowMapSize: 1536,
      environmentDensity: 1.18,
      particles: 520,
      adaptivePixelRatio: true
    };
  }
  return {
    preset,
    selection,
    maxPixelRatio: 1.35,
    shadows: true,
    shadowMapSize: 1024,
    environmentDensity: 0.9,
    particles: 300,
    adaptivePixelRatio: true
  };
}

export function getDefaultRacingQuality(): RacingQualitySettings {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("quality") ?? window.localStorage.getItem(RACING_QUALITY_STORAGE_KEY);
  const selection: RacingQualitySelection =
    requested === "low" || requested === "medium" || requested === "high" || requested === "auto"
      ? requested
      : DEFAULT_RACING_QUALITY_SELECTION;
  const preset = selection === "auto" ? resolveAutoPreset() : selection;
  return presetSettings(preset, selection);
}
