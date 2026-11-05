import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GRAVITY, PLAYER_HEIGHT, PLAYER_MOVE_SPEED, PLAYER_RADIUS } from '../core/config.ts';
import { setWorldSeedForTesting } from '../core/worldSeed.ts';
import { buildLabInterior, createLabInteriorVisual, type LabInteriorKind } from './labInterior.ts';
import { boxMatrix, createBoxCollider, type BoxTransform } from './structureKit.ts';
import { setHeightOverride } from './TerrainGenerator.ts';
import { buildTowerLab } from './towerUnderground.ts';

beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { setHeightOverride(null); setWorldSeedForTesting(1337); });

function corners(b: BoxTransform): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    points.push(b.halfExtents.clone().multiply(new THREE.Vector3(x, y, z)).applyMatrix4(boxMatrix(b)));
  }
  return points;
}

describe('lab interior descriptions', () => {
  for (const kind of ['full', 'compact', 'ground'] as const) {
    it(`keeps every ${kind} solid and detail within the usable volume, including animation`, () => {
      const width = kind === 'full' ? 12.7 : kind === 'compact' ? 4.7 : 2.7;
      const far = kind === 'full' ? -17.7 : kind === 'compact' ? -7.7 : -2.7;
      const near = kind === 'ground' ? 2.7 : -0.3;
      const volume = new THREE.Box3(new THREE.Vector3(-width - 1e-6, -1e-6, far - 1e-6),
        new THREE.Vector3(width + 1e-6, kind === 'ground' ? 2.95 : 6, near + 1e-6));
      for (let seed = 0; seed < 32; seed++) {
        const design = buildLabInterior(kind, seed);
        for (const part of [...design.parts, ...design.details]) {
          const bob = 'bob' in part ? part.bob : 0;
          const bounds = new THREE.Box3().setFromPoints(corners(part.box));
          bounds.min.y -= bob; bounds.max.y += bob;
          expect(volume.containsBox(bounds), `${kind} seed ${seed}: ${part.material} at ${part.box.center.toArray()}`).toBe(true);
        }
        for (const part of design.parts.filter(p => p.rail)) expect(part.box.halfExtents.x).toBeGreaterThan(part.box.halfExtents.z);
      }
    });
  }

  it('repeats exactly per seed, varying the cracked tank and specimen shapes', () => {
    for (const kind of ['full', 'compact'] as const) {
      const cracked = new Set<number>(), bodies = new Set<string>();
      for (let seed = 0; seed < 12; seed++) {
        const design = buildLabInterior(kind, seed);
        expect(buildLabInterior(kind, seed)).toEqual(design);
        cracked.add(design.crackedTank);
        bodies.add(JSON.stringify(design.details.filter(p => p.material === 'cladding')));
        const tanks = design.parts.filter(p => p.material === 'glass' && p.box.halfExtents.y === 1.3);
        expect(tanks.length).toBeGreaterThanOrEqual(4);
        expect(tanks.length).toBeLessThanOrEqual(6);
        expect(design.details.filter(p => p.material === 'inner-steel' && p.shape === 'cylinder')).toHaveLength(tanks.length - 1);
        expect(design.lamps).toHaveLength(kind === 'full' ? 4 : 1);
      }
      expect(cracked.size).toBeGreaterThan(1);
      expect(bodies.size).toBe(12);
    }
  });

  for (const kind of ['full', 'compact'] as const) {
    it(`merges ${kind} and ground props into at most 16 meshes with shared animation`, () => {
      const visual = createLabInteriorVisual([
        { design: buildLabInterior(kind, 17), matrix: new THREE.Matrix4() },
        { design: buildLabInterior('ground', 17), matrix: new THREE.Matrix4().makeTranslation(0, 10, 0) },
      ]);
      try {
        const meshes = visual.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
        expect(meshes.length).toBeLessThanOrEqual(16);
        expect(new Set(meshes.map(mesh => mesh.material)).size).toBe(meshes.length);
        expect(new Set(meshes.map(mesh => mesh.onBeforeRender)).size).toBe(1);
        expect(visual.group.children.every(child => child instanceof THREE.Mesh)).toBe(true);
        for (const mesh of meshes) {
          expect(mesh.geometry.groups).toHaveLength(0);
          expect(mesh.geometry.getAttribute('labMotion').count).toBe(mesh.geometry.getAttribute('position').count);
        }
        const skin = meshes.find(m => m.name === 'lab-skin')!;
        const motion = skin.geometry.getAttribute('labMotion');
        expect(Array.from(motion.array).some((value, i) => i % 2 === 0 && value > 0)).toBe(true);
        expect(Array.from(motion.array).some((value, i) => i % 2 === 0 && value === 0)).toBe(true);
        const bulb = meshes.find(m => m.name === 'lab-caged-bulb')!.material;
        visual.update(0);
        const dark = bulb.emissiveIntensity;
        visual.update(0.1);
        expect(bulb.emissiveIntensity).not.toBe(dark);
        const positions = skin.geometry.getAttribute('position').array;
        visual.update(5);
        expect(skin.geometry.getAttribute('position').array).toBe(positions);
      } finally { visual.dispose(); }
    });
  }
});

describe('furnished lab routes', () => {
  for (const orientation of ['south', 'west', 'north'] as const) for (const kind of ['full', 'compact'] as const) {
    for (const flights of [3, 4, 5]) it(`walks to every ${kind} room and back, ${orientation}, ${flights} flights`, () => {
      setHeightOverride(() => 0);
      // Opposite world positions exercise both extremes of the full shell's sliding entrance.
      for (const side of [-1, 1]) {
        const lab = buildTowerLab(0, { x: side * 100, z: side * 100 }, orientation, flights, kind);
        const placement = lab.interiors.find(p => p.design.kind === kind)!;
        const inverse = placement.matrix.clone().invert();
        const entranceX = lab.route[lab.route.length - 1]!.clone().applyMatrix4(inverse).x;
        const toTower = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(placement.matrix);
        const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
        try {
          const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
          for (const part of lab.parts) createBoxCollider(world, fixed, part.box);
          const atDoor = toTower(entranceX, PLAYER_HEIGHT / 2 + 0.1, 0.5);
          const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(atDoor.x, atDoor.y, atDoor.z));
          const capsule = world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS), body);
          const controller = world.createCharacterController(0.05);
          controller.setMaxSlopeClimbAngle(Math.PI / 4);
          controller.setMinSlopeSlideAngle(35 * Math.PI / 180);
          controller.enableAutostep(0.5, 0.2, true);
          controller.enableSnapToGround(0.3);
          let velocity = 0;
          world.step();
          const walk = (targets: THREE.Vector3[]) => {
            for (const target of targets) {
              for (let frame = 0; frame < 600; frame++) {
                const at = body.translation(), dx = target.x - at.x, dz = target.z - at.z;
                const distance = Math.hypot(dx, dz), stride = Math.min(distance, PLAYER_MOVE_SPEED / 60);
                velocity += GRAVITY / 60;
                controller.computeColliderMovement(capsule, { x: distance ? dx / distance * stride : 0, y: velocity / 60, z: distance ? dz / distance * stride : 0 });
                const move = controller.computedMovement();
                if (controller.computedGrounded() && velocity < 0) velocity = 0;
                body.setNextKinematicTranslation({ x: at.x + move.x, y: at.y + move.y, z: at.z + move.z });
                world.step();
                if (distance < 0.08 && Math.abs(at.y - PLAYER_HEIGHT / 2 - target.y) < 0.15) break;
              }
              const at = body.translation();
              expect(Math.hypot(at.x - target.x, at.z - target.z), `target ${target.toArray()}`).toBeLessThan(0.15);
              expect(Math.abs(at.y - PLAYER_HEIGHT / 2 - target.y)).toBeLessThan(0.2);
            }
          };
          for (const room of placement.design.rooms) {
            const route = [toTower(entranceX, 0, -1.7), toTower(0, 0, -1.7), toTower(0, 0, room.z), room.clone().applyMatrix4(placement.matrix)];
            walk(route);
            walk(route.reverse().concat(toTower(entranceX, 0, 0.5)));
          }
          if (kind === 'full') {
            const route = [toTower(entranceX, 0, -1.7), toTower(0, 0, -1.7), toTower(0, 0, -10),
              toTower(-11, 0, -10), toTower(-11, 0.18, -12.9), toTower(-11, 1.5, -16.9), toTower(0, 1.5, -16.9)];
            walk(route);
            walk(route.reverse());
          }
          // Glass remains a solid shot blocker, including the visibly cracked vessel.
          for (const tank of placement.design.parts.filter(p => p.material === 'glass' && p.box.halfExtents.y === 1.3)) {
            const origin = tank.box.center.clone().add(new THREE.Vector3(0, 0, 1)).applyMatrix4(placement.matrix);
            const direction = new THREE.Vector3(0, 0, -1).transformDirection(placement.matrix);
            const hit = world.castRay(new RAPIER.Ray(origin, direction), 2, true, undefined, undefined, capsule);
            expect(hit?.timeOfImpact).toBeCloseTo(0.4, 4);
          }
        } finally { world.free(); }
      }
    });
  }

  it('keeps a 2.4 m route clear of furniture from every entrance to each room', () => {
    for (const kind of ['full', 'compact'] as const satisfies readonly LabInteriorKind[]) {
      const design = buildLabInterior(kind, 42);
      for (const entry of kind === 'full' ? [-11.5, 0, 11.5] : [0]) for (const room of design.rooms) {
        const points = [new THREE.Vector3(entry, 0, -0.3), new THREE.Vector3(entry, 0, -1.7),
          new THREE.Vector3(0, 0, -1.7), new THREE.Vector3(0, 0, room.z), room];
        for (let i = 1; i < points.length; i++) {
          const corridor = new THREE.Box3().setFromPoints([points[i - 1]!, points[i]!]);
          corridor.min.add(new THREE.Vector3(-1.2, 0.01, -1.2));
          corridor.max.add(new THREE.Vector3(1.2, 2.3, 1.2));
          for (const part of design.parts) expect(new THREE.Box3().setFromPoints(corners(part.box)).intersectsBox(corridor)).toBe(false);
        }
      }
    }
  });

  it('places interior parts and lamps in the shell frame for all orientations', () => {
    setHeightOverride(() => 13);
    for (const orientation of ['south', 'west', 'north'] as const) {
      const lab = buildTowerLab(2, { x: 31, z: -20 }, orientation, 3);
      let index = lab.shellPartCount;
      for (const { design, matrix } of lab.interiors) {
        for (const part of design.parts) {
          const actual = lab.parts[index++]!;
          const expected = corners(part.box).map(p => p.applyMatrix4(matrix));
          for (const p of corners(actual.box)) expect(expected.some(q => q.distanceTo(p) < 1e-6)).toBe(true);
        }
        for (const lamp of design.lamps) {
          const world = lamp.clone().applyMatrix4(matrix).add(new THREE.Vector3(lab.x, lab.groundY, lab.z));
          expect(lab.lamps.some(p => p.distanceTo(world) < 1e-6)).toBe(true);
        }
      }
      expect(index).toBe(lab.parts.length);
    }
  });
});
