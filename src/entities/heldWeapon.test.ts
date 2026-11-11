import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getSkinMaterials } from '../weapons/models/skinMaterials.ts';
import { HeldWeapon } from './heldWeapon.ts';

function character(scale = 0.97): { model: THREE.Group; hand: THREE.Bone } {
  const model = new THREE.Group();
  model.scale.setScalar(scale);
  const arm = new THREE.Bone();
  arm.name = 'LowerArmR';
  const hand = new THREE.Bone();
  // The loader strips the dot from the rig's "Wrist.R".
  hand.name = 'WristR';
  arm.add(hand);
  model.add(arm);
  return { model, hand };
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => { if (object instanceof THREE.Mesh) found.push(object); });
  return found;
}

describe('HeldWeapon', () => {
  it('puts the weapon in the right hand, at real size whatever the character is scaled to', () => {
    const { model, hand } = character(0.5);
    const held = new HeldWeapon(model);
    held.set('rifle', 'pulse');
    expect(held.shownWeaponId).toBe('rifle');
    expect(held.shownSkinId).toBe('pulse');
    const holder = hand.getObjectByName('held-weapon')!;
    expect(holder).toBeDefined();
    model.updateWorldMatrix(true, true);
    expect(holder.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(1);
    const parts = meshes(holder);
    expect(parts.length).toBeGreaterThan(3);
    // The copy wears the skin's shared materials and has no first-person arms.
    const pulse = getSkinMaterials('pulse');
    expect(parts.some((mesh) => mesh.material === pulse.lightLine)).toBe(true);
    expect(parts.some((mesh) => mesh.material === pulse.glove || mesh.material === pulse.sleeve)).toBe(false);
    for (const mesh of parts) expect(mesh.castShadow).toBe(true);
  });

  it('rebuilds only when the weapon or the skin changes', () => {
    const { model, hand } = character();
    const held = new HeldWeapon(model);
    held.set('pistol', 'service');
    const first = hand.getObjectByName('held-weapon')!.children[0];
    held.set('pistol', 'service');
    expect(hand.getObjectByName('held-weapon')!.children[0]).toBe(first);
    held.set('pistol', 'gilded');
    expect(hand.getObjectByName('held-weapon')!.children[0]).not.toBe(first);
  });

  it('shows nothing for empty hands, an unknown weapon or a missing id, and the default skin for an unknown skin', () => {
    const { model, hand } = character();
    const held = new HeldWeapon(model);
    const holder = hand.getObjectByName('held-weapon')!;
    for (const id of ['unarmed', 'railgun', undefined]) {
      held.set(id, 'pulse');
      expect(holder.children).toHaveLength(0);
      expect(held.shownWeaponId).toBeNull();
    }
    held.set('knife', 'chrome');
    expect(held.shownSkinId).toBe('service');
    expect(holder.children).toHaveLength(1);
  });

  it('does nothing harmful on a character without a right hand bone', () => {
    const held = new HeldWeapon(new THREE.Group());
    expect(() => held.set('rifle', 'service')).not.toThrow();
    expect(() => held.dispose()).not.toThrow();
  });
});
