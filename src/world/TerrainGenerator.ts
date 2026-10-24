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
  TERRAIN_MACRO_AMPLITUDE,
  TERRAIN_MACRO_FREQUENCY,
  TERRAIN_OCTAVES,
  TERRAIN_PERSISTENCE,
  TERRAIN_RIDGE_AMPLITUDE,
  TERRAIN_RIDGE_FREQUENCY,
  TERRAIN_RIDGE_MASK_FREQUENCY,
  TERRAIN_WARP_FREQUENCY,
  TERRAIN_WARP_STRENGTH,
  FLAT_ZONE_RADIUS_MAX,
  FLAT_ZONE_TERRAIN_SKIRT,
  WATCH_TOWER_CLEARING_BLEND_MARGIN,
  WORLD_BOUNDARY_RADIUS,
  WORLD_EDGE_MOUNTAIN_HEIGHT,
  WORLD_EDGE_RAMP_START,
} from '../core/config.ts';
import { sampleFlatZone, sampleFlatZoneBlends, smoothstep } from './ZoneMap.ts';
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

/** Every tower clearing that reaches (x, z), as its flattening weight and tower index. */
function watchTowerClearings(worldX: number, worldZ: number): { membership: number; index: number }[] {
  const clearings: { membership: number; index: number }[] = [];
  getWatchTowerPositions().forEach((position, index) => {
    const distance = Math.hypot(worldX - position.x, worldZ - position.z);
    if (distance >= watchTowerClearingOuterRadius) return;
    clearings.push({ membership: 1 - smoothstep(WATCH_TOWER_FOOTPRINT_RADIUS, watchTowerClearingOuterRadius, distance), index });
  });
  return clearings;
}

/** Pulls `height` toward several flattening targets at once: toward their weighted mean, by the
 * union of their weights (1 - the product of 1 - w). Order-free, so it stays continuous where two
 * clearings overlap; blending only the nearest one jumped from one target height to the other
 * halfway between them, a cliff of up to 68 degrees between two close towers or two towns
 * (measured 2026-10-24). */
function blendToward(height: number, targets: { weight: number; height: number }[]): number {
  let keep = 1;
  let weightSum = 0;
  let weighted = 0;
  for (const target of targets) {
    keep *= 1 - target.weight;
    // w / (1 - w) grows without bound as w reaches 1, so a target at full weight sets the mean
    // exactly (a tower's footprint stays dead flat however close the next tower stands) and the
    // mean still moves continuously.
    const pull = target.weight / Math.max(1 - target.weight, 1e-9);
    weightSum += pull;
    weighted += pull * target.height;
  }
  if (weightSum <= 0) return height;
  return height + (weighted / weightSum - height) * (1 - keep);
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
let warpNoise2D: (x: number, y: number) => number;
let landformNoise2D: (x: number, y: number) => number;

function ensureNoiseForCurrentSeed(): void {
  const seed = getWorldSeed();
  if (noiseSeed === seed) return;
  noiseSeed = seed;
  noise2D = createNoise2D(mulberry32(seed));
  ridgeNoise2D = createNoise2D(mulberry32(seed + 1));
  warpNoise2D = createNoise2D(mulberry32(seed + 2));
  landformNoise2D = createNoise2D(mulberry32(seed + 3));
  flatZoneHeightCache.clear(); // cached heights from the previous world's seed are no longer valid
  spawnClearingHeightCache = null;
  watchTowerHeightCache = [];
}

/** The natural ground, sampled in continuous world coordinates so neighbouring chunks tile
 * seamlessly: layered (fBm) simplex hills over a domain warp, broad rises and basins, ridgelines in
 * a few masked areas, and the edge mountain ring - the terrain *before* any flattening is blended
 * in. Also used by sampleHeight itself to measure a flat zone's target height at its own site
 * center (see below), so this must stay independent of ZoneMap to avoid recursion. */
export function sampleBaseHeight(worldX: number, worldZ: number): number {
  ensureNoiseForCurrentSeed();

  // Domain warp: the hills are sampled at a point pushed up to TERRAIN_WARP_STRENGTH metres aside
  // by a slow noise field, which stretches round blobs into spurs and winding valleys.
  const warpX = worldX + warpNoise2D(worldX * TERRAIN_WARP_FREQUENCY, worldZ * TERRAIN_WARP_FREQUENCY) * TERRAIN_WARP_STRENGTH;
  const warpZ = worldZ + warpNoise2D(worldX * TERRAIN_WARP_FREQUENCY + 41.3, worldZ * TERRAIN_WARP_FREQUENCY - 17.9) * TERRAIN_WARP_STRENGTH;

  let amplitude = 1;
  let frequency = TERRAIN_BASE_FREQUENCY;
  let sum = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < TERRAIN_OCTAVES; octave++) {
    sum += noise2D(warpX * frequency, warpZ * frequency) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= TERRAIN_PERSISTENCE;
    frequency *= TERRAIN_LACUNARITY;
  }

  const hills = (sum / amplitudeSum) * TERRAIN_AMPLITUDE;
  const macro = landformNoise2D(worldX * TERRAIN_MACRO_FREQUENCY, worldZ * TERRAIN_MACRO_FREQUENCY) * TERRAIN_MACRO_AMPLITUDE;
  // Ridged noise (1 - |n|, squared) peaks in sharp crests along the zero lines of n; the mask keeps
  // ridgelines to some parts of the map so open ground stays open.
  const ridgeMask = smoothstep(0.15, 0.6, landformNoise2D(worldX * TERRAIN_RIDGE_MASK_FREQUENCY + 73.1, worldZ * TERRAIN_RIDGE_MASK_FREQUENCY - 29.4));
  const crest = 1 - Math.abs(landformNoise2D(warpX * TERRAIN_RIDGE_FREQUENCY - 11.7, warpZ * TERRAIN_RIDGE_FREQUENCY + 53.2));
  const ridges = crest * crest * TERRAIN_RIDGE_AMPLITUDE * ridgeMask;
  const distanceFromOrigin = Math.sqrt(worldX * worldX + worldZ * worldZ);
  return hills + macro + ridges + edgeMountainHeight(worldX, worldZ, distanceFromOrigin);
}

/** The height a clearing or pad flattens to: the natural ground averaged over its centre and a ring
 * of eight points `radius` out, so it sits at the middle of the ground around it. Flattening to
 * the height at the centre alone sank a clearing into a pit (or raised it on a plinth) whenever the
 * centre fell on a low point or a crest, up to 9 m below the ground 22 m away (measured
 * 2026-10-24), and the blend band then had to climb that in a few metres. */
function surroundingBaseHeight(centerX: number, centerZ: number, radius: number): number {
  let sum = sampleBaseHeight(centerX, centerZ);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    sum += sampleBaseHeight(centerX + Math.cos(angle) * radius, centerZ + Math.sin(angle) * radius);
  }
  return sum / 9;
}

/** Per-zone flattened target height is constant across the whole zone (a pure function of its site
 * center), so every chunk that samples inside it agrees - cached per zone cell since it's called
 * once per vertex but only actually changes per (gx,gz). Purely a derived/recomputable cache. */
const flatZoneHeightCache = new Map<string, number>();

/** The pad height of the town at cell (gx, gz). Towns whose zones overlap share one height, the
 * mean of each member's surrounding ground: two overlapping cores flattened to two different
 * heights met at a 66 degree wall (one seed in seven, 2026-10-24), however the two are blended.
 * Towns whose skirts merely touch keep their own heights: the order-free blend eases between them,
 * and joining those too pulled pads metres away from the ground around them. */
function padHeight(gx: number, gz: number, siteX: number, siteZ: number): number {
  const cached = flatZoneHeightCache.get(`${gx},${gz}`);
  if (cached !== undefined) return cached;
  // Every town reachable through overlapping zones: one's centre within the other's radius plus
  // the largest radius a zone can have.
  const reach = FLAT_ZONE_RADIUS_MAX;
  const members = new Map<string, { siteX: number; siteZ: number }>([[`${gx},${gz}`, { siteX, siteZ }]]);
  const queue = [{ siteX, siteZ }];
  while (queue.length > 0) {
    const site = queue.pop()!;
    for (const near of sampleFlatZoneBlends(site.siteX, site.siteZ, reach)) {
      const key = `${near.gx},${near.gz}`;
      if (members.has(key)) continue;
      members.set(key, near);
      queue.push(near);
    }
  }
  let sum = 0;
  for (const member of members.values()) sum += surroundingBaseHeight(member.siteX, member.siteZ, FLAT_ZONE_RADIUS_MAX);
  const height = sum / members.size;
  for (const key of members.keys()) flatZoneHeightCache.set(key, height);
  return height;
}

/**
 * World height including flattening (WORLD_PLAN.md follow-up: towns need genuinely flat ground,
 * not just naturally-flat-by-luck terrain): the spawn clearing, each town's pad (easing back to the
 * natural ground across FLAT_ZONE_TERRAIN_SKIRT metres past the town's edge, see
 * ZoneMap.sampleFlatZoneBlends) and each tower's clearing, all in one order-free blend
 * (blendToward). A core at full weight wins outright, so the spawn clearing, every town core and
 * every tower footprint stay dead flat, and the ground between two of them eases from one height
 * to the other. (Applying them one after another let a tower clearing tilt the edge of a town's
 * core, and each pull undo part of the last.)
 */
export function sampleHeight(worldX: number, worldZ: number): number {
  // First, so a new seed clears the cached pad, spawn and tower heights before any are read.
  ensureNoiseForCurrentSeed();
  const targets = flatTargets(worldX, worldZ);
  for (const clearing of watchTowerClearings(worldX, worldZ)) {
    let towerHeight = watchTowerHeightCache[clearing.index];
    if (towerHeight === undefined) {
      const position = getWatchTowerPositions()[clearing.index]!;
      towerHeight = towerGroundHeight(position.x, position.z);
      watchTowerHeightCache[clearing.index] = towerHeight;
    }
    targets.push({ weight: clearing.membership, height: towerHeight });
  }
  return blendToward(sampleBaseHeight(worldX, worldZ), targets);
}

/** The spawn clearing and the town pads that reach (x, z), as flattening targets. */
function flatTargets(worldX: number, worldZ: number): { weight: number; height: number }[] {
  const targets = sampleFlatZoneBlends(worldX, worldZ, FLAT_ZONE_TERRAIN_SKIRT).map((zone) => ({
    weight: zone.weight,
    height: padHeight(zone.gx, zone.gz, zone.siteX, zone.siteZ),
  }));
  const spawnMembership = spawnClearingMembership(worldX, worldZ);
  if (spawnMembership > 0) {
    spawnClearingHeightCache ??= surroundingBaseHeight(SPAWN_X, SPAWN_Z, SPAWN_CLEARING_RADIUS * 0.8);
    targets.push({ weight: spawnMembership, height: spawnClearingHeightCache });
  }
  return targets;
}

/** The height a tower's clearing flattens to: the ground as the towns and the spawn clearing have
 * already shaped it, averaged over the tower's centre and a ring through its blend band. A tower
 * can stand in a town's skirt (placement keeps it 2 m clear of the town itself), and flattening it
 * to the natural ground there left the clearing a few metres off the pad's slope beside it, a 54
 * degree bank in five metres (2026-10-24). */
function towerGroundHeight(centerX: number, centerZ: number): number {
  const radius = (WATCH_TOWER_FOOTPRINT_RADIUS + watchTowerClearingOuterRadius) / 2;
  const shaped = (x: number, z: number) => blendToward(sampleBaseHeight(x, z), flatTargets(x, z));
  let sum = shaped(centerX, centerZ);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    sum += shaped(centerX + Math.cos(angle) * radius, centerZ + Math.sin(angle) * radius);
  }
  return sum / 9;
}

/** How worn the ground at (x, z) is, 0 to 1, for the ground shader (terrainSplat.ts): a town's pad
 * (its zone, full in the core) and the apron round a tower's footprint are packed gravel. */
export function groundWear(worldX: number, worldZ: number): number {
  let wear = sampleFlatZone(worldX, worldZ).membership;
  for (const tower of getWatchTowerPositions()) {
    const distance = Math.hypot(worldX - tower.x, worldZ - tower.z);
    wear = Math.max(wear, 1 - smoothstep(WATCH_TOWER_FOOTPRINT_RADIUS * 0.8, WATCH_TOWER_FOOTPRINT_RADIUS + 3, distance));
  }
  return wear;
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
