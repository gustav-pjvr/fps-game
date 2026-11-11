import {
  applyHit, INTACT, mergeStates, rayPane, segmentCrossesPane, sweepPane,
  type GlassSyncEntry, type HitOutcome, type PaneCrossing, type PaneState, type WorldPane,
} from './glassPane.ts';

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PaneHit extends PaneCrossing {
  readonly pane: WorldPane;
}

/** Told when a pane's look must change. `side` (a break only) is the way the force travelled: 1
 * from inside to outside, -1 from outside in, 0 for a quiet change (a sync, a house streaming in). */
export type GlassListener = (id: number, pane: WorldPane | null, state: PaneState, outcome: HitOutcome, side: 1 | -1 | 0) => void;

/** How near a broken window (metres, along the ground) a foot treads on its shards. */
const DEBRIS_REACH = 1.1;

/**
 * Every pane's state for the whole match, and the panes of the houses streamed in right now
 * (docs/glass.md). The state outlives a house streaming out: when its chunk comes back, its windows
 * are as they were left. Nothing here draws or touches physics; GlassView listens for changes.
 */
export class GlassStore {
  /** Only panes that have been hit: an untouched pane has no entry. */
  private readonly states = new Map<number, PaneState>();
  private readonly panes = new Map<number, WorldPane>();
  private listener: GlassListener | null = null;
  /** Rises with every change of state: the sync tracker compares it to decide whether to resend. */
  revision = 0;

  setListener(listener: GlassListener | null): void {
    this.listener = listener;
  }

  /** A house streamed in: its panes stand again, each in the state it was left in. */
  addPanes(panes: readonly WorldPane[]): void {
    for (const pane of panes) {
      this.panes.set(pane.id, pane);
      this.listener?.(pane.id, pane, this.stateOf(pane.id), 'none', 0);
    }
  }

  /** A house streamed out: its panes are no longer in the world, their state is kept. */
  removePanes(ids: readonly number[]): void {
    for (const id of ids) {
      if (this.panes.delete(id)) this.listener?.(id, null, this.stateOf(id), 'none', 0);
    }
  }

  stateOf(id: number): PaneState {
    return this.states.get(id) ?? INTACT;
  }

  pane(id: number): WorldPane | null {
    return this.panes.get(id) ?? null;
  }

  get streamedCount(): number {
    return this.panes.size;
  }

  /** Every pane streamed in right now. */
  streamed(): WorldPane[] {
    return [...this.panes.values()];
  }

  private isIntact(id: number): boolean {
    return !this.states.get(id)?.broken;
  }

  /** Every intact pane a ray passes through within `maxDistance`, nearest first. */
  rayHits(origin: Point, direction: Point, maxDistance: number): PaneHit[] {
    const hits: PaneHit[] = [];
    for (const pane of this.panes.values()) {
      if (!this.isIntact(pane.id)) continue;
      const crossing = rayPane(pane, origin, direction, maxDistance);
      if (crossing) hits.push({ ...crossing, pane });
    }
    return hits.sort((a, b) => a.at - b.at);
  }

  /** How many intact panes lie on the straight line between two points (for sound). */
  intactBetween(from: Point, to: Point): number {
    let count = 0;
    for (const pane of this.panes.values()) {
      if (this.isIntact(pane.id) && segmentCrossesPane(pane, from, to)) count++;
    }
    return count;
  }

  /** The first intact pane a ball of `radius` touches moving from `from` to `to` (a thrown grenade). */
  sweep(from: Point, to: Point, radius: number): PaneHit | null {
    let first: PaneHit | null = null;
    for (const pane of this.panes.values()) {
      if (!this.isIntact(pane.id)) continue;
      const crossing = sweepPane(pane, from, to, radius);
      if (crossing && (!first || crossing.at < first.at)) first = { ...crossing, pane };
    }
    return first;
  }

  /** The intact panes whose centre is within `radius` of a point (a blast). */
  intactNear(point: Point, radius: number): WorldPane[] {
    const near: WorldPane[] = [];
    for (const pane of this.panes.values()) {
      if (!this.isIntact(pane.id)) continue;
      if (Math.hypot(pane.x - point.x, pane.y - point.y, pane.z - point.z) <= radius) near.push(pane);
    }
    return near;
  }

  /** Whether a foot at this point treads on the shards under a broken window. */
  debrisUnderfoot(x: number, feetY: number, z: number): boolean {
    for (const pane of this.panes.values()) {
      if (this.isIntact(pane.id)) continue;
      const dx = x - pane.x, dz = z - pane.z;
      const along = dx * pane.ux + dz * pane.uz, across = dx * pane.nx + dz * pane.nz;
      if (Math.abs(along) > pane.halfWidth + 0.3 || Math.abs(across) > DEBRIS_REACH) continue;
      const floor = across > 0 ? pane.floorOutside : pane.floorInside;
      if (Math.abs(feetY - floor) < 0.6) return true;
    }
    return false;
  }

  /** A hit of `power` at (u, v) on pane `id`, by anyone: the state changes and the view is told.
   * Works for a pane that is not streamed in (another player's hit far away): only the state moves. */
  hit(id: number, u: number, v: number, power: number, side: 1 | -1): HitOutcome {
    const result = applyHit(this.stateOf(id), u, v, power);
    if (result.outcome === 'none') return 'none';
    this.states.set(id, result.state);
    this.revision++;
    this.listener?.(id, this.panes.get(id) ?? null, result.state, result.outcome, side);
    return result.outcome;
  }

  /** Every hit pane, as glassSync carries it. */
  snapshot(): GlassSyncEntry[] {
    const entries: GlassSyncEntry[] = [];
    for (const [id, state] of this.states) entries.push({ id, d: state.damage, b: state.broken, h: [...state.holes] });
    return entries;
  }

  /** Another player's whole set (glassSync): each pane becomes the more damaged of the two views,
   * quietly (no burst, no sound). */
  merge(entries: readonly GlassSyncEntry[]): void {
    for (const entry of entries) {
      const mine = this.stateOf(entry.id);
      const merged = mergeStates(mine, { damage: entry.d, broken: entry.b, holes: entry.h });
      if (merged === mine) continue;
      this.states.set(entry.id, merged);
      this.revision++;
      this.listener?.(entry.id, this.panes.get(entry.id) ?? null, merged, 'none', 0);
    }
  }
}
