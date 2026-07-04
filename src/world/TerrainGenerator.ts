import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../utils/rng.ts';
import {
  TERRAIN_AMPLITUDE,
  TERRAIN_BASE_FREQUENCY,
  TERRAIN_EDGE_RIDGE_FREQUENCY,
  TERRAIN_EDGE_RIDGE_WEIGHT,
  TERRAIN_LACUNARITY,
  TERRAIN_OCTAVES,
  TERRAIN_PERSISTENCE,
  WORLD_BOUNDARY_RADIUS,
  WORLD_EDGE_MOUNTAIN_HEIGHT,
  WORLD_EDGE_RAMP_START,
  WORLD_SEED,
} from '../core/config.ts';
import { sampleFlatZone } from './ZoneMap.ts';

const noise2D = createNoise2D(mulberry32(WORLD_SEED));
const ridgeNoise2D = createNoise2D(mulberry32(WORLD_SEED + 1));

/** Layered (fBm) simplex noise sampled in continuous world coordinates, so neighboring chunks tile
 * seamlessly, plus the edge mountain ring - the terrain *before* any flat-zone flattening is
 * blended in. Also used by sampleHeight itself to measure a flat zone's target height at its own
 * site center (see below), so this must stay independent of ZoneMap to avoid recursion. */
export function sampleBaseHeight(worldX: number, worldZ: number): number {
  let amplitude = 1;
  let frequency = TERRAIN_BASE_FREQUENCY;
  let sum = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < TERRAIN_OCTAVES; octave++) {
    sum += noise2D(worldX * frequency, worldZ * frequency) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= TERRAIN_PERSISTENCE;
    frequency *= TERRAIN_LACUNARITY;
  }

  const baseHeight = (sum / amplitudeSum) * TERRAIN_AMPLITUDE;
  const distanceFromOrigin = Math.sqrt(worldX * worldX + worldZ * worldZ);
  return baseHeight + edgeMountainHeight(worldX, worldZ, distanceFromOrigin);
}

/** Per-zone flattened target height is constant across the whole zone (a pure function of its site
 * center), so every chunk that samples inside it agrees - cached per zone cell since it's called
 * once per vertex but only actually changes per (gx,gz). Purely a derived/recomputable cache. */
const flatZoneHeightCache = new Map<string, number>();

/**
 * World height including flat-zone flattening (WORLD_PLAN.md follow-up: towns need genuinely flat
 * ground, not just naturally-flat-by-luck terrain). Blends the natural terrain toward a constant
 * per-zone height as flat-zone membership approaches 1, easing back to natural terrain at the
 * zone's rim - see ZoneMap.sampleFlatZone for the zone geometry itself.
 */
export function sampleHeight(worldX: number, worldZ: number): number {
  const base = sampleBaseHeight(worldX, worldZ);

  const flatZone = sampleFlatZone(worldX, worldZ);
  if (flatZone.membership <= 0) return base;

  const cacheKey = `${flatZone.gx},${flatZone.gz}`;
  let flatHeight = flatZoneHeightCache.get(cacheKey);
  if (flatHeight === undefined) {
    flatHeight = sampleBaseHeight(flatZone.siteX, flatZone.siteZ);
    flatZoneHeightCache.set(cacheKey, flatHeight);
  }

  return base + (flatHeight - base) * flatZone.membership;
}

/**
 * Additive height that ramps up as distance from world origin approaches WORLD_BOUNDARY_RADIUS,
 * turning the bounded world's edge into a mountain ring (WORLD_PLAN.md §2) instead of a hard stop.
 * Smoothstep keeps the transition seamless with the interior terrain; ridge noise (a second,
 * independently seeded field) breaks up the ring so it doesn't read as a uniform dome.
 */
function edgeMountainHeight(worldX: number, worldZ: number, distanceFromOrigin: number): number {
  if (distanceFromOrigin <= WORLD_EDGE_RAMP_START) return 0;

  const t = Math.min(1, (distanceFromOrigin - WORLD_EDGE_RAMP_START) / (WORLD_BOUNDARY_RADIUS - WORLD_EDGE_RAMP_START));
  const falloff = t * t * (3 - 2 * t);
  const ridge = ridgeNoise2D(worldX * TERRAIN_EDGE_RIDGE_FREQUENCY, worldZ * TERRAIN_EDGE_RIDGE_FREQUENCY);
  return falloff * (WORLD_EDGE_MOUNTAIN_HEIGHT + ridge * WORLD_EDGE_MOUNTAIN_HEIGHT * TERRAIN_EDGE_RIDGE_WEIGHT);
}

/**
 * Row-major heightmap: heights[row * verticesPerSide + col], row along world Z, col along world X,
 * starting at (originX, originZ) and spanning `size` world units with `resolution` segments per side.
 */
export function generateHeightfield(
  resolution: number,
  size: number,
  originX: number,
  originZ: number,
): Float32Array {
  const verticesPerSide = resolution + 1;
  const heights = new Float32Array(verticesPerSide * verticesPerSide);
  const step = size / resolution;

  for (let row = 0; row < verticesPerSide; row++) {
    for (let col = 0; col < verticesPerSide; col++) {
      const worldX = originX + col * step;
      const worldZ = originZ + row * step;
      heights[row * verticesPerSide + col] = sampleHeight(worldX, worldZ);
    }
  }

  return heights;
}
