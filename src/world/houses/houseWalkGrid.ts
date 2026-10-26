import { furnitureCollider, wallPieces, WALL_THICKNESS, type AxisBox, type HouseLayout, type HouseStair } from './houseLayout.ts';

/**
 * The enemies' walk grid inside one house design (docs/enterable-buildings.md, part 2), pure and in
 * the house's local frame (houseLayout.ts): cells of about CELL metres on each floor, kept clear of
 * the walls, furniture, rails and the stair by CLEARANCE; the stair as a chain of nodes up its ramp
 * joining the ground floor at its foot to the upper floor at its landing; and the front door as a
 * threshold node in the doorway and a street node outside it. world/houses/HouseNavigator.ts places
 * it in the world and answers the enemy navigator with it.
 */

/** About this far between cell centres (m). */
export const CELL = 0.5;
/** A cell centre or a walked segment keeps this far from anything solid (m). */
export const CLEARANCE = 0.25;
/** The street node stands this far in front of the door's plane (m). */
export const DOOR_OUTSIDE = 0.8;
/** A body's height span over its floor that obstacles are tested against (m). */
const BODY_LOW = 0.15;
const BODY_HIGH = 1.7;
/** A floor this far above the feet can still be stepped onto (the stair's ramp, a sill). */
export const STEP_UP = 0.6;
/** Segments are tested at points this far apart (m). */
const SEGMENT_STEP = 0.1;
/** The stair's nodes are about this far apart along the flight (m). */
const STAIR_STEP = 0.5;
/** How far a stair end, the threshold or the street node reaches for floor cells (m). */
const LINK_REACH = 0.85;

/** A node's floor: an index into `levels`, or the stair, the doorway or the street. */
export const STAIR_LEVEL = -1;
export const OUTSIDE_LEVEL = -2;

export interface WalkNode {
  readonly x: number;
  /** The floor surface it stands on. */
  readonly y: number;
  readonly z: number;
  /** An index into HouseWalkGrid.levels (the threshold is on level 0), STAIR_LEVEL or OUTSIDE_LEVEL. */
  readonly level: number;
}

export interface WalkLevel {
  /** The floor's surface height. */
  readonly y: number;
  /** Where one can stand on it (the floor slabs; on level 0 also the doorway and the step outside). */
  readonly areas: readonly AxisBox[];
  /** What a body on it must keep CLEARANCE from, already grown by CLEARANCE in x and z. */
  readonly obstacles: readonly AxisBox[];
}

export interface HouseWalkGrid {
  /** The outer footprint's half sizes: the house stands on [-halfX, halfX] x [-halfZ, halfZ]. */
  readonly halfX: number;
  readonly halfZ: number;
  readonly levels: readonly WalkLevel[];
  readonly stair: HouseStair | null;
  readonly nodes: readonly WalkNode[];
  /** Per node, its neighbours with the cost of the step. */
  readonly edges: readonly (readonly { readonly to: number; readonly cost: number }[])[];
  /** The node in the doorway, on the door's plane. */
  readonly threshold: number;
  /** The node on the street in front of the door. */
  readonly outside: number;
}

const grow = (b: AxisBox, by: number): AxisBox => ({ ...b, minX: b.minX - by, maxX: b.maxX + by, minZ: b.minZ - by, maxZ: b.maxZ + by });
const containsXZ = (b: AxisBox, x: number, z: number): boolean => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
/** Strictly inside, so a cell exactly CLEARANCE from a wall still counts as clear. */
const insideXZ = (b: AxisBox, x: number, z: number): boolean => x > b.minX + 1e-6 && x < b.maxX - 1e-6 && z > b.minZ + 1e-6 && z < b.maxZ - 1e-6;
const spansBody = (b: AxisBox, floor: number): boolean => b.minY < floor + BODY_HIGH && b.maxY > floor + BODY_LOW;

/** The ramp's surface height at local z, for z within the flight. */
export function rampHeight(stair: HouseStair, z: number): number {
  const t = Math.min(1, Math.max(0, (stair.bottomZ - z) / (stair.bottomZ - stair.topZ)));
  return stair.bottomY + t * (stair.topY - stair.bottomY);
}

const onStair = (stair: HouseStair | null, x: number, z: number): stair is HouseStair =>
  stair !== null && x >= stair.minX && x <= stair.maxX && z >= Math.min(stair.topZ, stair.bottomZ) && z <= Math.max(stair.topZ, stair.bottomZ);

/** Whether a body on `level` may stand at (x, z): on one of its areas and clear of its obstacles. */
export function pointClear(level: WalkLevel, x: number, z: number): boolean {
  if (!level.areas.some((area) => containsXZ(area, x, z))) return false;
  return !level.obstacles.some((box) => insideXZ(box, x, z));
}

/** Whether the segment from a to b passes through the inside of the box [minX, maxX] x [minZ, maxZ]
 * (Liang-Barsky clipping; running along an edge does not count). */
export function segmentCrossesBox(ax: number, az: number, bx: number, bz: number, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - minX], [dx, maxX - ax], [-dz, az - minZ], [dz, maxZ - az]] as const) {
    if (Math.abs(p) < 1e-12) { if (q <= 1e-6) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return (t1 - t0) * Math.hypot(dx, dz) > 1e-6;
}

/** Whether a body on `level` can walk straight from a to b: never into an obstacle (tested exactly)
 * and on its floor all the way (tested every SEGMENT_STEP). */
export function segmentClear(level: WalkLevel, ax: number, az: number, bx: number, bz: number): boolean {
  if (level.obstacles.some((box) => segmentCrossesBox(ax, az, bx, bz, box.minX, box.maxX, box.minZ, box.maxZ))) return false;
  const length = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(length / SEGMENT_STEP));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    if (!level.areas.some((area) => containsXZ(area, x, z))) return false;
  }
  return true;
}

/** The surface a body with its feet at feetY stands on at (x, z), in the footprint: the highest floor
 * (or the stair's ramp) no more than STEP_UP above its feet, else the lowest one. */
export function floorAt(grid: HouseWalkGrid, x: number, z: number, feetY: number): number {
  const surfaces = grid.levels.filter((level, index) => index === 0 || level.areas.some((area) => containsXZ(area, x, z))).map((level) => level.y);
  if (onStair(grid.stair, x, z)) surfaces.push(rampHeight(grid.stair, z));
  const reachable = surfaces.filter((y) => y <= feetY + STEP_UP);
  return reachable.length > 0 ? Math.max(...reachable) : Math.min(...surfaces);
}

/** The floor a body with its feet at feetY is on at (x, z): STAIR_LEVEL on the flight's ramp, else a
 * level index. */
export function levelAt(grid: HouseWalkGrid, x: number, z: number, feetY: number): number {
  const surface = floorAt(grid, x, z, feetY);
  if (onStair(grid.stair, x, z) && Math.abs(surface - rampHeight(grid.stair, z)) < 1e-6
    && !grid.levels.some((level) => Math.abs(level.y - surface) < 1e-6)) return STAIR_LEVEL;
  let best = 0;
  grid.levels.forEach((level, index) => { if (Math.abs(level.y - surface) < Math.abs(grid.levels[best]!.y - surface)) best = index; });
  return best;
}

/** The outer footprint from the exterior walls' outer faces. */
function footprint(layout: HouseLayout): { halfX: number; halfZ: number } {
  let halfX = 0, halfZ = 0;
  for (const wall of layout.walls) {
    if (wall.outward === 0) continue;
    const face = Math.abs(wall.at + wall.outward * wall.thickness / 2);
    if (wall.run === 'z') halfX = Math.max(halfX, face); else halfZ = Math.max(halfZ, face);
  }
  return { halfX, halfZ };
}

/** Builds a design's walk grid. Its door must be the front door of houseLayout.ts (axis z, the room
 * toward -z). */
export function buildHouseWalkGrid(layout: HouseLayout): HouseWalkGrid {
  const { halfX, halfZ } = footprint(layout), door = layout.door, stair = layout.stair;
  if (door.axis !== 'z' || door.side !== -1) throw new Error(`walk grid: ${layout.name}'s door is not a front door`);
  const inX = halfX - WALL_THICKNESS, inZ = halfZ - WALL_THICKNESS;
  const pieces = layout.walls.flatMap(wallPieces);
  const solids = [...pieces, ...layout.furniture.map(furnitureCollider), ...layout.rails];
  const heights = [...new Set(layout.floors.map((floor) => Math.round(floor.maxY * 1000) / 1000))].sort((a, b) => a - b);
  // The doorway and the step outside belong to the ground floor, so a walk through the door is a
  // walk on level 0.
  const doorway: AxisBox = { minX: door.x - door.width / 2, maxX: door.x + door.width / 2, minY: 0, maxY: 0, minZ: inZ - 0.01, maxZ: halfZ + DOOR_OUTSIDE + 0.2 };
  const levels: WalkLevel[] = heights.map((y, index) => {
    const areas = layout.floors.filter((floor) => Math.abs(floor.maxY - y) < 1e-3);
    const obstacles = solids.filter((box) => spansBody(box, y));
    // Under and on the flight is not floor: the ramp has its own nodes.
    if (index === 0 && stair) obstacles.push({ minX: stair.minX, maxX: stair.maxX, minY: 0, maxY: 0, minZ: Math.min(stair.topZ, stair.bottomZ), maxZ: Math.max(stair.topZ, stair.bottomZ) });
    return { y, areas: index === 0 ? [...areas, doorway] : areas, obstacles: obstacles.map((box) => grow(box, CLEARANCE)) };
  });

  const nodes: WalkNode[] = [];
  const edges: { to: number; cost: number }[][] = [];
  const addNode = (node: WalkNode): number => { nodes.push(node); edges.push([]); return nodes.length - 1; };
  const link = (a: number, b: number): void => {
    const p = nodes[a]!, q = nodes[b]!, cost = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    edges[a]!.push({ to: b, cost });
    edges[b]!.push({ to: a, cost });
  };

  // Floor cells: an even tiling of the inside, each cell's centre where a body may stand.
  const nX = Math.max(1, Math.floor((2 * inX) / CELL)), nZ = Math.max(1, Math.floor((2 * inZ) / CELL));
  const cellX = (2 * inX) / nX, cellZ = (2 * inZ) / nZ;
  levels.forEach((level, index) => {
    const ids = new Int32Array(nX * nZ).fill(-1);
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nX; i++) {
      const x = -inX + (i + 0.5) * cellX, z = -inZ + (j + 0.5) * cellZ;
      if (pointClear(level, x, z)) ids[j * nX + i] = addNode({ x, y: level.y, z, level: index });
    }
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nX; i++) {
      const a = ids[j * nX + i]!;
      if (a < 0) continue;
      // Right, forward, and both forward diagonals: each pair once.
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nX || nj >= nZ) continue;
        const b = ids[nj * nX + ni]!;
        if (b >= 0 && segmentClear(level, nodes[a]!.x, nodes[a]!.z, nodes[b]!.x, nodes[b]!.z)) link(a, b);
      }
    }
  });

  /** Links node `from` to the cells of `level` within LINK_REACH that reach `via` (the node itself,
   * or for a stair end the point where one steps off the flight) in a straight line. */
  const linkToCells = (from: number, level: number, accept: (node: WalkNode) => boolean, via: { x: number; z: number } = nodes[from]!): void => {
    const p = nodes[from]!;
    nodes.forEach((node, index) => {
      if (index === from || node.level !== level || !accept(node)) return;
      if (Math.hypot(node.x - p.x, node.z - p.z) > LINK_REACH) return;
      if (segmentClear(levels[level]!, via.x, via.z, node.x, node.z)) link(from, index);
    });
  };

  // The door: a threshold node on its plane and a street node in front of it.
  const threshold = addNode({ x: door.x, y: levels[0]!.y, z: door.z, level: 0 });
  linkToCells(threshold, 0, (node) => node.z < door.z);
  const outside = addNode({ x: door.x, y: 0, z: halfZ + DOOR_OUTSIDE, level: OUTSIDE_LEVEL });
  link(threshold, outside);

  // The stair: nodes up the ramp's middle, the foot joined to the ground floor and the top to the
  // upper floor's landing.
  if (stair && levels.length > 1) {
    const run = stair.bottomZ - stair.topZ, count = Math.max(1, Math.round(Math.abs(run) / STAIR_STEP)), x = (stair.minX + stair.maxX) / 2;
    let previous = -1;
    for (let k = 0; k <= count; k++) {
      const z = stair.bottomZ - (run * k) / count;
      const id = addNode({ x, y: rampHeight(stair, z), z, level: STAIR_LEVEL });
      if (previous >= 0) link(previous, id);
      // The flight itself is an obstacle on the ground floor, so the way off it is tested from just
      // past its end.
      const beyond = Math.sign(run), off = CLEARANCE + 0.01;
      if (k === 0) linkToCells(id, 0, (node) => (node.z - stair.bottomZ) * beyond > 0, { x, z: stair.bottomZ + beyond * off });
      if (k === count) {
        const top = levels.findIndex((level) => Math.abs(level.y - stair.topY) < 1e-3);
        if (top > 0) linkToCells(id, top, (node) => (stair.topZ - node.z) * beyond > 0, { x, z: stair.topZ - beyond * off });
      }
      previous = id;
    }
  }

  // Cells boxed in by furniture (a corner behind a crate) are left out: every node reaches the door.
  const reached = walkField({ halfX, halfZ, levels, stair, nodes, edges, threshold, outside }, outside);
  const keep = new Int32Array(nodes.length).fill(-1);
  const kept: WalkNode[] = [];
  nodes.forEach((node, index) => { if (reached[index]! >= 0) keep[index] = kept.push(node) - 1; });
  const keptEdges = edges.flatMap((list, index) => keep[index]! < 0 ? [] : [list.map(({ to, cost }) => ({ to: keep[to]!, cost }))]);
  return { halfX, halfZ, levels, stair, nodes: kept, edges: keptEdges, threshold: keep[threshold]!, outside: keep[outside]! };
}

/** For every node, the next node on the cheapest way to `target` (itself at the target, -1 when it
 * cannot get there). */
export function walkField(grid: HouseWalkGrid, target: number): Int32Array {
  const count = grid.nodes.length, next = new Int32Array(count).fill(-1), cost = new Float64Array(count).fill(Infinity);
  const done = new Uint8Array(count);
  cost[target] = 0;
  next[target] = target;
  // Few nodes per house: a plain scan for the cheapest open node is fast enough.
  for (;;) {
    let best = -1;
    for (let i = 0; i < count; i++) if (!done[i] && cost[i]! < Infinity && (best < 0 || cost[i]! < cost[best]!)) best = i;
    if (best < 0) break;
    done[best] = 1;
    for (const { to, cost: step } of grid.edges[best]!) {
      if (cost[best]! + step < cost[to]!) {
        cost[to] = cost[best]! + step;
        next[to] = best;
      }
    }
  }
  return next;
}

/** A body this close to a node has reached it (m). */
const ARRIVE = 0.15;
/** nearestNode tests this many of the nearest nodes for a straight way to them. */
const NEAREST_TRIES = 8;

/** The node on `level` nearest (x, z) that a body there reaches in a straight line (of the few
 * nearest), else the nearest on that level, else -1. */
export function nearestNode(grid: HouseWalkGrid, x: number, z: number, level: number): number {
  const candidates: { index: number; distance: number }[] = [];
  grid.nodes.forEach((node, index) => {
    if (node.level === level) candidates.push({ index, distance: Math.hypot(node.x - x, node.z - z) });
  });
  if (candidates.length === 0) return -1;
  candidates.sort((a, b) => a.distance - b.distance);
  const walk = level >= 0 ? grid.levels[level] : undefined;
  if (walk) {
    for (const { index } of candidates.slice(0, NEAREST_TRIES)) {
      const node = grid.nodes[index]!;
      if (segmentClear(walk, x, z, node.x, node.z)) return index;
    }
  }
  return candidates[0]!.index;
}

/** Where a body at (x, z) on `level`, nearest node `from`, walking the grid along `field`, should
 * steer now: past `from` once it is on it or beyond it, then as far along the path on its own floor
 * as it can walk in a straight line (at most eight nodes ahead). Null when it cannot get there. */
export function nextNode(grid: HouseWalkGrid, field: Int32Array, from: number, x: number, z: number, level: number): number | null {
  if (from < 0 || field[from]! < 0) return null;
  const nodes = grid.nodes;
  const near = (id: number): boolean => Math.hypot(nodes[id]!.x - x, nodes[id]!.z - z) < ARRIVE;
  const walk = level >= 0 ? grid.levels[level] : undefined;
  /** Whether the body can head straight for node `id` (always, off its floor's grid: the stair). */
  const straight = (id: number): boolean => !walk || nodes[id]!.level !== level || segmentClear(walk, x, z, nodes[id]!.x, nodes[id]!.z);
  let waypoint = from;
  const after = field[from]!;
  if (after !== from) {
    const a = nodes[from]!, b = nodes[after]!;
    const beyond = (b.x - a.x) * (x - a.x) + (b.z - a.z) * (z - a.z) > 0;
    if ((near(from) || beyond) && straight(after)) waypoint = after;
  }
  if (walk) {
    let id = waypoint;
    for (let step = 0; step < 8; step++) {
      const next = field[id]!;
      if (next === id || next < 0 || nodes[next]!.level !== level) break;
      id = next;
      if (segmentClear(walk, x, z, nodes[id]!.x, nodes[id]!.z)) waypoint = id;
    }
  }
  // On a node already: on to the next one, unless the body stands just off it with a corner between
  // (it steps onto the node first).
  while (near(waypoint) && field[waypoint] !== waypoint && straight(field[waypoint]!)) waypoint = field[waypoint]!;
  return waypoint;
}
