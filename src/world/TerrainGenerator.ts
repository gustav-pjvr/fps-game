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

const noise2D = createNoise2D(mulberry32(WORLD_SEED));
const ridgeNoise2D = createNoise2D(mulberry32(WORLD_SEED + 1));

/** Layered (fBm) simplex noise sampled in continuous world coordinates, so neighboring chunks tile seamlessly. */
export function sampleHeight(worldX: number, worldZ: number): number {
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
