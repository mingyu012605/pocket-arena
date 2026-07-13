export type RacingQualityPreset = "low" | "medium" | "high";

export const DEFAULT_RACING_QUALITY: RacingQualityPreset = "high";

export interface RacingQualitySettings {
  preset: RacingQualityPreset;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  environmentDensity: number;
  particles: number;
}

export function getDefaultRacingQuality(): RacingQualitySettings {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("quality") ?? window.localStorage.getItem("pocket-arena:racingQuality");
  const preset: RacingQualityPreset = requested === "low" || requested === "high" ? requested : DEFAULT_RACING_QUALITY;
  if (preset === "low") {
    return {
      preset,
      maxPixelRatio: 1,
      shadows: false,
      shadowMapSize: 512,
      environmentDensity: 0.45,
      particles: 80
    };
  }
  if (preset === "high") {
    return {
      preset,
      maxPixelRatio: 1.75,
      shadows: true,
      shadowMapSize: 2048,
      environmentDensity: 1.25,
      particles: 640
    };
  }
  return {
    preset,
    maxPixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    environmentDensity: 0.72,
    particles: 220
  };
}
