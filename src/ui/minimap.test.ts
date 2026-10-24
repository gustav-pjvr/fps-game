import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { minimapTransform } from './minimap.ts';

const apply = (m: readonly number[], x: number, z: number): { sx: number; sy: number } => ({
  sx: m[0]! * x + m[2]! * z + m[4]!,
  sy: m[1]! * x + m[3]! * z + m[5]!,
});

describe('minimapTransform', () => {
  it('matches the dots: the offset rotated by -yaw about Y, scaled, around the centre', () => {
    const scale = 70 / 26;
    for (const [px, pz, yaw, x, z] of [
      [0, 0, 0, 5, -3],
      [10, -4, 1.1, 2, 7],
      [-20, 13, -2.4, -25, 0],
      [3, 3, Math.PI, 3, -10],
    ] as const) {
      const rotated = new THREE.Vector3(x - px, 0, z - pz).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -yaw, 0, 'YXZ')));
      const { sx, sy } = apply(minimapTransform(px, pz, yaw, scale, 70), x, z);
      expect(sx).toBeCloseTo(70 + rotated.x * scale);
      expect(sy).toBeCloseTo(70 + rotated.z * scale);
    }
  });

  it('puts the player at the centre and their forward straight up', () => {
    const yaw = 0.7;
    const m = minimapTransform(4, -9, yaw, 2, 70);
    const centre = apply(m, 4, -9);
    expect(centre.sx).toBeCloseTo(70);
    expect(centre.sy).toBeCloseTo(70);
    // Player forward is (0, 0, -1) turned by yaw, as Player builds it.
    const ahead = apply(m, 4 - Math.sin(yaw) * 10, -9 - Math.cos(yaw) * 10);
    expect(ahead.sx).toBeCloseTo(70);
    expect(ahead.sy).toBeCloseTo(50);
  });
});
