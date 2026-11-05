import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Player } from '../entities/Player.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { SoundEngine } from '../audio/SoundEngine.ts';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../core/config.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { GrenadeSystem } from '../combat/grenades/GrenadeSystem.ts';
import { predictArc, stepGrenade, type FlightParams } from '../combat/grenades/grenadeFlight.ts';
import { throwSegmentBlocked } from '../entities/ThrownGoose.ts';
import { AmmoDropManager } from '../entities/AmmoDropManager.ts';
import { visibility } from '../entities/enemies/playerVisibility.ts';
import { sampleHeight, setHeightOverride } from './TerrainGenerator.ts';
import {
  castRaySkippingCuts, clearUnderground, cutZoneUniforms, floorBelow, inCutZone, inUndergroundVolume, isTerrainCollider,
  isUnderground, pointInUndergroundVolume, registerTerrainCollider, registerUndergroundVolume, setCutZones, unregisterTerrainCollider,
} from './underground.ts';

const DT = 1 / 60;
const worlds: PhysicsWorld[] = [];
const zone = { cx: 0, cz: 0, halfX: 2.7, halfZ: 2.7 };
const volume = { minX: -8, maxX: 8, minZ: -8, maxZ: 8, floorY: -5, ceilY: -0.6 };

async function undergroundWorld() {
  const physics = await PhysicsWorld.create();
  worlds.push(physics);
  const terrain = physics.world.createCollider(RAPIER.ColliderDesc.heightfield(2, 2, new Float32Array(9), { x: 20, y: 1, z: 20 }));
  registerTerrainCollider(terrain.handle);
  const floor = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(8, 0.5, 8).setTranslation(0, -5.5, 0));
  physics.step(DT);
  return { physics, terrain, floor };
}

function playerAt(physics: PhysicsWorld, x: number): Player {
  return new Player(physics, new THREE.PerspectiveCamera(), new THREE.Vector3(x, PLAYER_HEIGHT / 2 + 0.1, 0),
    { onDamaged: () => {}, onFootstep: () => {} });
}

describe('underground terrain cuts', () => {
  beforeAll(async () => { await RAPIER.init(); });
  beforeEach(() => {
    clearUnderground();
    setHeightOverride(() => 0);
    setCutZones([zone]);
    registerUndergroundVolume(volume);
  });
  afterEach(() => {
    for (const physics of worlds) physics.dispose();
    worlds.length = 0;
    clearUnderground();
    setHeightOverride(null);
    vi.restoreAllMocks();
  });

  it('passes a heightfield through the cut and hits the box 5 m below, preserving ray distance', async () => {
    const { physics, floor } = await undergroundWorld();
    const hit = castRaySkippingCuts(physics.world, new RAPIER.Ray({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }), 10, true);
    expect(hit?.collider.handle).toBe(floor.handle);
    expect(hit?.timeOfImpact).toBeCloseTo(7, 4);
    expect(hit?.normal.y).toBeCloseTo(1);
    const shot = castHitscan(physics, new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0), 10);
    expect(shot?.point.y).toBeCloseTo(-5, 4);
  });

  it('still hits the heightfield outside the zone and when cuts are empty', async () => {
    const { physics, terrain } = await undergroundWorld();
    for (const x of [4, 0]) {
      if (x === 0) setCutZones([]);
      const hit = castRaySkippingCuts(physics.world, new RAPIER.Ray({ x, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }), 10, true);
      expect(hit?.collider.handle).toBe(terrain.handle);
      expect(hit?.timeOfImpact).toBeCloseTo(2);
    }
  });

  it('keeps exclusions, predicates, sensor flags and the remaining ray range', async () => {
    const { physics, floor } = await undergroundWorld();
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.1, 1).setTranslation(0, -2, 0).setSensor(true));
    physics.step(DT);
    const ray = new RAPIER.Ray({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 });
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    expect(castRaySkippingCuts(physics.world, ray, 6, true, flags)).toBeNull();
    expect(castRaySkippingCuts(physics.world, ray, 10, true, flags, undefined, floor)).toBeNull();
    expect(castRaySkippingCuts(physics.world, ray, 10, true, flags, undefined, undefined, undefined,
      (collider) => collider.handle !== floor.handle)).toBeNull();
    expect(castRaySkippingCuts(physics.world, ray, 10, true, flags)?.collider.handle).toBe(floor.handle);
  });

  it.each([0, 4])('the actual Player falls onto the appropriate floor at x = %s', async (x) => {
    const { physics } = await undergroundWorld();
    const player = playerAt(physics, x);
    const input = {
      consumeLookDelta: () => ({ dx: 0, dy: 0 }),
      getMoveVector: () => ({ x: 0, y: 0 }),
      isActionActive: () => false,
    } as unknown as InputManager;
    physics.step(DT);
    for (let frame = 0; frame < 180; frame++) {
      player.update(DT, input);
      physics.step(DT);
    }
    const floorY = x === 0 ? -5 : 0;
    expect(player.position.y).toBeCloseTo(floorY + PLAYER_HEIGHT / 2 + 0.05, 1);
  });

  it('returns the collider floor underground and sampleHeight outside, including under a volume ceiling', async () => {
    const { physics, floor } = await undergroundWorld();
    expect(floorBelow(physics.world, 0, 1, 0)).toBeCloseTo(-5);
    expect(floorBelow(physics.world, 4, -2, 0)).toBeCloseTo(-5);
    expect(floorBelow(physics.world, 4, 2, 0)).toBe(sampleHeight(4, 0));
    physics.world.removeCollider(floor, true);
    physics.step(DT);
    expect(floorBelow(physics.world, 4, -2, 0)).toBe(-5);
    expect(floorBelow(physics.world, 0, 1, 0)).toBe(-Infinity);
  });

  it('passes height to every grenade floor callback and rests and predicts on the underground box', async () => {
    const { physics } = await undergroundWorld();
    const floor = vi.fn((x: number, y: number, z: number) => floorBelow(physics.world, x, y, z));
    const params: FlightParams = { gravity: -9.81, restitution: 0, friction: 0, restSpeed: 0.5, radius: 0.1, floor };
    const body = { position: { x: 4, y: -4.85, z: 0 }, velocity: { x: 0, y: -1, z: 0 }, resting: false };
    stepGrenade(body, 0.05, () => null, params);
    expect(floor.mock.results[0]?.value).toBeCloseTo(-5);
    expect(body.position.y).toBeCloseTo(-4.9);
    expect(body.resting).toBe(true);
    stepGrenade(body, DT, () => null, params);
    expect(body.resting).toBe(true);
    const arc = predictArc({ x: 4, y: -2, z: 0 }, { x: 0, y: 0, z: 0 }, () => null, params, 2, DT);
    expect(arc.landing?.point.y).toBeCloseTo(-4.9);
    expect(floor.mock.calls.every(([, y, z]) => y < 0 && z === 0)).toBe(true);
  });

  it('a live grenade sweeps through the heightfield and settles on the box', async () => {
    const { physics } = await undergroundWorld();
    const system = new GrenadeSystem({
      physics, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), player: playerAt(physics, 4),
      enabled: true, kind: 'frag', network: null,
      sound: { playGrenadeBounce: () => {}, playGrenadeThrow: () => {} } as unknown as SoundEngine,
      targets: { applyBlast: () => {}, applyFlash: () => 0, notifyGunshot: () => {} },
      floor: (x, y, z) => floorBelow(physics.world, x, y, z),
      canStartThrow: () => true, onHandChange: () => {}, shootLampsNear: () => {},
    });
    try {
      system.receiveThrown({ type: 'grenadeThrown', senderSlot: 1, id: 'cut', kind: 'frag', origin: { x: 0, y: 1, z: 0 },
        velocity: { x: 0, y: -1, z: 0 }, fuseLeft: 10, t: 1 });
      for (let frame = 0; frame < 180; frame++) {
        physics.step(DT);
        system.update(DT, null);
      }
      const grenade = system.liveGrenades()[0];
      expect(grenade?.position.y).toBeGreaterThan(-5);
      expect(grenade?.position.y).toBeLessThan(-4.8);
      expect(grenade?.resting).toBe(true);
    } finally {
      system.dispose();
    }
  });

  it('thrown goose segments pass the cut but stop on the box', async () => {
    const { physics } = await undergroundWorld();
    expect(throwSegmentBlocked(physics.world, { x: 0, y: 1, z: 0 }, { x: 0, y: -2, z: 0 })).toBe(false);
    expect(throwSegmentBlocked(physics.world, { x: 0, y: 1, z: 0 }, { x: 0, y: -6, z: 0 })).toBe(true);
  });

  it('places an ammo drop on the floor at the anchor height', async () => {
    const { physics } = await undergroundWorld();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const drops = new AmmoDropManager(new THREE.Scene(), {}, (x, y, z) => floorBelow(physics.world, x, y, z));
    try {
      drops.update(1000, [new THREE.Vector3(4, -2, 0)], true);
      expect(drops.listForSync()[0]?.y).toBeCloseTo(-5);
    } finally {
      drops.dispose();
    }
  });

  it('keeps an underground player\'s ammo drops inside their volume, 1 m from its walls, on its floor', async () => {
    const { physics } = await undergroundWorld();
    const drops = new AmmoDropManager(new THREE.Scene(), {}, (x, y, z) => floorBelow(physics.world, x, y, z));
    try {
      for (const rolls of [0, 0.5, 0.999]) {
        drops.dispose();
        vi.spyOn(Math, 'random').mockReturnValue(rolls);
        // Anchor near a wall: the old 18 m disc landed out in the terrain or inside the wall.
        drops.update(1000, [new THREE.Vector3(7.5, -2, -7.5)], true);
        const drop = drops.listForSync()[0]!;
        expect(drop.x).toBeGreaterThanOrEqual(volume.minX + 1 - 1e-9);
        expect(drop.x).toBeLessThanOrEqual(volume.maxX - 1 + 1e-9);
        expect(drop.z).toBeGreaterThanOrEqual(volume.minZ + 1 - 1e-9);
        expect(drop.z).toBeLessThanOrEqual(volume.maxZ - 1 + 1e-9);
        expect(drop.y).toBeCloseTo(-5);
      }
    } finally {
      drops.dispose();
    }
  });

  it('samples volume points only for an anchor that is inside a volume', () => {
    expect(pointInUndergroundVolume(0, -2, 0, 0, 0)).toEqual({ x: -7, z: -7 });
    expect(pointInUndergroundVolume(0, -2, 0, 1, 1)).toEqual({ x: 7, z: 7 });
    expect(pointInUndergroundVolume(20, -2, 0, 0.5, 0.5)).toBeNull();
    expect(pointInUndergroundVolume(0, 5, 0, 0.5, 0.5)).toBeNull();
    expect(inUndergroundVolume(0, -2, 0)).toBe(true);
    expect(inUndergroundVolume(0, 5, 0)).toBe(false);
  });

  it('treats underground visibility exactly like an unlit room, preserving light overrides and Facility', () => {
    for (const map of ['valley', 'facility'] as const) for (const weather of ['day', 'night', 'fog'] as const) {
      for (const overrides of [{}, { flashLit: true }, { secondsSinceShot: 0.1 }, { torchOn: true, enemyInTorchBeam: true }]) {
        const inputs = { map, weather, secondsSinceShot: 10, torchOn: false, enemyInTorchBeam: false, ...overrides };
        // Underground is an unlit room in every Valley weather, Dusk too (a house room is dark only
        // at night and in fog); the Facility ignores it.
        const unlitRoom = map === 'valley' && weather === 'day'
          ? visibility({ ...inputs, weather: 'night', houseRoomLit: false })
          : visibility({ ...inputs, houseRoomLit: false });
        expect(visibility({ ...inputs, underground: true })).toBe(unlitRoom);
      }
    }
  });

  it('updates shared uniforms and clears all match state', () => {
    const uniforms = cutZoneUniforms.uCutZones;
    expect(Array.from(uniforms.value).slice(0, 4)).toEqual([0, 0, expect.closeTo(2.7), expect.closeTo(2.7)]);
    expect(inCutZone(2.7 - PLAYER_RADIUS + 0.01, 0, PLAYER_RADIUS)).toBe(false);
    expect(isUnderground(4, -5.5, 0)).toBe(true);
    expect(isUnderground(4, -5.51, 0)).toBe(false);
    expect(isUnderground(0, 3.2, 0)).toBe(false);
    registerTerrainCollider(123);
    unregisterTerrainCollider(123);
    expect(isTerrainCollider(123)).toBe(false);
    registerTerrainCollider(456);
    clearUnderground();
    expect(cutZoneUniforms.uCutZones).toBe(uniforms);
    expect(cutZoneUniforms.uCutZoneCount.value).toBe(0);
    expect(inCutZone(0, 0)).toBe(false);
    expect(isUnderground(4, -2, 0)).toBe(false);
    expect(isTerrainCollider(456)).toBe(false);
  });
});
