import * as THREE from 'three';
import type { MatchWeather } from '../core/config.ts';

/** The art direction in numbers (docs/visual-overhaul.md, "Art direction: stylised dusk"). One
 * preset per match weather, all drawn from the same palette, so every system that colours the
 * world (sky, fog, lights, the post grade, the material regrade) reads from here instead of
 * keeping its own hex values. Colours are sRGB hex like the doc's palette table; THREE.Color
 * converts them to linear on assignment. */
export interface LookPreset {
  /** Unit vector from the ground toward the sun (or the moon at night). */
  readonly sunDirection: THREE.Vector3;
  readonly sunColor: number;
  readonly sunIntensity: number;
  /** Hemisphere fill used when image-based lighting is off (Low/Medium). */
  readonly hemiSkyColor: number;
  readonly hemiGroundColor: number;
  readonly hemiIntensity: number;
  /** Multiplier on scene.environment (the PMREM of the sky) when image-based lighting is on. */
  readonly environmentIntensity: number;
  readonly sky: {
    readonly zenith: number;
    readonly band: number;
    /** Horizon and fog colour looking away from the sun. */
    readonly haze: number;
    /** Horizon and fog colour looking toward the sun. */
    readonly horizonSun: number;
    /** How strongly the sun side tints the horizon and the fog, 0 to 1. */
    readonly horizonSunStrength: number;
    readonly sunDisc: number;
    /** Angular radius of the visible disc, in radians. */
    readonly sunDiscRadius: number;
    readonly sunGlow: number;
    readonly stars: number;
  };
  /** Linear fog for the world edge (near/far), plus `haze`: an exponential atmospheric falloff per
   * metre layered on top, so mid-distance hills fade toward the horizon colour as they do at dusk. */
  readonly fog: { readonly near: number; readonly far: number; readonly haze: number };
  readonly exposure: number;
  readonly grade: {
    /** Added to the shadows (linear, after tone mapping). */
    readonly lift: number;
    /** Multiplied into the highlights. */
    readonly gain: number;
    readonly saturation: number;
    readonly contrast: number;
    readonly vignette: number;
    readonly grain: number;
  };
  readonly bloom: { readonly intensity: number; readonly threshold: number };
  /** Emissive strength of building windows (render/materialGrade.ts). */
  readonly windowGlow: number;
}

function sunFrom(elevationDeg: number, azimuthDeg: number): THREE.Vector3 {
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  return new THREE.Vector3(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth)).normalize();
}

/** The old fixed sun (20, 30, 10) came from azimuth ~26.6 deg; keeping that azimuth means maps and
 * spawn sightlines players already know keep their shadows falling the same way, just longer. */
const SUN_AZIMUTH_DEG = 26.6;

export const LOOK_PRESETS: Record<MatchWeather, LookPreset> = {
  // "Day" in the match setup is the dusk the art direction is built around.
  day: {
    // Low enough for long dusk shadows, high enough that hills don't drown whole valleys in shade
    // (readability matters more than drama in a shooter).
    sunDirection: sunFrom(24, SUN_AZIMUTH_DEG),
    sunColor: 0xffc78a,
    sunIntensity: 2.6,
    hemiSkyColor: 0x7d9a94,
    hemiGroundColor: 0x4a4636,
    hemiIntensity: 2.4,
    environmentIntensity: 0.55,
    sky: {
      zenith: 0x1c3236,
      band: 0x4d6a66,
      haze: 0x8a8a76,
      horizonSun: 0xdc9f5c,
      horizonSunStrength: 0.85,
      sunDisc: 0xffe2b0,
      sunDiscRadius: 0.022,
      sunGlow: 0xe8a64a,
      stars: 0,
    },
    // Far sits just past WORLD_HARD_CLAMP_RADIUS so the world edge dissolves into the haze.
    fog: { near: 30, far: 640, haze: 0.0026 },
    exposure: 1.05,
    grade: { lift: 0.03, gain: 1.04, saturation: 0.88, contrast: 1.0, vignette: 0.3, grain: 0.035 },
    bloom: { intensity: 0.85, threshold: 0.9 },
    windowGlow: 1.4,
  },
  night: {
    sunDirection: sunFrom(38, SUN_AZIMUTH_DEG + 150),
    sunColor: 0x8fb0d6,
    sunIntensity: 0.55,
    hemiSkyColor: 0x2c4256,
    hemiGroundColor: 0x161a18,
    hemiIntensity: 0.9,
    environmentIntensity: 0.9,
    sky: {
      zenith: 0x050b14,
      band: 0x0e1c26,
      haze: 0x1d2a30,
      horizonSun: 0x2f4552,
      horizonSunStrength: 0.5,
      sunDisc: 0xdfe8f0,
      sunDiscRadius: 0.018,
      sunGlow: 0x5f7f99,
      stars: 1,
    },
    fog: { near: 25, far: 420, haze: 0.004 },
    exposure: 1.25,
    grade: { lift: 0.018, gain: 1.0, saturation: 0.8, contrast: 1.06, vignette: 0.4, grain: 0.045 },
    bloom: { intensity: 1.1, threshold: 0.75 },
    windowGlow: 3.2,
  },
  fog: {
    sunDirection: sunFrom(24, SUN_AZIMUTH_DEG),
    sunColor: 0xd8cfb8,
    sunIntensity: 1.1,
    hemiSkyColor: 0x8a948c,
    hemiGroundColor: 0x45463a,
    hemiIntensity: 1.3,
    environmentIntensity: 0.7,
    sky: {
      zenith: 0x56635f,
      band: 0x7a8580,
      haze: 0x8e958b,
      horizonSun: 0xb5ab90,
      horizonSunStrength: 0.45,
      sunDisc: 0xf2e8d0,
      sunDiscRadius: 0.03,
      sunGlow: 0xb9a57c,
      stars: 0,
    },
    // Close to the old FogExp2 at density 0.035 (fully fogged by about 90 m).
    fog: { near: 2, far: 95, haze: 0 },
    exposure: 1.0,
    grade: { lift: 0.015, gain: 1.0, saturation: 0.8, contrast: 1.04, vignette: 0.34, grain: 0.04 },
    bloom: { intensity: 0.7, threshold: 0.95 },
    windowGlow: 1.8,
  },
};

export function lookFor(weather: MatchWeather): LookPreset {
  return LOOK_PRESETS[weather];
}

/** Accent colours shared by world effects and the HUD (the doc's palette table). */
export const ACCENT_CYAN = 0x6ff0dc;
export const ACCENT_AMBER = 0xe8a64a;
export const THREAT_RED = 0xff5a3c;
