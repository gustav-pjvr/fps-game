import programSource from 'three/src/renderers/webgl/WebGLProgram.js?raw';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { ObstacleRegistry } from '../../entities/enemies/tactics/obstacleRegistry.ts';
import * as structureMaterials from '../structureMaterials.ts';
import { generateFacilityLayout, SOLID, OPEN, PROP, type FacilityLayout } from './facilityLayout.ts';
import { buildFacilityGeometry, type ColliderBox } from './facilityGeometry.ts';
import { withBakedLight } from './bakedLightMaterial.ts';
import { FacilityWorld } from './FacilityBuilder.ts';

function contains(box: ColliderBox, x: number, y: number, z: number): boolean {
  return Math.abs(x - box.cx) <= box.hx && Math.abs(y - box.cy) <= box.hy && Math.abs(z - box.cz) <= box.hz;
}

function smallLayout(): FacilityLayout {
  const size = 6, kinds = new Uint8Array(size * size).fill(OPEN);
  return { seed: 1, size, cell: 1.5, kinds, ceiling: new Float32Array(size * size).fill(6),
    region: new Int16Array(size * size), rooms: [{ i0: 0, j0: 0, i1: 6, j1: 6, ceiling: 6, kind: 'hall', dark: false }],
    lamps: [{ x: -0.75, y: 5.85, z: -0.75, color: 0xffd2a0, intensity: 1, kind: 'panel' }],
    doorways: [], crates: [] };
}

describe('Facility geometry', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('stays within budget with valid surfaces and colliders on seed %i', seed => {
    const layout = generateFacilityLayout(seed), result = buildFacilityGeometry(layout);
    let vertices = 0, maxNormalError = 0, badTriangles = 0;
    for (const geometry of result.byMaterial.values()) {
      const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
      vertices += p.count;
      expect(n.count).toBe(p.count); expect(uv.count).toBe(p.count);
      expect(Array.from(uv.array).every(Number.isFinite)).toBe(true);
      for (let i = 0; i < n.count; i++) maxNormalError = Math.max(maxNormalError, Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1));
      const indices = geometry.index!;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
      for (let i = 0; i < indices.count; i += 3) {
        const ia = indices.getX(i), ib = indices.getX(i + 1), ic = indices.getX(i + 2);
        a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
        normal.fromBufferAttribute(n, ia);
        if (b.sub(a).cross(c.sub(a)).dot(normal) <= 0) badTriangles++;
      }
    }
    expect(vertices).toBeLessThan(140000);
    expect(maxNormalError).toBeLessThan(1e-6);
    expect(badTriangles).toBe(0);
    let uncovered = 0, blockedOpen = 0;
    for (let j = 0; j < layout.size; j++) for (let i = 0; i < layout.size; i++) {
      const x = (i + 0.5 - layout.size / 2) * layout.cell, z = (j + 0.5 - layout.size / 2) * layout.cell;
      const hit = result.colliderBoxes.some(box => contains(box, x, 1, z)), kind = layout.kinds[j * layout.size + i];
      if (kind === SOLID && !hit) uncovered++;
      if (kind === OPEN && hit) blockedOpen++;
    }
    expect(uncovered).toBe(0); expect(blockedOpen).toBe(0);
    if (seed === 1) console.log(`Facility seed 1 vertices: ${vertices}`);
    for (const geometry of result.byMaterial.values()) geometry.dispose();
  });

  it('merges solid rectangles and ceiling rectangles without spanning height changes', () => {
    const layout = smallLayout();
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      if (i < 2) { layout.kinds[j * 6 + i] = SOLID; layout.ceiling[j * 6 + i] = 0; }
      else if (i < 4) layout.ceiling[j * 6 + i] = 3.2;
    }
    const result = buildFacilityGeometry(layout);
    expect(result.colliderBoxes).toHaveLength(4);
    expect(result.colliderBoxes.filter(b => b.cy === 4)).toEqual([{ cx: -3, cy: 4, cz: 0, hx: 1.5, hy: 4, hz: 4.5 }]);
    const concrete = result.byMaterial.get('concrete')!, p = concrete.getAttribute('position'), n = concrete.getAttribute('normal');
    let lintel = false;
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) === 1.5 && p.getY(i) > 3.2 && n.getX(i) === 1) lintel = true;
    }
    expect(lintel).toBe(true);
    for (const geometry of result.byMaterial.values()) geometry.dispose();
  });

  it('keeps metre-scaled UVs and creates crate and pillar cover', () => {
    const base = smallLayout();
    base.kinds[2 * 6 + 2] = SOLID; base.ceiling[2 * 6 + 2] = 0;
    base.kinds[3 * 6 + 3] = PROP;
    const layout = { ...base, crates: [{ i: 3, j: 3, height: 1.8 }] };
    const result = buildFacilityGeometry(layout);
    expect(result.coverFootprints).toHaveLength(2);
    expect(result.coverFootprints.some(f => f.halfWidth === 0.6 && f.halfDepth === 0.6)).toBe(true);
    expect(result.colliderBoxes.filter(b => b.hx === 0.6 && b.hy === 0.9 && b.hz === 0.6)).toHaveLength(1);
    for (const [key, geometry] of result.byMaterial) {
      const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
      const tile = structureMaterials.STRUCTURE_TILE_METRES[key];
      // Each face begins with a horizontal run of shared vertices.
      const distance = Math.hypot(p.getX(1) - p.getX(0), p.getY(1) - p.getY(0), p.getZ(1) - p.getZ(0));
      expect(Math.abs(uv.getX(1) - uv.getX(0)) * tile).toBeCloseTo(distance);
      geometry.dispose();
    }
  });
});

describe('Facility material and world ownership', () => {
  it('patches a clone and preserves the shared material and texture maps', () => {
    const texture = new THREE.Texture(), source = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture, roughnessMap: texture });
    const original = source.onBeforeCompile, key = source.customProgramCacheKey(), clone = withBakedLight(source);
    const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '#include <aomap_fragment>' };
    clone.onBeforeCompile(shader as Parameters<typeof clone.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(clone).not.toBe(source);
    expect(clone.map).toBe(texture); expect(clone.normalMap).toBe(texture); expect(clone.roughnessMap).toBe(texture);
    expect(source.onBeforeCompile).toBe(original); expect(source.customProgramCacheKey()).toBe(key);
    expect(shader.vertexShader).toContain('attribute vec3 bakedLight');
    expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse += vBakedLight * BRDF_Lambert( diffuseColor.rgb );\n#include <aomap_fragment>');
    expect(clone.customProgramCacheKey()).not.toBe(key);
    clone.dispose(); source.dispose(); texture.dispose();
  });

  it('builds and disposes the scene, physics, cover and owned resources without WebGL', async () => {
    const texture = new THREE.Texture(), shared = Object.fromEntries(Object.keys(structureMaterials.STRUCTURE_TILE_METRES)
      .map(key => [key, new THREE.MeshStandardMaterial({ map: texture })])) as ReturnType<typeof structureMaterials.getStructureMaterials>;
    const mock = vi.spyOn(structureMaterials, 'getStructureMaterials').mockReturnValue(shared);
    const textureDisposed = vi.fn(); texture.addEventListener('dispose', textureDisposed);
    const physics = await PhysicsWorld.create(), scene = new THREE.Scene(), obstacles = new ObstacleRegistry();
    let facility: FacilityWorld | undefined;
    try {
      const base = smallLayout(); base.kinds[3 * 6 + 3] = PROP;
      const layout = { ...base, crates: [{ i: 3, j: 3, height: 1.2 }] };
      facility = FacilityWorld.build(layout, { scene, physics, obstacles, lightShafts: true, dust: true });
      expect(physics.world.bodies.len()).toBe(1); expect(physics.world.colliders.len()).toBeGreaterThan(1);
      expect(obstacles.size).toBe(1);
      const group = scene.getObjectByName('facility')!;
      const lamps = scene.getObjectByName('facility-lamps') as THREE.InstancedMesh;
      expect(lamps.count).toBe(layout.lamps.length);
      expect((lamps.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(6);
      const lampShader = { fragmentShader: '#include <emissivemap_fragment>' };
      (lamps.material as THREE.Material).onBeforeCompile(lampShader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      expect(lampShader.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb');
      // The tint must sit behind a define three actually sets in the fragment shader, or a shot-out
      // lamp keeps glowing white (it did in 4.3.0 behind USE_INSTANCING_COLOR, a vertex-only define).
      const guard = /#ifdef (\w+)\n totalEmissiveRadiance \*= vColor\.rgb/.exec(lampShader.fragmentShader)?.[1];
      const fragmentPrefixes = programSource.split('prefixFragment = [').slice(1).map(chunk => chunk.slice(0, chunk.indexOf('].')));
      expect(fragmentPrefixes.some(prefix => prefix.includes(`instancingColor ? '#define ${guard}'`))).toBe(true);
      expect(scene.getObjectByName('facility-shafts')).toBeDefined();
      const dust = scene.getObjectByName('facility-dust') as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
      const dustDisposed = vi.fn(); dust.material.map!.addEventListener('dispose', dustDisposed);
      const disposed = vi.fn();
      group.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.addEventListener('dispose', disposed);
          (object.material as THREE.Material).addEventListener('dispose', disposed);
        }
      });
      const camera = new THREE.PerspectiveCamera(); camera.position.set(30, 2, -20);
      facility.update(camera, 1 / 60); camera.position.x += 25; facility.update(camera, 1 / 60);
      const p = dust.geometry.getAttribute('position');
      expect(p.count).toBe(300);
      for (let i = 0; i < p.count; i++) expect(Math.hypot(p.getX(i) - camera.position.x, p.getY(i) - camera.position.y, p.getZ(i) - camera.position.z)).toBeLessThanOrEqual(10.00001);
      expect(facility.probeAt(-0.75, -0.75).every(Number.isFinite)).toBe(true);
      facility.dispose(); facility.dispose();
      expect(physics.world.bodies.len()).toBe(0); expect(physics.world.colliders.len()).toBe(0);
      expect(obstacles.size).toBe(0); expect(scene.children).toHaveLength(0);
      expect(disposed).toHaveBeenCalled(); expect(dustDisposed).toHaveBeenCalledTimes(1);
      expect(textureDisposed).not.toHaveBeenCalled();
      facility = FacilityWorld.build(layout, { scene, physics, obstacles, lightShafts: false, dust: false });
      expect(scene.getObjectByName('facility-shafts')).toBeUndefined();
      expect(scene.getObjectByName('facility-dust')).toBeUndefined();
    } finally {
      facility?.dispose(); physics.dispose(); mock.mockRestore();
      Object.values(shared).forEach(material => material.dispose()); texture.dispose();
    }
  });
});
