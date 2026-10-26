import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldBox } from './structureGeometry.ts';
import { getStructureMaterials, STRUCTURE_TILE_METRES, type StructureMaterialKey } from './structureMaterials.ts';
import { createWindowMaterial } from '../render/materialGrade.ts';

/** One box's full placement in a structure's local frame (centred, like both a Rapier cuboid and a
 * THREE.BoxGeometry). Every solid part of a tower or house is described once as one of these and
 * built as both its collider and its visible mesh, so what you see is what stops you and your
 * bullets. */
export interface BoxTransform {
  readonly center: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
  readonly halfExtents: THREE.Vector3;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);

/** An axis-aligned box from its centre and full size. */
export function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): BoxTransform {
  return { center: new THREE.Vector3(cx, cy, cz), rotation: new THREE.Quaternion(), halfExtents: new THREE.Vector3(sx / 2, sy / 2, sz / 2) };
}

/** A box whose local +X runs from `start` to `end` (a ramp, a beam, a sloped rail), `height` along
 * its local Y and `depth` along its local Z, with its local Z kept level: a ramp tilts along its
 * run and never rolls sideways. (The shortest-arc turn of +X onto the segment, which the first
 * towers used, rolls any sloped box that runs along Z: their flights on two faces leaned into the
 * core and wedged a climbing player against it, found by towerDesign.test.ts.) The same quaternion
 * serves the collider and the mesh, so the two cannot drift apart. */
export function boxAlong(start: THREE.Vector3, end: THREE.Vector3, height: number, depth: number): BoxTransform {
  const delta = new THREE.Vector3().subVectors(end, start);
  const xAxis = delta.clone().normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, new THREE.Vector3(0, 1, 0));
  const rotation =
    zAxis.lengthSq() < 1e-8
      ? new THREE.Quaternion().setFromUnitVectors(X_AXIS, xAxis)
      : new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, new THREE.Vector3().crossVectors(zAxis.normalize(), xAxis), zAxis));
  return {
    center: new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5),
    rotation,
    halfExtents: new THREE.Vector3(delta.length() / 2, height / 2, depth / 2),
  };
}

export function boxMatrix(transform: BoxTransform): THREE.Matrix4 {
  return new THREE.Matrix4().compose(transform.center, transform.rotation, new THREE.Vector3(1, 1, 1));
}

export function createBoxCollider(world: RAPIER.World, body: RAPIER.RigidBody, transform: BoxTransform): RAPIER.Collider {
  const { center, rotation, halfExtents } = transform;
  const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
    .setTranslation(center.x, center.y, center.z)
    .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
  return world.createCollider(desc, body);
}

/** A convex solid (a gable end, a pitched roof) given by its corner points in the local frame. */
export function createHullCollider(world: RAPIER.World, body: RAPIER.RigidBody, points: Float32Array): RAPIER.Collider | null {
  const desc = RAPIER.ColliderDesc.convexHull(points);
  return desc ? world.createCollider(desc, body) : null;
}

/** Material slots a structure draws with: the procedural surfaces, lit and dark window glass, and
 * small lamps. `inner-` surfaces are the same materials for inside a building (docs/enterable-
 * buildings.md): sky and ambient light reach them only at INTERIOR_INDIRECT_LIGHT, so a room is dim
 * by day while the sun through a window and the lamps (direct light) still light it fully. */
export type PieceMaterial = StructureMaterialKey | `inner-${StructureMaterialKey}` | 'window' | 'glass' | 'lamp' | 'warning';

/** How much of the sky and ambient (indirect) light reaches inside a building. */
export const INTERIOR_INDIRECT_LIGHT = 0.3;

const innerMaterials = new Map<StructureMaterialKey, THREE.MeshStandardMaterial>();
let interiorShade: THREE.DataTexture | null = null;

/** A structure material for inside a building: shared textures, with a flat ambient occlusion map,
 * which in three's standard material scales only indirect light. */
function interiorMaterial(key: StructureMaterialKey): THREE.MeshStandardMaterial {
  const cached = innerMaterials.get(key);
  if (cached) return cached;
  if (!interiorShade) {
    const shade = Math.round(INTERIOR_INDIRECT_LIGHT * 255);
    interiorShade = new THREE.DataTexture(new Uint8Array([shade, shade, shade, 255]), 1, 1);
    interiorShade.needsUpdate = true;
  }
  const material = getStructureMaterials()[key].clone();
  material.name = `structure-inner-${key}`;
  material.aoMap = interiorShade;
  material.aoMapIntensity = 1;
  innerMaterials.set(key, material);
  return material;
}

/** The procedural surface a material slot uses (its tile size), if any. */
function surfaceOf(key: PieceMaterial): StructureMaterialKey | null {
  const base = key.startsWith('inner-') ? key.slice(6) : key;
  return base in STRUCTURE_TILE_METRES ? (base as StructureMaterialKey) : null;
}

let sharedLamps: { lamp: THREE.MeshStandardMaterial; warning: THREE.MeshStandardMaterial; window: THREE.Material; glass: THREE.Material } | null = null;

function accentMaterials() {
  sharedLamps ??= {
    // Small warm work lamps and the red aviation light on a mast: the only colour on a structure
    // is light, as everywhere else in the dusk look.
    lamp: new THREE.MeshStandardMaterial({ name: 'structure-lamp', color: 0x221a10, emissive: 0xffb45a, emissiveIntensity: 2.2, roughness: 0.6 }),
    warning: new THREE.MeshStandardMaterial({ name: 'structure-warning', color: 0x200808, emissive: 0xff3a24, emissiveIntensity: 3, roughness: 0.6 }),
    window: createWindowMaterial(),
    // An unlit pane: dark glass that picks up the sky.
    glass: new THREE.MeshStandardMaterial({ name: 'structure-glass', color: 0x1a2226, roughness: 0.12, metalness: 0.5, envMapIntensity: 1 }),
  };
  return sharedLamps;
}

function materialFor(key: PieceMaterial): THREE.Material {
  if (key === 'window' || key === 'glass' || key === 'lamp' || key === 'warning') return accentMaterials()[key];
  if (key.startsWith('inner-')) return interiorMaterial(surfaceOf(key)!);
  return getStructureMaterials()[key as StructureMaterialKey];
}

/**
 * Collects a structure's pieces and merges them into one mesh per material, so a tower of a few
 * hundred boxes costs about eight draw calls. Box UVs are in metres over each material's tile
 * size, so a panel or a grating bar is the same size on every face of every piece.
 */
export class PieceCollector {
  private readonly pieces = new Map<PieceMaterial, THREE.BufferGeometry[]>();

  /** A box in the given material. */
  addBox(material: PieceMaterial, transform: BoxTransform): void {
    const h = transform.halfExtents;
    const surface = surfaceOf(material);
    const tile = surface ? STRUCTURE_TILE_METRES[surface] : 1;
    this.add(material, worldBox(h.x * 2, h.y * 2, h.z * 2, tile), boxMatrix(transform));
  }

  /** An axis-aligned box from its bounds whose texture is laid in the structure's own frame rather
   * than per box (each face's UVs are its position over the tile size), so the pieces a wall is cut
   * into around its openings line up as one surface. */
  addPlanarBox(material: PieceMaterial, minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): void {
    const surface = surfaceOf(material);
    const tile = surface ? STRUCTURE_TILE_METRES[surface] : 1;
    const geometry = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
    geometry.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
      // Faces across x read along z, faces across z along x (mirrored on the back faces so the
      // texture reads the right way round from outside); top and bottom read x by z.
      if (Math.abs(nx) > 0.5) uv.setXY(i, (nx > 0 ? -z : z) / tile, y / tile);
      else if (Math.abs(nz) > 0.5) uv.setXY(i, (nz > 0 ? x : -x) / tile, y / tile);
      else uv.setXY(i, x / tile, (ny > 0 ? -z : z) / tile);
    }
    this.add(material, geometry, new THREE.Matrix4());
  }

  /** Any geometry with position, normal and uv, placed by `matrix`. */
  add(material: PieceMaterial, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const placed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    placed.applyMatrix4(matrix);
    for (const name of Object.keys(placed.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') placed.deleteAttribute(name);
    }
    geometry.dispose();
    const list = this.pieces.get(material) ?? [];
    list.push(placed);
    this.pieces.set(material, list);
  }

  /** One mesh per material, casting and receiving shadows (glass and lamps receive only). */
  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [key, geometries] of this.pieces) {
      const merged = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, materialFor(key));
      mesh.name = `structure-${key}`;
      const glows = key === 'window' || key === 'lamp' || key === 'warning';
      mesh.castShadow = !glows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/** A triangular prism (a gable end, a roof ridge) from its three corners in the XY plane, extruded
 * along Z from z0 to z1, with flat normals and UVs in metres over `tile`. Also returns its corner
 * points for a hull collider. */
export function prism(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, z0: number, z1: number, tile: number): { geometry: THREE.BufferGeometry; points: Float32Array } {
  const corners = [a, b, c];
  const positions: number[] = [];
  const uvs: number[] = [];
  const pushTri = (p: THREE.Vector3[], uv: [number, number][]) => {
    for (let i = 0; i < 3; i++) {
      positions.push(p[i]!.x, p[i]!.y, p[i]!.z);
      uvs.push(uv[i]![0] / tile, uv[i]![1] / tile);
    }
  };
  // Ends, wound to face -Z and +Z for a counter-clockwise a, b, c.
  const front = corners.map((p) => new THREE.Vector3(p.x, p.y, z1));
  const back = corners.map((p) => new THREE.Vector3(p.x, p.y, z0));
  pushTri(front, corners.map((p) => [p.x, p.y] as [number, number]));
  pushTri([back[0]!, back[2]!, back[1]!], [a, c, b].map((p) => [p.x, p.y] as [number, number]));
  // Sides: one quad per edge.
  for (let i = 0; i < 3; i++) {
    const p0 = corners[i]!;
    const p1 = corners[(i + 1) % 3]!;
    const length = p0.distanceTo(p1);
    const q = [new THREE.Vector3(p0.x, p0.y, z0), new THREE.Vector3(p1.x, p1.y, z0), new THREE.Vector3(p1.x, p1.y, z1), new THREE.Vector3(p0.x, p0.y, z1)];
    pushTri([q[0]!, q[1]!, q[2]!], [[0, 0], [length, 0], [length, z1 - z0]]);
    pushTri([q[0]!, q[2]!, q[3]!], [[0, 0], [length, z1 - z0], [0, z1 - z0]]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const points = new Float32Array([...front, ...back].flatMap((p) => [p.x, p.y, p.z]));
  return { geometry, points };
}

const POST_SPACING = 1.5;
const POST_SIZE = 0.07;
const CAP_HEIGHT = 0.07;
const CAP_DEPTH = 0.12;

/**
 * A guard rail drawn over its collider box: a perforated steel panel the box's full size (so the
 * solid collider reads as a solid panel, never an invisible wall), a steel cap along the top
 * following the rail's slope, and upright posts at both ends and about every 1.5 m.
 */
export function addRailing(pieces: PieceCollector, rail: BoxTransform): void {
  const h = rail.halfExtents;
  pieces.addBox('perforated', { center: rail.center, rotation: rail.rotation, halfExtents: new THREE.Vector3(h.x, h.y, Math.min(h.z, 0.03)) });

  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rail.rotation);
  const along = new THREE.Vector3(1, 0, 0).applyQuaternion(rail.rotation);
  pieces.addBox('steel', {
    center: rail.center.clone().addScaledVector(up, h.y),
    rotation: rail.rotation,
    halfExtents: new THREE.Vector3(h.x + POST_SIZE / 2, CAP_HEIGHT / 2, CAP_DEPTH / 2),
  });

  const length = h.x * 2;
  const spans = Math.max(1, Math.round(length / POST_SPACING));
  const yaw = new THREE.Quaternion().setFromUnitVectors(X_AXIS, new THREE.Vector3(along.x, 0, along.z).normalize());
  for (let i = 0; i <= spans; i++) {
    // Vertical posts, standing on the rail's lower edge at this point along it.
    const point = rail.center.clone().addScaledVector(along, (i / spans - 0.5) * length);
    pieces.addBox('steel', { center: point, rotation: yaw, halfExtents: new THREE.Vector3(POST_SIZE / 2, h.y, POST_SIZE / 2) });
  }
}
