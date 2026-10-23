import RAPIER from '@dimforge/rapier3d-compat';
import { ENEMY_HEIGHT } from '../../core/config.ts';

/**
 * The enemy's hit shapes, fitted to the posed SWAT character (characterModels.ts) rather than the
 * old Kenney figure, whose 0.45 m capsule was nearly twice as wide as the new body. Measured from
 * the skinned vertices in the Idle_Gun, Walk and Run clips at ENEMY_HEIGHT, rifle left out:
 * - torso and legs sit within 0.25 to 0.28 m of the centre line, centred about 0.06 m forward;
 * - the helmeted head is a 0.17 m sphere (95% of its vertices) 1.48 m up and 0.12 m forward,
 *   with the helmet's crown at 1.65 to 1.67 m.
 * Swinging arms and the raised rifle reach past these in motion and are deliberately left out, so
 * a hit means the body was hit. All offsets are in the body's frame (forward is +Z, the way the
 * model faces), relative to the capsule-centred rigid body at ENEMY_HEIGHT / 2 above the feet.
 */
export const ENEMY_HIT_BODY_RADIUS = 0.27;
/** Feet to shoulders: the capsule ends where the head sphere begins, with no gap at the neck. */
export const ENEMY_HIT_BODY_TOP = 1.36;
export const ENEMY_HIT_BODY_FORWARD = 0.06;
export const ENEMY_HIT_HEAD_RADIUS = 0.17;
export const ENEMY_HIT_HEAD_HEIGHT = 1.48;
export const ENEMY_HIT_HEAD_FORWARD = 0.12;

export interface EnemyHitColliders {
  readonly body: RAPIER.Collider;
  readonly head: RAPIER.Collider;
}

export function createEnemyHitColliders(world: RAPIER.World, rigidBody: RAPIER.RigidBody): EnemyHitColliders {
  const halfHeight = ENEMY_HIT_BODY_TOP / 2 - ENEMY_HIT_BODY_RADIUS;
  const body = world.createCollider(
    RAPIER.ColliderDesc.capsule(halfHeight, ENEMY_HIT_BODY_RADIUS).setTranslation(0, ENEMY_HIT_BODY_TOP / 2 - ENEMY_HEIGHT / 2, ENEMY_HIT_BODY_FORWARD),
    rigidBody,
  );
  const head = world.createCollider(
    RAPIER.ColliderDesc.ball(ENEMY_HIT_HEAD_RADIUS).setTranslation(0, ENEMY_HIT_HEAD_HEIGHT - ENEMY_HEIGHT / 2, ENEMY_HIT_HEAD_FORWARD),
    rigidBody,
  );
  return { body, head };
}

/** The rotation that turns the body's +Z to face `yaw` (the model's rotation.y), so the forward
 * offsets above follow the character as it turns. */
export function yawRotation(yaw: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
