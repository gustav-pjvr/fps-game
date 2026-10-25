import type { HouseFootprint } from '../../../world/houseFootprint.ts';
import type { InteriorCoverSlot } from '../../../world/houses/houseCover.ts';

/**
 * Where the cover is (enemy AI v2, step 3 - docs/enemy-ai-v2.md). The world managers register
 * the obstacles an enemy can hide behind as their chunks load and drop them as chunks unload, so
 * position picking can ask "what cover is near here" without any physics query.
 *
 * Why not ask Rapier (collidersWithAabbIntersectingAabb): vegetation, house and tower colliders
 * are never registered with PhysicsWorld.getEntity, and trunks, rocks and house walls cannot be
 * told apart by shape alone. The managers already know exactly what they placed, so they say so
 * here. Rays still confirm every spot before an enemy trusts it (tacticalQuery.ts).
 *
 * Only real cover goes in: tree trunks and houses. Rocks (about 0.9 m tall) sit below an enemy's
 * chest (1.1 m) and cannot hide it. Watch towers are fixed per seed and come straight from
 * getWatchTowerPositions instead.
 */

export type Obstacle =
  | { readonly kind: 'trunk'; readonly x: number; readonly z: number; readonly radius: number }
  | {
    readonly kind: 'house';
    readonly footprint: HouseFootprint;
    /** An enterable house's cover spots inside, in the world (world/houses/houseCover.ts). */
    readonly interior?: readonly InteriorCoverSlot[];
  };

export interface ObstacleQuery {
  /** Every registered obstacle whose own extent reaches within `radius` of (x, z). */
  near(x: number, z: number, radius: number): Obstacle[];
}

const CELL_SIZE = 16;
/** A bound on how far any obstacle's own extent reaches past its centre (the largest house's half
 * diagonal plus its model offset is under 10 m), so the cell scan never misses one. */
const MAX_OBSTACLE_REACH = 14;

/** The obstacle's centre in world XZ. A house's centre is its footprint rectangle's centre, which
 * sits offsetX/offsetZ from its placement origin, turned by the building's rotation (the inverse of
 * the transform in houseFootprint.ts's isPointNearFootprint). */
export function obstacleCentre(obstacle: Obstacle): { x: number; z: number } {
  if (obstacle.kind === 'trunk') return { x: obstacle.x, z: obstacle.z };
  const fp = obstacle.footprint;
  const cos = Math.cos(fp.rotationY);
  const sin = Math.sin(fp.rotationY);
  return {
    x: fp.originX + fp.offsetX * cos + fp.offsetZ * sin,
    z: fp.originZ - fp.offsetX * sin + fp.offsetZ * cos,
  };
}

/** How far the obstacle itself reaches from its centre. */
export function obstacleReach(obstacle: Obstacle): number {
  if (obstacle.kind === 'trunk') return obstacle.radius;
  return Math.hypot(obstacle.footprint.halfWidth, obstacle.footprint.halfDepth);
}

function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class ObstacleRegistry implements ObstacleQuery {
  private readonly byChunk = new Map<string, Obstacle[]>();
  private readonly byCell = new Map<string, Obstacle[]>();
  private count = 0;

  get size(): number {
    return this.count;
  }

  add(chunk: string, obstacle: Obstacle): void {
    const owned = this.byChunk.get(chunk) ?? [];
    owned.push(obstacle);
    this.byChunk.set(chunk, owned);
    const centre = obstacleCentre(obstacle);
    const key = cellKey(Math.floor(centre.x / CELL_SIZE), Math.floor(centre.z / CELL_SIZE));
    const cell = this.byCell.get(key) ?? [];
    cell.push(obstacle);
    this.byCell.set(key, cell);
    this.count++;
  }

  removeChunk(chunk: string): void {
    const owned = this.byChunk.get(chunk);
    if (!owned) return;
    for (const obstacle of owned) {
      const centre = obstacleCentre(obstacle);
      const key = cellKey(Math.floor(centre.x / CELL_SIZE), Math.floor(centre.z / CELL_SIZE));
      const cell = this.byCell.get(key);
      if (!cell) continue;
      const index = cell.indexOf(obstacle);
      if (index >= 0) cell.splice(index, 1);
      if (cell.length === 0) this.byCell.delete(key);
      this.count--;
    }
    this.byChunk.delete(chunk);
  }

  near(x: number, z: number, radius: number): Obstacle[] {
    const reach = radius + MAX_OBSTACLE_REACH;
    const minCx = Math.floor((x - reach) / CELL_SIZE);
    const maxCx = Math.floor((x + reach) / CELL_SIZE);
    const minCz = Math.floor((z - reach) / CELL_SIZE);
    const maxCz = Math.floor((z + reach) / CELL_SIZE);
    const found: Obstacle[] = [];
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cell = this.byCell.get(cellKey(cx, cz));
        if (!cell) continue;
        for (const obstacle of cell) {
          const centre = obstacleCentre(obstacle);
          if (Math.hypot(centre.x - x, centre.z - z) <= radius + obstacleReach(obstacle)) found.push(obstacle);
        }
      }
    }
    return found;
  }

  clear(): void {
    this.byChunk.clear();
    this.byCell.clear();
    this.count = 0;
  }
}
