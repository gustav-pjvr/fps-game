import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boxAlong } from './structureKit.ts';

describe('boxAlong', () => {
  it('runs a sloped box along its segment without rolling it, in any direction', () => {
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, 0.8]]) {
      const start = new THREE.Vector3(1, 2, 3);
      const end = start.clone().add(new THREE.Vector3(dx! * 6, 3.2, dz! * 6));
      const b = boxAlong(start, end, 0.4, 2.4);
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(b.rotation);
      const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(b.rotation);
      expect(localX.angleTo(end.clone().sub(start))).toBeLessThan(1e-6);
      // The width axis stays level: a ramp along Z must not lean sideways.
      expect(Math.abs(localZ.y)).toBeLessThan(1e-6);
      expect(b.halfExtents.x * 2).toBeCloseTo(start.distanceTo(end), 6);
    }
  });

  it('handles a vertical segment', () => {
    const b = boxAlong(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, 0), 0.1, 0.1);
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(b.rotation).y).toBeCloseTo(1, 6);
  });
});
