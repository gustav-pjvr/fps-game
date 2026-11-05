import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GRAVITY, JUMP_SPEED, PLAYER_HEIGHT, PLAYER_MOVE_SPEED, PLAYER_RADIUS, SPRINT_MULTIPLIER, WATCH_TOWER_COUNT, WORLD_EDGE_RAMP_START } from '../core/config.ts';
import { setWorldSeedForTesting } from '../core/worldSeed.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { isNetworkMessage } from '../network/protocol.ts';
import { FacilityInteraction } from '../core/facilityInteraction.ts';
import { houseKey, houseObjectId, parseHouseObjectId, towerDoorId, towerIndexFromDoorId } from './houses/valleyHouseIds.ts';
import { ValleyDoors } from './houses/ValleyDoors.ts';
import { createBoxCollider } from './structureKit.ts';
import { sampleHeight, setHeightOverride } from './TerrainGenerator.ts';
import { towerParts, type TowerOrientation } from './towerDesign.ts';
import { buildTowerLab, computeTowerLabs, type LabVolume } from './towerUnderground.ts';
import { clearUnderground, inCutZone, isTerrainCollider, registerTerrainCollider, setCutZones } from './underground.ts';
import { getWatchTowerPositions, WatchTowerManager } from './WatchTowerManager.ts';

const DT = 1 / 60;
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { clearUnderground(); setHeightOverride(null); setWorldSeedForTesting(1337); });

function separation(a: LabVolume, b: LabVolume): number {
  const dx = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
  const dz = Math.max(a.minZ, b.minZ) - Math.min(a.maxZ, b.maxZ);
  return Math.hypot(Math.max(0, dx), Math.max(0, dz));
}

describe('tower lab solver', () => {
  it('covers and separates every lab over 500 seeds, reporting fallback rates', () => {
    const counts = { full: 0, compact: 0, 'dead-end': 0 };
    for (let seed = 1; seed <= 500; seed++) {
      setWorldSeedForTesting(seed);
      const labs = computeTowerLabs();
      expect(computeTowerLabs()).toBe(labs);
      expect(labs).toHaveLength(WATCH_TOWER_COUNT);
      for (const [index, lab] of labs.entries()) {
        counts[lab.kind]++;
        expect(lab.flights).toBeLessThanOrEqual(5);
        expect({ x: lab.x, z: lab.z }).toEqual(getWatchTowerPositions()[index]);
        const first = lab.route[3]!, end = lab.route[4]!;
        expect(Math.abs(first.x - end.x) < 1e-6 ? first.x < 0 : Math.abs(first.z) > 1).toBe(true);
        for (const rect of lab.footprints) {
          for (const x of [rect.minX, rect.maxX]) for (const z of [rect.minZ, rect.maxZ]) {
            expect(Math.hypot(x, z)).toBeLessThan(WORLD_EDGE_RAMP_START);
          }
          let minimum = Infinity;
          const nx = Math.ceil(rect.maxX - rect.minX + 2), nz = Math.ceil(rect.maxZ - rect.minZ + 2);
          for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
            minimum = Math.min(minimum, sampleHeight(Math.min(rect.minX - 1 + ix, rect.maxX + 1), Math.min(rect.minZ - 1 + iz, rect.maxZ + 1)));
          }
          expect(minimum - rect.ceilY, `cover seed ${seed}, tower ${index}`).toBeGreaterThanOrEqual(1 - 1e-6);
          for (const previous of labs.slice(0, index)) for (const other of previous.footprints) {
            const clear = separation(rect, other) >= 4 || (Math.abs(rect.floorY - other.floorY) >= 8 &&
              (rect.ceilY < other.floorY || other.ceilY < rect.floorY));
            if (!clear) expect.fail(`clearance seed ${seed}, towers ${index} and ${previous.index}`);
          }
        }
        expect(lab.parts.every(part => !part.rail || part.box.halfExtents.x > part.box.halfExtents.z)).toBe(true);
      }
    }
    console.info('Tower lab fallback rate:', { ...counts, fallbackPercent: 100 * (counts.compact + counts['dead-end']) / (500 * WATCH_TOWER_COUNT) });
    expect(counts.full / (500 * WATCH_TOWER_COUNT)).toBeGreaterThanOrEqual(0.95);
  // The independent terrain and clearance sweep has taken 64 s in the parallel full suite.
  // Keep all 500 seeds and allow for contention with the procedural texture tests.
  }, 180000);
});

describe('tower flight headroom', () => {
  for (const orientation of ['south', 'west', 'north'] as const) for (const flights of [3, 4, 5]) {
    it(`keeps 2.3 m above every capsule position on ${flights} flights facing ${orientation}`, () => {
      setHeightOverride(() => 0);
      const lab = buildTowerLab(0, { x: 0, z: 0 }, orientation, flights);
      const ceilings = [...lab.ceilingParts.map(index => lab.parts[index]!.box), towerParts(orientation)[0]!.box].map(box => ({
        inverse: new THREE.Matrix4().compose(box.center, box.rotation, new THREE.Vector3(1, 1, 1)).invert(),
        bounds: new THREE.Box3(box.halfExtents.clone().negate(), box.halfExtents),
      }));
      let minimum = Infinity;
      for (const { start, end } of lab.flightSurfaces) {
        const delta = end.clone().sub(start), steps = Math.ceil(delta.length() / 0.1);
        const across = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
        for (let i = 0; i <= steps; i++) for (const lateral of [-0.45, 0, 0.45]) {
          const surface = start.clone().addScaledVector(delta, i / steps).addScaledVector(across, lateral);
          // Include the capsule's footprint across tile edges, not just its centre line.
          for (let edge = -1; edge < 16; edge++) {
            const origin = surface.clone();
            let clearance = Infinity;
            if (edge >= 0) origin.add(new THREE.Vector3(Math.cos(edge * Math.PI / 8), 0, Math.sin(edge * Math.PI / 8)).multiplyScalar(PLAYER_RADIUS));
            for (const ceiling of ceilings) {
              const ray = new THREE.Ray(origin.clone(), new THREE.Vector3(0, 1, 0)).applyMatrix4(ceiling.inverse);
              const hit = ray.intersectBox(ceiling.bounds, new THREE.Vector3());
              if (hit) clearance = Math.min(clearance, hit.distanceTo(ray.origin));
            }
            if (!Number.isFinite(clearance)) expect.fail(`Missing ceiling over ${JSON.stringify(origin)}`);
            minimum = Math.min(minimum, clearance);
          }
        }
      }
      expect(minimum).toBeGreaterThanOrEqual(2.3 - 1e-6);
    });
  }
});

async function walkWorld(orientation: TowerOrientation, flights: number, kind: 'full' | 'compact' | 'dead-end' = 'full') {
  setHeightOverride(() => 0);
  const physics = await PhysicsWorld.create();
  const terrain = physics.world.createCollider(RAPIER.ColliderDesc.heightfield(2, 2, new Float32Array(9), { x: 120, y: 1, z: 120 }));
  registerTerrainCollider(terrain.handle);
  setCutZones([{ cx: 0, cz: 0, halfX: 2.7, halfZ: 2.7 }]);
  const lab = buildTowerLab(0, { x: 0, z: 0 }, orientation, flights, kind);
  const tower = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const colliderParts = new Map<number, { source: string; index: number; box: (typeof lab.parts)[number]['box'] }>();
  for (const [source, parts] of [['tower', towerParts(orientation)], ['lab', lab.parts]] as const) {
    parts.forEach((part, index) => {
      const collider = createBoxCollider(physics.world, tower, part.box);
      colliderParts.set(collider.handle, { source, index, box: part.box });
    });
  }
  const doors = new ValleyDoors(new THREE.Scene(), physics.world, () => null);
  doors.addDoor(towerDoorId(0), { x: 3, y: 0, z: 0, axis: 'x', side: -1, width: 1.2, height: 2.2 });
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(4, PLAYER_HEIGHT / 2 + 0.1, 0));
  const collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS), body);
  const controller = physics.world.createCharacterController(0.05);
  controller.setMaxSlopeClimbAngle(45 * Math.PI / 180);
  controller.setMinSlopeSlideAngle(35 * Math.PI / 180);
  controller.enableAutostep(0.5, 0.2, true);
  controller.enableSnapToGround(0.3);
  let verticalVelocity = 0;
  const step = (dx: number, dz: number) => {
    verticalVelocity += GRAVITY * DT;
    const at = body.translation(), speed = PLAYER_MOVE_SPEED * SPRINT_MULTIPLIER * DT;
    controller.computeColliderMovement(collider, { x: dx * speed, y: verticalVelocity * DT, z: dz * speed }, undefined, undefined,
      inCutZone(at.x, at.z, PLAYER_RADIUS) ? c => !isTerrainCollider(c.handle) : undefined);
    const moved = controller.computedMovement();
    if (controller.computedGrounded() && verticalVelocity < 0) verticalVelocity = 0;
    body.setNextKinematicTranslation({ x: at.x + moved.x, y: at.y + moved.y, z: at.z + moved.z });
    physics.step(DT);
  };
  const walk = (route: THREE.Vector3[]) => {
    for (const [i, target] of route.entries()) {
      for (let frame = 0; frame < 300; frame++) {
        const at = body.translation(), dx = target.x - at.x, dz = target.z - at.z, distance = Math.hypot(dx, dz);
        if (distance < 0.13) break;
        step(dx / distance * Math.min(1, distance / 0.15), dz / distance * Math.min(1, distance / 0.15));
      }
      const at = body.translation();
      if (Math.hypot(at.x - target.x, at.z - target.z) >= 0.2) {
        for (let contact = 0; contact < controller.numComputedCollisions(); contact++) {
          const collision = controller.computedCollision(contact)!;
          const part = collision.collider ? colliderParts.get(collision.collider.handle) : undefined;
          console.info('Stalled walker collision', { orientation, flights, waypoint: i, at, source: part?.source, index: part?.index,
            center: part?.box.center, halfExtents: part?.box.halfExtents, normal: collision.normal1 });
        }
      }
      expect(Math.hypot(at.x - target.x, at.z - target.z), `${orientation} ${flights}, waypoint ${i}: ${JSON.stringify(at)} -> ${JSON.stringify(target)}`).toBeLessThan(0.2);
      expect(Math.abs(at.y - PLAYER_HEIGHT / 2 - target.y), `height at waypoint ${i}`).toBeLessThan(0.45);
    }
  };
  physics.step(DT);
  const place = (surface: THREE.Vector3) => {
    const at = { x: surface.x, y: surface.y + PLAYER_HEIGHT / 2 + 0.2, z: surface.z };
    body.setTranslation(at, true);
    body.setNextKinematicTranslation(at);
    verticalVelocity = 0;
    for (let frame = 0; frame < 30; frame++) step(0, 0);
  };
  const jump = () => { verticalVelocity = JUMP_SPEED; };
  return { physics, lab, doors, body, step, walk, place, jump };
}

describe('tower underground enclosure', () => {
  for (const orientation of ['south', 'west', 'north'] as const) for (const [kind, flights] of [
    ['full', 3], ['full', 4], ['full', 5], ['compact', 3], ['dead-end', 1],
  ] as const) {
    it(`contains sideways and diagonal jumps from every ${kind} flight and landing, ${orientation}, ${flights} flights`, async () => {
      const { physics, lab, doors, body, step, place, jump } = await walkWorld(orientation, flights, kind);
      try {
        const sites = [...lab.route, ...lab.flightSurfaces.flatMap(({ start, end }) =>
          [0.25, 0.5, 0.75].map(t => start.clone().lerp(end, t)))];
        for (const site of sites) for (let direction = 0; direction < 8; direction++) {
          place(site);
          jump();
          let lowest = body.translation().y;
          for (let frame = 0; frame < 180; frame++) {
            step(Math.cos(direction * Math.PI / 4), Math.sin(direction * Math.PI / 4));
            lowest = Math.min(lowest, body.translation().y);
          }
          expect(lowest, `jump at ${JSON.stringify(site)}, direction ${direction}`).toBeGreaterThanOrEqual(lab.floorY - 1);
        }
      } finally { doors.dispose(); physics.dispose(); }
    }, 30000);

    it(`has no upward or sideways opening along the ${kind} route, ${orientation}, ${flights} flights`, async () => {
      const { physics, lab, doors } = await walkWorld(orientation, flights, kind);
      try {
        const directions = [new THREE.Vector3(0, 1, 0), ...Array.from({ length: 8 }, (_, i) =>
          new THREE.Vector3(Math.cos(i * Math.PI / 4), 0, Math.sin(i * Math.PI / 4)))];
        for (let segment = 1; segment < lab.route.length; segment++) {
          const from = lab.route[segment - 1]!, to = lab.route[segment]!;
          const samples = Math.max(1, Math.ceil(from.distanceTo(to) / 0.25));
          for (let i = 0; i <= samples; i++) {
            const origin = from.clone().lerp(to, i / samples).add(new THREE.Vector3(0, PLAYER_HEIGHT / 2, 0));
            for (const direction of directions) {
              const ceiling = inCutZone(origin.x, origin.z) ? 3 : 0;
              const limit = direction.y > 0 ? ceiling - origin.y : 100;
              const hit = physics.world.castRay(new RAPIER.Ray(origin, direction), limit + 1e-4, true,
                RAPIER.QueryFilterFlags.ONLY_FIXED, undefined, undefined, undefined, c => !isTerrainCollider(c.handle));
              expect(hit, `open shell at ${JSON.stringify(origin)} toward ${JSON.stringify(direction)}`).not.toBeNull();
              if (direction.y > 0) expect(hit!.timeOfImpact).toBeLessThanOrEqual(limit + 1e-4);
            }
          }
        }
      } finally { doors.dispose(); physics.dispose(); }
    });
  }
});

describe('tower underground walking and doors', () => {
  for (const orientation of ['south', 'west', 'north'] as const) for (const flights of [3, 4, 5]) {
    it(`walks down and up ${flights} flights facing ${orientation}, with a real terrain cut and a blocking door`, async () => {
      const { physics, lab, doors, body, step, walk } = await walkWorld(orientation, flights);
      try {
        for (let i = 0; i < 90; i++) step(-1, 0);
        expect(body.translation().x).toBeGreaterThan(3.4);
        doors.set('door', towerDoorId(0), true, true);
        const route = [new THREE.Vector3(1, 0.05, 0), ...lab.route];
        walk(route);
        for (let i = 0; i < 30; i++) step(0, 0);
        expect(body.translation().y - PLAYER_HEIGHT / 2).toBeCloseTo(lab.floorY, 0);
        walk([...route].reverse().slice(1).concat(new THREE.Vector3(4, 0, 0)));
        expect(body.translation().y).toBeGreaterThan(0.8);
      } finally { doors.dispose(); physics.dispose(); }
    });
  }

  it('allocates disjoint ids, syncs unloaded doors to late joiners, and never lets enemies open them', () => {
    const lastHouse = houseObjectId(houseKey({ gx: 2047, gz: 2047, index: 63 }), 3);
    for (let index = 0; index < WATCH_TOWER_COUNT; index++) {
      const id = towerDoorId(index);
      expect(id).toBeGreaterThan(lastHouse);
      expect(towerIndexFromDoorId(id)).toBe(index);
      expect(parseHouseObjectId(id)).toBeNull();
      expect(isNetworkMessage({ type: 'worldInteract', kind: 'door', id })).toBe(true);
    }
    for (const id of [-1, lastHouse, towerDoorId(0) + WATCH_TOWER_COUNT, NaN, Infinity, towerDoorId(0) + 0.5]) expect(towerIndexFromDoorId(id)).toBeNull();
    expect(houseObjectId(lastHouse, 0)).toBe(-1);
    for (const index of [-1, 4, 0.5, NaN]) expect(towerDoorId(index)).toBe(-1);
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    const host = new ValleyDoors(new THREE.Scene(), world, () => null);
    const guestWorld = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    const guest = new ValleyDoors(new THREE.Scene(), guestWorld, () => null);
    try {
      const id = towerDoorId(0);
      expect(host.set('door', id, true)).toBe(true);
      const wire = host.wire();
      expect(isNetworkMessage({ type: 'worldObjectState', ...wire })).toBe(true);
      expect(guest.parseWire(wire)).toEqual(wire);
      guest.applyWire(wire, true);
      expect(guest.state.isActive('door', id)).toBe(true);
      expect(guest.parseWire({ doors: '', breakers: '', valleyDoors: [id + 4] })).toBeNull();
      // The gate needs only its authority and door lookup on this branch.
      const interaction = new FacilityInteraction({ objects: { closedDoorAhead: () => id }, multiplayer: null } as unknown as ConstructorParameters<typeof FacilityInteraction>[0]);
      for (let i = 0; i < 600; i++) expect(interaction.enemyGate(1, 4, 0, -1, 0, DT)).toBe(true);
    } finally { host.dispose(); guest.dispose(); world.free(); guestWorld.free(); }
  });

  it('streams underground colliders and the shared door with the tower, preserving open state', async () => {
    setWorldSeedForTesting(17);
    const physics = await PhysicsWorld.create(), scene = new THREE.Scene();
    const doors = new ValleyDoors(scene, physics.world, () => null);
    const manager = WatchTowerManager.create(scene, physics);
    try {
      const baseline = physics.world.colliders.len();
      manager.placeForChunk(0, 0, -100, -100, 200);
      const loaded = physics.world.colliders.len();
      expect(doors.debugDoors()).toHaveLength(4);
      expect(loaded).toBeGreaterThan(baseline);
      doors.set('door', towerDoorId(0), true, true);
      manager.placeForChunk(0, 0, -100, -100, 200);
      expect(physics.world.colliders.len()).toBe(loaded);
      manager.removeChunk(0, 0);
      expect(physics.world.colliders.len()).toBe(baseline);
      expect(doors.debugDoors()).toHaveLength(0);
      manager.placeForChunk(0, 0, -100, -100, 200);
      expect(doors.debugDoors().find(d => d.id === towerDoorId(0))?.collider).toBe(false);
      manager.removeChunk(0, 0);
    } finally { doors.dispose(); physics.dispose(); }
  });
});
