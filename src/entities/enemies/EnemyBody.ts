import RAPIER from '@dimforge/rapier3d-compat';
import type { EnemyArchetype } from './archetypes.ts';
import { ENEMY_HEIGHT, ENEMY_RADIUS } from '../../core/config.ts';

/** Eye height above the capsule centre: where the brain's sight lines and shots start. It is the
 * old head ball's centre, kept when the hit shapes were fitted to the SWAT character
 * (characterHitbox.ts) so that no sight line moved. */
export const ENEMY_HEAD_OFFSET_Y = ENEMY_HEIGHT / 2 - ENEMY_RADIUS * 0.55;

export interface EnemyPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * What an enemy's brain (EnemyBrain.ts) is allowed to do with its body (Enemy.ts). Enemy AI v2
 * split the two (docs/enemy-ai-v2-design.md, commit 0) so decision logic can grow without the
 * shell (colliders, model, animation, health) growing with it, and so later steps can swap
 * movement (a navmesh, if step 7 is ever taken) behind this interface without touching the brain.
 *
 * Kinematic moves land on the next physics step, so `position` reads the same value for the whole
 * of one tick no matter how many move calls the brain makes in it.
 */
export interface EnemyBody {
  readonly id: number;
  readonly archetype: EnemyArchetype;
  /** Capsule centre, read fresh from the rigid body. */
  readonly position: EnemyPosition;
  /** The enemy's own rigid body, excluded from its sight-line and shot rays (the head ball and the
   * body capsule both sit on it, see enemySteering.ts's hasLineOfSight comment). */
  readonly excludeRigidBody: RAPIER.RigidBody;
  /** True once any move call has run this tick - the shell clears it at the start of each tick. */
  readonly isMoving: boolean;
  /** Which way the enemy faces, in the mesh's convention (rotation.y = atan2(dx, dz), so forward is
   * (sin, cos)) - the centre of its view cone. */
  readonly facingYaw: number;
  /** Steps toward the target with whisker avoidance, facing the direction of travel. `targetY` is the
   * target's body centre height when known (a house's upper floor, see enemyNavigator.ts). */
  moveToward(targetX: number, targetZ: number, speed: number, dt: number, targetY?: number): void;
  /** Steps directly away from the threat with whisker avoidance while facing it (the kiting
   * retreat). Returns the new position, or null when standing exactly on the threat. */
  retreatFrom(threatX: number, threatZ: number, speed: number, dt: number): EnemyPosition | null;
  /** Turns to face the point and holds position (re-glues the kinematic body to the ground). */
  faceToward(x: number, z: number): void;
  /** A ranged round was just fired: the body plays its shot (visual only, optional for test bodies). */
  onFired?(): void;
}
