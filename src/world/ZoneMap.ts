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

/**
 * Organic zone growth (WORLD_PLAN.md follow-up, promised in the WORLD_SIZE_CHUNKS history in
 * config.ts): a zone's shape is no longer a single scalar radius, but ZONE_RAY_COUNT evenly-spaced
 * rays from its site center, each ray's length being however far it can go in that direction
 * before hitting a boundary (the world-edge mountain ramp, the spawn/combat ring, or its own cell
 * size - see computeRadii). This fills the tight safe annulus far better than a fixed circle ever
 * could: a badly-centered site can still grow a usable (if lopsided) shape instead of being
 * rejected outright the moment a full circle doesn't fit at its exact position.
 *
 * 16 rays is a deliberate middle ground: enough angular resolution that the shape reads as
 * organic rather than faceted at the sizes these zones actually reach (radius ~10-20), while
 * keeping the per-query interpolation (radiusAtAngle) cheap - this runs on every terrain-vertex/
 * vegetation/building zone query, same as the old single-radius comparison did.
 */
const ZONE_RAY_COUNT = 16;

function rayAngle(index: number): number {
  return (index / ZONE_RAY_COUNT) * Math.PI * 2;
}

/** Distance along a ray from (originX, originZ) in direction (dirX, dirZ) until it exits a circle
 * of `radius` centered at the world origin - assumes the ray's start is already inside that
 * circle (every zone site is checked/constructed to start inside WORLD_EDGE_RAMP_START before
 * this is ever called), which guarantees exactly one positive root. */
function rayExitDistance(originX: number, originZ: number, dirX: number, dirZ: number, radius: number): number {
  const b = 2 * (originX * dirX + originZ * dirZ);
  const c = originX * originX + originZ * originZ - radius * radius;
  const discriminant = Math.max(0, b * b - 4 * c);
  return (-b + Math.sqrt(discriminant)) / 2;
}

/** Distance along a ray until it *enters* a circle of `radius` centered at the world origin, or
 * Infinity if it never does going forward (misses entirely, or the circle sits entirely behind
 * the ray's direction) - assumes the ray's start is already outside that circle (every zone site
 * is checked/constructed to start outside the spawn/combat ring before this is called). */
function rayEntryDistance(originX: number, originZ: number, dirX: number, dirZ: number, radius: number): number {
  const b = 2 * (originX * dirX + originZ * dirZ);
  const c = originX * originX + originZ * originZ - radius * radius;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) return Infinity;
  const sqrtDiscriminant = Math.sqrt(discriminant);
  const nearRoot = (-b - sqrtDiscriminant) / 2;
  if (nearRoot >= 0) return nearRoot;
  const farRoot = (-b + sqrtDiscriminant) / 2;
  return farRoot >= 0 ? farRoot : Infinity;
}

/** A site's shape can never reach beyond this fraction of its own cell size - the standard
 * Worley-noise search bound (see findNearestSite) requires every site's extent to stay under one
 * full cell, and jitter alone (placing a site arbitrarily close to its cell's edge) already
 * pushes that to the theoretical limit; this shaves a small, cheap margin off so floating-point
 * rounding at that limit can never be the thing that breaks the 3x3-neighbor search's coverage. */
const CELL_SIZE_SAFETY_FACTOR = 0.98;

/**
 * Computes a zone's organic shape: how far it can grow in each of ZONE_RAY_COUNT directions
 * before hitting the world-edge mountain ramp, the spawn/combat ring, or its own cell-size cap.
 * Unlike the old single-radius model, this can never produce an out-of-bounds shape - each ray is
 * already clipped to respect both boundaries in its own direction, so there's no separate
 * "does this fit, yes/no" rejection step for the boundaries themselves (see hasMinimumRoom for
 * the one rejection case that remains: a site with almost no room in *any* direction).
 */
function computeRadii(siteX: number, siteZ: number, cellSize: number): number[] {
  const outerRadius = WORLD_EDGE_RAMP_START - ZONE_EDGE_MARGIN;
  const innerRadius = ENEMY_RING_BASE_RADIUS + ZONE_EDGE_MARGIN;
  const siteRelSpawnX = siteX - SPAWN_X;
  const siteRelSpawnZ = siteZ - SPAWN_Z;
  const cellSizeCap = cellSize * CELL_SIZE_SAFETY_FACTOR;

  const radii: number[] = [];
  for (let i = 0; i < ZONE_RAY_COUNT; i++) {
    const angle = rayAngle(i);
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);

    const outerBound = rayExitDistance(siteX, siteZ, dirX, dirZ, outerRadius);
    const innerBound = rayEntryDistance(siteRelSpawnX, siteRelSpawnZ, dirX, dirZ, innerRadius);
    radii.push(Math.max(0, Math.min(outerBound, innerBound, cellSizeCap)));
  }
  return radii;
}

/** Interpolates a zone's ray lengths at an arbitrary angle - linear between the two rays that
 * bracket it, which is all the falloff math (membershipFor) or building placement
 * (BuildingManager.getTownLayout) ever needs: "how far does this zone's shape extend in exactly
 * this direction." */
function radiusAtAngle(radii: readonly number[], angle: number): number {
  const normalizedAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const rayIndexFloat = (normalizedAngle / (Math.PI * 2)) * ZONE_RAY_COUNT;
  const lowerIndex = Math.floor(rayIndexFloat) % ZONE_RAY_COUNT;
  const upperIndex = (lowerIndex + 1) % ZONE_RAY_COUNT;
  const t = rayIndexFloat - Math.floor(rayIndexFloat);
  const lower = radii[lowerIndex]!;
  const upper = radii[upperIndex]!;
  return lower + (upper - lower) * t;
}

/** The one remaining rejection case for an organic shape: a site positioned with almost no room
 * in *any* direction (e.g. jittered right against the spawn ring or the world edge) isn't worth
 * keeping even though every individual ray is technically valid. Mirrors the old isSiteClear's
 * role of demoting a site entirely rather than shrinking it - but the bar is "every direction has
 * at least radiusMin," not "a full circle of radiusMin fits," since there's no longer a single
 * circle to test. */
function hasMinimumRoom(radii: readonly number[], radiusMin: number): boolean {
  return radii.every((radius) => radius >= radiusMin);
}

interface ZoneSite {
  gx: number;
  gz: number;
  siteX: number;
  siteZ: number;
  radii: readonly number[];
}

/** A guaranteed zone's fully-formed site, precomputed directly (not derived from the per-cell hash
 * jitter) - see computeGuaranteedSites for why. Same shape as ZoneSite; kept as a distinct name
 * since the two are constructed very differently and callers care about that distinction. */
type GuaranteedSite = ZoneSite;

function findGuaranteedSite(sites: readonly GuaranteedSite[], gx: number, gz: number): GuaranteedSite | undefined {
  return sites.find((site) => site.gx === gx && site.gz === gz);
}

/** siteForCell (below) is called once per candidate cell in findNearestSite's 3x3-neighbor
 * search, which itself runs on every terrain-vertex/vegetation/building zone query - i.e. very
 * often. Computing ZONE_RAY_COUNT ray-circle intersections on every one of those calls would be a
 * real regression from the old model's single multiply-add. This cache (mirroring the
 * townLayoutCache/guaranteedSitesCache pattern already used elsewhere in this codebase) means a
 * cell's shape is computed once per world seed, never per-query - wholesale-cleared on seed
 * change rather than keyed by seed, so it can't grow unboundedly across a long session of
 * restarts/rematches the way a seed-keyed map would. */
let siteCacheSeed: number | null = null;
const siteCache = new Map<string, ZoneSite | null>();

function cachedSiteForCell(
  gx: number,
  gz: number,
  cellSize: number,
  seed: number,
  density: number,
  radiusMin: number,
  radiusMax: number,
  guaranteedSites: readonly GuaranteedSite[],
): ZoneSite | null {
  if (siteCacheSeed !== seed) {
    siteCache.clear();
    siteCacheSeed = seed;
  }
  const key = `${cellSize}:${gx},${gz}`;
  const cached = siteCache.get(key);
  if (cached !== undefined) return cached;

  const site = siteForCell(gx, gz, cellSize, seed, density, radiusMin, radiusMax, guaranteedSites);
  siteCache.set(key, site);
  return site;
}

/** Deterministic jittered hash-grid ("Worley" style): each cell either has one candidate site
 * (jittered within the cell) or none, decided purely from a hash of the cell coordinates - no
 * state, reload-identical, cheap to query. If this exact cell is one of the world's guaranteed
 * sites (see computeGuaranteedSites), that precomputed site is returned instead, regardless of
 * what the density roll would have said. A site whose computed shape has no minimum room anywhere
 * (see hasMinimumRoom) is demoted to null the same as a failed density roll - there's no partial
 * "shrink it to fit" step since computeRadii already can't produce an out-of-bounds shape, only
 * a shape with too little room to be worth having at all. */
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
  if (presenceRoll >= density) return null;

  const siteX = (gx + jitterX) * cellSize;
  const siteZ = (gz + jitterZ) * cellSize;
  const radii = computeRadii(siteX, siteZ, cellSize);
  if (!hasMinimumRoom(radii, radiusMin)) return null;

  // radiusMax caps how big a natural (non-guaranteed) site can roll even when there's more than
  // enough room, so density-rolled zones stay within the tuned min/max band rather than always
  // maxing out whatever the annulus happens to allow at that position.
  const cappedRadii = radii.map((radius) => Math.min(radius, radiusMax));
  return { gx, gz, siteX, siteZ, radii: cappedRadii };
}

/** A point can only ever fall within a site whose cell is among its own or its 8 neighbors, since
 * every site's shape is capped below its cell size - the standard Worley-noise search bound. */
function findNearestSite(
  x: number,
  z: number,
  cellSize: number,
  seed: number,
  density: number,
  radiusMin: number,
  radiusMax: number,
  guaranteedSites: readonly GuaranteedSite[],
): { site: ZoneSite; distance: number; angle: number } | null {
  const gx = Math.floor(x / cellSize);
  const gz = Math.floor(z / cellSize);

  let best: { site: ZoneSite; distance: number; angle: number } | null = null;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const site = cachedSiteForCell(gx + dx, gz + dz, cellSize, seed, density, radiusMin, radiusMax, guaranteedSites);
      if (!site) continue;
      const ddx = x - site.siteX;
      const ddz = z - site.siteZ;
      const distance = Math.sqrt(ddx * ddx + ddz * ddz);
      if (!best || distance < best.distance) best = { site, distance, angle: Math.atan2(ddz, ddx) };
    }
  }
  return best;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Flat-topped falloff: full membership through the inner fraction of the radius-at-this-angle,
 * then eases to 0 by the edge - a genuinely flat core plus a seam-free transition, not a dome or
 * a hard cutoff. Same falloff shape as the old circular model, just measured against an
 * interpolated per-angle radius instead of a fixed scalar one. */
function membershipFor(distance: number, radius: number, innerFraction: number): number {
  if (distance > radius) return 0;
  return 1 - smoothstep(radius * innerFraction, radius, distance);
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
 * full-radiusMin zone is guaranteed to have room everywhere (see hasMinimumRoom) regardless of
 * angle. Evenly-spread angles at a shared rough distance keep the sites far apart from each other
 * by construction, so they always land in distinct grid cells without needing to search for that
 * separately.
 *
 * Two subtleties fixed after code review caught them with direct numeric testing (both predate
 * the organic-shape rework and still apply identically, since they're about *where* a guaranteed
 * site's center goes, not the shape grown from it):
 * - The distance band is measured from SPAWN (siteX/siteZ are constructed at exactly `distance`
 *   from SPAWN_X/SPAWN_Z), but the edge/spawn-ring boundaries are measured from the *origin* -
 *   since SPAWN_Z is nonzero, those two distances differ by up to `spawnOffsetMagnitude`
 *   depending on angle. `maxDistance` subtracts that worst case so every direction still has room
 *   for at least radiusMin regardless of angle.
 * - The jitter (±half a sector) could bring two sites as close as 90° apart for
 *   GUARANTEED_ZONE_COUNT=2, occasionally landing them in the same grid cell, silently dropping
 *   the guarantee from 2 sites to 1. The dedup pass below re-jitters any colliding site into a
 *   fresh, distinct cell.
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
    const radii = computeRadii(siteX, siteZ, cellSize).map((radius) => Math.min(radius, radiusMax));
    return { gx: Math.floor(siteX / cellSize), gz: Math.floor(siteZ / cellSize), siteX, siteZ, radii };
  };

  for (let i = 0; i < GUARANTEED_ZONE_COUNT; i++) {
    const sectorAngle = (Math.PI * 2) / GUARANTEED_ZONE_COUNT;
    const angle = baseAngle + i * sectorAngle + (picker() - 0.5) * sectorAngle * 0.5;
    let site = buildSite(angle);

    // Re-jitter away from any already-placed site that landed in the exact same cell - adjacent
    // (not identical) cells are fine, since findGuaranteedSite matches by exact (gx, gz) and
    // getFlatZoneSite's nearest-site-wins check is always trivially satisfied by a site's distance
    // of 0 to its own center regardless of what's in a neighboring cell (the same reasoning that
    // already lets adjacent *natural* sites' shapes overlap - see getFlatZoneSite's docstring).
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

/** Exported (along with getGuaranteedForestSites) for the unit-test layer - the guaranteed-sites
 * mechanism has already been broken twice in subtle numeric ways caught only by hand (see
 * computeGuaranteedSites's docstring), so the invariant is locked in by tests across many seeds
 * rather than by comment alone. */
export function getGuaranteedFlatSites(): GuaranteedSite[] {
  const seed = getWorldSeed();
  if (!guaranteedFlatSitesCache || guaranteedFlatSitesCache.seed !== seed) {
    guaranteedFlatSitesCache = {
      seed,
      sites: computeGuaranteedSites(seed + FLAT_ZONE_SEED_OFFSET + 30, FLAT_ZONE_CELL_SIZE, FLAT_ZONE_RADIUS_MIN, FLAT_ZONE_RADIUS_MAX),
    };
  }
  return guaranteedFlatSitesCache.sites;
}

export function getGuaranteedForestSites(): GuaranteedSite[] {
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
  const { site, distance, angle } = found;

  const membership = membershipFor(distance, radiusAtAngle(site.radii, angle), FLAT_ZONE_INNER_FRACTION);
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
  const { site, distance, angle } = found;

  const membership = membershipFor(distance, radiusAtAngle(site.radii, angle), FOREST_ZONE_INNER_FRACTION);
  if (membership <= 0) return NO_ZONE;
  return { type: 'forest', membership, siteX: site.siteX, siteZ: site.siteZ, gx: site.gx, gz: site.gz };
}

export interface FlatZoneSite {
  gx: number;
  gz: number;
  siteX: number;
  siteZ: number;
  radii: readonly number[];
}

/** Direct cell lookup (not a nearest-point query) - lets BuildingManager enumerate every flat-zone
 * cell that could overlap a given chunk's bounds, so a town's layout can be generated once and its
 * buildings spawned into whichever chunk each one's world position actually falls into.
 *
 * Two adjacent cells' sites can jitter close enough for their shapes to overlap (jitter
 * unconstrained by cell boundaries) - without a check, a building could be placed as if it
 * belongs to this cell's site while sampleFlatZone (which drives terrain flattening and
 * vegetation suppression, via nearest-site-wins) actually resolves that exact point to the
 * *neighboring* site instead, silently building a town on unflattened ground. Fixed by requiring
 * this cell's site to also win the nearest-site contest at its own center. */
export function getFlatZoneSite(gx: number, gz: number): FlatZoneSite | null {
  const guaranteedSites = getGuaranteedFlatSites();
  const site = cachedSiteForCell(gx, gz, FLAT_ZONE_CELL_SIZE, getWorldSeed() + FLAT_ZONE_SEED_OFFSET, FLAT_ZONE_DENSITY, FLAT_ZONE_RADIUS_MIN, FLAT_ZONE_RADIUS_MAX, guaranteedSites);
  if (!site) return null;

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

/** Exported so BuildingManager can sample a random point within a flat zone's *actual* organic
 * footprint (angle first, then however far the shape extends in that exact direction) instead of
 * assuming a uniform circular disc. */
export function radiusOfFlatZoneAtAngle(site: FlatZoneSite, angle: number): number {
  return radiusAtAngle(site.radii, angle);
}
