import * as THREE from 'three';
import { ARM_PART_PREFIX, type WeaponBlueprint } from './kit/GunBuilder.ts';

/** Finds geometry that floats free of the rest of a weapon model: a stray box or disc left a few
 * centimetres off the gun reads as a piece that "does not belong" and is easy to miss in a side
 * view. Pure, so the test over every weapon and skin runs without a browser.
 *
 * Each mesh is split into islands (triangles joined by shared corners); islands whose boxes come
 * within `gap` of each other are one cluster; every cluster but the largest is reported. */

export interface FloatingPiece {
  readonly part: string;
  readonly slot: string;
  /** Centre and size of the piece's box in gun space (x right, y up, f forward), metres. */
  readonly centre: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  /** Distance from the piece's box to the nearest box of the main body, metres. */
  readonly distance: number;
}

interface Island {
  readonly part: string;
  readonly slot: string;
  readonly box: THREE.Box3;
}

const QUANTUM = 1e-4;

function islandsOf(geometry: THREE.BufferGeometry, offset: THREE.Vector3, part: string, slot: string): Island[] {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const corner = (i: number): number => (index ? index.getX(i) : i);
  const count = index ? index.count : position.count;
  // Corners at the same place are one corner, whatever their normals.
  const ids = new Map<string, number>();
  const idOf: number[] = [];
  for (let v = 0; v < position.count; v++) {
    const key = `${Math.round(position.getX(v) / QUANTUM)},${Math.round(position.getY(v) / QUANTUM)},${Math.round(position.getZ(v) / QUANTUM)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    idOf.push(id);
  }
  const parent = Array.from({ length: ids.size }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let t = 0; t < count; t += 3) {
    const a = find(idOf[corner(t)]!);
    parent[find(idOf[corner(t + 1)]!)] = a;
    parent[find(idOf[corner(t + 2)]!)] = a;
  }
  const boxes = new Map<number, THREE.Box3>();
  const point = new THREE.Vector3();
  for (let v = 0; v < position.count; v++) {
    const root = find(idOf[v]!);
    let box = boxes.get(root);
    if (!box) {
      box = new THREE.Box3();
      boxes.set(root, box);
    }
    box.expandByPoint(point.fromBufferAttribute(position, v).add(offset));
  }
  return Array.from(boxes.values(), (box) => ({ part, slot, box }));
}

function boxDistance(a: THREE.Box3, b: THREE.Box3): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}

/** The pieces of `blueprint` that float more than `gap` metres clear of its main body. The arms
 * are left out: a hand is its own shape and is judged by eye. */
export function floatingPieces(blueprint: WeaponBlueprint, gap = 0.004): FloatingPiece[] {
  // A part's meshes are built around its pivot; the pivot puts them back in gun space.
  const pivots = new Map(blueprint.parts.map((spec) => [spec.name, new THREE.Vector3(spec.pivot[0], spec.pivot[1], -spec.pivot[2])]));
  const islands: Island[] = [];
  for (const mesh of blueprint.meshes) {
    if (mesh.part.startsWith(ARM_PART_PREFIX)) continue;
    islands.push(...islandsOf(mesh.geometry, pivots.get(mesh.part) ?? new THREE.Vector3(), mesh.part, mesh.slot));
  }
  if (islands.length === 0) return [];

  // Clusters of islands whose boxes come within the gap of one another.
  const cluster = islands.map((_, i) => i);
  const find = (i: number): number => {
    while (cluster[i] !== i) {
      cluster[i] = cluster[cluster[i]!]!;
      i = cluster[i]!;
    }
    return i;
  };
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      if (find(i) !== find(j) && boxDistance(islands[i]!.box, islands[j]!.box) <= gap) cluster[find(j)] = find(i);
    }
  }
  const volumes = new Map<number, number>();
  const size = new THREE.Vector3();
  islands.forEach((island, i) => {
    island.box.getSize(size);
    volumes.set(find(i), (volumes.get(find(i)) ?? 0) + Math.max(size.x, 1e-4) * Math.max(size.y, 1e-4) * Math.max(size.z, 1e-4));
  });
  const main = [...volumes].sort((a, b) => b[1] - a[1])[0]![0];
  const body = islands.filter((_, i) => find(i) === main);

  const centre = new THREE.Vector3();
  return islands
    .filter((_, i) => find(i) !== main)
    .map((island) => {
      island.box.getCenter(centre);
      island.box.getSize(size);
      return {
        part: island.part,
        slot: island.slot,
        centre: [centre.x, centre.y, -centre.z] as const,
        size: [size.x, size.y, size.z] as const,
        distance: Math.min(...body.map((other) => boxDistance(island.box, other.box))),
      };
    });
}
