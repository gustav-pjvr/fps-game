import { HOUSE_LAYOUTS, wallPieces, type AxisBox, type HouseLayout } from '../world/houses/houseLayout.ts';
import type { MinimapLayer } from './minimap.ts';
import { AMBER } from './theme.ts';

/** Walls are cut at this height above the ground floor for the plan: above most window sills, so
 * windows, doors and doorways all show as gaps. */
const PLAN_CUT = 1.6;
/** While the player is inside a house the map shows this many metres round them, so its rooms
 * read (at the Valley's 90 m a house is a few pixels). */
export const HOUSE_ZOOM_RADIUS = 14;
/** Depth of the door and window marks across their wall (m). */
const MARK_DEPTH = 0.25;

const WALL_FILL = 'rgba(201, 226, 216, 0.75)';
const WINDOW_FILL = 'rgba(201, 226, 216, 0.3)';
/** An open door: a faint bar in the doorway (the accent's hue); a closed one is solid amber. */
const DOOR_OPEN_FILL = 'rgba(111, 240, 220, 0.35)';

/** A house as the map needs it, in the world. */
export interface MapHouse {
  /** Stable for the match (the house key): what has been entered is kept by it. */
  readonly key: number;
  readonly design: number;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly doorOpen: boolean;
}

/** Where the map's houses come from (ValleyHouses): the streamed-in ones. */
export interface MapHouseSource {
  mapHouses(): Iterable<MapHouse>;
}

export interface HousePlan {
  /** Solid wall at the cut height, ground floor. */
  readonly walls: readonly AxisBox[];
  /** Ground floor windows, as marks across their wall. */
  readonly windows: readonly AxisBox[];
  /** The front door's mark across its doorway. */
  readonly door: AxisBox;
  readonly halfX: number;
  readonly halfZ: number;
}

/** A design's ground floor plan in its local frame. Pure. */
export function housePlan(layout: HouseLayout): HousePlan {
  const floor = layout.floors[0]?.maxY ?? 0, cut = floor + PLAN_CUT;
  const walls = layout.walls.flatMap(wallPieces).filter((piece) => piece.minY <= cut && piece.maxY > cut);
  const windows: AxisBox[] = [];
  let halfX = 0, halfZ = 0;
  for (const wall of layout.walls) {
    if (wall.outward === 0) continue;
    const outer = Math.abs(wall.at) + wall.thickness / 2;
    if (wall.run === 'z') halfX = Math.max(halfX, outer); else halfZ = Math.max(halfZ, outer);
    if (wall.bottom > floor) continue;
    for (const opening of wall.openings) {
      if (opening.kind !== 'window' || opening.bottom > cut) continue;
      const a0 = opening.along - opening.width / 2, a1 = opening.along + opening.width / 2, h = MARK_DEPTH / 2;
      windows.push(wall.run === 'x'
        ? { minX: a0, maxX: a1, minY: 0, maxY: 0, minZ: wall.at - h, maxZ: wall.at + h }
        : { minX: wall.at - h, maxX: wall.at + h, minY: 0, maxY: 0, minZ: a0, maxZ: a1 });
    }
  }
  const d = layout.door, h = MARK_DEPTH / 2;
  const door = d.axis === 'z'
    ? { minX: d.x - d.width / 2, maxX: d.x + d.width / 2, minY: 0, maxY: 0, minZ: d.z - h, maxZ: d.z + h }
    : { minX: d.x - h, maxX: d.x + h, minY: 0, maxY: 0, minZ: d.z - d.width / 2, maxZ: d.z + d.width / 2 };
  return { walls, windows, door, halfX, halfZ };
}

/** Whether world (x, z) is inside a house's footprint. Pure. */
export function insideHouse(house: MapHouse, plan: HousePlan, x: number, z: number): boolean {
  const dx = x - house.x, dz = z - house.z, c = Math.cos(house.rotationY), s = Math.sin(house.rotationY);
  return Math.abs(dx * c - dz * s) < plan.halfX && Math.abs(dx * s + dz * c) < plan.halfZ;
}

/** Which houses the player has entered, by key. Pure (no DOM), so the reveal rule is unit-tested. */
export class HouseMapReveal {
  private readonly entered = new Set<number>();
  /** The house the player stood in at the last update, or null. */
  inside: MapHouse | null = null;

  update(houses: Iterable<MapHouse>, x: number, z: number): void {
    this.inside = null;
    for (const house of houses) {
      const plan = planOf(house.design);
      if (!plan || !insideHouse(house, plan, x, z)) continue;
      this.entered.add(house.key);
      this.inside = house;
    }
  }

  isEntered(key: number): boolean {
    return this.entered.has(key);
  }
}

const plans: (HousePlan | undefined)[] = [];
function planOf(design: number): HousePlan | null {
  const layout = HOUSE_LAYOUTS[design];
  return layout ? (plans[design] ??= housePlan(layout)) : null;
}

/** The Valley houses' plans on the minimap (docs/enterable-buildings.md, part 2): a house the player
 * has entered shows its ground floor walls, windows and door (amber shut, faint open) from then on;
 * while the player is inside one the map zooms in on it. */
export class ValleyHouseMapLayer implements MinimapLayer {
  readonly testId = 'valley-house-map';
  private readonly reveal = new HouseMapReveal();
  private houses: MapHouse[] = [];

  constructor(private readonly source: MapHouseSource) {}

  update(x: number, z: number): void {
    this.houses = [...this.source.mapHouses()];
    this.reveal.update(this.houses, x, z);
  }

  zoomRadius(): number | null {
    return this.reveal.inside ? HOUSE_ZOOM_RADIUS : null;
  }

  /** Debug API: the keys of the streamed-in houses entered so far, and the one the player is in. */
  debugState(): { entered: number[]; inside: number | null } {
    return { entered: this.houses.filter((h) => this.reveal.isEntered(h.key)).map((h) => h.key), inside: this.reveal.inside?.key ?? null };
  }

  draw(context: CanvasRenderingContext2D): void {
    for (const house of this.houses) {
      const plan = planOf(house.design);
      if (!plan || !this.reveal.isEntered(house.key)) continue;
      context.save();
      // Local (x, z) to the world: houseToWorld's turn is a canvas rotation by -rotationY.
      context.translate(house.x, house.z);
      context.rotate(-house.rotationY);
      const fill = (box: AxisBox): void => context.fillRect(box.minX, box.minZ, box.maxX - box.minX, box.maxZ - box.minZ);
      context.fillStyle = WALL_FILL;
      plan.walls.forEach(fill);
      context.fillStyle = WINDOW_FILL;
      plan.windows.forEach(fill);
      context.fillStyle = house.doorOpen ? DOOR_OPEN_FILL : AMBER;
      fill(plan.door);
      context.restore();
    }
  }
}
