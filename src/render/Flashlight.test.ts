import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TORCH_AIM_DISTANCE, TORCH_GUN_OFFSET, TORCH_SHOULDER_OFFSET, torchPose } from './Flashlight.ts';

const look = (pitch: number, yaw: number): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));

describe('torchPose', () => {
  it('places the light at the camera-local offset and aims it straight ahead', () => {
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    torchPose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion(), TORCH_GUN_OFFSET, position, target);
    expect(position.x).toBeCloseTo(1.18);
    expect(position.y).toBeCloseTo(1.84);
    expect(position.z).toBeCloseTo(2.65);
    expect(target.x).toBeCloseTo(1.18);
    expect(target.y).toBeCloseTo(1.84);
    expect(target.z).toBeCloseTo(2.65 - TORCH_AIM_DISTANCE);
  });

  it('turns the offset and the beam with the look', () => {
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    // A quarter turn left: the camera faces -X, its right is -Z.
    torchPose(new THREE.Vector3(), look(0, Math.PI / 2), TORCH_SHOULDER_OFFSET, position, target);
    expect(position.x).toBeCloseTo(0);
    expect(position.y).toBeCloseTo(-0.1);
    expect(position.z).toBeCloseTo(-0.25);
    const beam = target.clone().sub(position);
    expect(beam.x).toBeCloseTo(-TORCH_AIM_DISTANCE);
    expect(beam.z).toBeCloseTo(0);
  });

  it('beams along the camera forward for any look, at the aim distance', () => {
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    for (const [pitch, yaw] of [[0.4, -1.2], [-0.9, 2.5], [0, 0]] as const) {
      const orientation = look(pitch, yaw);
      torchPose(new THREE.Vector3(5, 1, -2), orientation, TORCH_GUN_OFFSET, position, target);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
      const beam = target.clone().sub(position);
      expect(beam.length()).toBeCloseTo(TORCH_AIM_DISTANCE);
      expect(beam.normalize().dot(forward)).toBeCloseTo(1);
    }
  });
});
