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
  // Goose Toss's "unarmed" placeholder (see definitions.ts) has nothing to hold - an empty group,
  // not a floating knife, since the player's hands are meant to read as genuinely empty (or later
  // holding a goose - see Game.ts's heldGooseViewModel, attached/detached independently of this).
  if (definition.id === 'unarmed') {
    return { group: new THREE.Group(), muzzleLocalOffset: new THREE.Vector3() };
  }

  // A rare reward weapon deserves to visually read as something other than a re-tinted knife or a
  // plain tube-and-box - a flared muzzle, a chamber bulge, an L-shaped shoulder stock, and a grip
  // break up what used to be just one cylinder and one box, same "no sourced asset, build it
  // procedurally" precedent every non-hero shape in this project already follows.
  if (definition.id === 'gooseLauncher') {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: definition.viewModelColor, metalness: 0.5, roughness: 0.4 });

    const barrelLength = 0.32;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, barrelLength, 10), material);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -barrelLength / 2);
    group.add(barrel);

    // Flared muzzle cap - a blunderbuss-style bell instead of a plain pipe end.
    const muzzleCap = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.045, 10), material);
    muzzleCap.rotation.x = Math.PI / 2;
    muzzleCap.position.set(0, 0, -barrelLength + 0.02);
    group.add(muzzleCap);

    // Chamber bulge behind the barrel - breaks up the "one straight tube" read.
    const chamber = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.09, 10), material);
    chamber.rotation.x = Math.PI / 2;
    chamber.position.set(0, 0.005, 0.03);
    group.add(chamber);

    // L-shaped shoulder stock (two pieces) instead of one plain box.
    const stockArm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.14), material);
    stockArm.position.set(0, -0.005, 0.13);
    group.add(stockArm);
    const stockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.03), material);
    stockPlate.position.set(0, -0.04, 0.2);
    group.add(stockPlate);

    // Pistol grip.
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.04), material);
    grip.position.set(0, -0.07, 0.06);
    grip.rotation.x = -0.25;
    group.add(grip);

    group.position.copy(WEAPON_HIP_POSITION);
    return { group, muzzleLocalOffset: new THREE.Vector3(0, 0, -barrelLength - 0.04) };
  }

  // Burst SMG - no sourced .glb exists for it either (only the 4 base blaster models are bundled),
  // so this reads as a distinct multi-part silhouette rather than a re-tinted existing gun:
  // receiver, ribbed handguard, a forward-curved magazine (the MP5's single most recognizable
  // element), a collapsible stock, grip, and front/rear sights.
  if (definition.id === 'mp5') {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: definition.viewModelColor, metalness: 0.55, roughness: 0.4 });

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.22), material);
    receiver.position.set(0, 0, 0.03);
    group.add(receiver);

    const barrelCenterZ = -0.15;
    const barrelHalfLength = 0.09;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, barrelHalfLength * 2, 8), material);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, -0.005, barrelCenterZ);
    group.add(barrel);

    // Ribbed "Slimline" handguard slats along the barrel.
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.014, 0.014), material);
      slat.position.set(0, -0.005, -0.09 - i * 0.028);
      group.add(slat);
    }

    // Curved magazine, forward of the grip - two segments joined at an angle rather than one
    // straight rectangle, since the forward curve is the gun's most recognizable silhouette cue.
    const magUpper = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.09, 0.032), material);
    magUpper.position.set(0, -0.09, -0.01);
    group.add(magUpper);
    const magLower = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.028), material);
    magLower.position.set(0, -0.16, -0.035);
    magLower.rotation.x = 0.35;
    group.add(magLower);

    // Collapsible stock - thin rod + end plate, not a fixed solid stock.
    const stockRod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), material);
    stockRod.rotation.x = Math.PI / 2;
    stockRod.position.set(0, 0.01, 0.21);
    group.add(stockRod);
    const stockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.08, 0.02), material);
    stockPlate.position.set(0, 0, 0.29);
    group.add(stockPlate);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.09, 0.03), material);
    grip.position.set(0, -0.075, 0.055);
    grip.rotation.x = -0.2;
    group.add(grip);

    // Rear sight drum + front sight post.
    const rearSight = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), material);
    rearSight.position.set(0, 0.045, 0.05);
    group.add(rearSight);
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.008), material);
    frontSight.position.set(0, 0.03, barrelCenterZ - barrelHalfLength + 0.02);
    group.add(frontSight);

    group.position.copy(WEAPON_HIP_POSITION);
    const muzzleLocalOffset = new THREE.Vector3(0, -0.005, barrelCenterZ - barrelHalfLength);
    return { group, muzzleLocalOffset };
  }

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
