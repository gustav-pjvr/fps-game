import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { ENEMY_HEIGHT, PLAYER_HEIGHT } from '../core/config.ts';
import { createHitColliders, ENEMY_HIT_SHAPE, PLAYER_HIT_SHAPE, yawRotation, type CharacterHitColliders, type CharacterHitShape, scaledHitShape } from './characterHitbox.ts';

// Real Rapier rays against the fitted hit shapes: a shot has to touch the character it is aimed
// at, and a near miss beside it (inside the old 0.45 m enemy and 0.4 m player capsules) has to
// stay a miss.

beforeAll(async () => {
  await RAPIER.init();
});

interface Setup {
  readonly world: RAPIER.World;
  readonly colliders: CharacterHitColliders;
}

function setup(shape: CharacterHitShape, yaw = 0): Setup {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, shape.height / 2, 0));
  const colliders = createHitColliders(world, body, shape);
  body.setNextKinematicRotation(yawRotation(yaw));
  world.step();
  return { world, colliders };
}

/** What a horizontal shot at `height` above the feet hits: 'head', 'body' or null. */
function shoot(s: Setup, height: number, from: { x: number; z: number }, dir: { x: number; z: number }): 'head' | 'body' | null {
  const ray = new RAPIER.Ray({ x: from.x, y: height, z: from.z }, { x: dir.x, y: 0, z: dir.z });
  const hit = s.world.castRay(ray, 20, true);
  if (!hit) return null;
  return hit.collider.handle === s.colliders.head.handle ? 'head' : 'body';
}

it('each shape is built for its character height', () => {
  expect(ENEMY_HIT_SHAPE.height).toBe(ENEMY_HEIGHT);
  expect(PLAYER_HIT_SHAPE.height).toBe(PLAYER_HEIGHT);
});

describe.each([
  ['enemy (SWAT)', ENEMY_HIT_SHAPE],
  ['other player (spacesuit)', PLAYER_HIT_SHAPE],
] as const)('%s hit shapes', (_name, shape) => {
  const chest = shape.bodyTop * 0.8;
  const beside = shape.bodyRadius + shape.bodyForward + 0.02;

  it('a shot at the chest hits the body, one just past the torso misses', () => {
    const s = setup(shape);
    expect(shoot(s, chest, { x: 0, z: 5 }, { x: 0, z: -1 })).toBe('body');
    expect(shoot(s, chest, { x: beside, z: 5 }, { x: 0, z: -1 })).toBeNull();
    expect(shoot(s, chest, { x: -beside, z: 5 }, { x: 0, z: -1 })).toBeNull();
    // Both old capsules were wider than this.
    expect(beside).toBeLessThan(0.4);
  });

  it('the legs are hittable down to the ankles', () => {
    expect(shoot(setup(shape), 0.15, { x: 0, z: 5 }, { x: 0, z: -1 })).toBe('body');
  });

  it('the head sits forward of the centre line, where the model carries it', () => {
    const s = setup(shape);
    expect(shoot(s, shape.headHeight, { x: 5, z: shape.headForward }, { x: -1, z: 0 })).toBe('head');
    expect(shoot(s, shape.headHeight, { x: 5, z: -shape.headForward }, { x: -1, z: 0 })).toBeNull();
  });

  it('there is no gap at the neck, and nothing above the crown', () => {
    const s = setup(shape);
    expect(shoot(s, shape.bodyTop - 0.03, { x: 0, z: 5 }, { x: 0, z: -1 })).not.toBeNull();
    expect(shoot(s, shape.headHeight + shape.headRadius + 0.02, { x: 0, z: 5 }, { x: 0, z: -1 })).toBeNull();
  });

  it('the head turns with the body', () => {
    // Facing +X (yaw 90 degrees): the head is now along +X.
    const s = setup(shape, Math.PI / 2);
    expect(shoot(s, shape.headHeight, { x: shape.headForward, z: 5 }, { x: 0, z: -1 })).toBe('head');
    expect(shoot(s, shape.headHeight, { x: -shape.headForward, z: 5 }, { x: 0, z: -1 })).toBeNull();
  });
});

it('a scaled shape grows up from the same feet: the head of an elite 1.22 times as big is 1.22 times as high', () => {
  const scaled = scaledHitShape(ENEMY_HIT_SHAPE, 1.22);
  // The rigid body does not move, so the height it is centred on stays.
  expect(scaled.height).toBe(ENEMY_HIT_SHAPE.height);
  expect(scaled.headHeight).toBeCloseTo(ENEMY_HIT_SHAPE.headHeight * 1.22);
  expect(scaled.headRadius).toBeCloseTo(ENEMY_HIT_SHAPE.headRadius * 1.22);
  expect(scaled.bodyTop).toBeCloseTo(ENEMY_HIT_SHAPE.bodyTop * 1.22);
  // No gap at the neck, as on the original: the head ball still reaches down to the capsule's top.
  expect(scaled.headHeight - scaled.headRadius).toBeLessThanOrEqual(scaled.bodyTop);
  expect(scaledHitShape(ENEMY_HIT_SHAPE, 1)).toEqual(ENEMY_HIT_SHAPE);
});
