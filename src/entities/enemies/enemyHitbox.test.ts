import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { ENEMY_HEIGHT } from '../../core/config.ts';
import { createEnemyHitColliders, yawRotation, type EnemyHitColliders } from './enemyHitbox.ts';

// Real Rapier rays against the fitted hit shapes: a shot has to touch the character it is aimed
// at, and a near miss beside it (inside the old 0.45 m capsule) has to stay a miss.

beforeAll(async () => {
  await RAPIER.init();
});

function setup(yaw = 0): { world: RAPIER.World; colliders: EnemyHitColliders } {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, ENEMY_HEIGHT / 2, 0));
  const colliders = createEnemyHitColliders(world, body);
  body.setNextKinematicRotation(yawRotation(yaw));
  world.step();
  return { world, colliders };
}

/** What a horizontal shot at `height` above the feet hits: 'head', 'body' or null. */
function shoot(setupResult: ReturnType<typeof setup>, height: number, from: { x: number; z: number }, dir: { x: number; z: number }): 'head' | 'body' | null {
  const ray = new RAPIER.Ray({ x: from.x, y: height, z: from.z }, { x: dir.x, y: 0, z: dir.z });
  const hit = setupResult.world.castRay(ray, 20, true);
  if (!hit) return null;
  return hit.collider.handle === setupResult.colliders.head.handle ? 'head' : 'body';
}

describe('enemy hit shapes', () => {
  it('a shot at the chest hits the body, one 0.33 m to the side misses', () => {
    const s = setup();
    expect(shoot(s, 1.1, { x: 0, z: 5 }, { x: 0, z: -1 })).toBe('body');
    expect(shoot(s, 1.1, { x: 0.33, z: 5 }, { x: 0, z: -1 })).toBeNull();
    expect(shoot(s, 1.1, { x: -0.33, z: 5 }, { x: 0, z: -1 })).toBeNull();
  });

  it('the legs are hittable down to the ankles', () => {
    expect(shoot(setup(), 0.15, { x: 0, z: 5 }, { x: 0, z: -1 })).toBe('body');
  });

  it('the head sits forward of the centre line, where the model carries it', () => {
    const s = setup();
    expect(shoot(s, 1.48, { x: 5, z: 0.12 }, { x: -1, z: 0 })).toBe('head');
    expect(shoot(s, 1.48, { x: 5, z: -0.12 }, { x: -1, z: 0 })).toBeNull();
  });

  it('there is no gap at the neck, and nothing above the helmet', () => {
    const s = setup();
    expect(shoot(s, 1.33, { x: 0, z: 5 }, { x: 0, z: -1 })).not.toBeNull();
    expect(shoot(s, 1.68, { x: 0, z: 5 }, { x: 0, z: -1 })).toBeNull();
  });

  it('the head turns with the body', () => {
    // Facing +X (yaw 90 degrees): the head is now 0.12 m along +X.
    const s = setup(Math.PI / 2);
    expect(shoot(s, 1.48, { x: 0.12, z: 5 }, { x: 0, z: -1 })).toBe('head');
    expect(shoot(s, 1.48, { x: -0.12, z: 5 }, { x: 0, z: -1 })).toBeNull();
  });
});
