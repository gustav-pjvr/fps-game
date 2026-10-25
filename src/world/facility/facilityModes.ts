import type { RNG } from '../../utils/rng.ts';
import { PROP, SOLID, cellCentre, cellOf, isSpawnBlocked, isWalkable, type FacilityLayout, type FacilityRoom } from './facilityLayout.ts';
import { segmentClear } from './facilityNav.ts';

// Where the goose modes and the Uplink mission put things on the Facility (docs/facility-map.md,
// "Modes on the Facility"). Pure, unit-tested; the entity managers call it through the small
// adapters at the bottom.

type Point = { x: number; z: number };

/** An ambient goose stands this far from walls, pillars and crates. */
export const FACILITY_PICKUP_CLEARANCE = 0.6;
/** Flying geese stay this far under the local ceiling. */
export const FACILITY_FLIGHT_CEILING_GAP = 0.6;
/** Their cruise height above the floor where the ceiling allows (a corridor's 3.2 m allows 2.6). */
export const FACILITY_FLIGHT_CRUISE = 2.6;
/** Horde geese spawn at least this far from every player, and out of every player's room. */
export const FACILITY_HORDE_MIN_SPAWN_DISTANCE = 18;
/** ...and preferably no farther than this, so a wave arrives in seconds rather than a minute. */
export const FACILITY_HORDE_MAX_SPAWN_DISTANCE = 40;
/** Mission objectives keep at least this far from the player's start. */
export const FACILITY_OBJECTIVE_MIN_DISTANCE = 16;
/** Clear floor an objective's console wants around it; rooms without it fall back to 0.8 m. */
const OBJECTIVE_CLEARANCE = 1.5;
/** Clearance for a goose's straight wander line (FacilityNav's own). */
const WANDER_CLEARANCE = 0.45;

const roomCentre = (layout: FacilityLayout, room: FacilityRoom): Point => ({
  x: ((room.i0 + room.i1) / 2 - layout.size / 2) * layout.cell,
  z: ((room.j0 + room.j1) / 2 - layout.size / 2) * layout.cell,
});

/** Cell centres on clear floor: walkable with `clearance`, so clear of walls, pillars and crates.
 * `roomsOnly` leaves out corridors. In grid order, so the result is deterministic. */
export function facilityFloorPoints(layout: FacilityLayout, clearance: number, roomsOnly = false): Point[] {
  const points: Point[] = [];
  for (let j = 0; j < layout.size; j++) for (let i = 0; i < layout.size; i++) {
    if (roomsOnly && layout.region[j * layout.size + i]! < 0) continue;
    const point = cellCentre(i, j);
    if (isWalkable(layout, point.x, point.z, clearance)) points.push(point);
  }
  return points;
}

/** The ceiling height over (x, z); 0 off the grid or over wall mass. */
export function facilityCeilingAt(layout: FacilityLayout, x: number, z: number): number {
  const { i, j } = cellOf(x, z);
  if (i < 0 || j < 0 || i >= layout.size || j >= layout.size) return 0;
  return layout.ceiling[j * layout.size + i]!;
}

/** How high a flying goose flies over (x, z): the cruise height, clamped to the local ceiling minus
 * FACILITY_FLIGHT_CEILING_GAP (never below half a metre, for a point over wall mass). */
export function facilityFlightHeight(layout: FacilityLayout, x: number, z: number): number {
  const ceiling = facilityCeilingAt(layout, x, z);
  if (ceiling <= 0) return FACILITY_FLIGHT_CRUISE;
  return Math.max(0.5, Math.min(FACILITY_FLIGHT_CRUISE, ceiling - FACILITY_FLIGHT_CEILING_GAP));
}

/** A random point from `points`, or null when there are none. */
export function pickPoint(points: readonly Point[], rng: RNG): Point | null {
  if (points.length === 0) return null;
  return points[Math.min(points.length - 1, Math.floor(rng() * points.length))]!;
}

/** A point from `points` between `min` and `max` metres of (x, z), at random; the nearest point at
 * least `min` away when none is in the band; null when `points` is empty. */
export function pickPointNear(points: readonly Point[], x: number, z: number, min: number, max: number, rng: RNG): Point | null {
  const band = points.filter(p => { const d = Math.hypot(p.x - x, p.z - z); return d >= min && d <= max; });
  if (band.length > 0) return pickPoint(band, rng);
  let best: Point | null = null, bestDistance = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= min && d < bestDistance) { best = p; bestDistance = d; }
  }
  return best ?? pickPoint(points, rng);
}

/** Where the next horde goose comes in: a room floor point (from facilityFloorPoints with
 * roomsOnly) out of every player's room and FACILITY_HORDE_MIN_SPAWN_DISTANCE from each of them,
 * preferably within FACILITY_HORDE_MAX_SPAWN_DISTANCE of the nearest. With no candidate that far,
 * the one farthest from its nearest player. Straight-line distance: the walk through the doors is
 * never shorter. */
export function facilityHordeSpawnPoint(
  layout: FacilityLayout, roomPoints: readonly Point[], players: readonly Point[], rng: RNG,
): Point | null {
  if (players.length === 0) return pickPoint(roomPoints, rng);
  const playerRooms = new Set(players.map(p => regionAt(layout, p.x, p.z)).filter(r => r >= 0));
  const near: Point[] = [], far: Point[] = [];
  let fallback: Point | null = null, fallbackDistance = -1;
  for (const point of roomPoints) {
    const nearest = Math.min(...players.map(p => Math.hypot(p.x - point.x, p.z - point.z)));
    const inPlayerRoom = playerRooms.has(regionAt(layout, point.x, point.z));
    if (!inPlayerRoom && nearest >= FACILITY_HORDE_MIN_SPAWN_DISTANCE) {
      (nearest <= FACILITY_HORDE_MAX_SPAWN_DISTANCE ? near : far).push(point);
    }
    const score = inPlayerRoom ? nearest - 1000 : nearest;
    if (score > fallbackDistance) { fallback = point; fallbackDistance = score; }
  }
  return pickPoint(near.length > 0 ? near : far, rng) ?? fallback;
}

function regionAt(layout: FacilityLayout, x: number, z: number): number {
  const { i, j } = cellOf(x, z);
  if (i < 0 || j < 0 || i >= layout.size || j >= layout.size) return -2;
  return layout.region[j * layout.size + i]!;
}

/** The clear cell centre nearest the room's centre, with `clearance` around it, or null. */
function roomSite(layout: FacilityLayout, room: FacilityRoom, clearance: number): Point | null {
  const centre = roomCentre(layout, room);
  let best: Point | null = null, bestDistance = Infinity;
  for (let j = room.j0; j < room.j1; j++) for (let i = room.i0; i < room.i1; i++) {
    const point = cellCentre(i, j);
    const distance = Math.hypot(point.x - centre.x, point.z - centre.z);
    if (distance < bestDistance && isWalkable(layout, point.x, point.z, clearance)) { best = point; bestDistance = distance; }
  }
  return best;
}

/** The Uplink mission's four points on the Facility (MissionState makes the three nearest the start
 * the uplinks and the farthest the extraction): one room per quadrant around the atrium, never the
 * atrium or the start's own room, each at least FACILITY_OBJECTIVE_MIN_DISTANCE from the start.
 * In each quadrant the largest such room wins (room for the console and the extraction ring), the
 * farther one on a tie. A quadrant with no such room is filled from the others, farthest first.
 * Each point is the clear floor nearest its room's centre. Deterministic for a layout and start. */
export function facilityMissionObjectives(layout: FacilityLayout, start: Point): Point[] {
  const startRegion = regionAt(layout, start.x, start.z);
  const candidates = layout.rooms.flatMap((room, index) => {
    if (index === 0 || index === startRegion) return [];
    const site = roomSite(layout, room, OBJECTIVE_CLEARANCE) ?? roomSite(layout, room, 0.8);
    if (!site || isSpawnBlocked(layout, site.x, site.z)) return [];
    const distance = Math.hypot(site.x - start.x, site.z - start.z);
    const area = (room.i1 - room.i0) * (room.j1 - room.j0);
    return [{ site, distance, area, quadrant: (site.x >= 0 ? 1 : 0) + (site.z >= 0 ? 2 : 0) }];
  });
  const far = candidates.filter(c => c.distance >= FACILITY_OBJECTIVE_MIN_DISTANCE);
  const chosen = new Set<(typeof candidates)[number]>();
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const best = far.filter(c => c.quadrant === quadrant).sort((a, b) => b.area - a.area || b.distance - a.distance)[0];
    if (best) chosen.add(best);
  }
  for (const pool of [far, candidates]) {
    for (const c of [...pool].sort((a, b) => b.distance - a.distance)) {
      if (chosen.size >= 4) break;
      chosen.add(c);
    }
  }
  return [...chosen].map(c => c.site);
}

const crateHeights = new WeakMap<FacilityLayout, Map<number, number>>();

/** Whether a thrown goose of `radius` at (x, y, z) has hit the facility: wall mass, a crate's top or
 * sides, or the ceiling. The floor is the caller's own ground check. */
export function facilityBlocksThrow(layout: FacilityLayout, x: number, y: number, z: number, radius: number): boolean {
  const { i, j } = cellOf(x, z);
  if (i < 0 || j < 0 || i >= layout.size || j >= layout.size) return true;
  const id = j * layout.size + i;
  if (layout.kinds[id] === SOLID) return true;
  if (y + radius >= layout.ceiling[id]!) return true;
  if (layout.kinds[id] !== PROP) return false;
  let heights = crateHeights.get(layout);
  if (!heights) {
    heights = new Map(layout.crates.map(crate => [crate.j * layout.size + crate.i, crate.height]));
    crateHeights.set(layout, heights);
  }
  return y - radius < (heights.get(id) ?? 0);
}

// ---- Adapters for the entity managers ----------------------------------------------------------

/** GooseManager's placement on the Facility (Goose Toss pickups, the goose a death spawns). */
export function facilityGoosePlacement(layout: FacilityLayout, rng: RNG = Math.random) {
  const points = facilityFloorPoints(layout, FACILITY_PICKUP_CLEARANCE);
  return {
    randomPoint: (): Point | null => pickPoint(points, rng),
    near: (x: number, z: number, min: number, max: number): Point | null => pickPointNear(points, x, z, min, max, rng),
    canWander: (ax: number, az: number, bx: number, bz: number): boolean => segmentClear(layout, ax, az, bx, bz, WANDER_CLEARANCE),
  };
}

/** HordeGooseManager's indoor site on the Facility: spawn points in rooms away from the players and
 * a flight height under the ceiling. Walking and flying geese route through the doors with the
 * enemies' navigator (Game sets it for a Facility match). */
export function facilityHordeSite(layout: FacilityLayout, rng: RNG = Math.random) {
  const roomPoints = facilityFloorPoints(layout, FACILITY_PICKUP_CLEARANCE, true);
  return {
    spawnPoint: (players: readonly Point[]): Point | null => facilityHordeSpawnPoint(layout, roomPoints, players, rng),
    flightHeight: (x: number, z: number): number => facilityFlightHeight(layout, x, z),
  };
}
