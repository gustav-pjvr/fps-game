import { FACILITY_POWER_SEED_OFFSET } from '../../core/config.ts';
import { mulberry32 } from '../../utils/rng.ts';
import { OPEN, SOLID, cellCentre, cellOf, type FacilityLayout, type FacilityRoom } from './facilityLayout.ts';

/**
 * Facility power zones and breaker panels (docs/facility-map.md, section 12), pure: rooms are
 * grouped by position into 4 to 6 zones from the seed, every lamp belongs to a zone (a corridor
 * lamp to its nearest room's), and each zone has one breaker panel on a wall of one of its rooms,
 * never in the atrium. Deterministic per layout, so every client numbers zones and panels alike.
 */

export interface FacilityBreaker {
  /** Equal to its zone. */
  readonly id: number;
  readonly zone: number;
  readonly room: number;
  /** The wall cell the panel hangs on. */
  readonly wall: { readonly i: number; readonly j: number };
  /** The walkable floor cell in front of it. */
  readonly floor: { readonly i: number; readonly j: number };
  /** Centre of the panel, on the wall face at shoulder height. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Unit normal of the wall face, pointing into the room. */
  readonly nx: number;
  readonly nz: number;
}

export interface FacilityPower {
  readonly zoneCount: number;
  /** Zone of each room, by room index. */
  readonly roomZone: readonly number[];
  /** Zone of each lamp, by lamp index (emergency lamps too, though they stay lit on battery). */
  readonly lampZone: readonly number[];
  /** One per zone, index = zone. */
  readonly breakers: readonly FacilityBreaker[];
}

/** Shoulder height of a panel's centre, metres. */
export const BREAKER_HEIGHT = 1.45;
/** How far the panel's centre stands off the wall face, metres (half its depth). */
const PANEL_OFFSET = 0.06;
/** Panels keep this many cells (Chebyshev) from any doorway cell, clear of a sliding leaf's travel. */
const DOORWAY_CLEARANCE = 3;
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

const roomCentre = (room: FacilityRoom): { i: number; j: number } => ({ i: (room.i0 + room.i1) / 2, j: (room.j0 + room.j1) / 2 });
const distanceSquared = (a: { i: number; j: number }, b: { i: number; j: number }): number => (a.i - b.i) ** 2 + (a.j - b.j) ** 2;

/** Every place a zone's panel may hang in `room`, in a fixed scan order: a SOLID cell outside the
 * room's rectangle (its perimeter wall, not a pillar) beside a floor cell of the room that is OPEN,
 * with OPEN floor one more step into the room, away from every doorway. */
function panelSpots(layout: FacilityLayout, roomIndex: number): { wall: { i: number; j: number }; floor: { i: number; j: number }; di: number; dj: number }[] {
  const { size, kinds, region } = layout, room = layout.rooms[roomIndex]!, spots: ReturnType<typeof panelSpots> = [];
  const kind = (i: number, j: number): number => i < 0 || j < 0 || i >= size || j >= size ? SOLID : kinds[j * size + i]!;
  for (let j = room.j0; j < room.j1; j++) for (let i = room.i0; i < room.i1; i++) {
    if (kinds[j * size + i] !== OPEN || region[j * size + i] !== roomIndex) continue;
    if (layout.doorways.some(d => Math.max(Math.abs(d.i - i), Math.abs(d.j - j)) < DOORWAY_CLEARANCE)) continue;
    for (const [di, dj] of DIRECTIONS) {
      const wi = i + di, wj = j + dj;
      const outside = wi < room.i0 || wi >= room.i1 || wj < room.j0 || wj >= room.j1;
      if (!outside || kind(wi, wj) !== SOLID || kind(i - di, j - dj) !== OPEN) continue;
      spots.push({ wall: { i: wi, j: wj }, floor: { i, j }, di, dj });
    }
  }
  return spots;
}

export function facilityPower(layout: FacilityLayout): FacilityPower {
  const rng = mulberry32(layout.seed + FACILITY_POWER_SEED_OFFSET);
  const rooms = layout.rooms, centres = rooms.map(roomCentre);
  const candidates = rooms.map((_, index) => index).filter(index => index !== 0);
  const target = Math.min(candidates.length, 4 + Math.floor(rng() * 3));
  // Farthest-point seeds from a seeded first room: zones spread over the whole plan.
  const seeds = [candidates[Math.floor(rng() * candidates.length)]!];
  while (seeds.length < target) {
    let best = -1, bestDistance = -1;
    for (const index of candidates) {
      if (seeds.includes(index)) continue;
      const distance = Math.min(...seeds.map(seed => distanceSquared(centres[index]!, centres[seed]!)));
      if (distance > bestDistance) { best = index; bestDistance = distance; }
    }
    seeds.push(best);
  }
  // Each room joins its nearest seed; a seed is nearest to itself, so no zone is empty.
  const nearestSeed = (index: number, among: readonly number[]): number => {
    let zone = 0, best = Infinity;
    among.forEach((seed, n) => {
      const distance = distanceSquared(centres[index]!, centres[seed]!);
      if (distance < best) { best = distance; zone = n; }
    });
    return zone;
  };
  let roomZone = rooms.map((_, index) => nearestSeed(index, seeds));
  // A zone without a single place for its panel (never seen in practice) joins its nearest neighbour.
  let spots = seeds.map((_, zone) => candidates.filter(index => roomZone[index] === zone).flatMap(index =>
    panelSpots(layout, index).map(spot => ({ ...spot, room: index }))));
  if (spots.some(list => list.length === 0)) {
    const kept = seeds.filter((_, zone) => spots[zone]!.length > 0);
    if (kept.length === 0) throw new Error('Facility has no wall for a breaker panel');
    roomZone = rooms.map((_, index) => nearestSeed(index, kept));
    spots = kept.map((_, zone) => candidates.filter(index => roomZone[index] === zone).flatMap(index =>
      panelSpots(layout, index).map(spot => ({ ...spot, room: index }))));
  }
  const breakers = spots.map((list, zone): FacilityBreaker => {
    const spot = list[Math.floor(rng() * list.length)]!;
    const floor = cellCentre(spot.floor.i, spot.floor.j), reach = layout.cell / 2 - PANEL_OFFSET;
    return { id: zone, zone, room: spot.room, wall: spot.wall, floor: spot.floor,
      x: floor.x + spot.di * reach, y: BREAKER_HEIGHT, z: floor.z + spot.dj * reach, nx: -spot.di, nz: -spot.dj };
  });
  const lampZone = layout.lamps.map(lamp => {
    const { i, j } = cellOf(lamp.x, lamp.z), region = layout.region[j * layout.size + i]!;
    if (region >= 0) return roomZone[region]!;
    // A corridor lamp joins the room nearest to its cell (distance to the room's rectangle).
    let zone = 0, best = Infinity;
    rooms.forEach((room, index) => {
      const di = Math.max(room.i0 - i, 0, i - (room.i1 - 1)), dj = Math.max(room.j0 - j, 0, j - (room.j1 - 1));
      if (di * di + dj * dj < best) { best = di * di + dj * dj; zone = roomZone[index]!; }
    });
    return zone;
  });
  return { zoneCount: breakers.length, roomZone, lampZone, breakers };
}

/** The panel lamps that are without power: every non-emergency lamp of a zone whose breaker is off.
 * Ascending. Shot-out lamps are tracked apart from this (FacilityWorld), so a lamp both shot and
 * unpowered stays dark when its breaker comes back on. */
export function unpoweredLamps(layout: FacilityLayout, power: FacilityPower, breakerOn: (zone: number) => boolean): number[] {
  const result: number[] = [];
  layout.lamps.forEach((lamp, index) => {
    if (lamp.kind !== 'emergency' && !breakerOn(power.lampZone[index]!)) result.push(index);
  });
  return result;
}
