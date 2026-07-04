import { mulberry32 } from '../utils/rng.ts';
import { hashChunkSeed } from './chunkSeed.ts';
import {
  ENEMY_RING_BASE_RADIUS,
  FLAT_ZONE_CELL_SIZE,
  FLAT_ZONE_DENSITY,
  FLAT_ZONE_INNER_FRACTION,
  FLAT_ZONE_RADIUS_MAX,
  FLAT_ZONE_RADIUS_MIN,
  FLAT_ZONE_SEED_OFFSET,
  FOREST_ZONE_CELL_SIZE,
  FOREST_ZONE_DENSITY,
  FOREST_ZONE_INNER_FRACTION,
  FOREST_ZONE_RADIUS_MAX,
  FOREST_ZONE_RADIUS_MIN,
  FOREST_ZONE_SEED_OFFSET,
  SPAWN_X,
  SPAWN_Z,
  WORLD_EDGE_RAMP_START,
  WORLD_SEED,
  ZONE_EDGE_MARGIN,
} from '../core/config.ts';

export type ZoneType = 'flat' | 'forest' | 'none';

export interface ZoneSample {
  type: ZoneType;
  /** 0 outside the zone, 1 at its core - a flat-topped falloff (see smoothstep band below). */
  membership: number;
  /** Zone's stable identity anchor - same for every point inside it, usable as a cache/seed key. */
  siteX: number;
  siteZ: number;
  /** Owning cell coordinates, for deriving a deterministic per-zone seed (e.g. town layout). */
  gx: number;
  gz: number;
}

const NO_ZONE: ZoneSample = { type: 'none', membership: 0, siteX: 0, siteZ: 0, gx: 0, gz: 0 };

interface ZoneSite {
  gx: number;
  gz: number;
  siteX: number;
  siteZ: number;
  radius: number;
}

/** Deterministic jittered hash-grid ("Worley" style): each cell either has one candidate site
 * (jittered within the cell, radius randomized in [radiusMin, radiusMax]) or none, decided purely
 * from a hash of the cell coordinates - no state, reload-identical, cheap to query. */
function siteForCell(
  gx: number,
  gz: number,
  cellSize: number,
  seed: number,
  density: number,
  radiusMin: number,
  radiusMax: number,
): ZoneSite | null {
  const rng = mulberry32(hashChunkSeed(gx, gz, seed));
  const jitterX = rng();
  const jitterZ = rng();
  const presenceRoll = rng();
  const radiusRoll = rng();
  if (presenceRoll >= density) return null;

  return {
    gx,
    gz,
    siteX: (gx + jitterX) * cellSize,
    siteZ: (gz + jitterZ) * cellSize,
    radius: radiusMin + radiusRoll * (radiusMax - radiusMin),
  };
}

/** A point can only ever fall within a site whose cell is among its own or its 8 neighbors, since
 * every site's radius is capped below its cell size - the standard Worley-noise search bound. */
function findNearestSite(
  x: number,
  z: number,
  cellSize: number,
  seed: number,
  density: number,
  radiusMin: number,
  radiusMax: number,
): { site: ZoneSite; distance: number } | null {
  const gx = Math.floor(x / cellSize);
  const gz = Math.floor(z / cellSize);

  let best: { site: ZoneSite; distance: number } | null = null;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const site = siteForCell(gx + dx, gz + dz, cellSize, seed, density, radiusMin, radiusMax);
      if (!site) continue;
      const ddx = x - site.siteX;
      const ddz = z - site.siteZ;
      const distance = Math.sqrt(ddx * ddx + ddz * ddz);
      if (!best || distance < best.distance) best = { site, distance };
    }
  }
  return best;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Flat-topped falloff: full membership through the inner fraction of the radius, then eases to 0
 * by the edge - a genuinely flat core plus a seam-free transition, not a dome or a hard cutoff. */
function membershipFor(distance: number, radius: number, innerFraction: number): number {
  if (distance > radius) return 0;
  return 1 - smoothstep(radius * innerFraction, radius, distance);
}

/** A zone site too close to the world edge or the spawn/combat ring is demoted entirely (not just
 * partially excluded), so a town or forest can never spill into either regardless of its radius.
 * Culled against WORLD_EDGE_RAMP_START (where the mountain ring begins), not the far-away hard
 * clamp radius - a flat zone sited on the ramp would fight the steep mountain slope with its own
 * flatten-blend, producing a sharp, jagged transition (verified in-browser: this wedged the
 * character controller against what looked like a plain hillside, same failure class as the
 * original ridge-noise wedge bug in WORLD_PLAN.md §2 - see NOTES.md). */
function isSiteClear(siteX: number, siteZ: number, radius: number): boolean {
  const distanceFromOrigin = Math.sqrt(siteX * siteX + siteZ * siteZ);
  if (distanceFromOrigin + radius > WORLD_EDGE_RAMP_START - ZONE_EDGE_MARGIN) return false;

  const dxSpawn = siteX - SPAWN_X;
  const dzSpawn = siteZ - SPAWN_Z;
  const distanceFromSpawn = Math.sqrt(dxSpawn * dxSpawn + dzSpawn * dzSpawn);
  if (distanceFromSpawn - radius < ENEMY_RING_BASE_RADIUS + ZONE_EDGE_MARGIN) return false;

  return true;
}

/** Where towns can spawn (WORLD_PLAN.md follow-up: buildings should only appear on genuinely flat
 * ground, in clusters, not scattered independently). Terrain flattening (TerrainGenerator.ts) and
 * building placement (BuildingManager.ts) both key off this. */
export function sampleFlatZone(x: number, z: number): ZoneSample {
  const found = findNearestSite(x, z, FLAT_ZONE_CELL_SIZE, WORLD_SEED + FLAT_ZONE_SEED_OFFSET, FLAT_ZONE_DENSITY, FLAT_ZONE_RADIUS_MIN, FLAT_ZONE_RADIUS_MAX);
  if (!found) return NO_ZONE;
  const { site, distance } = found;
  if (!isSiteClear(site.siteX, site.siteZ, site.radius)) return NO_ZONE;

  const membership = membershipFor(distance, site.radius, FLAT_ZONE_INNER_FRACTION);
  if (membership <= 0) return NO_ZONE;
  return { type: 'flat', membership, siteX: site.siteX, siteZ: site.siteZ, gx: site.gx, gz: site.gz };
}

/** Where trees cluster densely (WORLD_PLAN.md follow-up: real walk-into-able forests, not just
 * subtler density noise). Independent grid from flat zones - a forest can exist anywhere a town
 * can't (and vice versa; overlap is resolved by callers, see VegetationManager). */
export function sampleForestZone(x: number, z: number): ZoneSample {
  const found = findNearestSite(x, z, FOREST_ZONE_CELL_SIZE, WORLD_SEED + FOREST_ZONE_SEED_OFFSET, FOREST_ZONE_DENSITY, FOREST_ZONE_RADIUS_MIN, FOREST_ZONE_RADIUS_MAX);
  if (!found) return NO_ZONE;
  const { site, distance } = found;
  if (!isSiteClear(site.siteX, site.siteZ, site.radius)) return NO_ZONE;

  const membership = membershipFor(distance, site.radius, FOREST_ZONE_INNER_FRACTION);
  if (membership <= 0) return NO_ZONE;
  return { type: 'forest', membership, siteX: site.siteX, siteZ: site.siteZ, gx: site.gx, gz: site.gz };
}

export interface FlatZoneSite {
  gx: number;
  gz: number;
  siteX: number;
  siteZ: number;
  radius: number;
}

/** Direct cell lookup (not a nearest-point query) - lets BuildingManager enumerate every flat-zone
 * cell that could overlap a given chunk's bounds, so a town's layout can be generated once and its
 * buildings spawned into whichever chunk each one's world position actually falls into.
 *
 * Two adjacent cells' sites can jitter close enough for their discs to overlap (radius up to
 * FLAT_ZONE_RADIUS_MAX, jitter unconstrained by cell boundaries) - without a check, a building
 * could be placed as if it belongs to this cell's site while sampleFlatZone (which drives terrain
 * flattening and vegetation suppression, via nearest-site-wins) actually resolves that exact point
 * to the *neighboring* site instead, silently building a town on unflattened ground. Confirmed by
 * code review as a real, reachable inconsistency in the algorithm (not just theoretical) - fixed by
 * requiring this cell's site to also win the nearest-site contest at its own center. */
export function getFlatZoneSite(gx: number, gz: number): FlatZoneSite | null {
  const site = siteForCell(gx, gz, FLAT_ZONE_CELL_SIZE, WORLD_SEED + FLAT_ZONE_SEED_OFFSET, FLAT_ZONE_DENSITY, FLAT_ZONE_RADIUS_MIN, FLAT_ZONE_RADIUS_MAX);
  if (!site) return null;
  if (!isSiteClear(site.siteX, site.siteZ, site.radius)) return null;

  const nearest = findNearestSite(site.siteX, site.siteZ, FLAT_ZONE_CELL_SIZE, WORLD_SEED + FLAT_ZONE_SEED_OFFSET, FLAT_ZONE_DENSITY, FLAT_ZONE_RADIUS_MIN, FLAT_ZONE_RADIUS_MAX);
  if (!nearest || nearest.site.gx !== gx || nearest.site.gz !== gz) return null;

  return site;
}
