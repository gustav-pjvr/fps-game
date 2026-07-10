import { createNoise2D } from 'simplex-noise';
import { getWorldSeed } from '../core/worldSeed.ts';
import { mulberry32 } from '../utils/rng.ts';
import {
  ENEMY_RING_BASE_RADIUS,
  SPAWN_X,
  SPAWN_Z,
  TERRAIN_AMPLITUDE,
  TERRAIN_BASE_FREQUENCY,
  TERRAIN_EDGE_RIDGE_FREQUENCY,
  TERRAIN_EDGE_RIDGE_WEIGHT,
  TERRAIN_LACUNARITY,
  TERRAIN_OCTAVES,
  TERRAIN_PERSISTENCE,
  WATCH_TOWER_CLEARING_BLEND_MARGIN,
  WORLD_BOUNDARY_RADIUS,
  WORLD_EDGE_MOUNTAIN_HEIGHT,
  WORLD_EDGE_RAMP_START,
} from '../core/config.ts';
import { sampleFlatZone, smoothstep } from './ZoneMap.ts';
import { getWatchTowerPositions, WATCH_TOWER_FOOTPRINT_RADIUS } from './WatchTowerManager.ts';

/**
 * A small, fixed (non-randomized) clearing right around the match spawn point, always flattened
 * toward the height sampled at spawn itself regardless of world seed. Kept just large enough to
 * cover the entity encounter ring (ENEMY_RING_BASE_RADIUS) plus a short margin - without this, a
 * purely random seed can generate a ridge between spawn and a nearby target/enemy, blocking
 * hitscan line-of-sight on an otherwise-normal shot. The old fixed seed (1337) happened to be flat
 * here by luck; that isn't guaranteed once every match gets a fresh seed. Deliberately small so it
 * doesn't flatten meaningful chunks of the generated world - just enough for fair spawn combat.
 */
const SPAWN_CLEARING_RADIUS = ENEMY_RING_BASE_RADIUS + 5;
const SPAWN_CLEARING_INNER_FRACTION = 0.6;

function spawnClearingMembership(worldX: number, worldZ: number): number {
  const dx = worldX - SPAWN_X;
  const dz = worldZ - SPAWN_Z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance >= SPAWN_CLEARING_RADIUS) return 0;
  return 1 - smoothstep(SPAWN_CLEARING_RADIUS * SPAWN_CLEARING_INNER_FRACTION, SPAWN_CLEARING_RADIUS, distance);
}

/**
 * A small flattened clearing around each watch tower's base (see WATCH_TOWER_CLEARING_BLEND_MARGIN's
 * own comment for why this exists: discovered necessary by actually testing a tower in the dev
 * server - a tower's colliders assume flat local ground sampled once at its own center, and this
 * world's mountainous terrain can vary by many meters over just the tower's own footprint width
 * without this, burying the staircase in a slope or leaving it floating above real ground).
 * Unlike the spawn clearing above, the flat inner radius here is exactly the tower's own real
 * footprint (WATCH_TOWER_FOOTPRINT_RADIUS) rather than a fraction of the outer radius - a
 * fraction-based inner radius was the actual bug behind a staircase floating above (or sinking
 * into) its own tower's base: the outer switchback flights' own corners reach further out from
 * center than a smaller fraction-derived flat radius covered, so they landed in the *blending*
 * band instead of the guaranteed-flat one.
 */
const watchTowerClearingOuterRadius = WATCH_TOWER_FOOTPRINT_RADIUS + WATCH_TOWER_CLEARING_BLEND_MARGIN;

function nearestWatchTowerClearing(worldX: number, worldZ: number): { membership: number; index: number } | null {
  const positions = getWatchTowerPositions();
  let best: { distance: number; index: number } | null = null;

  for (let index = 0; index < positions.length; index++) {
    const position = positions[index]!;
    const distance = Math.hypot(worldX - position.x, worldZ - position.z);
    if (!best || distance < best.distance) best = { distance, index };
  }

  if (!best || best.distance >= watchTowerClearingOuterRadius) return null;
  const membership = 1 - smoothstep(WATCH_TOWER_FOOTPRINT_RADIUS, watchTowerClearingOuterRadius, best.distance);
  return { membership, index: best.index };
}

/** Cached per seed (invalidated alongside flatZoneHeightCache below) since it's a pure function of
 * the current seed's noise field sampled at a single fixed point. */
let spawnClearingHeightCache: number | null = null;
/** One flattened target height per tower, indexed the same way getWatchTowerPositions() orders
 * its results - same "pure function of a fixed point, cheap to cache" reasoning as
 * spawnClearingHeightCache above. */
let watchTowerHeightCache: number[] = [];

// Noise generators are rebuilt lazily whenever the world seed changes (see worldSeed.ts) rather
// than created once at module load - a fresh match calls randomizeWorldSeed() before generating
// anything, and these must pick that up without a page reload.
let noiseSeed: number | null = null;
let noise2D: (x: number, y: number) => number;
let ridgeNoise2D: (x: number, y: number) => number;

function ensureNoiseForCurrentSeed(): void {
  const seed = getWorldSeed();
  if (noiseSeed === seed) return;
  noiseSeed = seed;
  noise2D = createNoise2D(mulberry32(seed));
  ridgeNoise2D = createNoise2D(mulberry32(seed + 1));
  flatZoneHeightCache.clear(); // cached heights from the previous world's seed are no longer valid
  spawnClearingHeightCache = null;
  watchTowerHeightCache = [];
}

/** Layered (fBm) simplex noise sampled in continuous world coordinates, so neighboring chunks tile
 * seamlessly, plus the edge mountain ring - the terrain *before* any flat-zone flattening is
 * blended in. Also used by sampleHeight itself to measure a flat zone's target height at its own
 * site center (see below), so this must stay independent of ZoneMap to avoid recursion. */
export function sampleBaseHeight(worldX: number, worldZ: number): number {
  ensureNoiseForCurrentSeed();

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
  let height = base;

  const spawnMembership = spawnClearingMembership(worldX, worldZ);
  if (spawnMembership > 0) {
    if (spawnClearingHeightCache === null) {
      spawnClearingHeightCache = sampleBaseHeight(SPAWN_X, SPAWN_Z);
    }
    height += (spawnClearingHeightCache - height) * spawnMembership;
  }

  const towerClearing = nearestWatchTowerClearing(worldX, worldZ);
  if (towerClearing && towerClearing.membership > 0) {
    let towerHeight = watchTowerHeightCache[towerClearing.index];
    if (towerHeight === undefined) {
      const position = getWatchTowerPositions()[towerClearing.index]!;
      towerHeight = sampleBaseHeight(position.x, position.z);
      watchTowerHeightCache[towerClearing.index] = towerHeight;
    }
    height += (towerHeight - height) * towerClearing.membership;
  }

  const flatZone = sampleFlatZone(worldX, worldZ);
  if (flatZone.membership <= 0) return height;

  const cacheKey = `${flatZone.gx},${flatZone.gz}`;
  let flatHeight = flatZoneHeightCache.get(cacheKey);
  if (flatHeight === undefined) {
    flatHeight = sampleBaseHeight(flatZone.siteX, flatZone.siteZ);
    flatZoneHeightCache.set(cacheKey, flatHeight);
  }

  return height + (flatHeight - height) * flatZone.membership;
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
