import * as THREE from 'three';
import { ADS_SIGHT_DISTANCE } from '../core/config.ts';

export const WEAPON_HIP_POSITION = new THREE.Vector3(0.25, -0.22, -0.5);
/** Aim pose for a model without a sight (the knife and empty hands, which never aim anyway). */
export const WEAPON_ADS_POSITION = new THREE.Vector3(0, -0.14, -0.35);

/** The view-model position (camera space) that puts `sight`, a point in the view model's outer
 * group space, on the camera's forward axis `distance` in front of the eye, so an aimed weapon's
 * sight sits exactly on the screen centre. Assumes the aim pose has no rotation. */
export function adsPositionForSight(sight: THREE.Vector3, distance = ADS_SIGHT_DISTANCE, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-sight.x, -sight.y, -distance - sight.z);
}

export interface WeaponViewModel {
  group: THREE.Group;
  /** Barrel tip in the outer group's space, including the model's tuning transform. */
  muzzleLocalOffset: THREE.Vector3;
  /** Camera-space position at full aim: lines the model's sight-dot up with the screen centre
   * (adsPositionForSight), or WEAPON_ADS_POSITION for a model without one. */
  adsPosition: THREE.Vector3;
  glowMaterials: THREE.MeshStandardMaterial[];
  magazine: THREE.Object3D | null;
  magazineRestPosition: THREE.Vector3;
}
