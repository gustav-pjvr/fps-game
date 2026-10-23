import { describe, expect, it } from 'vitest';
import { shadeTerrain } from './terrainShading.ts';

describe('shadeTerrain', () => {
  it('leaves flat ground fully open with straight-up normals', () => {
    const { normals, colors } = shadeTerrain(() => 5, 0, 0, 8, 10);
    for (let i = 0; i < colors.length; i++) expect(colors[i]).toBe(1);
    for (let i = 0; i < normals.length; i += 3) {
      expect(normals[i]).toBeCloseTo(0);
      expect(normals[i + 1]).toBeCloseTo(1);
      expect(normals[i + 2]).toBeCloseTo(0);
    }
  });

  it('darkens the floor of a bowl more than its rim', () => {
    const bowl = (x: number, z: number): number => 0.08 * ((x - 5) ** 2 + (z - 5) ** 2);
    const { colors } = shadeTerrain(bowl, 0, 0, 8, 10);
    const centre = (4 * 9 + 4) * 3;
    const corner = 0;
    expect(colors[centre]!).toBeLessThan(colors[corner]!);
    expect(colors[centre]!).toBeGreaterThanOrEqual(0.4);
  });

  it('gives identical normals and AO on both sides of a chunk border', () => {
    const hills = (x: number, z: number): number => Math.sin(x * 0.3) * 3 + Math.cos(z * 0.2) * 2;
    const left = shadeTerrain(hills, 0, 0, 8, 10);
    const right = shadeTerrain(hills, 10, 0, 8, 10);
    for (let row = 0; row <= 8; row++) {
      const edgeLeft = (row * 9 + 8) * 3;
      const edgeRight = row * 9 * 3;
      for (let k = 0; k < 3; k++) {
        expect(left.normals[edgeLeft + k]).toBeCloseTo(right.normals[edgeRight + k]!, 6);
        expect(left.colors[edgeLeft + k]).toBeCloseTo(right.colors[edgeRight + k]!, 6);
      }
    }
  });

  it('tilts the normal away from rising ground', () => {
    const slope = (x: number): number => x * 0.5;
    const { normals } = shadeTerrain(slope, 0, 0, 4, 4);
    expect(normals[0]!).toBeLessThan(0);
    expect(normals[1]!).toBeGreaterThan(0);
  });
});
