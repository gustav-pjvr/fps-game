import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GrenadeArcPreview, resampleArc } from './GrenadeArcPreview.ts';

describe('arc preview', () => {
  it('places dots at even spacing along the path, from the start offset on', () => {
    const points = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: -2 }];
    const dots = resampleArc(points, 0.5, 0.25);
    expect(dots.map((d) => [d.x, d.z])).toEqual([[0.25, 0], [0.75, 0], [1, -0.25], [1, -0.75], [1, -1.25], [1, -1.75]]);
  });

  it('caps the number of dots', () => {
    expect(resampleArc([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], 0.1, 0, 10)).toHaveLength(10);
  });

  it('shows while cooking, lays the ring on the landing surface, hides with no arc', () => {
    const scene = new THREE.Scene();
    const preview = new GrenadeArcPreview(scene);
    const dots = scene.getObjectByName('grenade-arc-dots') as THREE.InstancedMesh;
    const ring = scene.getObjectByName('grenade-arc-ring')!;
    preview.update({
      points: [{ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1, z: -5 }],
      landing: { point: { x: 1, y: 1, z: -5 }, normal: { x: 1, y: 0, z: 0 } },
    });
    expect(dots.visible).toBe(true);
    expect(dots.count).toBeGreaterThan(10);
    expect(ring.visible).toBe(true);
    // A wall facing +x: the ring's face (+z locally) turns to +x and sits on the wall.
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(ring.quaternion);
    expect(facing.x).toBeCloseTo(1, 5);
    expect(ring.position.x).toBeLessThan(1);
    preview.update(null);
    expect(dots.visible).toBe(false);
    expect(ring.visible).toBe(false);
    preview.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
