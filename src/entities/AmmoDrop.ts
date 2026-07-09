import * as THREE from 'three';

const AMMO_DROP_TINT = 0x3ecf5f;
const CRATE_HALF_SIZE = 0.3;

/** Built from plain THREE primitives (no sourced asset), same "procedural, no asset licensing
 * risk" precedent as every other non-hero prop in this project (crates, the knife, the goose) - a
 * small green crate with a plus-sign cross on top so it reads as "ammo" at a glance, not just a
 * generic box. */
export function buildAmmoDropMesh(): THREE.Group {
  const group = new THREE.Group();
  const crateMaterial = new THREE.MeshStandardMaterial({ color: AMMO_DROP_TINT, roughness: 0.6 });
  const crossMaterial = new THREE.MeshStandardMaterial({ color: 0xe8fff0, roughness: 0.4, emissive: AMMO_DROP_TINT, emissiveIntensity: 0.4 });

  const crate = new THREE.Mesh(new THREE.BoxGeometry(CRATE_HALF_SIZE * 2, CRATE_HALF_SIZE * 2, CRATE_HALF_SIZE * 2), crateMaterial);
  group.add(crate);

  const barH = new THREE.Mesh(new THREE.BoxGeometry(CRATE_HALF_SIZE * 1.3, 0.06, 0.06), crossMaterial);
  barH.position.y = CRATE_HALF_SIZE + 0.01;
  group.add(barH);
  const barV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, CRATE_HALF_SIZE * 1.3), crossMaterial);
  barV.position.y = CRATE_HALF_SIZE + 0.01;
  group.add(barV);

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}
