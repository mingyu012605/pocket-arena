export type RacingQualityPreset = "low" | "medium" | "high";

export const DEFAULT_RACING_QUALITY: RacingQualityPreset = "medium";

export interface RacingQualitySettings {
  preset: RacingQualityPreset;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  environmentDensity: number;
  particles: number;
  adaptivePixelRatio: boolean;
}

export function getDefaultRacingQuality(): RacingQualitySettings {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("quality") ?? window.localStorage.getItem("pocket-arena:racingQuality");
  const preset: RacingQualityPreset =
    requested === "low" || requested === "medium" || requested === "high" ? requested : DEFAULT_RACING_QUALITY;
  if (preset === "low") {
    return {
      preset,
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
    maxPixelRatio: 1.35,
    shadows: true,
    shadowMapSize: 1024,
    environmentDensity: 0.9,
    particles: 300,
    adaptivePixelRatio: true
  };
}
