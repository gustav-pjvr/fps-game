import { mulberry32, type RNG } from '../utils/rng.ts';
import { cellCentre, isWalkable, OPEN, SOLID, type FacilityLayout } from '../world/facility/facilityLayout.ts';
import { isPointNearFootprint, type HouseFootprint } from '../world/houseFootprint.ts';
import type { GameMode } from '../core/gameModes.ts';
import {
  PICKUP_FACILITY_CLEARANCE,
  PICKUP_FACILITY_MIN_SPACING,
  PICKUP_FACILITY_PER_ROOM,
  PICKUP_MIX,
  PICKUP_SEED_OFFSET,
  PICKUP_VALLEY_BUILDING_MARGIN,
  PICKUP_VALLEY_BUILDING_OFFSET,
  PICKUP_VALLEY_COUNT,
  PICKUP_VALLEY_MAX_RISE,
  PICKUP_VALLEY_MIN_SPACING,
  PICKUP_VALLEY_ROAD_MARGIN,
  PICKUP_VALLEY_TOWER_MARGIN,
  PICKUP_VALLEY_TOWER_OFFSET,
  type PickupKind,
} from './pickupConfig.ts';

/** One placed pickup. `id` is its index in the match's site list, the same on every client (the
 * list is a pure function of the seed, the map and the mode), so the wire only ever carries ids.
 * `y` is the ground under it. */
export interface PickupSite {
  readonly id: number;
  readonly kind: PickupKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Which kinds a mode places (section 5): Knife Only (health only there) and Goose Toss (no gun to
 * feed) get health packs alone, and a grenade crate only where grenades are on. */
export function pickupKindsForMode(mode: GameMode, grenadesOn: boolean): PickupKind[] {
  if (mode === 'knifeOnly' || mode === 'gooseToss') return ['health'];
  return grenadesOn ? ['health', 'ammo', 'grenade'] : ['health', 'ammo'];
}

/** `count` kinds in a seeded order whose mix follows PICKUP_MIX over the allowed kinds, by largest
 * remainder so a small map still gets its quota (a plain random roll over about 15 sites often
 * leaves out the 15 percent kind). */
export function assignPickupKinds(count: number, allowed: readonly PickupKind[], rng: RNG): PickupKind[] {
  if (count <= 0 || allowed.length === 0) return [];
  const total = allowed.reduce((sum, kind) => sum + PICKUP_MIX[kind], 0);
  const shares = allowed.map((kind) => ({ kind, exact: (count * PICKUP_MIX[kind]) / total }));
  const quotas = shares.map((share) => Math.floor(share.exact));
  let spare = count - quotas.reduce((sum, quota) => sum + quota, 0);
  const byRemainder = shares
    .map((share, index) => ({ index, remainder: share.exact - Math.floor(share.exact) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (spare <= 0) break;
    quotas[index]!++;
    spare--;
  }
  const kinds = shares.flatMap((share, index) => Array<PickupKind>(quotas[index]!).fill(share.kind));
  return shuffle(kinds, rng);
}

function shuffle<T>(items: readonly T[], rng: RNG): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

interface Spot {
  readonly x: number;
  readonly z: number;
}

function toSites(spots: readonly Spot[], kinds: readonly PickupKind[], groundHeight: (x: number, z: number) => number): PickupSite[] {
  return spots.map((spot, id) => ({ id, kind: kinds[id]!, x: spot.x, y: groundHeight(spot.x, spot.z), z: spot.z }));
}

// ---- Facility -------------------------------------------------------------------------------

/** The Facility's pickups: about one per room (halls a little more, offices a little less),
 * standing on a floor cell against a wall or pillar, clear of doorways, never in a room holding
 * one of `avoid` (the single-player start). A pure function of the layout (its seed), `allowed`
 * and `avoid`. */
export function placeFacilityPickups(layout: FacilityLayout, allowed: readonly PickupKind[], avoid: readonly Spot[] = []): PickupSite[] {
  if (allowed.length === 0) return [];
  const rng = mulberry32(layout.seed + PICKUP_SEED_OFFSET);
  const size = layout.size;
  const kindAt = (i: number, j: number): number => (i < 0 || j < 0 || i >= size || j >= size ? SOLID : layout.kinds[j * size + i]!);
  const nearDoorway = (i: number, j: number): boolean => layout.doorways.some((d) => Math.max(Math.abs(d.i - i), Math.abs(d.j - j)) <= 2);
  const avoidedCells = avoid.map((point) => ({ i: Math.floor(point.x / layout.cell + size / 2), j: Math.floor(point.z / layout.cell + size / 2) }));

  const spots: Spot[] = [];
  for (const room of layout.rooms) {
    if (avoidedCells.some((cell) => cell.i >= room.i0 && cell.i < room.i1 && cell.j >= room.j0 && cell.j < room.j1)) continue;
    const expected = PICKUP_FACILITY_PER_ROOM[room.kind];
    const wanted = Math.floor(expected) + (rng() < expected - Math.floor(expected) ? 1 : 0);
    if (wanted === 0) continue;

    const usable: { i: number; j: number; wall: boolean }[] = [];
    for (let j = room.j0; j < room.j1; j++) {
      for (let i = room.i0; i < room.i1; i++) {
        if (kindAt(i, j) !== OPEN || nearDoorway(i, j)) continue;
        const centre = cellCentre(i, j);
        if (!isWalkable(layout, centre.x, centre.z, PICKUP_FACILITY_CLEARANCE)) continue;
        const wall = kindAt(i - 1, j) === SOLID || kindAt(i + 1, j) === SOLID || kindAt(i, j - 1) === SOLID || kindAt(i, j + 1) === SOLID;
        usable.push({ i, j, wall });
      }
    }
    // Against a wall first; any other floor cell only when the room has no wall cell left to give.
    const ordered = [...shuffle(usable.filter((cell) => cell.wall), rng), ...shuffle(usable.filter((cell) => !cell.wall), rng)];
    let placed = 0;
    for (const cell of ordered) {
      if (placed >= wanted) break;
      const point = cellCentre(cell.i, cell.j);
      if (spots.some((other) => Math.hypot(other.x - point.x, other.z - point.z) < PICKUP_FACILITY_MIN_SPACING)) continue;
      spots.push(point);
      placed++;
    }
  }
  return toSites(spots, assignPickupKinds(spots.length, allowed, rng), () => 0);
}

// ---- Valley ---------------------------------------------------------------------------------

export interface RoadSegment {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
}

/** What the Valley placement needs from the world, all of it pure data (valleyPickupInputs.ts
 * gathers it from the BuildingManager and the tower list). */
export interface ValleyPlacementInput {
  readonly seed: number;
  /** Every house in the world, streamed in or not. */
  readonly footprints: readonly HouseFootprint[];
  /** Every town road centre line. */
  readonly roads: readonly RoadSegment[];
  readonly towers: readonly Spot[];
  readonly towerRadius: number;
  /** Half the road width: a pickup keeps PICKUP_VALLEY_ROAD_MARGIN beyond it. */
  readonly roadHalfWidth: number;
  /** Pickups stay inside this distance of the world centre. */
  readonly maxRadius: number;
  groundHeight(x: number, z: number): number;
}

function distanceToSegment(x: number, z: number, road: RoadSegment): number {
  const dx = road.bx - road.ax;
  const dz = road.bz - road.az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - road.ax) * dx + (z - road.az) * dz) / lengthSq));
  return Math.hypot(x - (road.ax + t * dx), z - (road.az + t * dz));
}

/** The Valley's pickups (about PICKUP_VALLEY_COUNT): one at the foot of each watch tower, the rest
 * beside houses, spread over the map by farthest-point picking so towns share them. Never inside a
 * house footprint (plus a margin), on a road, in a tower's footprint, on steep ground or beyond
 * `maxRadius`. A pure function of the input (its seed), `allowed` and the mode. */
export function placeValleyPickups(input: ValleyPlacementInput, allowed: readonly PickupKind[]): PickupSite[] {
  if (allowed.length === 0) return [];
  const rng = mulberry32(input.seed + PICKUP_SEED_OFFSET);
  const roadReach = input.roadHalfWidth + PICKUP_VALLEY_ROAD_MARGIN;
  const towerReach = input.towerRadius + PICKUP_VALLEY_TOWER_MARGIN;

  const isClear = (x: number, z: number): boolean => {
    if (Math.hypot(x, z) > input.maxRadius) return false;
    if (input.footprints.some((f) => Math.abs(f.originX - x) < 40 && Math.abs(f.originZ - z) < 40 && isPointNearFootprint(x, z, f, PICKUP_VALLEY_BUILDING_MARGIN))) return false;
    if (input.roads.some((road) => distanceToSegment(x, z, road) < roadReach)) return false;
    if (input.towers.some((tower) => Math.hypot(x - tower.x, z - tower.z) < towerReach)) return false;
    const here = input.groundHeight(x, z);
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]] as const) {
      if (Math.abs(input.groundHeight(x + dx, z + dz) - here) > PICKUP_VALLEY_MAX_RISE) return false;
    }
    return true;
  };

  const chosen: Spot[] = [];

  // One at the foot of each tower: the first clear point on a ring round it, from a seeded angle.
  for (const tower of input.towers) {
    const start = rng() * Math.PI * 2;
    for (let step = 0; step < 16; step++) {
      const angle = start + (step * Math.PI) / 8;
      const radius = input.towerRadius + PICKUP_VALLEY_TOWER_OFFSET;
      const x = tower.x + Math.cos(angle) * radius;
      const z = tower.z + Math.sin(angle) * radius;
      if (!isClear(x, z)) continue;
      chosen.push({ x, z });
      break;
    }
  }

  // The rest beside houses: a point outside each side of each footprint, then farthest-point
  // picking over those candidates (the first one at random) so no town takes them all.
  const candidates: Spot[] = [];
  for (const footprint of input.footprints) {
    const cos = Math.cos(footprint.rotationY);
    const sin = Math.sin(footprint.rotationY);
    const sides: [number, number][] = [
      [footprint.halfWidth + PICKUP_VALLEY_BUILDING_OFFSET, (rng() - 0.5) * footprint.halfDepth],
      [-footprint.halfWidth - PICKUP_VALLEY_BUILDING_OFFSET, (rng() - 0.5) * footprint.halfDepth],
      [(rng() - 0.5) * footprint.halfWidth, footprint.halfDepth + PICKUP_VALLEY_BUILDING_OFFSET],
      [(rng() - 0.5) * footprint.halfWidth, -footprint.halfDepth - PICKUP_VALLEY_BUILDING_OFFSET],
    ];
    for (const [localX, localZ] of sides) {
      // The inverse of isPointNearFootprint's world to local turn.
      const x = footprint.originX + footprint.offsetX + localX * cos + localZ * sin;
      const z = footprint.originZ + footprint.offsetZ - localX * sin + localZ * cos;
      if (isClear(x, z)) candidates.push({ x, z });
    }
  }
  const total = Math.min(PICKUP_VALLEY_COUNT, chosen.length + candidates.length);
  if (candidates.length > 0 && chosen.length < total) {
    if (chosen.length === 0) chosen.push(candidates[Math.floor(rng() * candidates.length)]!);
    while (chosen.length < total) {
      let best = -1;
      let bestGap = PICKUP_VALLEY_MIN_SPACING;
      candidates.forEach((candidate, index) => {
        const gap = Math.min(...chosen.map((spot) => Math.hypot(spot.x - candidate.x, spot.z - candidate.z)));
        if (gap > bestGap) {
          bestGap = gap;
          best = index;
        }
      });
      if (best < 0) break;
      chosen.push(candidates[best]!);
    }
  }
  return toSites(chosen, assignPickupKinds(chosen.length, allowed, rng), input.groundHeight);
}
