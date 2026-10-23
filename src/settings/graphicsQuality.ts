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
   * real GPUs. Low/Medium fall back to a hemisphere fill (see Game.addLighting); its strength lives in
   * render/look.ts with the rest of the art direction. */
  readonly environmentLighting: boolean;
  /** The post stack (render/PostStack.ts): HDR buffer, bloom, the stylised-dusk grade, SMAA, and the
   * weapon in its own pass. Off on Low, which renders straight to the screen with ACES only. */
  readonly postProcessing: boolean;
  /** N8AO screen-space ambient occlusion inside the post stack. High only (real GPUs). */
  readonly ambientOcclusion: boolean;
}

/** Medium is what this project's own e2e suite is verified to run cleanly on a software-rendered
 * (SwiftShader) sandbox (see the SUN_SHADOW_MAP_SIZE_* comment in config.ts, where 768+ hard-hung
 * that sandbox) - kept as the default so out-of-the-box behavior matches what's actually tested.
 * High matches VISUAL_REALISM.md's original shadow-quality recommendation for players on real GPU
 * hardware, which has no reason to share the test sandbox's software-rendering ceiling. Low turns
 * shadows off entirely for the lowest-end/most CPU-bound systems. */
export const GRAPHICS_QUALITY_PRESETS: Record<GraphicsQuality, GraphicsQualityPreset> = {
  low: { shadowsEnabled: false, shadowMapSize: SUN_SHADOW_MAP_SIZE_MEDIUM, pixelRatioCap: 1, environmentLighting: false, postProcessing: false, ambientOcclusion: false },
  medium: { shadowsEnabled: true, shadowMapSize: SUN_SHADOW_MAP_SIZE_MEDIUM, pixelRatioCap: 2, environmentLighting: false, postProcessing: true, ambientOcclusion: false },
  high: { shadowsEnabled: true, shadowMapSize: SUN_SHADOW_MAP_SIZE_HIGH, pixelRatioCap: 2, environmentLighting: true, postProcessing: true, ambientOcclusion: true },
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
