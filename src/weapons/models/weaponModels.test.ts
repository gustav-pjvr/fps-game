import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_NEAR } from '../../core/config.ts';
import { GUN_TRACK } from '../animation/clips.ts';
import { ARM_PART_PREFIX, type WeaponBlueprint } from './kit/GunBuilder.ts';
import { triangleCount } from './kit/geometry.ts';
import { SIGHT_CLEAR_TANGENT } from './kit/sights.ts';
import { WEAPON_MODEL_BUILDERS } from './registry.ts';
import { getSkinMaterials } from './skinMaterials.ts';
import { SKIN_IDS, SKINS, type SkinId } from './skins.ts';
import { buildWeaponViewModel, createWeaponModel, getWeaponBlueprint } from './weaponModels.ts';
import { WEAPON_ADS_POSITION, WEAPON_HIP_POSITION } from '../viewModel.ts';

/** Blades never aim, so they have no line of aim to keep clear. */
const BLADES = new Set(['knife', 'karambit', 'machete', 'tanto', 'hatchet', 'spike']);
const WEAPON_IDS = Object.keys(WEAPON_MODEL_BUILDERS);

/** One draw call per part and material. Budgets hold the cost of a detailed model down: the old
 * box-built arsenal drew up to 26 meshes of about 500 triangles in all. */
const MAX_DRAW_CALLS = 26;
const MAX_TRIANGLES = 16000;
/** Anything nearer than this is behind the camera's near plane (core/config.ts CAMERA_NEAR) and never drawn. */
const NEAR = CAMERA_NEAR;

function blueprintOrNull(id: string, skinId: SkinId): WeaponBlueprint | null {
  try {
    return getWeaponBlueprint(id, skinId);
  } catch (error) {
    if (String(error).includes('not built yet')) return null;
    throw error;
  }
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root.traverse((object) => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}

/** The view model at full aim: at its aim pose, with the retracting parts slid back. */
function aimed(id: string, skinId: SkinId) {
  const model = buildWeaponViewModel(id, skinId);
  model.group.position.copy(model.adsPosition);
  for (const [part, distance] of Object.entries(model.aimRetract)) model.parts.get(part)!.position.z += distance;
  model.group.updateMatrixWorld(true);
  return model;
}

const vertex = new THREE.Vector3();
function eachVertex(mesh: THREE.Mesh, visit: (v: THREE.Vector3) => void): void {
  const position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) visit(vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
}

describe('weapon models', () => {
  it('has every weapon built (no stubs left)', () => {
    const missing = WEAPON_IDS.filter((id) => blueprintOrNull(id, 'service') === null);
    expect(missing).toEqual([]);
  });

  for (const id of WEAPON_IDS) {
    describe(id, () => {
      const built = blueprintOrNull(id, 'service') !== null;
      const check = built ? it : it.skip;

      for (const skinId of SKIN_IDS) {
        check(`${skinId}: sound geometry inside the draw call and triangle budgets`, () => {
          const blueprint = getWeaponBlueprint(id, skinId);
          let triangles = 0;
          for (const mesh of blueprint.meshes) {
            const { geometry } = mesh;
            expect(geometry.index, `${mesh.name} is non-indexed`).toBeNull();
            const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
            expect(position.count, mesh.name).toBeGreaterThan(0);
            expect(normal.count).toBe(position.count);
            expect(uv.count).toBe(position.count);
            for (const value of position.array as Float32Array) expect(Number.isFinite(value), `${mesh.name} position`).toBe(true);
            for (let i = 0; i < normal.count; i += 7) {
              expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)), `${mesh.name} normal ${i}`).toBeCloseTo(1, 2);
            }
            triangles += triangleCount(geometry);
          }
          expect(blueprint.meshes.length, 'draw calls with arms').toBeLessThanOrEqual(MAX_DRAW_CALLS);
          expect(triangles, 'triangles with arms').toBeLessThanOrEqual(MAX_TRIANGLES);
          const partNames = new Set(blueprint.parts.map((part) => part.name));
          for (const clip of Object.values(blueprint.animations)) {
            for (const track of Object.keys(clip.tracks)) {
              expect(track === GUN_TRACK || partNames.has(track), `clip track ${track} names a real part`).toBe(true);
            }
          }
          for (const part of Object.keys(blueprint.aimRetract)) expect(partNames.has(part)).toBe(true);
          // Only a blade may be held turned: a gun's aim pose assumes the model is not rotated.
          if (!BLADES.has(id)) expect(blueprint.tuning.rotation).toBeUndefined();
        });

        check(`${skinId}: the sights line up with the true aim point`, () => {
          const blueprint = getWeaponBlueprint(id, skinId);
          const model = aimed(id, skinId);
          if (BLADES.has(id)) {
            expect(blueprint.aimPoint).toBeNull();
            expect(model.adsPosition).toEqual(WEAPON_ADS_POSITION);
            return;
          }
          // Hitscan leaves the camera along its forward axis, so the true aim point is the screen
          // centre: the aim point must sit on that axis, at the aim distance.
          expect(blueprint.aimPoint).not.toBeNull();
          const aimPoint = new THREE.Vector3(blueprint.aimPoint![0], blueprint.aimPoint![1], -blueprint.aimPoint![2])
            .multiplyScalar(blueprint.tuning.scale).add(new THREE.Vector3(...blueprint.tuning.offset)).add(model.adsPosition);
          expect(aimPoint.distanceTo(new THREE.Vector3(0, 0, -blueprint.aimDistance))).toBeLessThan(1e-4);
          // The glowing sight tip is on the centre line, at or beyond the aim point.
          const dot = model.group.getObjectByName('sight-dot') as THREE.Mesh | undefined;
          expect(dot, 'sight-dot').toBeDefined();
          const centre = new THREE.Box3().setFromObject(dot!).getCenter(new THREE.Vector3());
          expect(Math.hypot(centre.x, centre.y)).toBeLessThan(0.0005);
          expect(centre.z).toBeLessThanOrEqual(-blueprint.aimDistance + 0.002);
          // The muzzle is ahead of the sights and the shot leaves below or on the line of aim.
          expect(model.muzzleLocalOffset.z + model.adsPosition.z).toBeLessThan(-blueprint.aimDistance);
        });

        check(`${skinId}: nothing but the sight tip and a clear sight frame rises to the line of aim`, () => {
          const blueprint = getWeaponBlueprint(id, skinId);
          if (BLADES.has(id) || blueprint.scoped) return;
          const model = aimed(id, skinId);
          const glass = getSkinMaterials(skinId).glass;
          const blocking = new Set<string>();
          const crowding = new Set<string>();
          for (const mesh of meshesOf(model.group)) {
            if (mesh.name === 'sight-dot' || mesh.material === glass) continue;
            eachVertex(mesh, (v) => {
              if (v.z > -NEAR) return;
              if (mesh.userData.opticFrame) {
                if (Math.hypot(v.x, v.y) / -v.z < SIGHT_CLEAR_TANGENT) crowding.add(mesh.name);
              } else if (v.y > -0.0005) {
                blocking.add(mesh.name);
              }
            });
          }
          expect([...blocking], 'meshes above the line of aim').toEqual([]);
          expect([...crowding], 'sight frames inside the clear window').toEqual([]);
        });
      }

      check('shares geometry and skin materials between copies, but not the ammo light', () => {
        const first = buildWeaponViewModel(id), second = buildWeaponViewModel(id);
        expect(first.group).not.toBe(second.group);
        expect(first.group.position).toEqual(WEAPON_HIP_POSITION);
        const a = meshesOf(first.group), b = meshesOf(second.group);
        expect(a.length).toBe(b.length);
        const materials = getSkinMaterials('service');
        a.forEach((mesh, i) => {
          expect(mesh.geometry).toBe(b[i]!.geometry);
          if (first.glowMaterials.includes(mesh.material as THREE.MeshStandardMaterial)) {
            expect(mesh.material).not.toBe(b[i]!.material);
          } else {
            expect(mesh.material).toBe(b[i]!.material);
            expect(Object.values(materials)).toContain(mesh.material);
          }
        });
        if (!BLADES.has(id)) {
          expect(first.glowMaterials.length, 'a gun has an ammo witness light').toBe(1);
          expect(first.glowMaterials[0]!.emissive.getHex()).toBe(SKINS.service.glow.full);
          expect(first.muzzleLocalOffset.z).toBeLessThan(0);
        }
      });

      check('gives the first-person copy arms and every other copy none', () => {
        const blueprint = getWeaponBlueprint(id, 'service');
        const armParts = blueprint.parts.filter((part) => part.name.startsWith(ARM_PART_PREFIX)).map((part) => part.name);
        expect(armParts.length, 'at least the trigger arm').toBeGreaterThan(0);
        const view = buildWeaponViewModel(id);
        for (const name of armParts) expect(view.parts.has(name)).toBe(true);
        const display = createWeaponModel(id);
        for (const name of armParts) expect(display.parts.has(name)).toBe(false);
        expect(meshesOf(display.root).length).toBeLessThan(meshesOf(view.group).length);
        for (const mesh of meshesOf(display.root)) {
          expect(['glove', 'sleeve']).not.toContain(blueprint.meshes.find((entry) => entry.name === mesh.name)?.slot);
        }
      });

      check('wears every skin family as more than paint', () => {
        const slots = (skinId: SkinId): Set<string> => new Set(getWeaponBlueprint(id, skinId).meshes.map((mesh) => mesh.slot));
        expect(slots('service').has('lightLine')).toBe(false);
        expect(slots('pulse').has('lightLine'), 'pulse: light lines').toBe(true);
        expect(slots('gilded').has('gold'), 'gilded: engraving or medallion').toBe(true);
        expect(slots('ranger').has('wrap'), 'ranger: wraps').toBe(true);
        expect(slots('whiteout').has('wrap'), 'whiteout: wraps').toBe(true);
        if (BLADES.has(id) || getWeaponBlueprint(id, 'service').scoped) return;
        const frames = (skinId: SkinId): number => getWeaponBlueprint(id, skinId).meshes.filter((mesh) => mesh.opticFrame).length;
        const fixed = frames('pulse') === 0 && frames('ranger') === 0;
        // A weapon whose sight is not fixed takes the ranger's peep ring and the pulse's reflex window.
        if (!fixed) {
          expect(frames('ranger'), 'ranger: aperture ring').toBeGreaterThan(0);
          expect(frames('pulse'), 'pulse: reflex frame').toBeGreaterThan(0);
        }
      });
    });
  }
});
