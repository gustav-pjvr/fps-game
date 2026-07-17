import { SUN_SHADOW_MAP_SIZE_HIGH, SUN_SHADOW_MAP_SIZE_MEDIUM } from '../core/config.ts';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface GraphicsQualityPreset {
  readonly shadowsEnabled: boolean;
  readonly shadowMapSize: number;
  readonly pixelRatioCap: number;
  /** Image-based lighting via a PMREM of the sky (scene.environment). Adds a prefiltered-envmap
   * sample to every MeshStandardMaterial fragment - cheap on real GPU hardware, but ruinous on the
   * software (SwiftShader) renderer the e2e sandbox uses (measured: it alone pushed the smoke suite
   * from ~24s to 30s+ timeouts). Gated to High for the same reason shadowMapSize is: High targets
   * real GPUs. Low/Medium fall back to a flat AmbientLight fill (see Game.addLighting). */
  readonly environmentLighting: boolean;
  /** Multiplies scene.environment's contribution (three.js Scene.environmentIntensity) - only
   * meaningful when environmentLighting is true. The sky's own PMREM is bright enough that at the
   * default 1.0 it stacks with the full-intensity direct sun to noticeably overexpose/bleach every
   * surface (confirmed visually) - full sky brightness plus full direct sun double-counts the same
   * light source. Scaled down so it reads as fill alongside the sun, not a second sun. Lowered
   * again 0.4 -> 0.2 after live side-by-side screenshots (2026-07-17) showed High still reading
   * washed-out/low-contrast next to Medium's flat 0.6 ambient - at 0.4 the env fill was lifting
   * every shadowed surface enough to flatten the whole image toward white. */
  readonly environmentIntensity: number;
}

/** Medium is what this project's own e2e suite is verified to run cleanly on a software-rendered
 * (SwiftShader) sandbox (see the SUN_SHADOW_MAP_SIZE_* comment in config.ts, where 768+ hard-hung
 * that sandbox) - kept as the default so out-of-the-box behavior matches what's actually tested.
 * High matches VISUAL_REALISM.md's original shadow-quality recommendation for players on real GPU
 * hardware, which has no reason to share the test sandbox's software-rendering ceiling. Low turns
 * shadows off entirely for the lowest-end/most CPU-bound systems. */
export const GRAPHICS_QUALITY_PRESETS: Record<GraphicsQuality, GraphicsQualityPreset> = {
  low: { shadowsEnabled: false, shadowMapSize: SUN_SHADOW_MAP_SIZE_MEDIUM, pixelRatioCap: 1, environmentLighting: false, environmentIntensity: 1 },
  medium: { shadowsEnabled: true, shadowMapSize: SUN_SHADOW_MAP_SIZE_MEDIUM, pixelRatioCap: 2, environmentLighting: false, environmentIntensity: 1 },
  high: { shadowsEnabled: true, shadowMapSize: SUN_SHADOW_MAP_SIZE_HIGH, pixelRatioCap: 2, environmentLighting: true, environmentIntensity: 0.2 },
};

export const GRAPHICS_QUALITY_ORDER: GraphicsQuality[] = ['low', 'medium', 'high'];

export const GRAPHICS_QUALITY_LABELS: Record<GraphicsQuality, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function isGraphicsQuality(value: unknown): value is GraphicsQuality {
  return value === 'low' || value === 'medium' || value === 'high';
}
