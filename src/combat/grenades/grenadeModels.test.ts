import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildGrenadeModel } from './grenadeModels.ts';

function meshes(group: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  group.traverse((object) => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}

describe('grenade models', () => {
  it('builds a frag with a body, spoon and ring, and a flash with a band', () => {
    const frag = buildGrenadeModel('frag');
    const flash = buildGrenadeModel('flash');
    for (const name of ['body', 'fuse', 'spoon', 'spoon-top', 'ring']) {
      expect(frag.getObjectByName(name)).toBeInstanceOf(THREE.Mesh);
      expect(flash.getObjectByName(name)).toBeInstanceOf(THREE.Mesh);
    }
    expect(flash.getObjectByName('band')).toBeInstanceOf(THREE.Mesh);
    expect(frag.getObjectByName('band')).toBeUndefined();
  });

  it('shares geometry and materials between copies, never per copy', () => {
    const [a, b] = [buildGrenadeModel('frag'), buildGrenadeModel('frag')];
    expect(a).not.toBe(b);
    const first = meshes(a);
    const second = meshes(b);
    expect(first.length).toBe(second.length);
    first.forEach((mesh, i) => {
      expect(mesh.geometry).toBe(second[i]!.geometry);
      expect(mesh.material).toBe(second[i]!.material);
    });
  });

  it('stays hand sized (about 6 to 13 cm)', () => {
    for (const kind of ['frag', 'flash'] as const) {
      const size = new THREE.Box3().setFromObject(buildGrenadeModel(kind)).getSize(new THREE.Vector3());
      expect(size.y).toBeGreaterThan(0.08);
      expect(size.y).toBeLessThan(0.16);
      expect(Math.max(size.x, size.z)).toBeLessThan(0.12);
    }
  });
});
