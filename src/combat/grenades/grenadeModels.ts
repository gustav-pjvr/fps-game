import * as THREE from 'three';
import { ACCENT_AMBER } from '../../render/look.ts';
import { getWeaponMaterials } from '../../weapons/models/weaponMaterials.ts';
import type { GrenadeKind } from './grenadeTuning.ts';

/**
 * The frag and flash models, built from primitives in the arsenal's look (weapons/models/arsenal.ts):
 * the guns' pipe metal for the fuse, spoon and ring, a painted body per kind. The origin is the
 * body's centre and +Y the fuse axis. Geometry and materials are made once and shared by every
 * copy (the live grenades' pool and the view-model hand), so they are never disposed.
 */

interface SharedParts {
  readonly geometry: {
    readonly fragBody: THREE.BufferGeometry;
    readonly fragGroove: THREE.BufferGeometry;
    readonly flashBody: THREE.BufferGeometry;
    readonly flashBand: THREE.BufferGeometry;
    readonly fuse: THREE.BufferGeometry;
    readonly spoonSide: THREE.BufferGeometry;
    readonly spoonTop: THREE.BufferGeometry;
    readonly ring: THREE.BufferGeometry;
  };
  readonly material: {
    readonly olive: THREE.MeshStandardMaterial;
    readonly oliveDark: THREE.MeshStandardMaterial;
    readonly grey: THREE.MeshStandardMaterial;
    readonly band: THREE.MeshStandardMaterial;
    readonly metal: THREE.MeshStandardMaterial;
  };
}

/** The frag's body: an ovoid this wide and FRAG_BODY_STRETCH times as tall. */
export const FRAG_BODY_RADIUS = 0.042;
const FRAG_BODY_STRETCH = 1.22;
export const FLASH_BODY_RADIUS = 0.026;
const FLASH_BODY_HEIGHT = 0.11;

let shared: SharedParts | undefined;

function parts(): SharedParts {
  if (shared) return shared;
  const metal = getWeaponMaterials().pipe;
  shared = {
    geometry: {
      fragBody: new THREE.SphereGeometry(FRAG_BODY_RADIUS, 16, 12).scale(1, FRAG_BODY_STRETCH, 1),
      fragGroove: new THREE.TorusGeometry(FRAG_BODY_RADIUS * 0.97, 0.0035, 5, 20).rotateX(Math.PI / 2),
      flashBody: new THREE.CylinderGeometry(FLASH_BODY_RADIUS, FLASH_BODY_RADIUS, FLASH_BODY_HEIGHT, 16),
      flashBand: new THREE.CylinderGeometry(FLASH_BODY_RADIUS * 1.06, FLASH_BODY_RADIUS * 1.06, 0.024, 16),
      fuse: new THREE.CylinderGeometry(0.012, 0.015, 0.022, 10),
      spoonSide: new THREE.BoxGeometry(0.006, 0.07, 0.016),
      spoonTop: new THREE.BoxGeometry(0.03, 0.006, 0.016),
      ring: new THREE.TorusGeometry(0.013, 0.0025, 5, 14),
    },
    material: {
      olive: new THREE.MeshStandardMaterial({ name: 'grenade-olive', color: 0x56603a, roughness: 0.72, metalness: 0.15 }),
      oliveDark: new THREE.MeshStandardMaterial({ name: 'grenade-olive-dark', color: 0x2f3522, roughness: 0.8, metalness: 0.1 }),
      grey: new THREE.MeshStandardMaterial({ name: 'grenade-grey', color: 0x8a908c, roughness: 0.45, metalness: 0.55 }),
      band: new THREE.MeshStandardMaterial({ name: 'grenade-band', color: ACCENT_AMBER, roughness: 0.55, metalness: 0.1 }),
      metal,
    },
  };
  return shared;
}

function add(group: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.z = rz;
  mesh.castShadow = false;
  group.add(mesh);
  return mesh;
}

/** One grenade of `kind`, ready to place. Cheap: every copy shares its geometry and materials. */
export function buildGrenadeModel(kind: GrenadeKind): THREE.Group {
  const { geometry: g, material: m } = parts();
  const group = new THREE.Group();
  group.name = `grenade-${kind}`;
  // The top of the body, where the fuse sits.
  let top: number;
  let side: number;
  if (kind === 'frag') {
    top = FRAG_BODY_RADIUS * FRAG_BODY_STRETCH;
    side = FRAG_BODY_RADIUS;
    add(group, 'body', g.fragBody, m.olive, 0, 0, 0);
    for (const y of [-0.018, 0.018]) add(group, `groove-${y}`, g.fragGroove, m.oliveDark, 0, y, 0);
  } else {
    top = FLASH_BODY_HEIGHT / 2;
    side = FLASH_BODY_RADIUS;
    add(group, 'body', g.flashBody, m.grey, 0, 0, 0);
    add(group, 'band', g.flashBand, m.band, 0, 0.012, 0);
  }
  add(group, 'fuse', g.fuse, m.metal, 0, top + 0.008, 0);
  // The spoon runs down the body's side from the fuse, leaning in at the bottom.
  add(group, 'spoon', g.spoonSide, m.metal, side + 0.004, top - 0.03, 0, kind === 'frag' ? 0.22 : 0);
  add(group, 'spoon-top', g.spoonTop, m.metal, side * 0.5, top + 0.02, 0);
  add(group, 'ring', g.ring, m.metal, -0.02, top + 0.016, 0);
  return group;
}
