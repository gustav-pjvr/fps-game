import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WEAPON_DEFINITIONS } from '../definitions.ts';
import { WEAPON_HIP_POSITION } from '../viewModel.ts';
import { buildWeaponViewModel, WEAPON_MODEL_TUNING } from './arsenal.ts';
import { getWeaponMaterials, WEAPON_GLOW_INTENSITY } from './weaponMaterials.ts';

function meshes(group: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  group.traverse((object) => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}

describe('Opus arsenal', () => {
  for (const definition of Object.values(WEAPON_DEFINITIONS)) {
    it(`builds ${definition.id} with the required geometry and independent glow`, () => {
      const first = buildWeaponViewModel(definition.id);
      const second = buildWeaponViewModel(definition.id);
      expect(first.group).toBeInstanceOf(THREE.Group);
      expect(first.group).not.toBe(second.group);
      expect(first.group.position).toEqual(WEAPON_HIP_POSITION);
      const parts = meshes(first.group);
      if (definition.id === 'unarmed') {
        expect(first.group.children).toHaveLength(0);
        expect(parts).toHaveLength(0);
        expect(first.glowMaterials).toHaveLength(0);
        expect(first.magazine).toBeNull();
        return;
      }
      expect(parts.length).toBeGreaterThanOrEqual(12);
      expect(parts.length).toBeLessThanOrEqual(25);
      const gunmetal = getWeaponMaterials().gunmetal;
      const firstMetal = parts.find((part) => part.material === gunmetal)!;
      const secondMetal = meshes(second.group).find((part) => part.material === gunmetal)!;
      expect(firstMetal).toBeDefined();
      expect(secondMetal).toBeDefined();
      expect(firstMetal.material).toBe(secondMetal.material);
      expect((firstMetal.material as THREE.MeshStandardMaterial).map)
        .toBe((secondMetal.material as THREE.MeshStandardMaterial).map);
      expect(gunmetal.map).toBeInstanceOf(THREE.DataTexture);
      if (definition.kind === 'ranged') {
        expect(first.muzzleLocalOffset.z).toBeLessThan(0);
        expect(first.glowMaterials.length).toBeGreaterThan(0);
        expect(first.glowMaterials.length).toBe(second.glowMaterials.length);
        first.glowMaterials.forEach((material, i) => {
          expect(material).not.toBe(second.glowMaterials[i]);
          expect(material.emissive.getHex()).toBe(0x6ff0dc);
          expect(material.color.getHex()).toBe(0x000000);
          expect(material.emissiveIntensity).toBe(WEAPON_GLOW_INTENSITY);
          expect(material.toneMapped).toBe(true);
          expect(parts.some((part) => part.material === material)).toBe(true);
          material.emissive.setHex(0xe8a64a);
          expect(second.glowMaterials[i]!.emissive.getHex()).toBe(0x6ff0dc);
        });
        const sight = first.group.getObjectByName('sight-dot') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
        expect(sight.material.emissive.getHex()).toBe(0xff6a3a);
        expect(first.glowMaterials).not.toContain(sight.material);
        expect(first.magazine).not.toBeNull();
        expect(first.magazine).not.toBe(second.magazine);
        expect(first.magazine!.position).toEqual(first.magazineRestPosition);
        first.magazine!.position.y -= 0.22;
        expect(second.magazine!.position).toEqual(second.magazineRestPosition);
        expect(first.magazineRestPosition).toEqual(second.magazineRestPosition);
      }
    });
  }

  it('ports the rifle dimensions, hands and magazine without baking the hip pose into its muzzle', () => {
    const model = buildWeaponViewModel('rifle');
    expect(meshes(model.group)).toHaveLength(24);
    const receiver = model.group.getObjectByName('receiver') as THREE.Mesh<THREE.BoxGeometry>;
    expect(receiver.geometry.parameters).toMatchObject({ width: 0.085, height: 0.11, depth: 0.42 });
    expect(model.group.getObjectByName('trigger-hand')!.rotation.x).toBeCloseTo(0.25);
    expect(model.group.getObjectByName('support-sleeve')!.rotation.y).toBeCloseTo(-0.6);
    expect(model.magazineRestPosition).toEqual(new THREE.Vector3(0, -0.1, -0.08));
    const tuning = WEAPON_MODEL_TUNING.rifle;
    expect(model.muzzleLocalOffset.x).toBeCloseTo(tuning.offset[0]);
    expect(model.muzzleLocalOffset.y).toBeCloseTo(tuning.offset[1]);
    expect(model.muzzleLocalOffset.z).toBeCloseTo(-0.66 * tuning.scale + tuning.offset[2]);
    model.group.position.set(4, 2, 7);
    model.group.rotation.set(0.1, 0.6, -0.2);
    model.group.updateMatrixWorld(true);
    const muzzle = model.group.getObjectByName('muzzle') as THREE.Mesh<THREE.CylinderGeometry>;
    const barrelTip = muzzle.localToWorld(new THREE.Vector3(0, muzzle.geometry.parameters.height / 2, 0));
    const declaredTip = model.group.localToWorld(model.muzzleLocalOffset.clone());
    expect(barrelTip.distanceTo(declaredTip)).toBeLessThan(1e-7);
  });

  it('gives the SMG three independently animated burst pips', () => {
    const model = buildWeaponViewModel('mp5');
    expect(model.glowMaterials.map((material) => material.userData.burstPip)).toEqual([0, 1, 2]);
    expect(new Set(model.glowMaterials).size).toBe(3);
  });

  it('shares gold only on the reward weapon and keeps the knife edge luminous', () => {
    const gold = getWeaponMaterials().gold;
    expect(gold.color.getHex()).toBe(0xd4af37);
    expect(meshes(buildWeaponViewModel('gooseLauncher').group).filter((part) => part.material === gold).length).toBeGreaterThan(1);
    expect(meshes(buildWeaponViewModel('rifle').group).some((part) => part.material === gold)).toBe(false);
    const knife = buildWeaponViewModel('knife');
    const edge = knife.group.getObjectByName('edge-glow') as THREE.Mesh;
    expect(edge.material).toBe(knife.glowMaterials[0]);
    expect(knife.magazine).toBeNull();
  });

  it('rejects an unknown id instead of substituting an unrelated weapon', () => {
    expect(() => buildWeaponViewModel('missing')).toThrow('Unknown weapon model');
  });
});

describe('Opus procedural materials in Node', () => {
  it('caches all four sets of 256px byte textures with the correct color spaces and sampling', () => {
    const materials = getWeaponMaterials();
    expect(materials).toBe(getWeaponMaterials());
    for (const maps of [materials.gunmetal, materials.pipe, materials.trim, materials.glowMaps]) {
      for (const [key, colorSpace] of [['map', THREE.SRGBColorSpace], ['normalMap', THREE.NoColorSpace], ['roughnessMap', THREE.NoColorSpace]] as const) {
        const texture = maps[key] as THREE.DataTexture;
        expect(texture).toBeInstanceOf(THREE.DataTexture);
        expect(texture.image.width).toBe(256);
        expect(texture.image.height).toBe(256);
        expect(texture.image.data).toBeInstanceOf(Uint8Array);
        expect(texture.image.data!.length).toBe(256 * 256 * 4);
        expect(texture.colorSpace).toBe(colorSpace);
        expect(texture.wrapS).toBe(THREE.RepeatWrapping);
        expect(texture.wrapT).toBe(THREE.RepeatWrapping);
        expect(texture.generateMipmaps).toBe(true);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      }
    }
    expect(materials.gunmetal.metalness).toBe(0.35);
    expect(materials.pipe.metalness).toBe(0.55);
    expect(materials.trim.metalness).toBe(0.3);
    expect(materials.sleeve.color.getHex()).toBe(0x3b4a42);
    expect(materials.sleeve.roughness).toBe(0.9);
    expect(materials.sleeve.metalness).toBe(0);
    expect(materials.glove.color.getHex()).toBe(0x2a2a28);
    expect(materials.glove.roughness).toBe(0.35);
  });

  it('encodes varying height normals and converts gloss to roughness in the green channel', () => {
    const materials = getWeaponMaterials();
    const normals = (materials.gunmetal.normalMap as THREE.DataTexture).image.data!;
    expect(new Set(normals).size).toBeGreaterThan(10);
    for (let i = 0; i < normals.length; i += 1024) {
      const length = Math.hypot(normals[i]! / 255 * 2 - 1, normals[i + 1]! / 255 * 2 - 1, normals[i + 2]! / 255 * 2 - 1);
      expect(length).toBeCloseTo(1, 2);
    }
    const roughness = (materials.gunmetal.roughnessMap as THREE.DataTexture).image.data!;
    expect(roughness[1]).toBe(Math.round((1 - 0.75) * 255));
    expect(materials.gunmetal.roughness).toBe(1);
    expect(materials.glowMaps.roughnessMap.image.data![1]).toBe(0);
    expect(Array.from(materials.glowMaps.normalMap.image.data!.slice(0, 4))).toEqual([128, 128, 255, 255]);
  });
});
