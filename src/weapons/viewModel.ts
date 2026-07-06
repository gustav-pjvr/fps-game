import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { WeaponDefinition } from './definitions.ts';

export const WEAPON_HIP_POSITION = new THREE.Vector3(0.25, -0.22, -0.5);
export const WEAPON_ADS_POSITION = new THREE.Vector3(0, -0.14, -0.35);

export interface WeaponViewModel {
  group: THREE.Group;
  /** Barrel-tip position relative to the group's own origin (constant regardless of hip/ADS pose). */
  muzzleLocalOffset: THREE.Vector3;
}

interface WeaponModelSpec {
  readonly path: string;
  readonly scale: number;
  /** Extra Y rotation (radians) in case a given model's barrel doesn't default to -Z forward. */
  readonly rotationYOffset: number;
}

/** Kenney "Blaster Kit" (CC0) - see public/assets/credits/. Scale is tuned per-model to sit
 * comfortably in first-person view; each model's own export scale/pivot varies. */
export const WEAPON_MODEL_SPECS: Record<string, WeaponModelSpec> = {
  pistol: { path: '/assets/models/weapons/blaster-h.glb', scale: 0.85, rotationYOffset: 0 },
  rifle: { path: '/assets/models/weapons/blaster-e.glb', scale: 0.45, rotationYOffset: 0 },
  shotgun: { path: '/assets/models/weapons/blaster-p.glb', scale: 0.7, rotationYOffset: 0 },
  sniper: { path: '/assets/models/weapons/blaster-f.glb', scale: 0.55, rotationYOffset: 0 },
};

export function weaponModelPaths(): string[] {
  return Object.values(WEAPON_MODEL_SPECS).map((spec) => spec.path);
}

/** No sourced .glb exists for the knife (Phase D) - matches this project's existing precedent for
 * non-hero placeholder geometry (see the procedural crate boxes in BuildingManager.ts) rather than
 * blocking on a new asset. A simple blade + handle silhouette built from boxes, tinted by the
 * weapon's own `viewModelColor`. */
export function createProceduralMeleeViewModel(definition: WeaponDefinition): WeaponViewModel {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: definition.viewModelColor, metalness: 0.6, roughness: 0.35 });

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.14), material);
  handle.position.set(0, 0, 0.05);
  group.add(handle);

  const bladeLength = 0.16;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.03, bladeLength),
    new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 0.85, roughness: 0.2 }),
  );
  blade.position.set(0, 0, -0.05 - bladeLength / 2);
  group.add(blade);

  group.position.copy(WEAPON_HIP_POSITION);
  const muzzleLocalOffset = new THREE.Vector3(0, 0, -0.05 - bladeLength);
  return { group, muzzleLocalOffset };
}

export function createWeaponViewModel(definition: WeaponDefinition, gltf: GLTF): WeaponViewModel {
  const spec = WEAPON_MODEL_SPECS[definition.id];
  if (!spec) throw new Error(`No model spec for weapon: ${definition.id}`);

  const model = gltf.scene.clone(true);
  model.scale.setScalar(spec.scale);
  model.rotation.y = spec.rotationYOffset;

  const group = new THREE.Group();
  group.add(model);

  // Compute the box while the group is still at its default (0,0,0) position, so the result is
  // relative to the group's own origin. Box3.setFromObject reads matrixWorld, which composes
  // through the parent chain - if we set group.position to WEAPON_HIP_POSITION first, that
  // offset gets baked into the box, and then WeaponManager adds viewModel.position (≈ the same
  // hip/ADS offset) on top of it too, double-counting it and placing tracers well behind the
  // actual muzzle.
  const box = new THREE.Box3().setFromObject(model);
  const muzzleLocalOffset = new THREE.Vector3(0, (box.min.y + box.max.y) / 2, box.min.z);

  group.position.copy(WEAPON_HIP_POSITION);

  return { group, muzzleLocalOffset };
}
