import {
  FACILITY_DOOR_CHANCE, FACILITY_DOOR_MAX_CELLS, FACILITY_DOOR_SEED_OFFSET, FACILITY_ENEMY_DOOR_WAIT,
} from '../../core/config.ts';
import { mulberry32 } from '../../utils/rng.ts';
import { OPEN, cellCentre, type FacilityLayout } from './facilityLayout.ts';

/**
 * Facility doors (docs/facility-map.md, section 12), pure: which doorway cells form one opening,
 * which openings get a door, where each door stands, and the small geometric tests the runtime
 * needs (a ray picking a door or panel, a walk crossing a closed door, a player standing in one).
 */

/** Adjacent doorway cells on the same axis that open into the same room from the same side. */
export interface FacilityOpening {
  readonly room: number;
  /** The layout's doorway axis: walking along it crosses the opening. */
  readonly axis: 'x' | 'z';
  /** The room lies one cell along +side on the axis from the corridor-side cells. */
  readonly side: 1 | -1;
  /** The corridor-side doorway cells, ascending along the opening. */
  readonly cells: readonly { i: number; j: number }[];
}

export interface FacilityDoor {
  readonly id: number;
  readonly room: number;
  readonly axis: 'x' | 'z';
  readonly side: 1 | -1;
  /** Corridor-side cell indices (j * size + i). */
  readonly cells: readonly number[];
  /** The room cells across the door plane from `cells`, in the same order. */
  readonly roomCells: readonly number[];
  /** Centre of the door plane at floor level. */
  readonly x: number;
  readonly z: number;
  /** Along the plane, metres. */
  readonly width: number;
  /** Floor to the underside of the frame's header, metres. */
  readonly height: number;
  readonly startsClosed: boolean;
}

/** An axis-aligned box by centre and half extents. */
export interface Box3 { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number }

/** The frame's header (FacilityBuilder geometry) is this thick; a door stops under it. */
const HEADER = 0.12;
/** Half the thickness of the box a ray must cross to pick a door, open or closed. */
const DOOR_PICK_HALF_DEPTH = 0.15;

/** Merges the layout's doorway cells into openings, in a fixed order (by the first cell's position
 * in the layout's doorway list), so every client numbers them the same. */
export function facilityOpenings(layout: FacilityLayout): FacilityOpening[] {
  const { size, kinds, region } = layout;
  const roomSide = (i: number, j: number, axis: 'x' | 'z'): { side: 1 | -1; room: number } | null => {
    for (const side of [1, -1] as const) {
      const ni = i + (axis === 'x' ? side : 0), nj = j + (axis === 'z' ? side : 0);
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const id = nj * size + ni;
      if (region[id]! >= 0 && kinds[id] === OPEN) return { side, room: region[id]! };
    }
    return null;
  };
  const key = (i: number, j: number, axis: 'x' | 'z'): number => (j * size + i) * 2 + (axis === 'z' ? 1 : 0);
  const doorways = new Map<number, { side: 1 | -1; room: number }>();
  for (const d of layout.doorways) {
    if (kinds[d.j * size + d.i] !== OPEN) continue;
    const found = roomSide(d.i, d.j, d.axis);
    if (found) doorways.set(key(d.i, d.j, d.axis), found);
  }
  const used = new Set<number>(), openings: FacilityOpening[] = [];
  for (const d of layout.doorways) {
    const first = doorways.get(key(d.i, d.j, d.axis));
    if (!first || used.has(key(d.i, d.j, d.axis))) continue;
    // Along the opening: z for an x-axis doorway, x for a z-axis one.
    const di = d.axis === 'z' ? 1 : 0, dj = d.axis === 'x' ? 1 : 0;
    const same = (i: number, j: number): boolean => {
      const other = doorways.get(key(i, j, d.axis));
      return !!other && other.side === first.side && other.room === first.room && !used.has(key(i, j, d.axis));
    };
    let i = d.i, j = d.j;
    while (same(i - di, j - dj)) { i -= di; j -= dj; }
    const cells: { i: number; j: number }[] = [];
    for (; same(i, j); i += di, j += dj) { used.add(key(i, j, d.axis)); cells.push({ i, j }); }
    openings.push({ room: first.room, axis: d.axis, side: first.side, cells });
  }
  return openings;
}

/** The doors of a layout: about FACILITY_DOOR_CHANCE of the openings up to FACILITY_DOOR_MAX_CELLS
 * wide, chosen from the seed, plus every such opening into a dark room. Dark rooms' doors start
 * closed, the rest open. Deterministic per layout. */
export function facilityDoors(layout: FacilityLayout): FacilityDoor[] {
  const { size, cell, ceiling } = layout, half = size * cell / 2;
  const rng = mulberry32(layout.seed + FACILITY_DOOR_SEED_OFFSET);
  const doors: FacilityDoor[] = [];
  for (const opening of facilityOpenings(layout)) {
    // One draw per opening keeps the stream aligned whatever the earlier openings decided.
    const roll = rng();
    const dark = layout.rooms[opening.room]?.dark ?? false;
    if (opening.cells.length > FACILITY_DOOR_MAX_CELLS || !(dark || roll < FACILITY_DOOR_CHANCE)) continue;
    const { axis, side } = opening;
    const cells = opening.cells.map(c => c.j * size + c.i);
    const roomCells = opening.cells.map(c => (c.j + (axis === 'z' ? side : 0)) * size + c.i + (axis === 'x' ? side : 0));
    const height = Math.min(...cells.map((id, n) => Math.min(ceiling[id]!, ceiling[roomCells[n]!]!))) - HEADER;
    const first = cellCentre(opening.cells[0]!.i, opening.cells[0]!.j);
    const last = cellCentre(opening.cells[opening.cells.length - 1]!.i, opening.cells[opening.cells.length - 1]!.j);
    // The plane is the boundary between the corridor-side cells and the room.
    const plane = axis === 'x'
      ? (opening.cells[0]!.i + (side > 0 ? 1 : 0)) * cell - half
      : (opening.cells[0]!.j + (side > 0 ? 1 : 0)) * cell - half;
    doors.push({
      id: doors.length, room: opening.room, axis, side, cells, roomCells,
      x: axis === 'x' ? plane : (first.x + last.x) / 2,
      z: axis === 'z' ? plane : (first.z + last.z) / 2,
      width: opening.cells.length * cell, height, startsClosed: dark,
    });
  }
  return doors;
}

/** The box a look ray must cross to pick a door: the doorway's plane, slightly thickened. */
export function doorPickBox(door: FacilityDoor): Box3 {
  const across = door.axis === 'x';
  return { cx: door.x, cy: door.height / 2, cz: door.z,
    hx: across ? DOOR_PICK_HALF_DEPTH : door.width / 2, hy: door.height / 2, hz: across ? door.width / 2 : DOOR_PICK_HALF_DEPTH };
}

/** Where along a ray (origin + t * unit direction) it enters the box, or Infinity if it misses it
 * within maxDistance. A ray starting inside enters at 0. */
export function rayBoxDistance(box: Box3, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number): number {
  let lo = 0, hi = maxDistance;
  for (const [o, d, c, h] of [[ox, dx, box.cx, box.hx], [oy, dy, box.cy, box.hy], [oz, dz, box.cz, box.hz]] as const) {
    if (Math.abs(d) < 1e-12) {
      if (o < c - h || o > c + h) return Infinity;
      continue;
    }
    const a = (c - h - o) / d, b = (c + h - o) / d;
    lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    if (lo > hi) return Infinity;
  }
  return lo;
}

/** Whether the walk from (ax, az) to (bx, bz) crosses the door's plane inside the opening. */
export function segmentCrossesDoor(door: FacilityDoor, ax: number, az: number, bx: number, bz: number): boolean {
  // In the door's frame: u across the plane, v along it.
  const across = door.axis === 'x';
  const ua = (across ? ax : az) - (across ? door.x : door.z), ub = (across ? bx : bz) - (across ? door.x : door.z);
  if (ua === ub || (Math.sign(ua) === Math.sign(ub) && ua !== 0 && ub !== 0)) return false;
  const t = ua / (ua - ub);
  const va = (across ? az : ax) - (across ? door.z : door.x), vb = (across ? bz : bx) - (across ? door.z : door.x);
  return Math.abs(va + (vb - va) * t) <= door.width / 2;
}

/** Whether a body of `radius` at (x, z) overlaps the closed door's leaves. */
export function bodyInDoorway(door: FacilityDoor, x: number, z: number, radius: number): boolean {
  const across = door.axis === 'x';
  const u = Math.abs((across ? x : z) - (across ? door.x : door.z));
  const v = Math.abs((across ? z : x) - (across ? door.z : door.x));
  return u < radius + 0.1 && v < door.width / 2 + radius;
}

/** The flow-field edges a door blocks while closed: every move (straight or diagonal) between one
 * of its corridor-side cells and one of its room cells, keyed `a * cells + b` both ways, valued
 * with the door id. */
export function doorCrossings(doors: readonly FacilityDoor[], size: number): Map<number, number> {
  const crossings = new Map<number, number>(), total = size * size;
  for (const door of doors) for (const a of door.cells) for (const b of door.roomCells) {
    const ai = a % size, aj = Math.floor(a / size), bi = b % size, bj = Math.floor(b / size);
    if (Math.max(Math.abs(ai - bi), Math.abs(aj - bj)) !== 1) continue;
    crossings.set(a * total + b, door.id); crossings.set(b * total + a, door.id);
  }
  return crossings;
}

/**
 * Enemies at closed doors (docs/facility-map.md, section 12): an enemy whose next stretch of walk
 * crosses a closed door stops there; after FACILITY_ENEMY_DOOR_WAIT seconds of standing at the same
 * door it opens it. Pure bookkeeping per enemy id; the caller finds the door and does the opening.
 */
export class EnemyDoorWaits {
  private readonly waits = new Map<number, { door: number; seconds: number }>();

  /** One moving tick of enemy `id`, which faces closed door `door` (-1 for none). Returns 'walk'
   * (no door in the way), 'wait', or 'open' once the wait is over (the wait then starts afresh). */
  step(id: number, door: number, dt: number): 'walk' | 'wait' | 'open' {
    if (door < 0) { this.waits.delete(id); return 'walk'; }
    const wait = this.waits.get(id);
    const seconds = (wait?.door === door ? wait.seconds : 0) + (Number.isFinite(dt) ? Math.max(0, dt) : 0);
    if (seconds >= FACILITY_ENEMY_DOOR_WAIT) { this.waits.delete(id); return 'open'; }
    this.waits.set(id, { door, seconds });
    return 'wait';
  }

  clear(): void {
    this.waits.clear();
  }
}
