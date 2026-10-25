import * as THREE from 'three';
import type { GrenadeKind } from '../../core/gameModes.ts';

/** Stand-in grenade models for the Loadout page's thumbnails only (see weaponThumbnail.ts). The
 * real grenade models are built on the grenades branch: when it merges, point
 * buildGrenadeThumbnailModel at them and delete the procedural shapes below. Units are arbitrary,
 * the thumbnail renderer frames whatever it gets. */
export function buildGrenadeThumbnailModel(kind: GrenadeKind): THREE.Group {
  return kind === 'frag' ? buildFrag() : buildFlash();
}

function material(color: number, roughness = 0.75, metalness = 0.1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]): THREE.Mesh {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(...position);
  m.rotation.set(...rotation);
  return m;
}

/** The fuse head, the spoon running down one side and the pull ring: shared by both grenades. */
function addFuseAssembly(group: THREE.Group, top: number, sideX: number, spoonLength: number): void {
  const steel = material(0x5d6468, 0.45, 0.6);
  const ring = material(0xa9b0b2, 0.35, 0.8);
  group.add(mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.2, 16), steel, [0, top + 0.08, 0]));
  // The spoon: a short cap across the fuse head, then a long strip leaning down the body.
  group.add(mesh(new THREE.BoxGeometry(0.3, 0.035, 0.13), steel, [sideX * 0.45, top + 0.2, 0]));
  group.add(mesh(new THREE.BoxGeometry(0.035, spoonLength, 0.13), steel, [sideX, top + 0.2 - spoonLength / 2, 0], [0, 0, 0.12]));
  group.add(mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 24), ring, [-sideX * 0.75, top + 0.12, 0.02], [0, Math.PI / 2.6, 0]));
}

function buildFrag(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grenade-frag';
  const olive = material(0x59653a, 0.85);
  const body = mesh(new THREE.SphereGeometry(0.5, 24, 18), olive, [0, 0, 0]);
  body.scale.set(1, 1.22, 1);
  group.add(body);
  // A raised waist band so the ovoid reads as cast metal, not an egg.
  group.add(mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 32), material(0x4a5430, 0.85), [0, 0, 0], [Math.PI / 2, 0, 0]));
  addFuseAssembly(group, 0.56, 0.44, 0.62);
  return group;
}

function buildFlash(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grenade-flash';
  const grey = material(0x8b9296, 0.6, 0.3);
  group.add(mesh(new THREE.CylinderGeometry(0.33, 0.33, 1.05, 28), grey, [0, 0, 0]));
  group.add(mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.2, 28), material(0xd9b45a, 0.55, 0.2), [0, 0.12, 0]));
  addFuseAssembly(group, 0.52, 0.36, 0.74);
  return group;
}
