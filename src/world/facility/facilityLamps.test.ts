import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { ObstacleRegistry } from '../../entities/enemies/tactics/obstacleRegistry.ts';
import * as structureMaterials from '../structureMaterials.ts';
import { generateFacilityLayout, OPEN, type FacilityLayout } from './facilityLayout.ts';
import { FacilityWorld } from './FacilityBuilder.ts';
import { facilityPower } from './facilityPower.ts';
import type { FacilityBakeState } from './facilityBake.ts';

function hall(): FacilityLayout {
  const size = 8, kinds = new Uint8Array(size * size).fill(OPEN);
  return { seed: 1, size, cell: 1.5, kinds, ceiling: new Float32Array(size * size).fill(6),
    region: new Int16Array(size * size), rooms: [{ i0: 0, j0: 0, i1: 8, j1: 8, ceiling: 6, kind: 'hall', dark: false }],
    lamps: [
      { x: -3, y: 5.85, z: 0, color: 0xffd2a0, intensity: 1, kind: 'panel' },
      { x: 3, y: 5.85, z: 0, color: 0xffd2a0, intensity: 1, kind: 'panel' },
      { x: 0, y: 2.5, z: 3, color: 0xffa040, intensity: 0.5, kind: 'emergency' },
    ],
    doorways: [], crates: [] };
}

/** Every baked vertex of the facility: position, normal and the live light value it reads. */
function bakedVertices(scene: THREE.Scene): { position: THREE.Vector3; normal: THREE.Vector3; light: () => number[] }[] {
  const result: ReturnType<typeof bakedVertices> = [];
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.geometry.getAttribute('bakedLight')) return;
    const p = object.geometry.getAttribute('position'), n = object.geometry.getAttribute('normal');
    const light = object.geometry.getAttribute('bakedLight') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) result.push({ position: new THREE.Vector3().fromBufferAttribute(p, i),
      normal: new THREE.Vector3().fromBufferAttribute(n, i), light: () => [light.getX(i), light.getY(i), light.getZ(i)] });
  });
  return result;
}

describe('Facility lamps', () => {
  let physics: PhysicsWorld, scene: THREE.Scene, obstacles: ObstacleRegistry, facility: FacilityWorld | undefined;
  let mock: { mockRestore: () => void }, shared: ReturnType<typeof structureMaterials.getStructureMaterials>;

  beforeEach(async () => {
    shared = Object.fromEntries(Object.keys(structureMaterials.STRUCTURE_TILE_METRES)
      .map(key => [key, new THREE.MeshStandardMaterial()])) as typeof shared;
    mock = vi.spyOn(structureMaterials, 'getStructureMaterials').mockReturnValue(shared);
    physics = await PhysicsWorld.create(); scene = new THREE.Scene(); obstacles = new ObstacleRegistry();
  });
  afterEach(() => {
    facility?.dispose(); facility = undefined; physics.dispose(); mock.mockRestore();
    Object.values(shared).forEach(material => material.dispose());
  });

  it.each(['power then shoot', 'shoot then power'])('rebakes %s to the same arrays as a fresh build with only L shot', order => {
    const layout = generateFacilityLayout(1), power = facilityPower(layout);
    const lamp = layout.lamps.findIndex(l => l.kind === 'panel'), zone = power.lampZone[lamp]!;
    const zoneLamps = layout.lamps.flatMap((l, index) => l.kind !== 'emergency' && power.lampZone[index] === zone ? [index] : []);
    expect(lamp).toBeGreaterThanOrEqual(0); expect(zoneLamps.length).toBeGreaterThan(1);
    const build = (): FacilityWorld => FacilityWorld.build(layout, { scene, physics, obstacles, lightShafts: false, dust: false });
    const snapshot = (): Record<'light' | 'probes' | 'direct' | 'fill', Float32Array> => {
      const bake = (facility as unknown as { bake: FacilityBakeState }).bake;
      return { light: bake.light.slice(), probes: bake.probes.slice(), direct: bake.direct.slice(), fill: bake.fill.slice() };
    };
    facility = build(); facility.killLamp(lamp); facility.flushLampRebakes();
    const expected = snapshot();
    facility.dispose(); facility = build();
    const powerZone = (on: boolean): void => {
      for (const index of zoneLamps) facility!.setLampPowered(index, on);
      facility!.flushLampRebakes(); expect(facility!.pendingRebakes).toBe(0);
    };
    if (order === 'power then shoot') {
      powerZone(false); powerZone(true); facility.killLamp(lamp);
    } else {
      facility.killLamp(lamp); facility.flushLampRebakes(); powerZone(false); powerZone(true);
    }
    facility.flushLampRebakes();
    expect(facility.deadLampIndices()).toEqual([lamp]);
    for (const index of zoneLamps) expect(facility.isLampLit(index)).toBe(index !== lamp);
    const actual = snapshot();
    for (const key of ['light', 'probes', 'direct', 'fill'] as const) {
      expect(actual[key].length).toBe(expected[key].length);
      let maxDifference = 0;
      actual[key].forEach((value, index) => { maxDifference = Math.max(maxDifference, Math.abs(value - expected[key][index]!)); });
      expect(maxDifference, key).toBeLessThanOrEqual(1e-5);
    }
  }, 30000);

  it('hits the nearest live lamp box along a ray and misses beside or beyond it', () => {
    facility = FacilityWorld.build(hall(), { scene, physics, obstacles, lightShafts: false, dust: false });
    const origin = new THREE.Vector3(-8, 5.85, 0), east = new THREE.Vector3(1, 0, 0);
    expect(facility.rayHitLamp(origin, east, 50)).toBe(0);
    expect(facility.rayHitLamp(new THREE.Vector3(8, 5.85, 0), new THREE.Vector3(-1, 0, 0), 50)).toBe(1);
    // Up from below, inside the enlarged 1.0 x 0.2 x 0.4 box but outside the visible 0.9 x 0.3 panel.
    expect(facility.rayHitLamp(new THREE.Vector3(-3.47, 1, 0.18), new THREE.Vector3(0, 1, 0), 50)).toBe(0);
    expect(facility.rayHitLamp(new THREE.Vector3(-3.55, 1, 0), new THREE.Vector3(0, 1, 0), 50)).toBe(-1);
    expect(facility.rayHitLamp(new THREE.Vector3(-3, 1, 0.25), new THREE.Vector3(0, 1, 0), 50)).toBe(-1);
    // A wall or player in front of the lamp (the physics hit) is nearer: no lamp.
    expect(facility.rayHitLamp(origin, east, 4)).toBe(-1);
    expect(facility.rayHitLamp(origin, east, 4.6)).toBe(0);
    expect(facility.rayHitLamp(origin, east.clone().multiplyScalar(3), 50)).toBe(0);
    expect(facility.rayHitLamp(new THREE.Vector3(0, 2.5, -2), new THREE.Vector3(0, 0, 1), 50)).toBe(2);
    expect(facility.rayHitLamp(new THREE.Vector3(0.2, 2.5, -2), new THREE.Vector3(0, 0, 1), 50)).toBe(-1);
    expect(facility.killLamp(0)).toEqual({ x: -3, y: 5.85, z: 0 });
    expect(facility.rayHitLamp(origin, east, 50)).toBe(1);
    expect(facility.killLamp(0)).toBeNull();
    expect(facility.killLamp(99)).toBeNull();
    expect(facility.deadLampIndices()).toEqual([0]);
    expect(facility.lampPosition(2)).toEqual({ x: 0, y: 2.5, z: 3 });
    expect(facility.lampPosition(3)).toBeNull();
  });

  it('counts a lamp dead and darkens its panel at once, then rebakes one queued lamp per update', () => {
    const layout = generateFacilityLayout(1);
    facility = FacilityWorld.build(layout, { scene, physics, obstacles, lightShafts: false, dust: false });
    const vertices = bakedVertices(scene), before = vertices.map(v => v.light());
    const lamps = scene.getObjectByName('facility-lamps') as THREE.InstancedMesh, color = new THREE.Color();
    const camera = new THREE.PerspectiveCamera();
    // A shotgun breaking three lamps in one shot: nothing is rebaked inside the shot.
    for (const index of [0, 1, 2]) expect(facility.killLamp(index)).not.toBeNull();
    expect(facility.deadLampIndices()).toEqual([0, 1, 2]);
    expect(facility.isLampDead(1)).toBe(true);
    expect(facility.pendingRebakes).toBe(3);
    lamps.getColorAt(1, color);
    expect(color.getHex()).toBe(0);
    vertices.forEach((v, i) => expect(v.light()).toEqual(before[i]));
    facility.update(camera, 1 / 60);
    expect(facility.pendingRebakes).toBe(2);
    facility.update(camera, 1 / 60); facility.update(camera, 1 / 60);
    expect(facility.pendingRebakes).toBe(0);
    expect(vertices.some((v, i) => v.light().some((c, k) => c < before[i]![k]!))).toBe(true);
    // A batch (late joiner or resync) kills only the live lamps and queues one rebake each.
    expect(facility.killLamps([2, 3, 4, 3])).toEqual([3, 4]);
    expect(facility.pendingRebakes).toBe(2);
    facility.relightAll();
    expect(facility.pendingRebakes).toBe(0);
    vertices.forEach((v, i) => expect(v.light()).toEqual(before[i]));
  }, 20000);

  it('kills a lamp on seed 1: the room under it darkens, far rooms keep their light, relightAll restores it exactly', () => {
    const layout = generateFacilityLayout(1);
    facility = FacilityWorld.build(layout, { scene, physics, obstacles, lightShafts: true, dust: false });
    const vertices = bakedVertices(scene), before = vertices.map(v => v.light());
    const probesBefore = layout.lamps.map(l => facility!.probeAt(l.x, l.z));
    const lamps = scene.getObjectByName('facility-lamps') as THREE.InstancedMesh;
    const shafts = scene.getObjectByName('facility-shafts') as THREE.InstancedMesh | undefined;
    const index = layout.lamps.findIndex((lamp, i) => lamp.kind === 'panel' && i > 0 && lamp.y > 5.4);
    const lamp = layout.lamps[index > 0 ? index : 0]!, target = index > 0 ? index : 0;
    let under = -1, best = Infinity;
    vertices.forEach((v, i) => {
      const distance = Math.hypot(v.position.x - lamp.x, v.position.z - lamp.z);
      if (v.position.y === 0 && v.normal.y > 0.9 && distance < best) { best = distance; under = i; }
    });
    expect(best).toBeLessThan(1);
    const timings: number[] = [];
    expect(facility.killLamp(target)).toEqual({ x: lamp.x, y: lamp.y, z: lamp.z });
    facility.flushLampRebakes();
    timings.push(facility.lastKillMs);
    const after = vertices[under]!.light();
    for (let c = 0; c < 3; c++) expect(after[c]!).toBeLessThan(before[under]![c]! * 0.8);
    const probe = facility.probeAt(lamp.x, lamp.z);
    for (let c = 0; c < 3; c++) expect(probe[c]!).toBeLessThan(probesBefore[target]![c]! * 0.8);
    vertices.forEach((v, i) => {
      if (Math.hypot(v.position.x - lamp.x, v.position.z - lamp.z) > 20) expect(v.light()).toEqual(before[i]);
    });
    const color = new THREE.Color();
    lamps.getColorAt(target, color);
    expect(color.getHex()).toBe(0);
    if (shafts) {
      const matrix = new THREE.Matrix4(), scale = new THREE.Vector3();
      for (let i = 0; i < shafts.count; i++) {
        shafts.getMatrixAt(i, matrix); scale.setFromMatrixScale(matrix);
        const x = matrix.elements[12]!, z = matrix.elements[14]!;
        if (Math.abs(x - lamp.x) < 1e-4 && Math.abs(z - lamp.z) < 1e-4) expect(scale.y).toBe(0); else expect(scale.y).toBeGreaterThan(0);
      }
    }
    // A few more kills for the timing figure.
    for (let i = 0, kills = 0; i < layout.lamps.length && kills < 6; i++) {
      if (i === target) continue;
      facility.killLamp(i); facility.flushLampRebakes(); timings.push(facility.lastKillMs); kills++;
    }
    timings.sort((a, b) => a - b);
    console.log(`Facility seed 1 killLamp: median ${timings[timings.length >> 1]!.toFixed(1)} ms, max ${timings[timings.length - 1]!.toFixed(1)} ms over ${timings.length} lamps`);
    expect(timings[timings.length >> 1]!).toBeLessThan(25);
    facility.relightAll();
    expect(facility.deadLampIndices()).toEqual([]);
    vertices.forEach((v, i) => expect(v.light()).toEqual(before[i]));
    layout.lamps.forEach((l, i) => expect(facility!.probeAt(l.x, l.z)).toEqual(probesBefore[i]));
    lamps.getColorAt(target, color);
    expect(color.getHex()).toBe(lamp.color);
    if (shafts) {
      const matrix = new THREE.Matrix4(), scale = new THREE.Vector3();
      for (let i = 0; i < shafts.count; i++) { shafts.getMatrixAt(i, matrix); expect(scale.setFromMatrixScale(matrix).y).toBeGreaterThan(0); }
    }
  }, 20000);
});
