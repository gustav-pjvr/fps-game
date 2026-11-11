import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WEAPON_DEFINITIONS } from '../definitions.ts';
import {
  allowedAttachments, ATTACHMENT_IDS, attachmentLens, attachmentMeshes, sanitizeAttachments, toggleAttachment, WEAPON_MOUNTS,
} from './attachments.ts';
import { SKIN_IDS } from './skins.ts';
import { createWeaponModel, getWeaponBlueprint } from './weaponModels.ts';

function boxOf(weaponId: string, id: (typeof ATTACHMENT_IDS)[number]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const mesh of attachmentMeshes(weaponId, id)) {
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!);
  }
  return box;
}

describe('which guns take which attachments', () => {
  it('only guns have mounts, and every mount is on a real weapon', () => {
    for (const weaponId of Object.keys(WEAPON_MOUNTS)) {
      expect(WEAPON_DEFINITIONS[weaponId]?.kind, weaponId).toBe('ranged');
    }
  });

  it('offers nothing for a gun without a mount, a blade or an unknown weapon', () => {
    for (const weaponId of ['revolver', 'sawnOff', 'sniper', 'gooseLauncher', 'knife', 'noSuchWeapon']) {
      expect(allowedAttachments(weaponId), weaponId).toEqual([]);
      expect(sanitizeAttachments(weaponId, ['laser', 'torch']), weaponId).toEqual([]);
      for (const id of ATTACHMENT_IDS) expect(attachmentMeshes(weaponId, id), weaponId).toEqual([]);
    }
  });

  it('keeps only what a gun can carry', () => {
    expect(allowedAttachments('rifle')).toEqual(['laser', 'torch']);
    expect(allowedAttachments('shotgun')).toEqual(['torch']);
    expect(allowedAttachments('dmr')).toEqual(['laser']);
    expect(sanitizeAttachments('rifle', ['torch', 'laser', 'torch', 'scope', 7])).toEqual(['laser', 'torch']);
    expect(sanitizeAttachments('shotgun', ['laser', 'torch'])).toEqual(['torch']);
  });

  it('a one-rail gun carries one unit: fitting the other swaps it', () => {
    expect(sanitizeAttachments('pistol', ['laser', 'torch'])).toEqual(['torch']);
    expect(toggleAttachment('pistol', ['torch'], 'laser')).toEqual(['laser']);
    expect(toggleAttachment('pistol', ['laser'], 'laser')).toEqual([]);
    expect(toggleAttachment('rifle', ['laser'], 'torch')).toEqual(['laser', 'torch']);
    expect(toggleAttachment('dmr', [], 'torch')).toEqual([]);
  });
});

describe('the units on the guns', () => {
  for (const [weaponId, { mounts }] of Object.entries(WEAPON_MOUNTS)) {
    for (const id of ATTACHMENT_IDS) {
      if (!mounts[id]) continue;
      it(`${weaponId}: the ${id} sits below the line of aim, behind the muzzle end and holds its lens`, () => {
        const blueprint = getWeaponBlueprint(weaponId);
        const box = boxOf(weaponId, id);
        expect(box.isEmpty()).toBe(false);
        // Nothing but the sights may stand in the sight picture.
        expect(box.max.y).toBeLessThan(blueprint.aimPoint![1] - 0.01);
        // Three space is (x, y, -f): the unit's front may pass the muzzle by a centimetre at most.
        expect(-box.min.z).toBeLessThan(blueprint.muzzle[2] + 0.01);
        const lens = attachmentLens(weaponId, id)!;
        expect(box.containsPoint(new THREE.Vector3(lens[0], lens[1], -lens[2]).clampScalar(-9, 9)) || box.distanceToPoint(new THREE.Vector3(lens[0], lens[1], -lens[2])) < 0.003).toBe(true);
      });
    }
  }

  it('a model carries its units on the body, the same under every skin', () => {
    const names = (skinId: (typeof SKIN_IDS)[number]): string[] => {
      const model = createWeaponModel('rifle', skinId, { raw: true, attachments: ['laser', 'torch'] });
      return model.parts.get('body')!.children.filter((child) => child.name.startsWith('attachment-')).map((child) => `${child.name}:${((child as THREE.Mesh).material as THREE.Material).name}`).sort();
    };
    const service = names('service');
    expect(service.length).toBeGreaterThan(6);
    for (const skinId of SKIN_IDS) expect(names(skinId), skinId).toEqual(service);
    // Bare, and on a gun that cannot take them, nothing is added.
    const bare = createWeaponModel('rifle', 'service', { raw: true });
    expect(bare.parts.get('body')!.children.some((child) => child.name.startsWith('attachment-'))).toBe(false);
    const sniper = createWeaponModel('sniper', 'service', { raw: true, attachments: ['laser', 'torch'] });
    expect(sniper.parts.get('body')!.children.some((child) => child.name.startsWith('attachment-'))).toBe(false);
  });
});
