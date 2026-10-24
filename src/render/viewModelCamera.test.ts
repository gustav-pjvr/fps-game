import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_FAR, CAMERA_NEAR, VIEW_MODEL_FOV } from '../core/config.ts';
import { syncViewModelCamera, viewModelPointToWorldLens } from './viewModelCamera.ts';

function worldCamera(fov: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(3, 1.7, -8);
  camera.rotation.set(-0.2, 1.1, 0, 'YXZ');
  return camera;
}

describe('syncViewModelCamera', () => {
  it('keeps the view-model lens at VIEW_MODEL_FOV whatever the world camera FOV is', () => {
    const world = worldCamera(75);
    const viewModel = new THREE.PerspectiveCamera();
    for (const fov of [60, 75, 90, 110, 45]) {
      world.fov = fov;
      world.updateProjectionMatrix();
      syncViewModelCamera(viewModel, world);
      expect(viewModel.fov).toBe(VIEW_MODEL_FOV);
      expect(viewModel.projectionMatrix.equals(new THREE.PerspectiveCamera(VIEW_MODEL_FOV, 16 / 9, CAMERA_NEAR, CAMERA_FAR).projectionMatrix)).toBe(true);
    }
  });

  it('follows the world camera position, rotation, aspect and clip planes', () => {
    const world = worldCamera(110);
    const viewModel = new THREE.PerspectiveCamera();
    syncViewModelCamera(viewModel, world);
    expect(viewModel.position.equals(world.position)).toBe(true);
    expect(viewModel.quaternion.equals(world.quaternion)).toBe(true);
    expect([viewModel.aspect, viewModel.near, viewModel.far]).toEqual([16 / 9, CAMERA_NEAR, CAMERA_FAR]);

    world.aspect = 4 / 3;
    world.position.set(-1, 2, 5);
    world.updateProjectionMatrix();
    syncViewModelCamera(viewModel, world);
    expect(viewModel.aspect).toBe(4 / 3);
    expect(viewModel.position.equals(world.position)).toBe(true);
    const expected = new THREE.PerspectiveCamera(VIEW_MODEL_FOV, 4 / 3, CAMERA_NEAR, CAMERA_FAR).projectionMatrix;
    expect(viewModel.projectionMatrix.equals(expected)).toBe(true);
  });
});

describe('viewModelPointToWorldLens', () => {
  it('puts a point on the same screen spot under the world lens as under the view-model lens', () => {
    const aspect = 16 / 9;
    const viewModelLens = new THREE.PerspectiveCamera(VIEW_MODEL_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
    for (const fov of [45, 60, 75, 110]) {
      const worldLens = new THREE.PerspectiveCamera(fov, aspect, CAMERA_NEAR, CAMERA_FAR);
      const muzzle = new THREE.Vector3(0.18, -0.17, -1.0);
      const seen = muzzle.clone().applyMatrix4(viewModelLens.projectionMatrix);
      const moved = viewModelPointToWorldLens(muzzle.clone(), fov);
      const shown = moved.clone().applyMatrix4(worldLens.projectionMatrix);
      expect(moved.z).toBe(muzzle.z);
      expect(shown.x).toBeCloseTo(seen.x, 9);
      expect(shown.y).toBeCloseTo(seen.y, 9);
    }
  });
});
