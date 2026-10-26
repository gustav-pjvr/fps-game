/**
 * The geometry every sliding door shares (the Facility's, docs/facility-map.md section 12, and the
 * Valley houses', docs/enterable-buildings.md), pure: where a door's plane is, the box a look ray
 * must cross to pick it, a walk crossing it and a body standing in it.
 */

/** A door's opening in world space: an axis-aligned plane, since Facility walls are axis-aligned and
 * Valley houses only turn in quarter turns. */
export interface DoorPlane {
  /** Walking along this axis crosses the opening. */
  readonly axis: 'x' | 'z';
  /** The room (the inside) lies toward +side on the axis. */
  readonly side: 1 | -1;
  /** Centre of the opening at floor level. */
  readonly x: number;
  readonly z: number;
  /** Floor height of the opening; 0 when left out (the Facility's floor). */
  readonly y?: number;
  /** Along the plane, metres. */
  readonly width: number;
  /** Floor to the underside of the header, metres. */
  readonly height: number;
}

/** An axis-aligned box by centre and half extents. */
export interface Box3 { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number }

/** Half the thickness of the box a ray must cross to pick a door, open or closed. */
const DOOR_PICK_HALF_DEPTH = 0.15;

/** The box a look ray must cross to pick a door: the doorway's plane, slightly thickened. */
export function doorPickBox(door: DoorPlane): Box3 {
  const across = door.axis === 'x';
  return { cx: door.x, cy: (door.y ?? 0) + door.height / 2, cz: door.z,
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
export function segmentCrossesDoor(door: DoorPlane, ax: number, az: number, bx: number, bz: number): boolean {
  // In the door's frame: u across the plane, v along it.
  const across = door.axis === 'x';
  const ua = (across ? ax : az) - (across ? door.x : door.z), ub = (across ? bx : bz) - (across ? door.x : door.z);
  if (ua === ub || (Math.sign(ua) === Math.sign(ub) && ua !== 0 && ub !== 0)) return false;
  const t = ua / (ua - ub);
  const va = (across ? az : ax) - (across ? door.z : door.x), vb = (across ? bz : bx) - (across ? door.z : door.x);
  return Math.abs(va + (vb - va) * t) <= door.width / 2;
}

/** How far ahead (m) along its walk an enemy (or a horde goose) notices a closed door and stops. */
export const ENEMY_DOOR_LOOKAHEAD = 1.6;
/** Feet this far (m) below a door's floor still count as at it: the ground in front of a house. */
const DOOR_FEET_BELOW = 1;

/** Whether a walker at (x, z) heading along the unit direction (dirX, dirZ) is about to go through
 * the door's opening. The lookahead stops at its waypoint, `reach` metres on (a walk that ends short
 * of the door never needs it), and feet at `feetY`, when given, must be at the opening's height: a
 * body on an upper floor or above the header (a window over the front door) is not at the door. */
export function walkMeetsDoor(door: DoorPlane, x: number, z: number, dirX: number, dirZ: number, reach = Infinity, feetY?: number): boolean {
  if (feetY !== undefined) {
    const floor = door.y ?? 0;
    if (feetY < floor - DOOR_FEET_BELOW || feetY >= floor + door.height) return false;
  }
  const ahead = Math.min(ENEMY_DOOR_LOOKAHEAD, Math.max(0, reach));
  return ahead > 0 && segmentCrossesDoor(door, x, z, x + dirX * ahead, z + dirZ * ahead);
}

/** Whether a body of `radius` at (x, z) overlaps the closed door's leaves. */
export function bodyInDoorway(door: DoorPlane, x: number, z: number, radius: number): boolean {
  const across = door.axis === 'x';
  const u = Math.abs((across ? x : z) - (across ? door.x : door.z));
  const v = Math.abs((across ? z : x) - (across ? door.z : door.x));
  return u < radius + 0.1 && v < door.width / 2 + radius;
}

/** Horizontal distance from (x, z) to the door's opening (its centre line). */
export function distanceToDoor(door: DoorPlane, x: number, z: number): number {
  const across = door.axis === 'x';
  const u = (across ? x : z) - (across ? door.x : door.z), v = (across ? z : x) - (across ? door.z : door.x);
  return Math.hypot(u, Math.max(0, Math.abs(v) - door.width / 2));
}
