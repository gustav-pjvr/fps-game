import { describe, expect, it } from 'vitest';
import { ObstacleRegistry, obstacleCentre, obstacleReach, type Obstacle } from './obstacleRegistry.ts';
import { isPointNearFootprint, type HouseFootprint } from '../../../world/buildingColliders.ts';

function house(overrides: Partial<HouseFootprint> = {}): HouseFootprint {
  return { originX: 40, originZ: -20, offsetX: 1, offsetZ: 0.5, halfWidth: 4, halfDepth: 3, rotationY: 0.7, ...overrides };
}

const trunk = (x: number, z: number): Obstacle => ({ kind: 'trunk', x, z, radius: 0.35 });

describe('obstacle geometry', () => {
  it("puts a house's centre inside its own footprint, offset and rotation included", () => {
    const footprint = house();
    const centre = obstacleCentre({ kind: 'house', footprint });
    expect(isPointNearFootprint(centre.x, centre.z, footprint, 0)).toBe(true);
    // The origin itself is off-centre by the model offset.
    expect(Math.hypot(centre.x - footprint.originX, centre.z - footprint.originZ)).toBeCloseTo(Math.hypot(1, 0.5));
  });

  it('reaches as far as its own extent', () => {
    expect(obstacleReach(trunk(0, 0))).toBe(0.35);
    expect(obstacleReach({ kind: 'house', footprint: house() })).toBeCloseTo(5);
  });
});

describe('ObstacleRegistry', () => {
  it('finds a nearby trunk and not a far one', () => {
    const registry = new ObstacleRegistry();
    registry.add('a', trunk(10, 10));
    registry.add('a', trunk(60, 60));
    const found = registry.near(12, 10, 5);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'trunk', x: 10, z: 10 });
  });

  it('finds a house whose edge is in range even when its centre is not', () => {
    const registry = new ObstacleRegistry();
    const footprint = house({ rotationY: 0, offsetX: 0, offsetZ: 0 });
    registry.add('a', { kind: 'house', footprint });
    // 5.5 m from the centre, with a 1 m query radius: only the house's own 5 m reach brings it in.
    expect(registry.near(40 + 5.5, -20, 1)).toHaveLength(1);
    expect(registry.near(40 + 7, -20, 1)).toHaveLength(0);
  });

  it('finds obstacles across cell boundaries', () => {
    const registry = new ObstacleRegistry();
    registry.add('a', trunk(15.9, 0));
    expect(registry.near(16.1, 0, 1)).toHaveLength(1);
    registry.add('a', trunk(-0.1, -0.1));
    expect(registry.near(0.1, 0.1, 1)).toHaveLength(1);
  });

  it("removing a chunk drops only that chunk's obstacles", () => {
    const registry = new ObstacleRegistry();
    registry.add('a', trunk(5, 5));
    registry.add('b', trunk(6, 5));
    expect(registry.size).toBe(2);
    registry.removeChunk('a');
    expect(registry.size).toBe(1);
    const found = registry.near(5, 5, 3);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ x: 6 });
    registry.removeChunk('missing');
    expect(registry.size).toBe(1);
  });

  it('clears everything', () => {
    const registry = new ObstacleRegistry();
    registry.add('a', trunk(5, 5));
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.near(5, 5, 3)).toHaveLength(0);
  });
});
