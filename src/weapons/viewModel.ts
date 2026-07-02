import * as THREE from 'three';
import type { WeaponDefinition } from './definitions.ts';

export const WEAPON_HIP_POSITION = new THREE.Vector3(0.25, -0.22, -0.5);
export const WEAPON_ADS_POSITION = new THREE.Vector3(0, -0.14, -0.35);

const BODY_LENGTH = 0.35;
const BARREL_RADIUS = 0.025;

export interface WeaponViewModel {
  group: THREE.Group;
  /** Barrel-tip position relative to the group's own origin (constant regardless of hip/ADS pose). */
  muzzleLocalOffset: THREE.Vector3;
}

/**
 * Procedural placeholder view model (no .glb asset wired up yet — see PLAN.md's free-asset
 * pipeline, e.g. Kenney.nl). Shape/color/barrel length are data-driven off the weapon
 * definition so different weapons are at least visually distinguishable until real models
 * exist. Swapping in a real model later means loading it via GLTFLoader and computing its
 * own muzzle offset instead - every caller already treats the mesh as an opaque Object3D.
 */
export function createPlaceholderWeaponMesh(definition: WeaponDefinition): WeaponViewModel {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: definition.viewModelColor,
    roughness: 0.6,
    metalness: 0.3,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, BODY_LENGTH), material);
  group.add(body);

  const barrelCenterZ = -BODY_LENGTH / 2 - definition.barrelLength / 2;
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(BARREL_RADIUS, BARREL_RADIUS, definition.barrelLength, 12),
    material,
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, barrelCenterZ);
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), material);
  grip.rotation.x = -0.3;
  grip.position.set(0, -0.13, 0.08);
  group.add(grip);

  if (definition.hasScope) {
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4 }),
    );
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -0.05);
    group.add(scope);
  }

  group.position.copy(WEAPON_HIP_POSITION);

  const muzzleLocalOffset = new THREE.Vector3(0, 0.02, barrelCenterZ - definition.barrelLength / 2);
  return { group, muzzleLocalOffset };
}
