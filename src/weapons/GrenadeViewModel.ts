import * as THREE from 'three';
import { buildGrenadeModel } from '../combat/grenades/grenadeModels.ts';
import type { GrenadeKind } from '../combat/grenades/grenadeTuning.ts';
import { grenadeArmPose } from './grenadeThrowPose.ts';
import { getWeaponMaterials } from './models/weaponMaterials.ts';

/**
 * The throwing arm on the view model: a gloved hand and sleeve (the arsenal's own hand materials)
 * holding a frag or flash model. Parented to the camera like the guns, so Renderer draws it in the
 * view-model pass with the fixed lens. Posed by grenadeThrowPose.ts from WeaponManager's throwPose
 * and throw progress.
 */
export class GrenadeViewModel {
  private readonly arm = new THREE.Group();
  private readonly models: Record<GrenadeKind, THREE.Group>;
  /** The last kind cooked, still shown through its throw after the hand state clears. */
  private kind: GrenadeKind = 'frag';

  constructor(private readonly camera: THREE.Camera) {
    const { glove, sleeve } = getWeaponMaterials();
    this.arm.name = 'grenade-arm';
    const box = (name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material, rx = 0): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.name = name;
      mesh.position.set(...position);
      mesh.rotation.x = rx;
      this.arm.add(mesh);
    };
    box('palm', [0.075, 0.06, 0.085], [0.008, -0.012, 0.004], glove);
    box('fingers', [0.08, 0.034, 0.03], [0.004, 0.018, -0.04], glove, -0.3);
    box('thumb', [0.022, 0.024, 0.06], [-0.04, 0.026, -0.004], glove, 0.25);
    box('sleeve', [0.1, 0.1, 0.36], [0.028, -0.11, 0.19], sleeve, 0.55);
    this.models = { frag: buildGrenadeModel('frag'), flash: buildGrenadeModel('flash') };
    for (const model of Object.values(this.models)) {
      model.position.set(0, 0.05, -0.008);
      model.rotation.set(0.15, 0.6, -0.12);
      model.visible = false;
      this.arm.add(model);
    }
    this.arm.visible = false;
    camera.add(this.arm);
  }

  /** Per render frame. `throwPose`, `throwProgress`: WeaponManager's; `cookingKind`: the grenade in
   * hand (GrenadeSystem.cooking), or null. */
  update(throwPose: number, throwProgress: number | null, cookingKind: GrenadeKind | null): void {
    if (cookingKind) this.kind = cookingKind;
    const { pose, visible, holding } = grenadeArmPose(throwPose, throwProgress);
    this.arm.visible = visible;
    if (!visible) return;
    this.arm.position.set(pose.px, pose.py, pose.pz);
    this.arm.rotation.set(pose.rx, pose.ry, pose.rz);
    this.models.frag.visible = holding && this.kind === 'frag';
    this.models.flash.visible = holding && this.kind === 'flash';
  }

  dispose(): void {
    this.camera.remove(this.arm);
    this.arm.traverse((object) => {
      // The grenade models share their geometry (grenadeModels.ts); only the arm's own boxes go.
      if (object instanceof THREE.Mesh && object.parent === this.arm) object.geometry.dispose();
    });
  }
}
