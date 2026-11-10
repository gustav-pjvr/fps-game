import * as THREE from 'three';
import { WEAPON_DEFINITIONS } from '../weapons/definitions.ts';
import { resolveSkinId, type SkinId } from '../weapons/models/skins.ts';
import { createWeaponModel, hasWeaponModel } from '../weapons/models/weaponModels.ts';

/** How a kind of weapon sits in the character's right hand: a position (metres, in the hand
 * bone's own frame) and a rotation (radians, XYZ) that turn the model's forward axis along the
 * forearm and its top upward. Found by eye in the weapon lab (`weaponlab.html?view=held`). */
interface Grip {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
}

const GRIPS: Readonly<Record<'long' | 'short' | 'blade', Grip>> = {
  long: { position: [0, 0.07, 0.03], rotation: [Math.PI / 2, 0, Math.PI / 2] },
  short: { position: [0, 0.07, 0.03], rotation: [Math.PI / 2, 0, Math.PI / 2] },
  blade: { position: [0, 0.07, 0.02], rotation: [Math.PI / 2, 0, Math.PI / 2] },
};

function gripFor(weaponId: string): Grip {
  const category = WEAPON_DEFINITIONS[weaponId]?.category;
  if (category === 'melee') return GRIPS.blade;
  return category === 'secondary' ? GRIPS.short : GRIPS.long;
}

const scratch = new THREE.Vector3();

/** The weapon another player (or the loadout's character) is seen holding: a copy of the weapon
 * model in its skin, without the first-person arms, riding the character's right hand bone. */
export class HeldWeapon {
  private readonly hand: THREE.Object3D | null;
  private readonly holder = new THREE.Group();
  private weaponId: string | null = null;
  private skinId: SkinId | null = null;

  /** `character` is the skinned model from instantiateCharacter (entities/characterModels.ts). */
  constructor(character: THREE.Object3D) {
    let hand: THREE.Object3D | null = null;
    character.traverse((object) => {
      // The loader strips the dot from "Wrist.R".
      if (!hand && /^Wrist\.?R$/i.test(object.name)) hand = object;
    });
    this.hand = hand;
    this.holder.name = 'held-weapon';
    if (this.hand) {
      (this.hand as THREE.Object3D).add(this.holder);
      // The skeleton carries the character's own scale; the weapon is authored in metres.
      character.updateWorldMatrix(true, true);
      const scale = (this.hand as THREE.Object3D).getWorldScale(scratch);
      this.holder.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
    }
  }

  /** Shows `weaponId` in `skinId`. Anything unknown (an older or newer build's weapon, empty
   * hands) shows nothing; an unknown skin shows the default. Cheap when nothing changed. */
  set(weaponId: string | undefined, skinId?: string): void {
    const id = weaponId !== undefined && hasWeaponModel(weaponId) ? weaponId : null;
    const skin = id === null ? null : resolveSkinId(skinId);
    if (id === this.weaponId && skin === this.skinId) return;
    this.weaponId = id;
    this.skinId = skin;
    this.holder.clear();
    if (id === null || skin === null || !this.hand) return;
    const model = createWeaponModel(id, skin, { raw: true });
    const grip = gripFor(id);
    model.root.position.set(...grip.position);
    model.root.rotation.set(...grip.rotation);
    model.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
    });
    this.holder.add(model.root);
  }

  get shownWeaponId(): string | null {
    return this.weaponId;
  }

  get shownSkinId(): SkinId | null {
    return this.skinId;
  }

  dispose(): void {
    this.holder.clear();
    this.holder.removeFromParent();
  }
}
