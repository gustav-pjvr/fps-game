import { OPEN, cellCentre, cellOf, isWalkable, type FacilityLayout } from './facilityLayout.ts';

const CLEARANCE = 0.45;
const NEIGHBOURS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
type Point = { x: number; z: number };

function pointSegmentDistanceSquared(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length));
  return (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
}

function boxDistanceSquared(i: number, j: number, ax: number, az: number, bx: number, bz: number): number {
  let enter = 0, exit = 1;
  for (const [a, b, min] of [[ax, bx, i], [az, bz, j]] as const) {
    const delta = b - a;
    if (delta === 0) {
      if (a < min || a > min + 1) { enter = Infinity; break; }
    } else {
      const t0 = (min - a) / delta, t1 = (min + 1 - a) / delta;
      enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1));
    }
  }
  if (enter <= exit) return 0;
  let distance = Math.min(
    Math.max(i - ax, 0, ax - i - 1) ** 2 + Math.max(j - az, 0, az - j - 1) ** 2,
    Math.max(i - bx, 0, bx - i - 1) ** 2 + Math.max(j - bz, 0, bz - j - 1) ** 2,
  );
  for (const x of [i, i + 1]) for (const z of [j, j + 1]) {
    distance = Math.min(distance, pointSegmentDistanceSquared(x, z, ax, az, bx, bz));
  }
  return distance;
}

/** Grid DDA with exact capsule-to-cell distances around each traversed cell. */
export function segmentClear(layout: FacilityLayout, ax: number, az: number, bx: number, bz: number, clearance: number): boolean {
  if (!isWalkable(layout, ax, az, clearance) || !isWalkable(layout, bx, bz, clearance)) return false;
  const x0 = ax / layout.cell + layout.size / 2, z0 = az / layout.cell + layout.size / 2;
  const x1 = bx / layout.cell + layout.size / 2, z1 = bz / layout.cell + layout.size / 2;
  const dx = x1 - x0, dz = z1 - z0, sx = Math.sign(dx), sz = Math.sign(dz);
  const radius = Math.max(0, clearance) / layout.cell, reach = Math.floor(radius) + 1;
  let i = Math.floor(x0), j = Math.floor(z0);
  const endI = Math.floor(x1), endJ = Math.floor(z1);
  const dtX = dx === 0 ? Infinity : 1 / Math.abs(dx), dtZ = dz === 0 ? Infinity : 1 / Math.abs(dz);
  let tx = dx === 0 ? Infinity : ((sx > 0 ? i + 1 : i) - x0) / dx;
  let tz = dz === 0 ? Infinity : ((sz > 0 ? j + 1 : j) - z0) / dz;
  for (;;) {
    for (let y = j - reach; y <= j + reach; y++) for (let x = i - reach; x <= i + reach; x++) {
      if (x >= 0 && y >= 0 && x < layout.size && y < layout.size && layout.kinds[y * layout.size + x] === OPEN) continue;
      if (boxDistanceSquared(x, y, x0, z0, x1, z1) <= radius * radius) return false;
    }
    if ((i === endI && j === endJ) || Math.min(tx, tz) >= 1) return true;
    if (tx < tz) { i += sx; tx += dtX; }
    else if (tz < tx) { j += sz; tz += dtZ; }
    else { i += sx; j += sz; tx += dtX; tz += dtZ; }
  }
}

export class FacilityNav {
  private readonly fields = new Map<number, Int32Array>();

  constructor(private readonly layout: FacilityLayout) {}

  private nearestTarget(x: number, z: number): Point {
    if (isWalkable(this.layout, x, z, CLEARANCE)) return { x, z };
    let result = { x, z }, best = Infinity;
    for (let j = 0; j < this.layout.size; j++) for (let i = 0; i < this.layout.size; i++) {
      if (this.layout.kinds[j * this.layout.size + i] !== OPEN) continue;
      const point = cellCentre(i, j), distance = (point.x - x) ** 2 + (point.z - z) ** 2;
      if (distance < best && isWalkable(this.layout, point.x, point.z, CLEARANCE)) { best = distance; result = point; }
    }
    return result;
  }

  private field(target: number): Int32Array {
    const cached = this.fields.get(target);
    if (cached) { this.fields.delete(target); this.fields.set(target, cached); return cached; }
    const { size, kinds } = this.layout;
    const next = new Int32Array(kinds.length).fill(-1), queue = new Int32Array(kinds.length);
    let head = 0, tail = 1;
    queue[0] = target; next[target] = target;
    while (head < tail) {
      const id = queue[head++]!, i = id % size, j = Math.floor(id / size);
      for (const [di, dj] of NEIGHBOURS) {
        const x = i + di, z = j + dj, neighbour = z * size + x;
        if (x < 0 || z < 0 || x >= size || z >= size || next[neighbour] !== -1 || kinds[neighbour] !== OPEN) continue;
        if (di !== 0 && dj !== 0 && (kinds[j * size + x] !== OPEN || kinds[z * size + i] !== OPEN)) continue;
        next[neighbour] = id; queue[tail++] = neighbour;
      }
    }
    if (this.fields.size === 24) this.fields.delete(this.fields.keys().next().value!);
    this.fields.set(target, next);
    return next;
  }

  nextWaypoint(fromX: number, fromZ: number, toX: number, toZ: number): Point {
    const target = this.nearestTarget(toX, toZ);
    if (segmentClear(this.layout, fromX, fromZ, target.x, target.z, CLEARANCE)) return target;
    const from = cellOf(fromX, fromZ), to = cellOf(target.x, target.z), size = this.layout.size;
    if (from.i < 0 || from.j < 0 || from.i >= size || from.j >= size || !isWalkable(this.layout, target.x, target.z, CLEARANCE)) return { x: toX, z: toZ };
    const field = this.field(to.j * size + to.i);
    let id = from.j * size + from.i;
    if (field[id] === -1) return { x: toX, z: toZ };
    // Recentring first lets a moving actor safely turn after crossing into the next cell.
    let waypoint = cellCentre(from.i, from.j);
    for (let step = 0; step < 8; step++) {
      const next = field[id]!;
      if (next === id || next < 0) break;
      id = next;
      const point = cellCentre(id % size, Math.floor(id / size));
      if (segmentClear(this.layout, fromX, fromZ, point.x, point.z, CLEARANCE)) waypoint = point;
    }
    return waypoint;
  }
}
