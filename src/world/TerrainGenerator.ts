import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../utils/rng.ts';
import {
  TERRAIN_AMPLITUDE,
  TERRAIN_BASE_FREQUENCY,
  TERRAIN_LACUNARITY,
  TERRAIN_OCTAVES,
  TERRAIN_PERSISTENCE,
  WORLD_SEED,
} from '../core/config.ts';

const noise2D = createNoise2D(mulberry32(WORLD_SEED));

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

  return (sum / amplitudeSum) * TERRAIN_AMPLITUDE;
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
