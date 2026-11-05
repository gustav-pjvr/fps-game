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
const FIRST_FLOOR = -3.85;
const WELL_END = -9;
const CORRIDOR_END = -10;

/** A slab sunk below its walking surface, extended under the flush landings. */
function ramp(start: THREE.Vector3, end: THREE.Vector3): BoxTransform {
  const direction = end.clone().sub(start).normalize();
  const slab = boxAlong(start.clone().addScaledVector(direction, -0.05), end.clone().addScaledVector(direction, 0.05), 0.3, WIDTH);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(slab.rotation);
  return { ...slab, center: slab.center.clone().addScaledVector(up, -0.15) };
}

/** All three orientations share this plan. Only the room's lane changes to avoid the east door. */
export function buildTowerLab(index: number, position: { x: number; z: number }, orientation: TowerOrientation, flights: number, kind: TowerLab['kind'] = 'full'): TowerLab {
  const { x, z } = position, groundY = sampleHeight(x, z);
  const rotation = towerRotation(orientation), mirror = orientation === 'north' ? -1 : 1, lane = -1.65;
  const parts: TowerPart[] = [], route: THREE.Vector3[] = [], volumes: LabVolume[] = [], footprints: LabVolume[] = [];
  const ceilingParts: number[] = [], flightSurfaces: { start: THREE.Vector3; end: THREE.Vector3 }[] = [];
  const lamps: THREE.Vector3[] = [];
  const floorY = FIRST_FLOOR - (flights - 1) * 3;
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

  volume(-2.7, 2.7, floorY, 3, -2.7, 2.7, false);
  // Approach the top landing from the side, never cutting diagonally across the hole.
  route.push(point(0, 0.05, 0), point(0, 0.05, 2.15), point(lane, 0.05, 2.15));
  flight(point(lane, 0.05, 1.65), point(lane, FIRST_FLOOR, -4));
  slab(lane - 0.9, lane + 0.9, FIRST_FLOOR, -5.5, -4);
  const wellEnd = kind === 'dead-end' ? -5.5 : WELL_END;
  const east = kind === 'dead-end' ? 3 : 6.75;
  const roofAt = (px: number, south: boolean) => {
    const t = Math.max(0, Math.min(1, (px + 0.75) / 5.4));
    return FIRST_FLOOR - (south ? 6 - t * 3 : t * 3) + 2.75;
  };
  slab(-2.85, east, floorY, wellEnd, -3.5);
  // Crosswise switchbacks fit the stairwell beside the core's apron. Roof strips follow the
  // highest flight in each lane, rather than exposing a tall box on a downhill site.
  const roofTile = (left: number, right: number, near: number, far: number, roof: number, thickness = 0.15) => {
    const roofNear = Math.min(near, left === -2.85 && near === -3 ? -4.1 : -3.5);
    ceilingParts.push(parts.length);
    add(box((left + right) / 2, roof - thickness / 2, (far + roofNear) / 2, right - left, thickness, roofNear - far));
    volume(left, right, floorY - 0.3, roof, far, near);
    if (near === -3) {
      wall(left, Math.min(right, lane - 0.9), floorY, roof, -3.3, -3);
      wall(Math.max(left, lane + 0.9), right, floorY, roof, -3.3, -3);
    }
    if (left === -2.85) wall(-2.85, -2.55, floorY, roof, far, near);
    if (right === east) wall(east - 0.3, east, floorY, roof, far, near);
  };
  for (const south of kind === 'dead-end' ? [false] : [false, true]) {
    const near = south ? -6 : -3, far = south ? wellEnd : Math.max(wellEnd, -6);
    const edges = [-2.85, -0.75];
    for (let at = 0.25; at < east; at += 1) edges.push(at);
    edges.push(east);
    for (let i = 0; i < edges.length - 1; i++) {
      const left = edges[i]!, right = edges[i + 1]!;
      const roof = kind === 'dead-end' ? -1.12 : Math.max(roofAt(left, south), roofAt(right, south));
      if (!south && left === -2.85) {
        // Thin steel over D1's arrival keeps the capsule clear of the leading ceiling edge.
        // This entire inflated strip lies inside the tower's flat terrain apron.
        roofTile(left, right, near, -5.5, -1, 0.05);
        if (far < -5.5) roofTile(left, right, -5.5, far, -4.12);
      } else roofTile(left, right, near, far, roof);
    }
  }
  wall(lane - 0.9, lane + 0.9, floorY, FIRST_FLOOR - 0.3, -3.3, -3);
  let exitX = lane;
  for (let k = 1; k < flights; k++) {
    const forward = k % 2 === 1, pz = forward ? -4.5 : -7.5;
    const y = FIRST_FLOOR - (k - 1) * 3;
    const from = forward ? -0.75 : 4.65, to = forward ? 4.65 : -0.75;
    const fromLanding = forward ? lane : 5.55;
    exitX = forward ? 5.55 : lane;
    route.push(point(fromLanding, y, pz));
    flight(point(from, y, pz), point(to, y - 3, pz));
    slab(exitX - 0.9, exitX + 0.9, y - 3, -8.7, -3.5);
    route.push(point(exitX, y - 3, pz));
  }
  if (kind === 'dead-end') {
    wall(-2.85, east, floorY, -1.12, wellEnd, wellEnd + 0.3);
    route.push(point(lane, floorY, -4.5));
  } else {
    route.push(point(exitX, floorY, -7.5), point(exitX, floorY, CORRIDOR_END - 2));
    // The lab's entry follows the final landing, so no return route runs into a ramp underside.
    for (let left = -2.85; left < east; left += 1) {
      const right = Math.min(east, left + 1), roof = Math.max(roofAt(left, true), roofAt(right, true));
      wall(left, Math.min(right, exitX - 1.2), floorY, roof, WELL_END, WELL_END + 0.3);
      wall(Math.max(left, exitX + 1.2), right, floorY, roof, WELL_END, WELL_END + 0.3);
      wall(Math.max(left, exitX - 1.2), Math.min(right, exitX + 1.2), floorY + 3, roof, WELL_END, WELL_END + 0.3);
    }
    slab(exitX - 1.5, exitX + 1.5, floorY, CORRIDOR_END, WELL_END);
    ceilingParts.push(parts.length);
    slab(exitX - 1.5, exitX + 1.5, floorY + 3.3, CORRIDOR_END, WELL_END);
    for (const side of [-1, 1]) wall(exitX + side * 1.35 - 0.15, exitX + side * 1.35 + 0.15, floorY, floorY + 3.3, CORRIDOR_END, WELL_END);
    volume(exitX - 1.5, exitX + 1.5, floorY - 0.3, floorY + 3.3, CORRIDOR_END, WELL_END);
    const width = kind === 'full' ? 26 : 10, depth = kind === 'full' ? 18 : 8;
    const lateral = new THREE.Vector3(mirror, 0, 0).applyQuaternion(rotation);
    // The wide entrance wall can slide past a straight corridor. Bias that spare width toward
    // the map interior so the outer corner does not needlessly enter the world edge ramp.
    const inward = THREE.MathUtils.clamp(-x * lateral.x - z * lateral.z, -11.5, 11.5);
    const labX = kind === 'full' ? THREE.MathUtils.clamp(inward, exitX - 11.5, exitX + 11.5) : exitX, end = CORRIDOR_END - depth;
    slab(labX - width / 2, labX + width / 2, floorY, end, CORRIDOR_END);
    ceilingParts.push(parts.length);
    slab(labX - width / 2, labX + width / 2, floorY + 6.3, end, CORRIDOR_END);
    for (const side of [-1, 1]) wall(labX + side * (width / 2 - 0.15) - 0.15, labX + side * (width / 2 - 0.15) + 0.15, floorY, floorY + 6.3, end, CORRIDOR_END);
    wall(labX - width / 2, labX + width / 2, floorY, floorY + 6.3, end, end + 0.3);
    wall(labX - width / 2, exitX - 1.2, floorY, floorY + 6.3, CORRIDOR_END - 0.3, CORRIDOR_END);
    wall(exitX + 1.2, labX + width / 2, floorY, floorY + 6.3, CORRIDOR_END - 0.3, CORRIDOR_END);
    wall(exitX - 1.2, exitX + 1.2, floorY + 3, floorY + 6.3, CORRIDOR_END - 0.3, CORRIDOR_END);
    volume(labX - width / 2, labX + width / 2, floorY - 0.3, floorY + 6.3, end, CORRIDOR_END);
    lamps.push(point(exitX, floorY + 2.7, (CORRIDOR_END + WELL_END) / 2),
      point(labX - width / 4, floorY + 5.5, (end + CORRIDOR_END) / 2),
      point(labX + width / 4, floorY + 5.5, (end + CORRIDOR_END) / 2));
  }
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
