import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CLEAR_PATH, MAX_COUNTED_SOLIDS } from '../audio/occlusion.ts';
import { MAX_CASTS, probeOcclusion, probeSoundPath, probeStats } from './soundProbe.ts';

// The probe against a real Rapier world. The listener stands at the origin and the source is 12 m
// down +Z, with walls across the line at z = 3, 5, 7 and 9 (each 20 m wide, 10 m tall, 0.5 m thick).

const LISTENER = { x: 0, y: 1.6, z: 0 };
const SOURCE = { x: 0, y: 1.6, z: 12 };

function box(world: RAPIER.World, x: number, y: number, z: number, hx: number, hy: number, hz: number, configure?: (desc: RAPIER.ColliderDesc) => void): RAPIER.Collider {
  const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z);
  configure?.(desc);
  return world.createCollider(desc);
}
const wallAt = (world: RAPIER.World, z: number): RAPIER.Collider => box(world, 0, 5, z, 10, 5, 0.25);

function newWorld(build?: (world: RAPIER.World) => void): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  build?.(world);
  world.step();
  return world;
}

describe('probeSoundPath', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('finds open air clear', () => {
    const world = newWorld();
    expect(probeSoundPath(world, LISTENER, SOURCE)).toEqual(CLEAR_PATH);
  });

  it('counts one wall fully between as one solid, with no way round', () => {
    const world = newWorld((w) => { wallAt(w, 5); });
    expect(probeSoundPath(world, LISTENER, SOURCE)).toEqual({ solids: 1, earth: false, glass: 0, bent: false });
  });

  it('counts two walls as two solids', () => {
    const world = newWorld((w) => { wallAt(w, 4); wallAt(w, 8); });
    expect(probeSoundPath(world, LISTENER, SOURCE)).toMatchObject({ solids: 2, bent: false });
  });

  it('counts three walls as three, and caps four at MAX_COUNTED_SOLIDS', () => {
    const three = newWorld((w) => { wallAt(w, 3); wallAt(w, 6); wallAt(w, 9); });
    expect(probeSoundPath(three, LISTENER, SOURCE).solids).toBe(3);
    const four = newWorld((w) => { wallAt(w, 2); wallAt(w, 4); wallAt(w, 6); wallAt(w, 8); });
    const path = probeSoundPath(four, LISTENER, SOURCE);
    expect(path.solids).toBe(MAX_COUNTED_SOLIDS);
    expect(path.bent).toBe(false);
  });

  it('lets sound go round a thin post: bent, with no solids', () => {
    const world = newWorld((w) => { box(w, 0, 5, 5, 0.15, 5, 0.15); });
    expect(probeSoundPath(world, LISTENER, SOURCE)).toEqual({ solids: 0, earth: false, glass: 0, bent: true });
  });

  it('finds a wall with a gap clear when listener and source line up through it', () => {
    const world = newWorld((w) => {
      // Two pieces with a 1.2 m opening between x = -0.6 and x = 0.6.
      box(w, -5.6, 5, 5, 5, 5, 0.25);
      box(w, 5.6, 5, 5, 5, 5, 0.25);
    });
    expect(probeSoundPath(world, LISTENER, SOURCE)).toEqual(CLEAR_PATH);
  });

  it('does not count the wall a source stands just in front of', () => {
    // Wall face at z = 9.75; the source is 0.1 m in front of the wall's near face, on the listener's side.
    const world = newWorld((w) => { wallAt(w, 10); });
    expect(probeSoundPath(world, LISTENER, { x: 0, y: 1.6, z: 9.65 })).toEqual(CLEAR_PATH);
  });

  it('finds a source resting on a surface clear with the listener in line of sight', () => {
    const world = newWorld((w) => { box(w, 0, -0.5, 6, 30, 0.5, 30); });
    expect(probeSoundPath(world, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0.05, z: 8 })).toEqual(CLEAR_PATH);
    // A thing sitting on a table: the table top is under the source and does not count either.
    const tabled = newWorld((w) => { box(w, 0, 0.4, 8, 0.6, 0.4, 0.6); });
    expect(probeSoundPath(tabled, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0.85, z: 8 })).toEqual(CLEAR_PATH);
  });

  it('reports intact glass on an otherwise clear line as glass with no solids', () => {
    const world = newWorld();
    const calls: number[] = [];
    const path = probeSoundPath(world, LISTENER, SOURCE, { glassBetween: () => { calls.push(1); return 1; } });
    expect(path).toEqual({ solids: 0, earth: false, glass: 1, bent: false });
    expect(calls).toHaveLength(1);
  });

  it('ignores sensor colliders', () => {
    const world = newWorld((w) => { box(w, 0, 5, 5, 10, 5, 0.25, (desc) => desc.setSensor(true)); });
    expect(probeSoundPath(world, LISTENER, SOURCE)).toEqual(CLEAR_PATH);
  });

  it('ignores a kinematic body\'s collider (only fixed world fabric counts)', () => {
    const world = newWorld((w) => {
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 5, 5));
      w.createCollider(RAPIER.ColliderDesc.cuboid(10, 5, 0.25), body);
    });
    expect(probeSoundPath(world, LISTENER, SOURCE)).toEqual(CLEAR_PATH);
  });

  it('treats a dynamic body as no wall either', () => {
    const world = newWorld((w) => {
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.6, 5).setGravityScale(0));
      w.createCollider(RAPIER.ColliderDesc.cuboid(10, 5, 0.25), body);
    });
    expect(probeSoundPath(world, LISTENER, SOURCE)).toEqual(CLEAR_PATH);
  });

  it('skips a degenerate line (source at the listener) as clear', () => {
    const world = newWorld((w) => { wallAt(w, 0.2); });
    expect(probeSoundPath(world, LISTENER, { x: 0, y: 1.6, z: 0.3 })).toEqual(CLEAR_PATH);
    expect(probeSoundPath(world, LISTENER, LISTENER)).toEqual(CLEAR_PATH);
  });

  it('works whichever way the line points (a wall to the side, a source above)', () => {
    const world = newWorld((w) => { box(w, 5, 5, 0, 0.25, 5, 10); });
    expect(probeSoundPath(world, LISTENER, { x: 12, y: 1.6, z: 0 }).solids).toBe(1);
    const floor = newWorld((w) => { box(w, 0, 4, 0, 10, 0.25, 10); });
    expect(probeSoundPath(floor, LISTENER, { x: 0, y: 8, z: 0 }).solids).toBe(1);
  });

  it('turns a blocked wall into a quieter, duller voice through probeOcclusion', () => {
    const world = newWorld((w) => { wallAt(w, 5); });
    const occlusion = probeOcclusion(world, LISTENER, SOURCE);
    expect(occlusion.gain).toBeLessThan(1);
    expect(occlusion.blocked).toBe(1);
    expect(probeOcclusion(newWorld(), LISTENER, SOURCE).gain).toBe(1);
  });

  it('stays within its cast budget when the line is blocked and every bend too', () => {
    const world = newWorld((w) => { wallAt(w, 2); wallAt(w, 4); wallAt(w, 6); wallAt(w, 8); });
    const before = { ...probeStats };
    probeSoundPath(world, LISTENER, SOURCE);
    expect(probeStats.probes - before.probes).toBe(1);
    expect(probeStats.blocked - before.blocked).toBe(1);
    expect(probeStats.casts - before.casts).toBeLessThanOrEqual(MAX_CASTS);
  });

  it('counts at most MAX_CASTS casts for one probe through a blocked wall', () => {
    const world = newWorld((w) => { wallAt(w, 5); });
    probeStats.probes = 0;
    probeStats.casts = 0;
    probeStats.clear = 0;
    probeStats.bent = 0;
    probeStats.blocked = 0;
    probeSoundPath(world, LISTENER, SOURCE);
    expect(probeStats.probes).toBe(1);
    expect(probeStats.casts).toBeGreaterThan(0);
    expect(probeStats.casts).toBeLessThanOrEqual(MAX_CASTS);
    expect(MAX_CASTS).toBe(MAX_COUNTED_SOLIDS + 1 + 6);
  });

  it('costs well under a frame: microseconds per probe through one wall among 200 cuboids', () => {
    const world = newWorld((w) => {
      wallAt(w, 5);
      // About 200 cuboids scattered over a 100 m square, none on the line.
      for (let i = 0; i < 200; i++) {
        const x = ((i * 37) % 100) - 50, z = ((i * 53) % 100) - 50;
        if (Math.abs(x) < 4) continue;
        box(w, x, 1.5, z, 1, 1.5, 1);
      }
    });
    for (let i = 0; i < 100; i++) probeSoundPath(world, LISTENER, SOURCE);
    const runs = 2000;
    const start = performance.now();
    for (let i = 0; i < runs; i++) probeSoundPath(world, LISTENER, SOURCE);
    const micros = ((performance.now() - start) * 1000) / runs;
    console.log(`sound probe through one wall, ~200 cuboids: ${micros.toFixed(1)} microseconds per probe (${runs} probes)`);
    expect(micros).toBeLessThan(2000);
  });
});
