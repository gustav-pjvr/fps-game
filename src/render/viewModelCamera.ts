import * as THREE from 'three';
import { VIEW_MODEL_FOV } from '../core/config.ts';

/** Points the view-model camera like the world camera but keeps its own fixed lens: same position,
 * rotation, aspect and clip planes, always `fov` (VIEW_MODEL_FOV). The world camera's FOV (the
 * user's setting and the aim zoom) never reaches the gun. The projection matrix is rebuilt only
 * when a lens value changed (a resize, or the first frame). */
export function syncViewModelCamera(target: THREE.PerspectiveCamera, source: THREE.PerspectiveCamera, fov = VIEW_MODEL_FOV): void {
  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  if (target.fov === fov && target.aspect === source.aspect && target.near === source.near && target.far === source.far) return;
  target.fov = fov;
  target.aspect = source.aspect;
  target.near = source.near;
  target.far = source.far;
  target.updateProjectionMatrix();
}

/** Moves a camera-space point drawn by the view-model lens to where the world camera shows the same
 * screen spot at the same depth: x and y scale by tan(worldFov / 2) / tan(viewModelFov / 2). Things
 * the world pass draws from the gun (tracers) then start at the muzzle the player sees. */
export function viewModelPointToWorldLens(point: THREE.Vector3, worldFov: number, viewModelFov = VIEW_MODEL_FOV): THREE.Vector3 {
  const k = Math.tan(THREE.MathUtils.degToRad(worldFov) / 2) / Math.tan(THREE.MathUtils.degToRad(viewModelFov) / 2);
  point.x *= k;
  point.y *= k;
  return point;
}
