import * as THREE from 'three';
import { ADS_SIGHT_DISTANCE } from '../core/config.ts';
import type { WeaponAnimations } from './animation/clips.ts';
import type { SkinId } from './models/skins.ts';

export const WEAPON_HIP_POSITION = new THREE.Vector3(0.25, -0.22, -0.5);
/** Aim pose for a model without a sight (the blades and empty hands, which never aim anyway). */
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
  /** Camera-space position at full aim: lines the model's aim point up with the screen centre
   * (adsPositionForSight), or WEAPON_ADS_POSITION for a model without one. */
  adsPosition: THREE.Vector3;
  /** The ammo witness light of this copy (empty for a weapon without one). */
  glowMaterials: THREE.MeshStandardMaterial[];
  /** The model inside the group (scaled and offset by its tuning): what the `gun` animation track
   * moves. Null for empty hands. */
  model: THREE.Object3D | null;
  /** Moving parts by name, for the part animator (animation/PartAnimator.ts). */
  parts: Map<string, THREE.Object3D>;
  animations: WeaponAnimations;
  /** Parts that slide back out of view as the weapon is aimed: metres at full aim, by part name. */
  aimRetract: Readonly<Record<string, number>>;
  skinId: SkinId;
  /** A scope overlay replaces the model at full aim. */
  scoped: boolean;
}
