import * as THREE from 'three';
import { WORLD_EDGE_RAMP_START } from '../core/config.ts';
import { getWorldSeed } from '../core/worldSeed.ts';
import type { DoorPlane } from './doors/doorGeometry.ts';
import { towerIndexFromDoorId } from './houses/valleyHouseIds.ts';
import { box, boxAlong, type BoxTransform } from './structureKit.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import { towerRotation, type TowerOrientation, type TowerPart } from './towerDesign.ts';
import { getWatchTowerPositions } from './WatchTowerManager.ts';

export interface LabVolume {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly floorY: number;
  readonly ceilY: number;
}

export interface TowerLab {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly groundY: number;
  readonly orientation: TowerOrientation;
  readonly kind: 'full' | 'compact' | 'dead-end';
  readonly flights: number;
  readonly floorY: number;
  /** Parts and walk route are in the tower's frame; volumes are in world space. */
  readonly parts: TowerPart[];
  readonly ceilingParts: number[];
  readonly flightSurfaces: { start: THREE.Vector3; end: THREE.Vector3 }[];
  readonly route: THREE.Vector3[];
  readonly volumes: LabVolume[];
  readonly footprints: LabVolume[];
  /** Placeholder corridor and lab lamps in world space. */
  readonly lamps: THREE.Vector3[];
}

const WIDTH = 1.8;
const HALF_LANE = WIDTH / 2;
const WALL = 0.3;
const ROOM_HALF = 2.7;
const ROOM_FLOOR = 0.05;
const ROOM_FLOOR_BOTTOM = -0.1;
const ROOM_CEILING = 3;
const FIRST_FLOOR = -3.85;
const FLIGHT_DROP = 3;
const FLIGHT_RUN = 5.4;
const ENTRY_LANE = -1.65;
const ENTRY_START_Z = 1.65;
const ENTRY_END_Z = -4;
const ENTRY_APPROACH_Z = 2.15;
const ENTRY_LANDING_END_Z = -5.5;
const ENTRY_ROOF_EDGE_Z = -4.1;
const ENTRY_ROOF_TOP = -1;
const ENTRY_ROOF_THICKNESS = 0.05;
const ENTRY_RETURN_ROOF_TOP = -4.12;
const DEAD_END_ROOF_TOP = -1.12;
const WELL_WEST = -2.85;
const WELL_EAST = 6.75;
const WELL_NORTH = -3;
const WELL_NORTH_INNER = WELL_NORTH - WALL;
const WELL_FLOOR_NORTH = -3.5;
const WELL_MIDDLE = -6;
const WELL_END = -9;
const WELL_SOUTH_INNER = WELL_END + WALL;
const NEAR_FLIGHT_Z = -4.5;
const FAR_FLIGHT_Z = -7.5;
const FLIGHT_START_X = -0.75;
const FLIGHT_END_X = 4.65;
const FAR_LANDING_X = 5.55;
const ROOF_RISE = 2.75;
const ROOF_THICKNESS = 0.15;
const CORRIDOR_END = -10;
const CORRIDOR_HALF_WIDTH = 1.2;
const CORRIDOR_HEIGHT = 3;
const LAB_HEIGHT = 6;

/** A slab sunk below its walking surface, extended under the flush landings. */
function ramp(start: THREE.Vector3, end: THREE.Vector3): BoxTransform {
  const direction = end.clone().sub(start).normalize();
  const slab = boxAlong(start.clone().addScaledVector(direction, -0.05), end.clone().addScaledVector(direction, 0.05), 0.3, WIDTH);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(slab.rotation);
  return { ...slab, center: slab.center.clone().addScaledVector(up, -0.15) };
}

function createLabBuilder(index: number, position: { x: number; z: number }, orientation: TowerOrientation, flights: number, kind: TowerLab['kind'] = 'full') {
  const { x, z } = position, groundY = sampleHeight(x, z);
  const rotation = towerRotation(orientation), mirror = orientation === 'north' ? -1 : 1;
  const parts: TowerPart[] = [], route: THREE.Vector3[] = [], volumes: LabVolume[] = [], footprints: LabVolume[] = [];
  const ceilingParts: number[] = [], flightSurfaces: { start: THREE.Vector3; end: THREE.Vector3 }[] = [];
  const lamps: THREE.Vector3[] = [];
  const floorY = FIRST_FLOOR - (flights - 1) * FLIGHT_DROP;
  const point = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz);
  const add = (b: BoxTransform, material: TowerPart['material'] = 'concrete', rail = false) => {
    const turn = b.rotation.clone();
    if (mirror < 0) {
      const along = new THREE.Vector3(1, 0, 0).applyQuaternion(turn), up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
      along.x *= -1; up.x *= -1;
      turn.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, up, new THREE.Vector3().crossVectors(along, up)));
    }
    const center = b.center.clone(); center.x *= mirror;
    parts.push({ box: { ...b, center: center.applyQuaternion(rotation), rotation: rotation.clone().multiply(turn) }, material, rail });
  };
  const slab = (x0: number, x1: number, top: number, z0: number, z1: number) => add(box((x0 + x1) / 2, top - 0.15, (z0 + z1) / 2, x1 - x0, 0.3, z1 - z0));
  const wall = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    if (x1 > x0 && y1 > y0 && z1 > z0) add(box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0));
  };
  const volume = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, underground = true) => {
    const a = point(x0 * mirror, 0, z0).applyQuaternion(rotation), b = point(x1 * mirror, 0, z1).applyQuaternion(rotation);
    const bounds = { minX: x + Math.min(a.x, b.x), maxX: x + Math.max(a.x, b.x), minZ: z + Math.min(a.z, b.z), maxZ: z + Math.max(a.z, b.z), floorY: groundY + y0, ceilY: groundY + y1 };
    volumes.push(bounds);
    if (underground) footprints.push(bounds);
  };
  const roofSections: { x0: number; x1: number; z0: number; z1: number; top: number; bottom: number }[] = [];
  const ceiling = (x0: number, x1: number, top: number, z0: number, z1: number, thickness = ROOF_THICKNESS) => {
    ceilingParts.push(parts.length);
    add(box((x0 + x1) / 2, top - thickness / 2, (z0 + z1) / 2, x1 - x0, thickness, z1 - z0));
    roofSections.push({ x0, x1, z0, z1, top, bottom: top - thickness });
  };
  const sealRoofJoints = () => {
    const seam = 0.02;
    for (let i = 0; i < roofSections.length; i++) for (const b of roofSections.slice(i + 1)) {
      const a = roofSections[i]!;
      if (Math.abs(a.top - b.top) < 1e-6) continue;
      const bottom = Math.min(a.bottom, b.bottom), top = Math.max(a.top, b.top);
      const z0 = Math.max(a.z0, b.z0), z1 = Math.min(a.z1, b.z1);
      const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1);
      if (z1 > z0 && (Math.abs(a.x1 - b.x0) < 1e-6 || Math.abs(b.x1 - a.x0) < 1e-6)) {
        const edge = Math.max(a.x0, b.x0);
        ceilingParts.push(parts.length);
        wall(edge - seam, edge + seam, bottom, top, z0, z1);
      }
      if (x1 > x0 && (Math.abs(a.z1 - b.z0) < 1e-6 || Math.abs(b.z1 - a.z0) < 1e-6)) {
        const edge = Math.max(a.z0, b.z0);
        ceilingParts.push(parts.length);
        wall(x0, x1, bottom, top, edge - seam, edge + seam);
      }
    }
  };
  const rail = (a: THREE.Vector3, b: THREE.Vector3) => add(boxAlong(a, b, 0.8, 0.08), 'perforated', true);
  const flight = (a: THREE.Vector3, b: THREE.Vector3) => {
    flightSurfaces.push({ start: a.clone(), end: b.clone() });
    add(ramp(a, b), 'steel');
    // Shallow tread boxes lie within the ramp slab. Their collider is their drawn box too.
    const delta = b.clone().sub(a), steps = Math.ceil(Math.abs(delta.y) / 0.2);
    const direction = new THREE.Vector3(delta.x, 0, delta.z).normalize();
    for (let i = 0; i < steps; i++) {
      const p = a.clone().addScaledVector(delta, (i + 0.5) / steps);
      const run = Math.hypot(delta.x, delta.z) / steps;
      p.y -= Math.abs(delta.y) / steps / 2 + 0.035;
      add(boxAlong(p.clone().addScaledVector(direction, -run / 2), p.clone().addScaledVector(direction, run / 2), 0.06, WIDTH - 0.08), 'grating');
    }
    for (const side of [-1, 1]) {
      const offset = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(side * (WIDTH / 2 + 0.05));
      offset.y = 0.4;
      rail(a.clone().add(offset), b.clone().add(offset));
    }
    route.push(a, b);
  };

  const wellEnd = kind === 'dead-end' ? ENTRY_LANDING_END_Z : WELL_END;
  const east = kind === 'dead-end' ? -WELL_NORTH : WELL_EAST;
  const roofAt = (px: number, south: boolean) => {
    const t = Math.max(0, Math.min(1, (px - FLIGHT_START_X) / FLIGHT_RUN));
    return FIRST_FLOOR - (south ? 2 * FLIGHT_DROP - t * FLIGHT_DROP : t * FLIGHT_DROP) + ROOF_RISE;
  };

  return { index, x, z, groundY, orientation, flights, kind, rotation, mirror, floorY, parts, route, volumes, footprints,
    ceilingParts, flightSurfaces, lamps, wellEnd, east, roofAt, point, add, slab, wall, volume, ceiling, flight, sealRoofJoints };
}

type LabBuilder = ReturnType<typeof createLabBuilder>;

function buildRoomShaft(builder: LabBuilder): void {
  const { volume, floorY, route, point, flight, slab, wall, ceiling } = builder;
  volume(-ROOM_HALF, ROOM_HALF, floorY, ROOM_CEILING, -ROOM_HALF, ROOM_HALF, false);
  // Approach the top landing from the side, never cutting diagonally across the hole.
  route.push(point(0, ROOM_FLOOR, 0), point(0, ROOM_FLOOR, ENTRY_APPROACH_Z), point(ENTRY_LANE, ROOM_FLOOR, ENTRY_APPROACH_Z));
  flight(point(ENTRY_LANE, ROOM_FLOOR, ENTRY_START_Z), point(ENTRY_LANE, FIRST_FLOOR, ENTRY_END_Z));
  slab(ENTRY_LANE - HALF_LANE, ENTRY_LANE + HALF_LANE, FIRST_FLOOR, ENTRY_LANDING_END_Z, ENTRY_END_Z);
  // Below the room floor the rail can be jumped. Solid sides, a back wall and a bottom
  // bound the entire shaft while its far end opens onto the first landing.
  for (const side of [-1, 1]) {
    const edge = ENTRY_LANE + side * HALF_LANE;
    wall(Math.min(edge, edge + side * WALL), Math.max(edge, edge + side * WALL), FIRST_FLOOR - WALL, ROOM_FLOOR_BOTTOM,
      ENTRY_ROOF_EDGE_Z, ENTRY_START_Z + WALL);
  }
  wall(ENTRY_LANE - HALF_LANE - WALL, ENTRY_LANE + HALF_LANE + WALL, FIRST_FLOOR - WALL, ROOM_FLOOR,
    ENTRY_START_Z, ENTRY_START_Z + WALL);
  slab(ENTRY_LANE - HALF_LANE - WALL, ENTRY_LANE + HALF_LANE + WALL, FIRST_FLOOR - WALL,
    ENTRY_ROOF_EDGE_Z, ENTRY_START_Z + WALL);
  ceiling(ENTRY_LANE - HALF_LANE, ENTRY_LANE + HALF_LANE, ROOM_FLOOR,
    WELL_NORTH, -ROOM_HALF, WALL);
}

function buildStairwell(builder: LabBuilder): number {
  const { slab, east, floorY, wellEnd, ceiling, wall, volume, kind, roofAt, flights, route, point, flight } = builder;
  slab(WELL_WEST, east, floorY, wellEnd, WELL_FLOOR_NORTH);
  // Crosswise switchbacks fit the stairwell beside the core's apron. Roof strips follow the
  // highest flight in each lane, rather than exposing a tall box on a downhill site.
  const roofTile = (left: number, right: number, near: number, far: number, roof: number, thickness = ROOF_THICKNESS) => {
    const roofNear = Math.min(near, left === WELL_WEST && near === WELL_NORTH ? ENTRY_ROOF_EDGE_Z : WELL_FLOOR_NORTH);
    ceiling(left, right, roof, far, roofNear, thickness);
    if (near === WELL_NORTH) {
      // The entry collar meets the room floor, closing the strips above the old roof setbacks.
      ceiling(left, right, ROOM_FLOOR, roofNear, near, WALL);
      wall(left, Math.min(right, ENTRY_LANE - HALF_LANE), roof, ROOM_FLOOR, WELL_NORTH_INNER, WELL_NORTH);
      wall(Math.max(left, ENTRY_LANE + HALF_LANE), right, roof, ROOM_FLOOR, WELL_NORTH_INNER, WELL_NORTH);
      if (left === WELL_WEST) wall(WELL_WEST, WELL_WEST + WALL, roof, ROOM_FLOOR, roofNear, near);
      if (right === east) wall(east - WALL, east, roof, ROOM_FLOOR, roofNear, near);
    }
    volume(left, right, floorY - 0.3, roof, far, near);
    if (near === WELL_NORTH) {
      wall(left, Math.min(right, ENTRY_LANE - HALF_LANE), floorY, roof, WELL_NORTH_INNER, WELL_NORTH);
      wall(Math.max(left, ENTRY_LANE + HALF_LANE), right, floorY, roof, WELL_NORTH_INNER, WELL_NORTH);
    }
    if (left === WELL_WEST) wall(WELL_WEST, WELL_WEST + WALL, floorY, roof, far, near);
    if (right === east) wall(east - 0.3, east, floorY, roof, far, near);
  };
  for (const south of kind === 'dead-end' ? [false] : [false, true]) {
    const near = south ? WELL_MIDDLE : WELL_NORTH, far = south ? wellEnd : Math.max(wellEnd, WELL_MIDDLE);
    const edges = [WELL_WEST, FLIGHT_START_X];
    for (let at = 0.25; at < east; at += 1) edges.push(at);
    edges.push(east);
    for (let i = 0; i < edges.length - 1; i++) {
      const left = edges[i]!, right = edges[i + 1]!;
      const roof = kind === 'dead-end' ? DEAD_END_ROOF_TOP : Math.max(roofAt(left, south), roofAt(right, south));
      if (!south && left === WELL_WEST) {
        // Thin steel over D1's arrival keeps the capsule clear of the leading ceiling edge.
        // This entire inflated strip lies inside the tower's flat terrain apron.
        roofTile(left, right, near, ENTRY_LANDING_END_Z, ENTRY_ROOF_TOP, ENTRY_ROOF_THICKNESS);
        if (far < ENTRY_LANDING_END_Z) roofTile(left, right, ENTRY_LANDING_END_Z, far, ENTRY_RETURN_ROOF_TOP);
      } else roofTile(left, right, near, far, roof);
    }
  }
  wall(ENTRY_LANE - HALF_LANE, ENTRY_LANE + HALF_LANE, floorY, FIRST_FLOOR - 0.3, WELL_NORTH_INNER, WELL_NORTH);
  let exitX = ENTRY_LANE;
  for (let k = 1; k < flights; k++) {
    const forward = k % 2 === 1, pz = forward ? NEAR_FLIGHT_Z : FAR_FLIGHT_Z;
    const y = FIRST_FLOOR - (k - 1) * FLIGHT_DROP;
    const from = forward ? FLIGHT_START_X : FLIGHT_END_X, to = forward ? FLIGHT_END_X : FLIGHT_START_X;
    const fromLanding = forward ? ENTRY_LANE : FAR_LANDING_X;
    exitX = forward ? FAR_LANDING_X : ENTRY_LANE;
    route.push(point(fromLanding, y, pz));
    flight(point(from, y, pz), point(to, y - FLIGHT_DROP, pz));
    slab(exitX - HALF_LANE, exitX + HALF_LANE, y - FLIGHT_DROP, WELL_SOUTH_INNER, WELL_FLOOR_NORTH);
    route.push(point(exitX, y - FLIGHT_DROP, pz));
  }
  if (kind === 'dead-end') {
    wall(WELL_WEST, east, floorY, DEAD_END_ROOF_TOP, wellEnd, wellEnd + 0.3);
    route.push(point(ENTRY_LANE, floorY, NEAR_FLIGHT_Z));
  }
  return exitX;
}

function buildLab(builder: LabBuilder, exitX: number): void {
  const { route, point, floorY, east, roofAt, wall, slab, ceilingParts, parts, volume, kind, mirror, rotation, x, z, lamps } = builder;
  route.push(point(exitX, floorY, FAR_FLIGHT_Z), point(exitX, floorY, CORRIDOR_END - 2));
  // The lab's entry follows the final landing, so no return route runs into a ramp underside.
  for (let left = WELL_WEST; left < east; left += 1) {
    const right = Math.min(east, left + 1), roof = Math.max(roofAt(left, true), roofAt(right, true));
    wall(left, Math.min(right, exitX - CORRIDOR_HALF_WIDTH), floorY, roof, WELL_END, WELL_END + 0.3);
    wall(Math.max(left, exitX + CORRIDOR_HALF_WIDTH), right, floorY, roof, WELL_END, WELL_END + 0.3);
    wall(Math.max(left, exitX - CORRIDOR_HALF_WIDTH), Math.min(right, exitX + CORRIDOR_HALF_WIDTH), floorY + CORRIDOR_HEIGHT, roof, WELL_END, WELL_END + 0.3);
  }
  slab(exitX - 1.5, exitX + 1.5, floorY, CORRIDOR_END, WELL_END);
  ceilingParts.push(parts.length);
  slab(exitX - 1.5, exitX + 1.5, floorY + CORRIDOR_HEIGHT + WALL, CORRIDOR_END, WELL_END);
  for (const side of [-1, 1]) wall(exitX + side * 1.35 - 0.15, exitX + side * 1.35 + 0.15, floorY, floorY + CORRIDOR_HEIGHT + WALL, CORRIDOR_END, WELL_END);
  volume(exitX - 1.5, exitX + 1.5, floorY - 0.3, floorY + CORRIDOR_HEIGHT + WALL, CORRIDOR_END, WELL_END);
  const width = kind === 'full' ? 26 : 10, depth = kind === 'full' ? 18 : 8;
  const lateral = new THREE.Vector3(mirror, 0, 0).applyQuaternion(rotation);
  // The wide entrance wall can slide past a straight corridor. Bias that spare width toward
  // the map interior so the outer corner does not needlessly enter the world edge ramp.
  const inward = THREE.MathUtils.clamp(-x * lateral.x - z * lateral.z, -11.5, 11.5);
  const labX = kind === 'full' ? THREE.MathUtils.clamp(inward, exitX - 11.5, exitX + 11.5) : exitX, end = CORRIDOR_END - depth;
  slab(labX - width / 2, labX + width / 2, floorY, end, CORRIDOR_END);
  ceilingParts.push(parts.length);
  slab(labX - width / 2, labX + width / 2, floorY + LAB_HEIGHT + WALL, end, CORRIDOR_END);
  for (const side of [-1, 1]) wall(labX + side * (width / 2 - 0.15) - 0.15, labX + side * (width / 2 - 0.15) + 0.15, floorY, floorY + LAB_HEIGHT + WALL, end, CORRIDOR_END);
  wall(labX - width / 2, labX + width / 2, floorY, floorY + LAB_HEIGHT + WALL, end, end + 0.3);
  wall(labX - width / 2, exitX - CORRIDOR_HALF_WIDTH, floorY, floorY + LAB_HEIGHT + WALL, CORRIDOR_END - 0.3, CORRIDOR_END);
  wall(exitX + CORRIDOR_HALF_WIDTH, labX + width / 2, floorY, floorY + LAB_HEIGHT + WALL, CORRIDOR_END - 0.3, CORRIDOR_END);
  wall(exitX - CORRIDOR_HALF_WIDTH, exitX + CORRIDOR_HALF_WIDTH, floorY + CORRIDOR_HEIGHT, floorY + LAB_HEIGHT + WALL, CORRIDOR_END - 0.3, CORRIDOR_END);
  volume(labX - width / 2, labX + width / 2, floorY - 0.3, floorY + LAB_HEIGHT + WALL, end, CORRIDOR_END);
  lamps.push(point(exitX, floorY + 2.7, (CORRIDOR_END + WELL_END) / 2),
    point(labX - width / 4, floorY + 5.5, (end + CORRIDOR_END) / 2),
    point(labX + width / 4, floorY + 5.5, (end + CORRIDOR_END) / 2));
}

/** All three orientations share this plan. Only the room shaft is mirrored to avoid the east door. */
export function buildTowerLab(index: number, position: { x: number; z: number }, orientation: TowerOrientation, flights: number, kind: TowerLab['kind'] = 'full'): TowerLab {
  const builder = createLabBuilder(index, position, orientation, flights, kind);
  const { x, z, groundY, mirror, rotation, floorY, parts, ceilingParts, flightSurfaces, route, volumes, footprints, lamps } = builder;
  buildRoomShaft(builder);
  const exitX = buildStairwell(builder);
  if (kind !== 'dead-end') buildLab(builder, exitX);
  builder.sealRoofJoints();
  const transform = (p: THREE.Vector3) => { p.x *= mirror; return p.applyQuaternion(rotation); };
  return { index, x, z, groundY, orientation, flights, kind, floorY: groundY + floorY, parts, ceilingParts,
    flightSurfaces: flightSurfaces.map(({ start, end }) => ({ start: transform(start), end: transform(end) })),
    route: route.map(transform), volumes, footprints,
    lamps: lamps.map(p => transform(p).add(new THREE.Vector3(x, groundY, z))) };
}

export function towerDoorPlane(id: number): DoorPlane | null {
  const index = towerIndexFromDoorId(id), at = index === null ? undefined : getWatchTowerPositions()[index];
  return at ? { axis: 'x', side: -1, x: at.x + 3, z: at.z, y: sampleHeight(at.x, at.z), width: 1.2, height: 2.2 } : null;
}

/** Quarter turns keep the rotated rectangles axis aligned, so this is their exact separation. */
export function labSeparation(a: LabVolume, b: LabVolume): number {
  return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
}

export function labsClear(a: TowerLab, b: TowerLab): boolean {
  return a.footprints.every(p => b.footprints.every(q => labSeparation(p, q) >= 4 ||
    (Math.abs(p.floorY - q.floorY) >= 8 && (p.ceilY < q.floorY || q.ceilY < p.floorY))));
}

export function labInsideWorld(volume: LabVolume): boolean {
  return [volume.minX, volume.maxX].every(x => [volume.minZ, volume.maxZ].every(z => Math.hypot(x, z) < WORLD_EDGE_RAMP_START));
}

let coverSeed: number | undefined;
const heightSamples = new Map<number, Map<number, number>>();
const coverHeights = new Map<string, number>();

/** Include the inflated rectangle's edges even when they do not fall on an integer grid. */
export function lowestCoverHeight(volume: LabVolume): number {
  const seed = getWorldSeed();
  if (coverSeed !== seed) {
    coverSeed = seed;
    heightSamples.clear();
    coverHeights.clear();
  }
  const key = [volume.minX, volume.maxX, volume.minZ, volume.maxZ].join(',');
  const cached = coverHeights.get(key);
  if (cached !== undefined) return cached;
  let lowest = Infinity;
  for (let x = volume.minX - 1; x < volume.maxX + 2; x++) {
    const px = Math.min(x, volume.maxX + 1);
    let column = heightSamples.get(px);
    if (!column) { column = new Map(); heightSamples.set(px, column); }
    for (let z = volume.minZ - 1; z < volume.maxZ + 2; z++) {
      const pz = Math.min(z, volume.maxZ + 1);
      let height = column.get(pz);
      if (height === undefined) { height = sampleHeight(px, pz); column.set(pz, height); }
      lowest = Math.min(lowest, height);
    }
  }
  coverHeights.set(key, lowest);
  return lowest;
}

let cache: { seed: number; labs: TowerLab[] } | null = null;

/** Deterministic tower-index order, one seed retained, and no changes to tower placement. */
export function computeTowerLabs(): TowerLab[] {
  const seed = getWorldSeed();
  if (cache?.seed === seed) return cache.labs;
  const positions = getWatchTowerPositions(), labs: TowerLab[] = [];
  const orientations = positions.map((position, index) => {
    const order: TowerOrientation[] = ['south', 'west', 'north'];
    const distance = (orientation: TowerOrientation) => {
      const offset = new THREE.Vector3(0, 0, -20).applyQuaternion(towerRotation(orientation));
      return Math.min(...positions.filter((_, i) => i !== index).map(p => Math.hypot(position.x + offset.x - p.x, position.z + offset.z - p.z)));
    };
    return order.sort((a, b) => distance(b) - distance(a));
  });
  const built = new Map<string, TowerLab | null>();
  function* candidates(index: number, kind: TowerLab['kind'], previous: TowerLab[], passes: (candidate: TowerLab) => boolean = () => true): Generator<TowerLab> {
    for (const orientation of orientations[index]!) {
      for (const flights of kind === 'dead-end' ? [1] : [3, 4, 5]) {
        const key = `${index}:${orientation}:${kind}:${flights}`;
        let candidate = built.get(key);
        if (candidate === undefined) {
          candidate = buildTowerLab(index, positions[index]!, orientation, flights, kind);
          if (!candidate.footprints.every(p => labInsideWorld(p) && lowestCoverHeight(p) - p.ceilY >= 1 - 1e-6)) candidate = null;
          built.set(key, candidate);
        }
        if (candidate && previous.every(p => labsClear(candidate, p)) && passes(candidate)) {
          yield candidate;
          break;
        }
      }
    }
  }
  for (let index = 0; index < positions.length; index++) {
    const future = positions.slice(index + 1).map((_, offset) => index + 1 + offset);
    const has = (next: number, kind: TowerLab['kind'], previous: TowerLab[]) => !candidates(next, kind, previous).next().done;
    // Reserve later entrances and retain a full-shell option where one remains possible.
    const fullPossible = future.map(next => has(next, 'full', labs));
    let chosen: TowerLab | undefined;
    for (const reserveFull of [true, false]) {
      for (const kind of ['full', 'compact', 'dead-end'] as const) {
        chosen = candidates(index, kind, labs, candidate => {
          const previous = [...labs, candidate];
          return future.every(next => has(next, 'dead-end', previous)) &&
            (!reserveFull || future.every((next, i) => !fullPossible[i] || has(next, 'full', previous)));
        }).next().value;
        if (chosen) break;
      }
      if (chosen) break;
    }
    if (!chosen) throw new Error(`No covered tower landing for seed ${seed}, tower ${index}`);
    labs.push(chosen);
  }
  cache = { seed, labs };
  return labs;
}
