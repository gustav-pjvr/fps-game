import * as THREE from 'three';

export const WEAPON_HIP_POSITION = new THREE.Vector3(0.25, -0.22, -0.5);
export const WEAPON_ADS_POSITION = new THREE.Vector3(0, -0.14, -0.35);

export interface WeaponViewModel {
  group: THREE.Group;
  /** Barrel tip in the outer group's space, including the model's tuning transform. */
  muzzleLocalOffset: THREE.Vector3;
  glowMaterials: THREE.MeshStandardMaterial[];
  magazine: THREE.Object3D | null;
  magazineRestPosition: THREE.Vector3;
}
