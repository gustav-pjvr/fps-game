import * as THREE from 'three';
import { GROUND_TEXTURE_WORLD_SIZE } from '../core/config.ts';
import { cutZoneUniforms } from './underground.ts';

/**
 * The ground's look (docs/world-redesign.md, terrain): one Poly Haven "Aerial Grass Rock" texture
 * read as several surfaces. The texture is part moss and part gravel; the shader splits it by how
 * green each texel is and tints the two from the dusk palette, so the photo's detail survives but
 * its colour comes from the look. On top of that:
 * - it samples in world space at two scales and rotations mixed by a slow noise, so the 10 m tile
 *   no longer reads as a grid from a tower;
 * - large patches of lush and dry grass (about 30 and 85 m across) break up the valley;
 * - grass covers most flat ground, thins on slopes from about 23 degrees, and gives way to rock from
 * about 26, rock sampled
 *   side-on so a bank is not a smear;
 * - worn ground (the `surface` attribute: town pads and tower aprons, see TerrainGenerator.groundWear)
 *   turns to packed gravel.
 * It replaces the 'ground' grade of materialGrade.ts, which pulled every texel toward one olive and
 * flattened exactly the variation this adds.
 */

/** Palette (sRGB), chosen against the look tokens in docs/visual-overhaul.md: foliage #4f5f45 to
 * #2e463f, ground #67603f, concrete #a99d84. */
export const TERRAIN_PALETTE = {
  grassLush: 0x3b5a2f,
  grassDry: 0x5c6838,
  soil: 0x655c45,
  gravel: 0x7d776a,
  rock: 0x8d897f,
} as const;

const vertexHead = /* glsl */ `
attribute float surface;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
varying float vTerrainSurface;
`;

const vertexBody = /* glsl */ `
vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);
vTerrainSurface = surface;
`;

const fragmentHead = /* glsl */ `
uniform vec3 uGrassLush;
uniform vec3 uGrassDry;
uniform vec3 uSoil;
uniform vec3 uGravel;
uniform vec3 uRock;
uniform float uTile;
uniform vec4 uCutZones[4];
uniform int uCutZoneCount;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
varying float vTerrainSurface;

float terrainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float terrainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), u.x), mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const fragmentBody = /* glsl */ `
for (int i = 0; i < 4; i++) {
  if (i >= uCutZoneCount) break;
  vec4 zone = uCutZones[i];
  if (all(lessThanEqual(abs(vTerrainPos.xz - zone.xy), zone.zw))) discard;
}
#ifdef USE_MAP
{
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  vec2 ground = vTerrainPos.xz;
  float patchNoise = terrainNoise(ground / 21.0);
  vec3 near = texture2D(map, ground / uTile).rgb;
  vec3 far = texture2D(map, mat2(0.8, -0.6, 0.6, 0.8) * ground / (uTile * 3.7) + 0.31).rgb;
  vec3 tex = mix(near, far, 0.3 + 0.4 * patchNoise);
  // The texture's own mean (its smallest mip), so detail is read relative to it.
  float meanLum = max(dot(textureLod(map, vec2(0.5), 12.0).rgb, LUMA), 1e-3);
  float detail = clamp(dot(tex, LUMA) / meanLum, 0.35, 1.9);
  float greenness = tex.g * 3.0 / max(tex.r + tex.g + tex.b, 1e-3);
  float moss = smoothstep(1.06, 1.3, greenness);

  float macro = terrainNoise(ground / 85.0) * 0.65 + terrainNoise(ground / 31.0) * 0.35;
  float slope = 1.0 - clamp(normalize(vTerrainNormal).y, 0.0, 1.0);
  float wear = clamp(vTerrainSurface, 0.0, 1.0);
  float grass = clamp(0.8 + moss * 0.4 + (macro - 0.5) * 1.1, 0.0, 1.0);
  grass *= (1.0 - smoothstep(0.08, 0.16, slope)) * (1.0 - wear);
  vec3 grassColor = mix(uGrassDry, uGrassLush, smoothstep(0.3, 0.7, macro));
  vec3 soilColor = mix(uSoil, uGravel, wear);
  vec3 surfaceColor = mix(soilColor, grassColor, grass) * mix(1.0, detail, 0.75);

  // Rock, sampled side-on from the two vertical projections, weighted by which way the bank faces.
  float rock = smoothstep(0.1, 0.2, slope + (patchNoise - 0.5) * 0.05);
  vec3 facing = abs(normalize(vTerrainNormal));
  vec3 sideX = texture2D(map, vTerrainPos.zy / (uTile * 0.7)).rgb;
  vec3 sideZ = texture2D(map, vTerrainPos.xy / (uTile * 0.7)).rgb;
  float rockDetail = dot(mix(sideZ, sideX, facing.x / max(facing.x + facing.z, 1e-3)), LUMA) / meanLum;
  vec3 rockColor = uRock * clamp(0.45 + rockDetail * 0.6, 0.4, 1.6);

  diffuseColor.rgb *= mix(surfaceColor, rockColor, rock);
}
#endif
`;


/** Patches a ground MeshStandardMaterial (with `map` set) to draw the splatted terrain. */
export function applyTerrainSplat(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cutZoneUniforms);
    shader.uniforms.uGrassLush = { value: new THREE.Color(TERRAIN_PALETTE.grassLush) };
    shader.uniforms.uGrassDry = { value: new THREE.Color(TERRAIN_PALETTE.grassDry) };
    shader.uniforms.uSoil = { value: new THREE.Color(TERRAIN_PALETTE.soil) };
    shader.uniforms.uGravel = { value: new THREE.Color(TERRAIN_PALETTE.gravel) };
    shader.uniforms.uRock = { value: new THREE.Color(TERRAIN_PALETTE.rock) };
    shader.uniforms.uTile = { value: GROUND_TEXTURE_WORLD_SIZE };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexHead}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBody}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentHead}`)
      .replace('#include <map_fragment>', fragmentBody);
  };
  material.customProgramCacheKey = () => 'terrain-splat';
  material.needsUpdate = true;
}
