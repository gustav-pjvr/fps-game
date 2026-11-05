import { describe, expect, it } from 'vitest';
import { valleyFallRecovery } from '../core/valleyFallRecovery.ts';

describe('Valley fall recovery', () => {
  const towers = [{ x: 10, z: 20, floorY: -15 }, { x: -30, z: 20, floorY: -9 }];
  it('uses the nearest tower and a strict 25 m margin below its lowest lab floor', () => {
    expect(valleyFallRecovery({ x: 10, y: -40, z: 20 }, 0, towers)).toBeNull();
    expect(valleyFallRecovery({ x: 10, y: -40.01, z: 20 }, 0, towers)).toEqual({ x: 14.5, z: 20 });
    expect(valleyFallRecovery({ x: -29, y: -35, z: 20 }, 0, towers)).toEqual({ x: -25.5, z: 20 });
    for (const y of [18, 0, -3.85, -9, -15]) expect(valleyFallRecovery({ x: 10, y, z: 20 }, 0, towers)).toBeNull();
  });
  it('also recovers a fall 60 m below terrain, including far from the towers', () => {
    const deep = [{ x: 10, z: 20, floorY: -100 }];
    expect(valleyFallRecovery({ x: 150, y: -10, z: 150 }, 50, deep)).toBeNull();
    expect(valleyFallRecovery({ x: 150, y: -10.01, z: 150 }, 50, deep)).toEqual({ x: 14.5, z: 20 });
    expect(valleyFallRecovery({ x: 1, y: -61, z: 2 }, 0, [])).toEqual({ x: 1, z: 2 });
  });
});
