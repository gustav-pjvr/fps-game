import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONTACT_SHADOW_LIFT, contactShadowMatrix, createContactShadowGeometry } from './contactShadows.ts';

function placedNormal(matrix: THREE.Matrix4): THREE.Vector3 {
  const geometryUp = new THREE.Vector3(0, 1, 0);
  return geometryUp.applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(matrix)));
}

describe('contactShadowMatrix', () => {
  it('lies flat just above level ground, sized to the radius', () => {
    const matrix = contactShadowMatrix(() => 3, 10, -4, 1.5);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(position.x).toBeCloseTo(10);
    expect(position.y).toBeCloseTo(3 + CONTACT_SHADOW_LIFT);
    expect(position.z).toBeCloseTo(-4);
    expect(placedNormal(matrix).y).toBeCloseTo(1);
    const scale = new THREE.Vector3().setFromMatrixScale(matrix);
    expect(scale.x).toBeCloseTo(3);
    expect(scale.z).toBeCloseTo(3);
  });

  it('tilts to follow a hillside so the far edge does not float', () => {
    const slope = (x: number): number => x * 0.5;
    const matrix = contactShadowMatrix(slope, 0, 0, 2);
    const normal = placedNormal(matrix);
    expect(normal.x).toBeLessThan(-0.3);
    // Each corner of the quad sits within the lift of the ground beneath it.
    const geometry = createContactShadowGeometry();
    const corner = new THREE.Vector3();
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      corner.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      expect(Math.abs(corner.y - slope(corner.x))).toBeLessThan(0.1);
    }
  });
});
