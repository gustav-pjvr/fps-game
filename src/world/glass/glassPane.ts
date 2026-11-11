import { houseToWorld, type HouseLayout } from '../houses/houseLayout.ts';

/**
 * The glass in the Valley houses' windows (docs/glass.md), pure: where each pane is, its id, what a
 * hit does to it and how its state travels between players. A pane is not a physics collider: it is
 * an upright rectangle that rays are tested against (as the lamps are), so bullets, sight and blast
 * pass through it while a thrown grenade's sweep asks it directly. GlassStore holds the state and
 * GlassView draws it.
 */

/** A pane takes this many points of damage before it breaks. */
export const PANE_STRENGTH = 6;
/** A hit of this power breaks any pane at once: a blade, a blast. */
export const BREAK_POWER = PANE_STRENGTH;
/** Bullet holes kept (and drawn) per pane. Later hits still count toward breaking. */
export const MAX_HOLES = 8;
/** Holes are stored to the centimetre, so every client draws them in the same place. */
const HOLE_GRID = 0.01;

/** What one round costs a pane, from the damage it does to a body: a pistol round 1 (six to break),
 * a battle rifle or revolver round 2, a sniper round 3. Each shotgun pellet is a round of its own. */
export function hitPower(weaponDamage: number): number {
  return weaponDamage >= 60 ? 3 : weaponDamage >= 35 ? 2 : 1;
}

export interface PaneState {
  /** Points of damage taken so far, 0 to PANE_STRENGTH. */
  readonly damage: number;
  readonly broken: boolean;
  /** Bullet holes as pairs (u, v) in metres from the pane's centre: u along the wall, v up. */
  readonly holes: readonly number[];
}

export const INTACT: PaneState = { damage: 0, broken: false, holes: [] };

export type HitOutcome = 'none' | 'cracked' | 'broke';

const snap = (value: number): number => Math.round(value / HOLE_GRID) * HOLE_GRID;

/** A hit of `power` at (u, v) on a pane in `state`: the new state and what happened. A broken pane
 * takes nothing more. A hit that breaks the pane leaves no hole: there is no glass left to hold it. */
export function applyHit(state: PaneState, u: number, v: number, power: number): { state: PaneState; outcome: HitOutcome } {
  if (state.broken || !(power > 0)) return { state, outcome: 'none' };
  const damage = Math.min(PANE_STRENGTH, state.damage + Math.floor(power));
  if (damage >= PANE_STRENGTH) return { state: { damage: PANE_STRENGTH, broken: true, holes: [] }, outcome: 'broke' };
  const holes = state.holes.length >= MAX_HOLES * 2 ? state.holes : [...state.holes, snap(u), snap(v)];
  return { state: { damage, broken: false, holes }, outcome: 'cracked' };
}

/** The more damaged of two states of one pane: what two players' views merge to. */
export function mergeStates(mine: PaneState, theirs: PaneState): PaneState {
  if (mine.broken) return mine;
  if (theirs.broken || theirs.damage > mine.damage) return theirs;
  return mine;
}

// ------------------------------------------------------------------------------------------------
// Where the panes are

/** One window of a house design, in the house's local frame (houseLayout.ts). */
export interface PaneSpec {
  /** The window's place in the design: walls in order, openings in order, windows only. */
  readonly index: number;
  readonly wall: number;
  readonly opening: number;
  /** The pane's centre: in the middle of the wall's thickness. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The wall runs along this local axis; the pane's width lies along it. */
  readonly run: 'x' | 'z';
  /** The outside lies toward this sign on the other axis. */
  readonly outward: 1 | -1;
  readonly width: number;
  readonly height: number;
  /** Height of the floor inside under the window, for the shards that lie there. */
  readonly floorInside: number;
}

/** A design may have this many windows: a pane id is the house key times this, plus the index. */
export const PANES_PER_HOUSE = 16;

/** Every window of a design, in an order that never changes for that design. */
export function layoutPanes(layout: HouseLayout): PaneSpec[] {
  const panes: PaneSpec[] = [];
  layout.walls.forEach((wall, wallIndex) => {
    wall.openings.forEach((opening, openingIndex) => {
      if (opening.kind !== 'window' || wall.outward === 0) return;
      const x = wall.run === 'x' ? opening.along : wall.at;
      const z = wall.run === 'x' ? wall.at : opening.along;
      // The floor a shard lands on: the highest floor slab under the sill at this spot.
      let floorInside = 0;
      for (const floor of layout.floors) {
        if (floor.maxY <= opening.bottom && floor.maxY > floorInside) floorInside = floor.maxY;
      }
      panes.push({
        index: panes.length, wall: wallIndex, opening: openingIndex,
        x, y: opening.bottom + opening.height / 2, z,
        run: wall.run, outward: wall.outward, width: opening.width, height: opening.height, floorInside,
      });
    });
  });
  if (panes.length > PANES_PER_HOUSE) throw new Error(`A house design has ${panes.length} windows; pane ids allow ${PANES_PER_HOUSE}`);
  return panes;
}

export function paneId(houseKey: number, index: number): number {
  return houseKey * PANES_PER_HOUSE + index;
}

export function parsePaneId(id: number): { houseKey: number; index: number } | null {
  if (!Number.isSafeInteger(id) || id < 0) return null;
  return { houseKey: Math.floor(id / PANES_PER_HOUSE), index: id % PANES_PER_HOUSE };
}

/** A pane standing in the world: an upright rectangle. */
export interface WorldPane {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Unit vector along the pane's width (horizontal): the direction u grows. */
  readonly ux: number;
  readonly uz: number;
  /** Unit normal (horizontal), pointing outside the house. */
  readonly nx: number;
  readonly nz: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** World height of the floor inside under the window, and of the ground outside. */
  readonly floorInside: number;
  readonly floorOutside: number;
}

/** A design's pane placed with its house (the same turn as houseToWorld). */
export function paneToWorld(spec: PaneSpec, id: number, originX: number, groundY: number, originZ: number, rotationY: number): WorldPane {
  const centre = houseToWorld(spec.x, spec.y, spec.z, originX, groundY, originZ, rotationY);
  const turn = (x: number, z: number): { x: number; z: number } => {
    const at = houseToWorld(x, 0, z, 0, 0, 0, rotationY);
    return { x: at.x, z: at.z };
  };
  const along = spec.run === 'x' ? turn(1, 0) : turn(0, 1);
  const out = spec.run === 'x' ? turn(0, spec.outward) : turn(spec.outward, 0);
  return {
    id, x: centre.x, y: centre.y, z: centre.z,
    ux: along.x, uz: along.z, nx: out.x, nz: out.z,
    halfWidth: spec.width / 2, halfHeight: spec.height / 2,
    floorInside: groundY + spec.floorInside, floorOutside: groundY,
  };
}

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PaneCrossing {
  /** Distance along the ray (rayPane), or the share of the segment travelled (sweepPane). */
  readonly at: number;
  readonly u: number;
  readonly v: number;
  /** 1 when the line travels from inside to outside (with the normal), -1 the other way. */
  readonly side: 1 | -1;
}

/** Where a ray from `origin` along unit `direction` passes through the pane within `maxDistance`. */
export function rayPane(pane: WorldPane, origin: Point, direction: Point, maxDistance: number): PaneCrossing | null {
  const approach = direction.x * pane.nx + direction.z * pane.nz;
  if (Math.abs(approach) < 1e-6) return null;
  const at = ((pane.x - origin.x) * pane.nx + (pane.z - origin.z) * pane.nz) / approach;
  if (at < 0 || at > maxDistance) return null;
  const px = origin.x + direction.x * at - pane.x, pz = origin.z + direction.z * at - pane.z;
  const u = px * pane.ux + pz * pane.uz, v = origin.y + direction.y * at - pane.y;
  if (Math.abs(u) > pane.halfWidth || Math.abs(v) > pane.halfHeight) return null;
  return { at, u, v, side: approach > 0 ? 1 : -1 };
}

/** Whether the straight segment between two points passes through the pane. */
export function segmentCrossesPane(pane: WorldPane, from: Point, to: Point): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return false;
  return rayPane(pane, from, { x: dx / length, y: dy / length, z: dz / length }, length) !== null;
}

/** A ball of `radius` moving from `from` to `to`: where it first touches the pane, as the share of
 * the move made (`at`), or null when it does not reach it. */
export function sweepPane(pane: WorldPane, from: Point, to: Point, radius: number): PaneCrossing | null {
  const before = (from.x - pane.x) * pane.nx + (from.z - pane.z) * pane.nz;
  const after = (to.x - pane.x) * pane.nx + (to.z - pane.z) * pane.nz;
  const sign = before >= 0 ? 1 : -1;
  const start = before * sign, end = after * sign;
  // Moving away, or never coming within a radius of the plane.
  if (end >= start || end > radius) return null;
  const at = start <= radius ? 0 : (start - radius) / (start - end);
  const px = from.x + (to.x - from.x) * at - pane.x, pz = from.z + (to.z - from.z) * at - pane.z;
  const u = px * pane.ux + pz * pane.uz, v = from.y + (to.y - from.y) * at - pane.y;
  if (Math.abs(u) > pane.halfWidth + radius * 0.5 || Math.abs(v) > pane.halfHeight + radius * 0.5) return null;
  // A ball already past the plane's face on its own side is not stopped by the edge it is leaving.
  if (start < 0) return null;
  return { at, u: Math.max(-pane.halfWidth, Math.min(pane.halfWidth, u)), v: Math.max(-pane.halfHeight, Math.min(pane.halfHeight, v)), side: sign > 0 ? -1 : 1 };
}

// ------------------------------------------------------------------------------------------------
// Between players

/** One pane's state on the wire (glassSync): id, damage, broken, holes. */
export interface GlassSyncEntry {
  readonly id: number;
  readonly d: number;
  readonly b: boolean;
  readonly h: readonly number[];
}

/** At most this many entries of a received list are read. */
export const GLASS_SYNC_MAX_ENTRIES = 2048;
/** No real pane is larger than this from its centre, in metres. */
const MAX_PANE_REACH = 4;

/** The valid entries of a received glassSync list: real panes (`isPane`), sane numbers, each pane
 * once. Anything that is not an array gives none. */
export function parseGlassSync(value: unknown, isPane: (id: number) => boolean): GlassSyncEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = new Map<number, GlassSyncEntry>();
  for (let i = 0; i < value.length && i < GLASS_SYNC_MAX_ENTRIES; i++) {
    const raw = value[i] as Partial<Record<keyof GlassSyncEntry, unknown>> | null;
    if (!raw || typeof raw !== 'object') continue;
    const { id, d, b, h } = raw;
    if (!Number.isSafeInteger(id) || (id as number) < 0 || !isPane(id as number)) continue;
    if (!Number.isInteger(d) || (d as number) < 0 || (d as number) > PANE_STRENGTH || typeof b !== 'boolean') continue;
    const holes: number[] = [];
    if (Array.isArray(h) && !b) {
      for (let k = 0; k + 1 < h.length && k < MAX_HOLES * 2; k += 2) {
        const u: unknown = h[k], v: unknown = h[k + 1];
        if (typeof u !== 'number' || typeof v !== 'number' || !Number.isFinite(u) || !Number.isFinite(v)) continue;
        if (Math.abs(u) > MAX_PANE_REACH || Math.abs(v) > MAX_PANE_REACH) continue;
        holes.push(snap(u), snap(v));
      }
    }
    entries.set(id as number, { id: id as number, d: b ? PANE_STRENGTH : (d as number), b, h: holes });
  }
  return [...entries.values()];
}

/** Whether a received glassHit's numbers are sane (the pane itself is checked against the world). */
export function isValidGlassHit(u: unknown, v: unknown, power: unknown, side: unknown): boolean {
  return typeof u === 'number' && Number.isFinite(u) && Math.abs(u) <= MAX_PANE_REACH
    && typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_PANE_REACH
    && Number.isInteger(power) && (power as number) >= 1 && (power as number) <= PANE_STRENGTH
    && (side === 1 || side === -1);
}
