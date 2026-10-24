import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildStructureMaterials, getStructureMaterials, STRUCTURE_TILE_METRES, type StructureMaterialKey } from './structureMaterials.ts';

const keys: StructureMaterialKey[] = ['concrete', 'grating', 'perforated', 'roof', 'cladding', 'steel', 'hazard'];
const mapKeys = ['map', 'normalMap', 'roughnessMap'] as const;

describe('structure materials', () => {
  it('caches all seven materials with 256px PBR textures and world tile sizes', () => {
    const materials = getStructureMaterials();
    expect(materials).toBe(getStructureMaterials());
    expect(Object.keys(materials)).toEqual(keys);
    expect(STRUCTURE_TILE_METRES).toEqual({ concrete: 2, grating: 1, perforated: 1, roof: 2, cladding: 2, steel: 1, hazard: 1 });
    const metalness = { concrete: 0, grating: 0.6, perforated: 0.6, roof: 0.4, cladding: 0.25, steel: 0.6, hazard: 0.2 };
    for (const key of keys) {
      const material = materials[key];
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(material.name).toBe(`structure-${key}`);
      expect(material.roughness).toBe(1);
      expect(material.envMapIntensity).toBe(0.5);
      expect(material.metalness).toBe(metalness[key]);
      for (const mapKey of mapKeys) {
        const texture = material[mapKey] as THREE.DataTexture;
        expect(texture).toBeInstanceOf(THREE.DataTexture);
        expect(texture.image.width).toBe(256);
        expect(texture.image.height).toBe(256);
        expect(texture.image.data).toBeInstanceOf(Uint8Array);
        expect(texture.image.data!.length).toBe(256 * 256 * 4);
        expect(texture.colorSpace).toBe(mapKey === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace);
        expect(texture.wrapS).toBe(THREE.RepeatWrapping);
        expect(texture.wrapT).toBe(THREE.RepeatWrapping);
      }
    }
  });

  it('builds identical texture bytes independently of the cache', () => {
    const first = buildStructureMaterials();
    const second = buildStructureMaterials();
    for (const key of keys) {
      expect(first[key]).not.toBe(second[key]);
      for (const mapKey of mapKeys) {
        const a = first[key][mapKey] as THREE.DataTexture;
        const b = second[key][mapKey] as THREE.DataTexture;
        expect(a).not.toBe(b);
        const bytes = a.image.data!;
        const other = b.image.data!;
        expect(bytes.length).toBe(other.length);
        expect(bytes.every((value, i) => value === other[i])).toBe(true);
        a.dispose();
        b.dispose();
      }
      first[key].dispose();
      second[key].dispose();
    }
  }, 60000);

  it('keeps both yellow and dark texels in the hazard stripes', () => {
    const bytes = (getStructureMaterials().hazard.map as THREE.DataTexture).image.data!;
    let yellow = 0, dark = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      const r = bytes[i]!, g = bytes[i + 1]!, b = bytes[i + 2]!;
      if (r > 150 && g > 120 && b < 90) yellow++;
      if (r < 80 && g < 80 && b < 80) dark++;
    }
    expect(yellow).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(0);
  });
});
