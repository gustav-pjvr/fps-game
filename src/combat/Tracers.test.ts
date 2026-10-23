import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Tracers } from './Tracers.ts';
import { TRACER_LENGTH, TRACER_SPEED } from '../core/config.ts';

function headAndTail(scene: THREE.Scene, index = 0): { head: number; tail: number } {
  const mesh = scene.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry>;
  const heads = mesh.geometry.getAttribute('aHead');
  const tails = mesh.geometry.getAttribute('aTail');
  return { head: heads.getZ(index), tail: tails.getZ(index) };
}

describe('Tracers', () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const impact = new THREE.Vector3(0, 0, 100);

  it('grows out of the muzzle, flies as a streak of TRACER_LENGTH, then is swallowed at impact', () => {
    const scene = new THREE.Scene();
    const tracers = new Tracers(scene);
    tracers.spawn(origin, impact);

    tracers.update(0.01);
    const early = headAndTail(scene);
    expect(early.head).toBeCloseTo(TRACER_SPEED * 0.01, 3);
    expect(early.tail).toBe(0);

    tracers.update(0.2);
    const mid = headAndTail(scene);
    expect(mid.head - mid.tail).toBeCloseTo(TRACER_LENGTH, 3);

    // Head pinned at the impact point while the tail catches up.
    tracers.update((100 - TRACER_SPEED * 0.21) / TRACER_SPEED + 0.001);
    const landing = headAndTail(scene);
    expect(landing.head).toBeCloseTo(100, 3);
    expect(landing.tail).toBeLessThan(100);

    tracers.update(TRACER_LENGTH / TRACER_SPEED);
    expect(tracers.activeCount).toBe(0);
    expect((scene.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry>).geometry.instanceCount).toBe(0);
  });

  it('keeps at most 128 in flight, dropping the oldest', () => {
    const scene = new THREE.Scene();
    const tracers = new Tracers(scene);
    for (let i = 0; i < 140; i++) tracers.spawn(origin, impact);
    expect(tracers.activeCount).toBe(128);
    tracers.clear();
    expect(tracers.activeCount).toBe(0);
  });

  it('ignores a zero-length shot', () => {
    const tracers = new Tracers(new THREE.Scene());
    tracers.spawn(origin, origin.clone());
    expect(tracers.activeCount).toBe(0);
  });
});
