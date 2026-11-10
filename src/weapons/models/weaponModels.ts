import * as THREE from 'three';
import { adsPositionForSight, WEAPON_ADS_POSITION, WEAPON_HIP_POSITION, type WeaponViewModel } from '../viewModel.ts';
import { ARM_PART_PREFIX, BODY, GunBuilder, type WeaponBlueprint } from './kit/GunBuilder.ts';
import { toThree } from './kit/geometry.ts';
import { WEAPON_MODEL_BUILDERS } from './registry.ts';
import { createSkinGlow, getSkinMaterials } from './skinMaterials.ts';
import { DEFAULT_SKIN, SKINS, type SkinId } from './skins.ts';

const blueprints = new Map<string, WeaponBlueprint>();

export function hasWeaponModel(id: string): boolean {
  return Object.hasOwn(WEAPON_MODEL_BUILDERS, id);
}

/** A weapon's geometry in one skin, built once and shared by every copy of it: the view model,
 * other players' copies and the menu previews. Never disposed: there are few and they are small. */
export function getWeaponBlueprint(id: string, skinId: SkinId = DEFAULT_SKIN): WeaponBlueprint {
  const key = `${id}:${skinId}`;
  let blueprint = blueprints.get(key);
  if (!blueprint) {
    if (!hasWeaponModel(id)) throw new Error(`Unknown weapon model: ${id}`);
    const builder = new GunBuilder(id, SKINS[skinId].features);
    WEAPON_MODEL_BUILDERS[id]!(builder);
    blueprint = builder.finish();
    blueprints.set(key, blueprint);
  }
  return blueprint;
}

export interface WeaponModel {
  /** The model itself: scaled and offset by the weapon's tuning. The `gun` track moves it. */
  readonly root: THREE.Group;
  /** Moving parts by name (BODY included). */
  readonly parts: Map<string, THREE.Object3D>;
  readonly glowMaterials: THREE.MeshStandardMaterial[];
  readonly blueprint: WeaponBlueprint;
  readonly skinId: SkinId;
}

/** One copy of a weapon in a skin. `arms` adds the shooter's hands and forearms (the first-person
 * view); thumbnails, the Skins preview and other players' copies leave them out. */
export function createWeaponModel(id: string, skinId: SkinId = DEFAULT_SKIN, options: { arms?: boolean } = {}): WeaponModel {
  const blueprint = getWeaponBlueprint(id, skinId);
  const materials = getSkinMaterials(skinId);
  const arms = options.arms ?? false;
  const root = new THREE.Group();
  root.name = 'model-tuning';
  root.scale.setScalar(blueprint.tuning.scale);
  root.position.set(...blueprint.tuning.offset);
  if (blueprint.tuning.rotation) {
    const [pitch, yaw, roll] = blueprint.tuning.rotation;
    root.rotation.set(pitch, -yaw, -roll, 'YXZ');
  }

  const parts = new Map<string, THREE.Object3D>();
  const pivots = new Map<string, THREE.Vector3>();
  for (const spec of blueprint.parts) {
    if (!arms && spec.name.startsWith(ARM_PART_PREFIX)) continue;
    const group = new THREE.Group();
    group.name = spec.name;
    const pivot = toThree(spec.pivot);
    pivots.set(spec.name, pivot);
    if (spec.name === BODY) {
      root.add(group);
    } else {
      group.position.copy(pivot).sub(pivots.get(spec.parent)!);
      parts.get(spec.parent)!.add(group);
    }
    parts.set(spec.name, group);
  }

  let glow: THREE.MeshStandardMaterial | null = null;
  for (const entry of blueprint.meshes) {
    const parent = parts.get(entry.part);
    if (!parent) continue;
    const material = entry.slot === 'glow' ? (glow ??= createSkinGlow(skinId)) : materials[entry.slot];
    const mesh = new THREE.Mesh(entry.geometry, material);
    mesh.name = entry.name;
    if (entry.opticFrame) mesh.userData.opticFrame = true;
    if (entry.slot === 'glass') mesh.renderOrder = 2;
    parent.add(mesh);
  }
  return { root, parts, glowMaterials: glow ? [glow] : [], blueprint, skinId };
}

/** A gun-space point of a blueprint in the space of the group that holds the model's root. */
function inHolder(blueprint: WeaponBlueprint, point: readonly [number, number, number]): THREE.Vector3 {
  return toThree(point).multiplyScalar(blueprint.tuning.scale).add(new THREE.Vector3(...blueprint.tuning.offset));
}

/** The first-person view model: the weapon with the shooter's arms, in a group at the hip pose. */
export function buildWeaponViewModel(id: string, skinId: SkinId = DEFAULT_SKIN): WeaponViewModel {
  const group = new THREE.Group();
  group.name = `weapon-${id}`;
  group.position.copy(WEAPON_HIP_POSITION);
  if (id === 'unarmed') {
    return {
      group,
      muzzleLocalOffset: new THREE.Vector3(),
      adsPosition: WEAPON_ADS_POSITION.clone(),
      glowMaterials: [],
      model: null,
      parts: new Map(),
      animations: {},
      aimRetract: {},
      skinId,
      scoped: false,
    };
  }
  const model = createWeaponModel(id, skinId, { arms: true });
  group.add(model.root);
  const { blueprint } = model;
  return {
    group,
    muzzleLocalOffset: inHolder(blueprint, blueprint.muzzle),
    adsPosition: blueprint.aimPoint
      ? adsPositionForSight(inHolder(blueprint, blueprint.aimPoint), blueprint.aimDistance)
      : WEAPON_ADS_POSITION.clone(),
    glowMaterials: model.glowMaterials,
    model: model.root,
    parts: model.parts,
    animations: blueprint.animations,
    aimRetract: blueprint.aimRetract,
    skinId,
    scoped: blueprint.scoped,
  };
}
