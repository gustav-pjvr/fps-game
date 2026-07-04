import { getWorldSeed } from '../core/worldSeed.ts';
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
  GUARANTEED_ZONE_COUNT,
  SPAWN_X,
  SPAWN_Z,
  WORLD_EDGE_RAMP_START,
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

/** A guaranteed zone's fully-formed site, precomputed directly (not derived from the per-cell hash
 * jitter) - see computeGuaranteedSites for why. */
interface GuaranteedSite {
  gx: number;
  gz: number;
  siteX: number;
  siteZ: number;
  radius: number;
}

function findGuaranteedSite(sites: readonly GuaranteedSite[], gx: number, gz: number): GuaranteedSite | undefined {
  return sites.find((site) => site.gx === gx && site.gz === gz);
}

/** Largest radius a site centered at (siteX, siteZ) could have and still pass isSiteClear (see
 * below) - used defensively when constructing a guaranteed site, in case its rolled radius doesn't
 * quite fit its chosen position. */
function maxClearRadius(siteX: number, siteZ: number): number {
  const distanceFromOrigin = Math.sqrt(siteX * siteX + siteZ * siteZ);
  const maxByEdge = WORLD_EDGE_RAMP_START - ZONE_EDGE_MARGIN - distanceFromOrigin;

  const dxSpawn = siteX - SPAWN_X;
  const dzSpawn = siteZ - SPAWN_Z;
  const distanceFromSpawn = Math.sqrt(dxSpawn * dxSpawn + dzSpawn * dzSpawn);
  const maxBySpawn = distanceFromSpawn - (ENEMY_RING_BASE_RADIUS + ZONE_EDGE_MARGIN);

  return Math.min(maxByEdge, maxBySpawn);
}

/** Deterministic jittered hash-grid ("Worley" style): each cell either has one candidate site
 * (jittered within the cell, radius randomized in [radiusMin, radiusMax]) or none, decided purely
 * from a hash of the cell coordinates - no state, reload-identical, cheap to query. If this exact
 * cell is one of the world's guaranteed sites (see computeGuaranteedSites), that precomputed site
 * is returned instead, regardless of what the density roll would have said. */
function siteForCell(
  gx: number,
  gz: number,
  cellSize: number,
  seed: number,
  density: number,
  radiusMin: number,
  radiusMax: number,
  guaranteedSites: readonly GuaranteedSite[],
): ZoneSite | null {
  const guaranteed = findGuaranteedSite(guaranteedSites, gx, gz);
  if (guaranteed) return guaranteed;

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
  guaranteedSites: readonly GuaranteedSite[],
): { site: ZoneSite; distance: number } | null {
  const gx = Math.floor(x / cellSize);
  const gz = Math.floor(z / cellSize);

  let best: { site: ZoneSite; distance: number } | null = null;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const site = siteForCell(gx + dx, gz + dz, cellSize, seed, density, radiusMin, radiusMax, guaranteedSites);
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

/**
 * Places GUARANTEED_ZONE_COUNT full-size sites directly, regardless of the density roll, so a
 * world never generates fewer than this many towns/forests.
 *
 * Two earlier approaches were tried and failed under direct testing:
 * (1) A random angle/distance sampler that converted candidate points to grid cells - the zone's
 * own cell size (230 for towns, 160 for forests) is large relative to the world's safe annulus
 * (spawn-ring-to-edge-mountain-ring), so floor-dividing any sampled point down to a cell only ever
 * reached a handful of distinct cells (as few as 4), regardless of how many attempts were made.
 * (2) Exhaustively enumerating every cell and requiring its *natural* hash-jittered position to
 * already have room for a full-size zone - still left most seeds with zero eligible cells, since
 * the safe annulus is narrow relative to a full-size zone's radius and a cell's position isn't
 * something this can choose, only accept or reject.
 *
 * This instead picks the sites' positions directly: `count` angles spread evenly around spawn
 * (with per-seed jitter for variety), each at a distance chosen from the exact band where a
 * full-radiusMin zone is guaranteed to fit both the world edge and the spawn ring. Evenly-spread
 * angles at a shared rough distance keep the sites far apart from each other by construction, so
 * they always land in distinct grid cells without needing to search for that separately.
 *
 * Two subtleties fixed after code review caught them with direct numeric testing:
 * - The distance band is measured from SPAWN (siteX/siteZ are constructed at exactly `distance`
 *   from SPAWN_X/SPAWN_Z), but isSiteClear's edge check measures distance from the *origin* -
 *   since SPAWN_Z is nonzero, those two distances differ by up to `spawnOffsetMagnitude`
 *   depending on angle. `maxDistance` subtracts that worst case so the edge check always holds
 *   at radiusMin regardless of angle (previously this was missing, and ~11% of guaranteed flat
 *   sites silently ended up smaller than radiusMin as a result).
 * - The jitter (±half a sector) could bring two sites as close as 90° apart for
 *   GUARANTEED_ZONE_COUNT=2, occasionally (confirmed via sampling: ~0.1% of angle/distance
 *   combinations) landing them in the same grid cell, silently dropping the guarantee from 2
 *   sites to 1. The dedup pass below re-jitters any colliding site into a fresh, distinct cell.
 */
function computeGuaranteedSites(pickerSeed: number, cellSize: number, radiusMin: number, radiusMax: number): GuaranteedSite[] {
  const spawnOffsetMagnitude = Math.sqrt(SPAWN_X * SPAWN_X + SPAWN_Z * SPAWN_Z);
  const minDistance = ENEMY_RING_BASE_RADIUS + ZONE_EDGE_MARGIN + radiusMin;
  const maxDistance = WORLD_EDGE_RAMP_START - ZONE_EDGE_MARGIN - radiusMin - spawnOffsetMagnitude;
  if (maxDistance <= minDistance) return []; // world too small to fit even one full-size guaranteed zone

  const picker = mulberry32(pickerSeed);
  const baseAngle = picker() * Math.PI * 2;
  const sites: GuaranteedSite[] = [];

  const buildSite = (angle: number): GuaranteedSite => {
    const distance = minDistance + picker() * (maxDistance - minDistance);
    const siteX = SPAWN_X + Math.cos(angle) * distance;
    const siteZ = SPAWN_Z + Math.sin(angle) * distance;
    const rolledRadius = radiusMin + picker() * (radiusMax - radiusMin);
    const radius = Math.min(rolledRadius, maxClearRadius(siteX, siteZ));
    return { gx: Math.floor(siteX / cellSize), gz: Math.floor(siteZ / cellSize), siteX, siteZ, radius };
  };

  for (let i = 0; i < GUARANTEED_ZONE_COUNT; i++) {
    const sectorAngle = (Math.PI * 2) / GUARANTEED_ZONE_COUNT;
    const angle = baseAngle + i * sectorAngle + (picker() - 0.5) * sectorAngle * 0.5;
    let site = buildSite(angle);

    // Re-jitter away from any already-placed site that landed in the exact same cell - adjacent
    // (not identical) cells are fine, since findGuaranteedSite matches by exact (gx, gz) and
    // getFlatZoneSite's nearest-site-wins check is always trivially satisfied by a site's distance
    // of 0 to its own center regardless of what's in a neighboring cell (the same reasoning that
    // already lets adjacent *natural* sites' discs overlap - see getFlatZoneSite's docstring).
    // Checking only exact equality (not adjacency) matters here because the safe annulus a
    // guaranteed site can sit in is narrower than one grid cell, so nearly every valid position at
    // any angle ends up adjacent to any other - an adjacency-based check left this loop unable to
    // find a "far enough" cell within its attempt budget and it would give up still colliding.
    let nudge = 0;
    while (sites.some((other) => other.gx === site.gx && other.gz === site.gz) && nudge < 8) {
      nudge++;
      site = buildSite(angle + nudge * (Math.PI / 6));
    }

    sites.push(site);
  }

  return sites;
}

interface GuaranteedSitesCache {
  seed: number;
  sites: GuaranteedSite[];
}

let guaranteedFlatSitesCache: GuaranteedSitesCache | null = null;
let guaranteedForestSitesCache: GuaranteedSitesCache | null = null;

function getGuaranteedFlatSites(): GuaranteedSite[] {
  const seed = getWorldSeed();
  if (!guaranteedFlatSitesCache || guaranteedFlatSitesCache.seed !== seed) {
    guaranteedFlatSitesCache = {
      seed,
      sites: computeGuaranteedSites(seed + FLAT_ZONE_SEED_OFFSET + 30, FLAT_ZONE_CELL_SIZE, FLAT_ZONE_RADIUS_MIN, FLAT_ZONE_RADIUS_MAX),
    };
  }
  return guaranteedFlatSitesCache.sites;
}

function getGuaranteedForestSites(): GuaranteedSite[] {
  const seed = getWorldSeed();
  if (!guaranteedForestSitesCache || guaranteedForestSitesCache.seed !== seed) {
    guaranteedForestSitesCache = {
      seed,
      sites: computeGuaranteedSites(seed + FOREST_ZONE_SEED_OFFSET + 30, FOREST_ZONE_CELL_SIZE, FOREST_ZONE_RADIUS_MIN, FOREST_ZONE_RADIUS_MAX),
    };
  }
  return guaranteedForestSitesCache.sites;
}

/** Where towns can spawn (WORLD_PLAN.md follow-up: buildings should only appear on genuinely flat
 * ground, in clusters, not scattered independently). Terrain flattening (TerrainGenerator.ts) and
 * building placement (BuildingManager.ts) both key off this. */
export function sampleFlatZone(x: number, z: number): ZoneSample {
  const found = findNearestSite(
    x,
    z,
    FLAT_ZONE_CELL_SIZE,
    getWorldSeed() + FLAT_ZONE_SEED_OFFSET,
    FLAT_ZONE_DENSITY,
    FLAT_ZONE_RADIUS_MIN,
    FLAT_ZONE_RADIUS_MAX,
    getGuaranteedFlatSites(),
  );
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
  const found = findNearestSite(
    x,
    z,
    FOREST_ZONE_CELL_SIZE,
    getWorldSeed() + FOREST_ZONE_SEED_OFFSET,
    FOREST_ZONE_DENSITY,
    FOREST_ZONE_RADIUS_MIN,
    FOREST_ZONE_RADIUS_MAX,
    getGuaranteedForestSites(),
  );
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
  const guaranteedSites = getGuaranteedFlatSites();
  const site = siteForCell(gx, gz, FLAT_ZONE_CELL_SIZE, getWorldSeed() + FLAT_ZONE_SEED_OFFSET, FLAT_ZONE_DENSITY, FLAT_ZONE_RADIUS_MIN, FLAT_ZONE_RADIUS_MAX, guaranteedSites);
  if (!site) return null;
  if (!isSiteClear(site.siteX, site.siteZ, site.radius)) return null;

  const nearest = findNearestSite(
    site.siteX,
    site.siteZ,
    FLAT_ZONE_CELL_SIZE,
    getWorldSeed() + FLAT_ZONE_SEED_OFFSET,
    FLAT_ZONE_DENSITY,
    FLAT_ZONE_RADIUS_MIN,
    FLAT_ZONE_RADIUS_MAX,
    guaranteedSites,
  );
  if (!nearest || nearest.site.gx !== gx || nearest.site.gz !== gz) return null;

  return site;
}
