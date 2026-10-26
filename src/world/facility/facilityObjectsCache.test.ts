import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { generateFacilityLayout } from './facilityLayout.ts';
import { FacilityObjects } from './FacilityObjects.ts';
import type { FacilityWorld } from './FacilityBuilder.ts';

let physics: PhysicsWorld;
beforeAll(async () => {
  physics = await PhysicsWorld.create();
});
afterAll(() => physics.dispose());

describe('FacilityObjects.closedDoors', () => {
  it('returns the same list until a door changes, then a fresh correct one', () => {
    const layout = generateFacilityLayout(1);
    const world = { setLampPowered: () => {} } as unknown as FacilityWorld;
    const objects = FacilityObjects.build(layout, world, null, { scene: new THREE.Scene(), physics });
    const first = objects.closedDoors();
    expect(first.length).toBeGreaterThan(0);
    // Nothing changed: no new array per call (a wandering goose asks every step).
    expect(objects.closedDoors()).toBe(first);
    const door = first[0]!;
    expect(objects.set('door', door.id, true, true)).toBe(true);
    const second = objects.closedDoors();
    expect(second).not.toBe(first);
    expect(second.map(d => d.id)).not.toContain(door.id);
    expect(second.length).toBe(first.length - 1);
    expect(objects.closedDoors()).toBe(second);
    // A reset (single-player Restart) brings it back.
    objects.reset();
    expect(objects.closedDoors().map(d => d.id)).toContain(door.id);
    objects.dispose();
  });
});
