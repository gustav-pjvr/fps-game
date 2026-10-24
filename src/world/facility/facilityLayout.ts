import {
  FACILITY_CELL, FACILITY_GRID, FACILITY_SEED_OFFSET, FACILITY_ATRIUM_CEILING,
  FACILITY_HALL_CEILING_MIN, FACILITY_HALL_CEILING_MAX, FACILITY_STORAGE_CEILING,
  FACILITY_PLANT_CEILING, FACILITY_OFFICE_CEILING, FACILITY_CORRIDOR_CEILING,
  FACILITY_LAMP_WARM, FACILITY_LAMP_COOL, FACILITY_LAMP_AMBER,
} from '../../core/config.ts';
import { mulberry32, type RNG } from '../../utils/rng.ts';

export const SOLID = 0;
export const OPEN = 1;
export const PROP = 2;

export interface FacilityRoom {
  // Bounds include i0/j0 and exclude i1/j1.
  readonly i0: number;
  readonly j0: number;
  readonly i1: number;
  readonly j1: number;
  readonly kind: 'hall' | 'storage' | 'plant' | 'office';
  readonly ceiling: number;
  readonly dark: boolean;
}

export interface FacilityDoorway {
  readonly i: number;
  readonly j: number;
  // Axis crossing from the corridor into the room.
  readonly axis: 'x' | 'z';
}

export interface FacilityCrate { readonly i: number; readonly j: number; readonly height: number }
export interface FacilityLamp {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: number;
  readonly intensity: number;
  readonly kind: 'panel' | 'emergency';
}

export interface FacilityLayout {
  readonly seed: number;
  readonly size: number;
  readonly cell: number;
  readonly kinds: Uint8Array;
  readonly ceiling: Float32Array;
  readonly region: Int16Array;
  readonly rooms: readonly FacilityRoom[];
  readonly doorways: readonly FacilityDoorway[];
  readonly crates: readonly FacilityCrate[];
  readonly lamps: readonly FacilityLamp[];
}

const SIZE = FACILITY_GRID;
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const indexOf = (i: number, j: number): number => j * SIZE + i;
const integer = (rng: RNG, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
const centre = (r: FacilityRoom): { i: number; j: number } => ({
  i: Math.floor((r.i0 + r.i1) / 2), j: Math.floor((r.j0 + r.j1) / 2),
});

export function cellOf(x: number, z: number): { i: number; j: number } {
  return { i: Math.floor(x / FACILITY_CELL + SIZE / 2), j: Math.floor(z / FACILITY_CELL + SIZE / 2) };
}

export function cellCentre(i: number, j: number): { x: number; z: number } {
  return { x: (i - SIZE / 2 + 0.5) * FACILITY_CELL, z: (j - SIZE / 2 + 0.5) * FACILITY_CELL };
}

export function isWalkable(layout: FacilityLayout, x: number, z: number, clearance = 0): boolean {
  if (![x, z, clearance].every(Number.isFinite)) return false;
  const radius = Math.max(0, clearance);
  const gx = x / layout.cell + layout.size / 2;
  const gz = z / layout.cell + layout.size / 2;
  const r = radius / layout.cell;
  if (gx - r <= 0 || gz - r <= 0 || gx + r >= layout.size || gz + r >= layout.size) return false;
  for (let j = Math.ceil(gz - r) - 1; j <= Math.floor(gz + r); j++) {
    for (let i = Math.ceil(gx - r) - 1; i <= Math.floor(gx + r); i++) {
      const dx = Math.max(i - gx, 0, gx - i - 1);
      const dz = Math.max(j - gz, 0, gz - j - 1);
      if (dx * dx + dz * dz <= r * r && layout.kinds[j * layout.size + i] !== OPEN) return false;
    }
  }
  return true;
}

export function isSpawnBlocked(layout: FacilityLayout, x: number, z: number): boolean {
  return !isWalkable(layout, x, z, 0.8);
}

function shuffled<T>(items: readonly T[], rng: RNG): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = integer(rng, 0, i);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function encounterPoints(
  layout: FacilityLayout, count: number, avoid: { x: number; z: number; radius: number }, rng: RNG,
): { x: number; z: number }[] {
  const candidates = shuffled(layout.rooms, rng).map(room => {
    const points: { x: number; z: number }[] = [];
    for (let j = room.j0; j < room.j1; j++) for (let i = room.i0; i < room.i1; i++) {
      const point = cellCentre(i, j);
      if (!isSpawnBlocked(layout, point.x, point.z)
        && Math.hypot(point.x - avoid.x, point.z - avoid.z) >= avoid.radius) points.push(point);
    }
    return shuffled(points, rng);
  });
  const result: { x: number; z: number }[] = [];
  for (let pass = 0; pass < 3 && result.length < count; pass++) {
    for (const points of candidates) {
      if (result.length >= count) break;
      if (points[pass]) result.push(points[pass]!);
    }
  }
  return result;
}

export function playerStart(layout: FacilityLayout, rng: RNG): { x: number; z: number } {
  const points = layout.rooms.slice(1).map(room => ({
    x: ((room.i0 + room.i1) / 2 - SIZE / 2) * FACILITY_CELL,
    z: ((room.j0 + room.j1) / 2 - SIZE / 2) * FACILITY_CELL,
  })).filter(point => !isSpawnBlocked(layout, point.x, point.z));
  if (points.length === 0) throw new Error('Facility has no clear room centre');
  return points[integer(rng, 0, points.length - 1)]!;
}

function placeRooms(rng: RNG): FacilityRoom[] {
  const rooms: FacilityRoom[] = [{ i0: 22, j0: 22, i1: 34, j1: 34, kind: 'hall', ceiling: FACILITY_ATRIUM_CEILING, dark: rng() < 0.2 }];
  const target = integer(rng, 14, 18);
  for (let attempt = 0; attempt < 400 && rooms.length < target; attempt++) {
    const width = integer(rng, 5, 12), depth = integer(rng, 5, 12);
    const i0 = integer(rng, 1, SIZE - width - 1), j0 = integer(rng, 1, SIZE - depth - 1);
    const i1 = i0 + width, j1 = j0 + depth;
    if (rooms.some(r => i0 < r.i1 + 2 && i1 > r.i0 - 2 && j0 < r.j1 + 2 && j1 > r.j0 - 2)) continue;
    const kinds: FacilityRoom['kind'][] = ['storage', 'plant'];
    if (Math.min(width, depth) >= 9) kinds.push('hall');
    if (Math.max(width, depth) <= 7) kinds.push('office');
    const kind = kinds[integer(rng, 0, kinds.length - 1)]!;
    const ceiling = kind === 'hall' ? FACILITY_HALL_CEILING_MIN + rng() * (FACILITY_HALL_CEILING_MAX - FACILITY_HALL_CEILING_MIN)
      : kind === 'plant' ? FACILITY_PLANT_CEILING : kind === 'office' ? FACILITY_OFFICE_CEILING : FACILITY_STORAGE_CEILING;
    rooms.push({ i0, j0, i1, j1, kind, ceiling, dark: rng() < 0.2 });
  }
  return rooms;
}

function connections(rooms: readonly FacilityRoom[], rng: RNG): [number, number][] {
  const centres = rooms.map(centre);
  const distance = (a: number, b: number): number => (centres[a]!.i - centres[b]!.i) ** 2 + (centres[a]!.j - centres[b]!.j) ** 2;
  const edges: [number, number][] = [];
  const degrees = rooms.map(() => 0);
  const add = (a: number, b: number): void => {
    if (edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return;
    edges.push([a, b]); degrees[a] = degrees[a]! + 1; degrees[b] = degrees[b]! + 1;
  };
  const visited = new Set([0]);
  while (visited.size < rooms.length) {
    let best = Infinity, a = 0, b = 0;
    for (let i = 0; i < rooms.length; i++) if (visited.has(i)) {
      for (let j = 0; j < rooms.length; j++) if (!visited.has(j) && distance(i, j) < best) {
        best = distance(i, j); a = i; b = j;
      }
    }
    add(a, b); visited.add(b);
  }
  const nearest = rooms.map((_, i) => rooms.map((_, j) => j).filter(j => j !== i)
    .sort((a, b) => distance(i, a) - distance(i, b) || a - b));
  for (let i = 0; i < rooms.length; i++) if (rng() < 0.5 && nearest[i]![1] !== undefined) add(i, nearest[i]![1]!);
  for (let i = 0; i < rooms.length; i++) for (const j of nearest[i]!) {
    if (degrees[i]! >= 2) break;
    add(i, j);
  }
  return edges;
}

function flood(kinds: Uint8Array): Uint8Array {
  const seen = new Uint8Array(kinds.length), queue = new Int32Array(kinds.length);
  const start = indexOf(SIZE / 2, SIZE / 2);
  if (kinds[start] !== OPEN) return seen;
  let head = 0, tail = 1;
  queue[0] = start; seen[start] = 1;
  while (head < tail) {
    const id = queue[head++]!, i = id % SIZE, j = Math.floor(id / SIZE);
    for (const [di, dj] of DIRECTIONS) {
      const x = i + di, z = j + dj, next = indexOf(x, z);
      if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || seen[next] || kinds[next] !== OPEN) continue;
      seen[next] = 1; queue[tail++] = next;
    }
  }
  return seen;
}

function setSolid(layout: FacilityLayout, id: number): void {
  layout.kinds[id] = SOLID; layout.ceiling[id] = 0; layout.region[id] = -2;
}

function blockConnected(layout: FacilityLayout, cells: number[], kind: number): boolean {
  for (const id of cells) layout.kinds[id] = kind;
  const seen = flood(layout.kinds);
  if (layout.kinds.some((value, id) => value === OPEN && !seen[id])) {
    for (const id of cells) layout.kinds[id] = OPEN;
    return false;
  }
  if (kind === SOLID) for (const id of cells) setSolid(layout, id);
  return true;
}

function carveCorridors(layout: FacilityLayout, edges: [number, number][], rng: RNG): { i: number; j: number }[] {
  const bends: { i: number; j: number }[] = [];
  const carve = (i: number, j: number): void => {
    const id = indexOf(i, j);
    if (i <= 0 || j <= 0 || i >= SIZE - 1 || j >= SIZE - 1 || layout.kinds[id] !== SOLID) return;
    // The four atrium pillars remain intact when a connection passes through the hall.
    if (i >= 22 && i < 34 && j >= 22 && j < 34) return;
    layout.kinds[id] = OPEN; layout.ceiling[id] = FACILITY_CORRIDOR_CEILING; layout.region[id] = -1;
  };
  for (const [a, b] of edges) {
    const start = centre(layout.rooms[a]!), end = centre(layout.rooms[b]!);
    const bend = rng() < 0.5 ? { i: end.i, j: start.j } : { i: start.i, j: end.j };
    bends.push(bend);
    for (const [p, q] of [[start, bend], [bend, end]] as const) {
      if (p.j === q.j) for (let i = Math.min(p.i, q.i); i <= Math.max(p.i, q.i); i++) {
        carve(i, p.j); carve(i, p.j + 1);
      }
      else for (let j = Math.min(p.j, q.j); j <= Math.max(p.j, q.j); j++) {
        carve(p.i, j); carve(p.i + 1, j);
      }
    }
  }
  return bends;
}

function findDoorways(layout: FacilityLayout): FacilityDoorway[] {
  const result: FacilityDoorway[] = [];
  for (let j = 1; j < SIZE - 1; j++) for (let i = 1; i < SIZE - 1; i++) {
    if (layout.region[indexOf(i, j)] !== -1) continue;
    for (const axis of ['x', 'z'] as const) {
      const offsets = axis === 'x' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
      if (offsets.some(([di, dj]) => layout.region[indexOf(i + di!, j + dj!)]! >= 0
        && layout.kinds[indexOf(i + di!, j + dj!)] === OPEN)) result.push({ i, j, axis });
    }
  }
  return result;
}

function decorate(layout: FacilityLayout, crates: FacilityCrate[], rng: RNG): void {
  const allowed = (room: FacilityRoom, i: number, j: number): boolean => {
    const c = centre(room);
    return i >= room.i0 && i < room.i1 && j >= room.j0 && j < room.j1
      && layout.kinds[indexOf(i, j)] === OPEN
      && (Math.abs(i - c.i) > 1 || Math.abs(j - c.j) > 1)
      && !layout.doorways.some(d => Math.max(Math.abs(d.i - i), Math.abs(d.j - j)) <= 2);
  };
  for (const room of layout.rooms) {
    if ((room.kind === 'hall' || room.kind === 'plant') && Math.min(room.i1 - room.i0, room.j1 - room.j0) >= 9) {
      for (let j = room.j0 + 2; j < room.j1 - 1; j += 4) for (let i = room.i0 + 2; i < room.i1 - 1; i += 4) {
        if (allowed(room, i, j)) blockConnected(layout, [indexOf(i, j)], SOLID);
      }
    }
  }
  for (const room of layout.rooms) {
    if (room.kind === 'office') continue;
    const target = integer(rng, 2, 6);
    for (let attempt = 0, placed = 0; attempt < 100 && placed < target; attempt++) {
      const i = integer(rng, room.i0, room.i1 - 1), j = integer(rng, room.j0, room.j1 - 1);
      const length = integer(rng, 1, 3), [di, dj] = DIRECTIONS[integer(rng, 0, 3)]!;
      const cells = Array.from({ length }, (_, n) => ({ i: i + di * n, j: j + dj * n }));
      if (!cells.every(p => allowed(room, p.i, p.j))) continue;
      if (!blockConnected(layout, cells.map(p => indexOf(p.i, p.j)), PROP)) continue;
      const height = [0.9, 1.2, 1.8][integer(rng, 0, 2)]!;
      crates.push(...cells.map(p => ({ ...p, height }))); placed++;
    }
  }
}

function placeLamps(layout: FacilityLayout, bends: { i: number; j: number }[], rng: RNG): FacilityLamp[] {
  const lamps: FacilityLamp[] = [], used = new Set<number>();
  const add = (i: number, j: number, color: number, intensity: number, kind: FacilityLamp['kind']): void => {
    const id = indexOf(i, j);
    if (layout.kinds[id] === SOLID || used.has(id)) return;
    lamps.push({ ...cellCentre(i, j), y: layout.ceiling[id]! - 0.15, color, intensity, kind }); used.add(id);
  };
  for (const room of layout.rooms) {
    if (room.dark) {
      const c = centre(room); add(c.i, c.j, FACILITY_LAMP_AMBER, 0.25, 'panel');
      continue;
    }
    const spacing = integer(rng, 3, 4), color = room.kind === 'plant' ? FACILITY_LAMP_COOL : FACILITY_LAMP_WARM;
    const before = lamps.length;
    for (let j = room.j0 + 1; j < room.j1; j += spacing) for (let i = room.i0 + 1; i < room.i1; i += spacing) add(i, j, color, 1, 'panel');
    if (lamps.length === before) { const c = centre(room); add(c.i, c.j, color, 1, 'panel'); }
  }
  const corridorBends = bends.filter(bend => layout.region[indexOf(bend.i, bend.j)] === -1);
  for (let n = 2; n < corridorBends.length; n += 3) {
    const bend = corridorBends[n]!;
    add(bend.i, bend.j, FACILITY_LAMP_AMBER, 0.5, 'emergency');
  }
  // Walk straight corridor runs in a fixed order, keeping adjacent lanes from doubling lamps.
  for (const horizontal of [true, false]) for (let lane = 1; lane < SIZE - 1; lane++) {
    let gap = integer(rng, 4, 5);
    for (let step = 1; step < SIZE - 1; step++) {
      const i = horizontal ? step : lane, j = horizontal ? lane : step, id = indexOf(i, j);
      if (layout.region[id] !== -1) { gap = integer(rng, 4, 5); continue; }
      if (--gap > 0) continue;
      gap = integer(rng, 4, 5);
      if (rng() < 0.25) continue;
      if (lamps.some(l => Math.hypot(l.x - cellCentre(i, j).x, l.z - cellCentre(i, j).z) < 3 * FACILITY_CELL)) continue;
      add(i, j, FACILITY_LAMP_WARM, 0.8, 'panel');
    }
  }
  return lamps;
}

function generateAttempt(seed: number, rng: RNG): FacilityLayout {
  const rooms = placeRooms(rng), doorways: FacilityDoorway[] = [], crates: FacilityCrate[] = [];
  const layout: FacilityLayout = {
    seed, size: SIZE, cell: FACILITY_CELL, kinds: new Uint8Array(SIZE * SIZE),
    ceiling: new Float32Array(SIZE * SIZE), region: new Int16Array(SIZE * SIZE).fill(-2),
    rooms, doorways, crates, lamps: [],
  };
  rooms.forEach((room, region) => {
    for (let j = room.j0; j < room.j1; j++) for (let i = room.i0; i < room.i1; i++) {
      const id = indexOf(i, j); layout.kinds[id] = OPEN; layout.ceiling[id] = room.ceiling; layout.region[id] = region;
    }
  });
  for (const j of [25, 29]) for (const i of [25, 29]) {
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) setSolid(layout, indexOf(i + dx, j + dz));
  }
  const bends = carveCorridors(layout, connections(rooms, rng), rng);
  doorways.push(...findDoorways(layout));
  const seen = flood(layout.kinds);
  for (let id = 0; id < seen.length; id++) if (layout.kinds[id] === OPEN && !seen[id]) setSolid(layout, id);
  decorate(layout, crates, rng);
  return { ...layout, lamps: placeLamps(layout, bends, rng) };
}

export function generateFacilityLayout(seed: number): FacilityLayout {
  for (let attempt = 0; ; attempt++) {
    const layout = generateAttempt(seed, mulberry32(seed + attempt * 7919 + FACILITY_SEED_OFFSET));
    const fraction = layout.kinds.reduce((sum, kind) => sum + Number(kind === OPEN), 0) / layout.kinds.length;
    if (fraction >= 0.35 && fraction <= 0.6 && layout.rooms.length >= 10) return layout;
  }
}
