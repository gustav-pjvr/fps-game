import { horizontalDistance } from './enemySteering.ts';
import type { EnemyPosition } from './EnemyBody.ts';
import { ENEMY_STUCK_EPSILON, ENEMY_STUCK_WINDOW } from '../../core/config.ts';

/**
 * No navmesh in this codebase - whisker avoidance (see enemySteering.ts) handles convex obstacles,
 * but a concave trap (e.g. a tight gap between buildings) can still wedge an enemy. This notices
 * when an enemy has been trying to move but has covered less than ENEMY_STUCK_EPSILON over
 * ENEMY_STUCK_WINDOW, so the caller can give up on what it was doing (patrol picks a fresh
 * destination, the kiting retreat stops, a position pick is logged unreachable) instead of
 * freezing in place. Split out of EnemyBrain in enemy AI v2 step 3 so patrol and combat can each
 * keep their own.
 */
export class StuckDetector {
  private timer = 0;
  private lastX: number;
  private lastZ: number;

  constructor(start: EnemyPosition) {
    this.lastX = start.x;
    this.lastZ = start.z;
  }

  /** Starts a fresh window from `position` (a new destination). */
  reset(position: EnemyPosition): void {
    this.timer = 0;
    this.lastX = position.x;
    this.lastZ = position.z;
  }

  /** Call once per tick while moving somewhere; true when the enemy is stuck. */
  update(dt: number, current: EnemyPosition, isMoving: boolean): boolean {
    this.timer += dt;
    if (this.timer < ENEMY_STUCK_WINDOW) return false;
    const moved = horizontalDistance(current, { x: this.lastX, z: this.lastZ });
    const stuck = isMoving && moved < ENEMY_STUCK_EPSILON;
    this.timer = 0;
    this.lastX = current.x;
    this.lastZ = current.z;
    return stuck;
  }
}
