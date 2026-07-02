import * as THREE from 'three';

export const WEAPON_HIP_POSITION = new THREE.Vector3(0.25, -0.22, -0.5);
export const WEAPON_ADS_POSITION = new THREE.Vector3(0, -0.14, -0.35);

/**
 * Procedural placeholder view model (no .glb asset wired up yet — see PLAN.md's free-asset
 * pipeline, e.g. Kenney.nl). Swapping in a real model later means loading it via GLTFLoader
 * and returning its scene root here instead; every caller already treats this as an opaque
 * THREE.Object3D parented to the camera.
 */
export function createPlaceholderWeaponMesh(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.3 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.35), material);
  group.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 12), material);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.3);
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), material);
  grip.rotation.x = -0.3;
  grip.position.set(0, -0.13, 0.08);
  group.add(grip);

  group.position.copy(WEAPON_HIP_POSITION);
  return group;
}
