import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { throwSegmentBlocked } from './ThrownGoose.ts';

let physics: PhysicsWorld;

beforeAll(async () => {
  physics = await PhysicsWorld.create();
  // A house wall: 0.3 m thick across x = 5, 6 m long (z -3 to 3), 3 m high.
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.15, 1.5, 3).setTranslation(5, 1.5, 0));
  // A tree's canopy: a sensor ball, not solid.
  physics.world.createCollider(RAPIER.ColliderDesc.ball(1).setSensor(true).setTranslation(-5, 2, 0));
  physics.step(1 / 60);
});

afterAll(() => physics.dispose());

describe('throwSegmentBlocked', () => {
  it('a step through a wall is blocked, one beside or short of it is not', () => {
    const w = physics.world;
    expect(throwSegmentBlocked(w, { x: 4.8, y: 1.5, z: 0 }, { x: 5.4, y: 1.5, z: 0 })).toBe(true);
    expect(throwSegmentBlocked(w, { x: 4, y: 1.5, z: 0 }, { x: 4.6, y: 1.5, z: 0 })).toBe(false);
    expect(throwSegmentBlocked(w, { x: 4.8, y: 1.5, z: 4 }, { x: 5.4, y: 1.5, z: 4 })).toBe(false);
    // Over the wall.
    expect(throwSegmentBlocked(w, { x: 4.8, y: 3.6, z: 0 }, { x: 5.4, y: 3.6, z: 0 })).toBe(false);
  });

  it('ignores sensors and a zero-length step', () => {
    const w = physics.world;
    expect(throwSegmentBlocked(w, { x: -6, y: 2, z: 0 }, { x: -4, y: 2, z: 0 })).toBe(false);
    expect(throwSegmentBlocked(w, { x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 0 })).toBe(false);
  });
});
