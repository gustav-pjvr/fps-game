import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FRAG_MAX_DEBRIS, FRAG_MAX_PUFFS, FRAG_MAX_SCORCHES, FRAG_MAX_SPARKS, FragExplosion } from './FragExplosion.ts';

const FLOOR = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };

function setup(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; effect: FragExplosion } {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 8);
  camera.updateMatrixWorld();
  return { scene, camera, effect: new FragExplosion(scene) };
}

describe('FragExplosion', () => {
  it('is in the scene from the start with nothing drawn, and adds no light', () => {
    const { scene, camera, effect } = setup();
    const children = scene.children.length;
    effect.update(1 / 60, camera);
    expect(effect.activeCounts).toEqual({ puffs: 0, sparks: 0, debris: 0, scorches: 0 });
    effect.spawn({ x: 0, y: 0.07, z: 0 }, FLOOR);
    effect.update(1 / 60, camera);
    expect(scene.children.length).toBe(children);
    expect(scene.children.some((child) => child instanceof THREE.Light)).toBe(false);
  });

  it('bursts into a fireball, smoke, a dirt fountain, a dust ring, sparks, debris and a scorch, which all clear but the scorch', () => {
    const { camera, effect } = setup();
    effect.spawn({ x: 0, y: 0.07, z: 0 }, FLOOR);
    effect.update(1 / 60, camera);
    const counts = effect.activeCounts;
    // The core, 6 of fire, 10 of smoke, 9 of dirt and 16 of dust.
    expect(counts.puffs).toBe(42);
    expect(counts.sparks).toBeGreaterThan(30);
    expect(counts.debris).toBeGreaterThan(15);
    expect(counts.scorches).toBe(1);
    // The flash is gone in a tenth of a second, the dirt has fallen back within two, and the
    // smoke column hangs for some five.
    for (let t = 0; t < 0.2; t += 1 / 60) effect.update(1 / 60, camera);
    expect(effect.activeCounts.puffs).toBe(41);
    for (let t = 0; t < 2; t += 1 / 30) effect.update(1 / 30, camera);
    expect(effect.activeCounts.puffs).toBeGreaterThanOrEqual(10);
    expect(effect.activeCounts.puffs).toBeLessThan(32);
    for (let t = 0; t < 3.5; t += 1 / 30) effect.update(1 / 30, camera);
    expect(effect.activeCounts).toEqual({ puffs: 0, sparks: 0, debris: 0, scorches: 1 });
    for (let t = 0; t < 30; t += 0.1) effect.update(0.1, camera);
    expect(effect.activeCounts.scorches).toBe(0);
  });

  it('in the air: no dirt, no dust ring and no scorch', () => {
    const { camera, effect } = setup();
    effect.spawn({ x: 0, y: 3, z: 0 }, null);
    effect.update(1 / 60, camera);
    const counts = effect.activeCounts;
    expect(counts.scorches).toBe(0);
    // The core, the fire and the smoke only.
    expect(counts.puffs).toBe(17);
  });

  it('keeps its caps however many frags go off at once', () => {
    const { camera, effect } = setup();
    for (let i = 0; i < 14; i++) effect.spawn({ x: i, y: 0.07, z: 0 }, { ...FLOOR, point: { x: i, y: 0, z: 0 } });
    effect.update(1 / 60, camera);
    const counts = effect.activeCounts;
    expect(counts.puffs).toBe(FRAG_MAX_PUFFS);
    expect(counts.sparks).toBe(FRAG_MAX_SPARKS);
    expect(counts.debris).toBe(FRAG_MAX_DEBRIS);
    expect(counts.scorches).toBe(FRAG_MAX_SCORCHES);
  });

  it('sparks and debris never pass through the surface they bounce on', () => {
    const { camera, effect } = setup();
    // A wall facing +x.
    effect.spawn({ x: 0.07, y: 1, z: 0 }, { point: { x: 0, y: 1, z: 0 }, normal: { x: 1, y: 0, z: 0 } });
    const debris = (effect as unknown as { debris: { position: THREE.Vector3; age: number; life: number }[] }).debris;
    for (let t = 0; t < 1.5; t += 1 / 60) {
      effect.update(1 / 60, camera);
      for (const bit of debris) if (bit.age < bit.life) expect(bit.position.x).toBeGreaterThan(0);
    }
  });

  it('clears everything on a restart', () => {
    const { camera, effect } = setup();
    effect.spawn({ x: 0, y: 0.07, z: 0 }, FLOOR);
    effect.update(1 / 60, camera);
    effect.clear();
    expect(effect.activeCounts).toEqual({ puffs: 0, sparks: 0, debris: 0, scorches: 0 });
  });
});
