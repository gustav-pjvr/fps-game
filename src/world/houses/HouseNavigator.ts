import { ENEMY_HEIGHT } from '../../core/config.ts';
import { HOUSE_LAYOUTS, houseToWorld } from './houseLayout.ts';
import {
  buildHouseWalkGrid, DOOR_OUTSIDE, floorAt, levelAt, nearestNode, nextNode, OUTSIDE_LEVEL, segmentClear, segmentCrossesBox, STAIR_LEVEL,
  walkField, type HouseWalkGrid,
} from './houseWalkGrid.ts';
import type { HousePlacement } from './ValleyHouses.ts';

/** Within this distance (m) of the street node an enemy walks the door's path itself. */
const DOOR_REACH = 1.0;
/** Within this distance (m) of the street node the approach skips the whiskers: a closed door ahead
 * would otherwise turn it aside before the door gate holds it. */
const DOOR_APPROACH = 3.0;
/** Corners are rounded this far out from the walls (m). */
const CORNER_MARGIN = DOOR_OUTSIDE;
/** A walker this close to a waypoint has reached it (m). */
const ARRIVE = 0.2;
/** Within this distance across the door's line (m) a walker goes on through the doorway. */
const DOOR_LINE = 0.15;
/** Spatial buckets for finding the house at a point (m). */
const BUCKET = 16;

/** A navigator answer (entities/enemies/enemyNavigator.ts): the point to steer at, and whether the
 * straight way there is known clear (no whisker steering). */
export interface HouseWaypoint {
  readonly x: number;
  readonly z: number;
  readonly direct?: boolean;
}

interface Design {
  readonly grid: HouseWalkGrid;
  /** Walk fields by target node, built when first asked for. */
  readonly fields: Map<number, Int32Array>;
}

interface PlacedHouse {
  readonly placement: HousePlacement;
  readonly design: Design;
  readonly cos: number;
  readonly sin: number;
  readonly buckets: number[];
}

const designs: (Design | undefined)[] = [];

/** A design's grid, built once per page. */
function designOf(index: number): Design | null {
  const layout = HOUSE_LAYOUTS[index];
  if (!layout) return null;
  return designs[index] ??= { grid: buildHouseWalkGrid(layout), fields: new Map() };
}

function fieldTo(design: Design, target: number): Int32Array {
  let field = design.fields.get(target);
  if (!field) { field = walkField(design.grid, target); design.fields.set(target, field); }
  return field;
}

const bucketKey = (bx: number, bz: number): number => (bx + 32768) * 65536 + (bz + 32768);

/**
 * Enemies and the Valley houses (docs/enterable-buildings.md, part 2): the streamed-in houses with
 * their walk grids (houseWalkGrid.ts), answering the enemy navigator and the enemies' floor height.
 * An enemy whose move starts or ends inside a house walks that house's grid: outside, it goes round
 * the house to the street node in front of the door, then through the door (the door gate opens it)
 * and along the grid, up the stair if the target is upstairs; inside, along the grid to the target,
 * or to the door and out. A move that starts and ends outside every house is returned unchanged.
 */
export class HouseNavigator {
  private readonly houses = new Map<string, PlacedHouse>();
  private readonly buckets = new Map<number, PlacedHouse[]>();

  /** A house streamed in (`name` is its id, as in ValleyHouses). */
  add(name: string, placement: HousePlacement): void {
    const design = designOf(placement.design);
    if (!design || this.houses.has(name)) return;
    // Registered as far out as houseAt's widest margin reaches.
    const reach = Math.hypot(design.grid.halfX, design.grid.halfZ) + CORNER_MARGIN + 0.5;
    const keys: number[] = [];
    for (let bx = Math.floor((placement.x - reach) / BUCKET); bx <= Math.floor((placement.x + reach) / BUCKET); bx++) {
      for (let bz = Math.floor((placement.z - reach) / BUCKET); bz <= Math.floor((placement.z + reach) / BUCKET); bz++) keys.push(bucketKey(bx, bz));
    }
    const house: PlacedHouse = { placement, design, cos: Math.cos(placement.rotationY), sin: Math.sin(placement.rotationY), buckets: keys };
    this.houses.set(name, house);
    for (const key of keys) {
      const list = this.buckets.get(key);
      if (list) list.push(house); else this.buckets.set(key, [house]);
    }
  }

  remove(name: string): void {
    const house = this.houses.get(name);
    if (!house) return;
    this.houses.delete(name);
    for (const key of house.buckets) {
      const list = this.buckets.get(key)?.filter((other) => other !== house);
      if (list && list.length > 0) this.buckets.set(key, list); else this.buckets.delete(key);
    }
  }

  private local(house: PlacedHouse, x: number, z: number): { x: number; z: number } {
    const dx = x - house.placement.x, dz = z - house.placement.z;
    return { x: dx * house.cos - dz * house.sin, z: dx * house.sin + dz * house.cos };
  }

  private world(house: PlacedHouse, x: number, z: number, direct: boolean): HouseWaypoint {
    const p = house.placement, at = houseToWorld(x, 0, z, p.x, p.groundY, p.z, p.rotationY);
    return { x: at.x, z: at.z, direct };
  }

  /** The streamed-in house whose footprint (walls included), grown by `margin`, holds (x, z), or null. */
  private houseAt(x: number, z: number, margin = 0): PlacedHouse | null {
    const list = this.buckets.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
    if (!list) return null;
    for (const house of list) {
      const at = this.local(house, x, z);
      if (Math.abs(at.x) < house.design.grid.halfX + margin && Math.abs(at.z) < house.design.grid.halfZ + margin) return house;
    }
    return null;
  }

  /** The level (houseWalkGrid.ts) a body centred at height y stands on, at a local point. */
  private levelOf(house: PlacedHouse, at: { x: number; z: number }, y: number | undefined, fallback: number): number {
    if (y === undefined || !Number.isFinite(y)) return fallback;
    return levelAt(house.design.grid, at.x, at.z, y - ENEMY_HEIGHT / 2 - house.placement.groundY);
  }

  /** The enemy navigator (setEnemyNavigator): (fromY, toY) are body centre heights when known. */
  readonly navigate = (fromX: number, fromZ: number, toX: number, toZ: number, fromY?: number, toY?: number): HouseWaypoint => {
    const inFrom = this.houseAt(fromX, fromZ), inTo = this.houseAt(toX, toZ);
    if (inFrom) return this.fromInside(inFrom, fromX, fromZ, toX, toZ, fromY, inTo === inFrom ? toY : undefined, inTo === inFrom);
    if (inTo) return this.toInside(inTo, fromX, fromZ, toX, toZ, toY);
    // Just out of a house's door with the target on its far side: round the house, not back in.
    const near = this.houseAt(fromX, fromZ, CORNER_MARGIN + 0.3);
    if (!near) return { x: toX, z: toZ };
    const from = this.local(near, fromX, fromZ), to = this.local(near, toX, toZ);
    const corner = this.roundHouse(near, from, to);
    return corner ? this.world(near, corner.x, corner.z, false) : { x: toX, z: toZ };
  };

  /** A move that starts inside `house`: along its grid to the target in it, or to the door and out. */
  private fromInside(house: PlacedHouse, fromX: number, fromZ: number, toX: number, toZ: number, fromY: number | undefined, toY: number | undefined, toSameHouse: boolean): HouseWaypoint {
    const { grid } = house.design, from = this.local(house, fromX, fromZ);
    const level = this.levelOf(house, from, fromY, 0);
    let target = grid.outside;
    if (toSameHouse) {
      const to = this.local(house, toX, toZ);
      const toLevel = this.levelOf(house, to, toY, level === STAIR_LEVEL ? 0 : level);
      // On the same floor with nothing between: straight there.
      if (toLevel === level && level >= 0 && segmentClear(grid.levels[level]!, from.x, from.z, to.x, to.z)) return { x: toX, z: toZ, direct: true };
      target = nearestNode(grid, to.x, to.z, toLevel);
      if (target < 0) target = nearestNode(grid, to.x, to.z, 0);
    }
    const start = nearestNode(grid, from.x, from.z, level);
    const next = target < 0 ? null : nextNode(grid, fieldTo(house.design, target), start, from.x, from.z, level);
    if (next === null) return { x: toX, z: toZ };
    const node = grid.nodes[next]!;
    return this.world(house, node.x, node.z, true);
  }

  /** A move from outside to a target inside `house`: round the house to the street node, then
   * square onto the door and along the door's path. */
  private toInside(house: PlacedHouse, fromX: number, fromZ: number, toX: number, toZ: number, toY: number | undefined): HouseWaypoint {
    const { grid } = house.design, from = this.local(house, fromX, fromZ), street = grid.nodes[grid.outside]!;
    const distance = Math.hypot(street.x - from.x, street.z - from.z);
    if (distance <= DOOR_REACH) {
      // Off the door's line: onto the street node first, so the walk through the doorway is square.
      if (distance > ARRIVE && Math.abs(from.x - street.x) > DOOR_LINE) return this.world(house, street.x, street.z, true);
      const to = this.local(house, toX, toZ);
      const level = this.levelOf(house, to, toY, 0);
      let target = nearestNode(grid, to.x, to.z, level);
      if (target < 0) target = nearestNode(grid, to.x, to.z, 0);
      const next = target < 0 ? null : nextNode(grid, fieldTo(house.design, target), grid.outside, from.x, from.z, OUTSIDE_LEVEL);
      if (next === null) return { x: toX, z: toZ };
      const node = grid.nodes[next]!;
      return this.world(house, node.x, node.z, true);
    }
    const corner = this.roundHouse(house, from, street);
    if (corner) return this.world(house, corner.x, corner.z, false);
    return this.world(house, street.x, street.z, distance <= DOOR_APPROACH);
  }

  /** When the straight way from `from` to `to` (both local, outside the footprint) cuts through the
   * house: the first corner (CORNER_MARGIN out from the walls) on the shortest way round; null when
   * the way is clear. */
  private roundHouse(house: PlacedHouse, from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number } | null {
    const { halfX, halfZ } = house.design.grid;
    const blocked = (a: { x: number; z: number }, b: { x: number; z: number }): boolean => segmentCrossesBox(a.x, a.z, b.x, b.z, -halfX, halfX, -halfZ, halfZ);
    if (!blocked(from, to)) return null;
    const cx = halfX + CORNER_MARGIN, cz = halfZ + CORNER_MARGIN;
    // Round the four corners in order; the shortest way is to one corner and on round the house.
    const corners = [{ x: cx, z: cz }, { x: cx, z: -cz }, { x: -cx, z: -cz }, { x: -cx, z: cz }];
    const length = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
    let best: { x: number; z: number } | null = null, bestLength = Infinity;
    corners.forEach((first, index) => {
      if (length(first, from) < ARRIVE || blocked(from, first)) return;
      for (const turn of [1, -1]) {
        let total = length(from, first), at = first;
        for (let k = 0; k < 4 && blocked(at, to); k++) {
          const next = corners[(index + turn * (k + 1) + 8) % 4]!;
          total += length(at, next);
          at = next;
        }
        total += length(at, to);
        if (total < bestLength) { best = first; bestLength = total; }
      }
    });
    return best;
  }

  /** The enemies' floor (setEnemyFloor): in a house's footprint the floor, stair or upper floor
   * under an enemy whose feet are at feetY; null outside every house (the terrain). */
  readonly floorAt = (x: number, z: number, feetY: number): number | null => {
    const house = this.houseAt(x, z);
    if (!house) return null;
    const at = this.local(house, x, z), ground = house.placement.groundY;
    return ground + floorAt(house.design.grid, at.x, at.z, feetY - ground);
  };

  /** Whether (x, z) is inside a streamed-in house's footprint. */
  isInside(x: number, z: number): boolean {
    return this.houseAt(x, z) !== null;
  }

  clear(): void {
    this.houses.clear();
    this.buckets.clear();
  }
}
