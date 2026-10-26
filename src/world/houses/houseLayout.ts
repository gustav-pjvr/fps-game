import type { DoorPlane } from '../doors/doorGeometry.ts';

/**
 * The enterable Valley houses (docs/enterable-buildings.md), pure: for each of the three designs in
 * world/houseDesigns.ts, its walls with their real openings (the front door, windows, inner
 * doorways), floors and ceilings, rooms with a ceiling lamp each, furniture, the block's stair and
 * the guard rails round its stairwell. world/houseDesigns.ts builds the colliders and meshes from it;
 * the door, lamps and (part 2) the enemies' walk grid and cover points read it too.
 *
 * Local frame as in houseDesigns.ts: ground at y = 0, centred on the footprint, the long side along
 * z, the front door at +z. Exterior walls keep the outer faces of the old solid volumes, so the
 * outside reads as before; they are WALL_THICKNESS thick inward.
 */

/** An axis-aligned box by its bounds in the local frame. */
export interface AxisBox {
  readonly minX: number; readonly maxX: number;
  readonly minY: number; readonly maxY: number;
  readonly minZ: number; readonly maxZ: number;
}

export type HouseOpeningKind = 'door' | 'window' | 'doorway';

/** A hole through a wall. Doors and doorways start at the wall's foot. */
export interface HouseOpening {
  readonly kind: HouseOpeningKind;
  /** Centre along the wall's run. */
  readonly along: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface HouseWall {
  /** The wall runs along this axis; its centre line sits at `at` on the other one. */
  readonly run: 'x' | 'z';
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly bottom: number;
  readonly top: number;
  readonly thickness: number;
  /** The outside lies toward this sign on the other axis; 0 for a partition inside. */
  readonly outward: 1 | -1 | 0;
  /** The outer skin's look (a partition is lined on both faces). */
  readonly material: 'concrete' | 'cladding';
  /** Below this height the outer skin is concrete (a plinth course); 0 for none. */
  readonly plinth: number;
  readonly openings: readonly HouseOpening[];
}

export interface HouseRoom {
  readonly name: string;
  /** Floor to ceiling, wall face to wall face. */
  readonly bounds: AxisBox;
  /** The ceiling lamp's centre (an emissive panel just under the ceiling). */
  readonly lamp: { readonly x: number; readonly y: number; readonly z: number };
}

export type HouseFurnitureKind = 'crate' | 'table' | 'shelf' | 'bunk';

export interface HouseFurniture {
  readonly kind: HouseFurnitureKind;
  /** The whole piece, standing on its room's floor. */
  readonly bounds: AxisBox;
}

/** A straight flight along z, climbing from bottomZ to topZ: a walkable ramp (the collider) under
 * drawn steps. */
export interface HouseStair {
  readonly minX: number;
  readonly maxX: number;
  readonly bottomZ: number;
  readonly topZ: number;
  readonly bottomY: number;
  readonly topY: number;
}

export interface HouseLayout {
  readonly name: string;
  readonly walls: readonly HouseWall[];
  /** Walkable slabs (ground floors, the upper floor with its stairwell left open). */
  readonly floors: readonly AxisBox[];
  readonly ceilings: readonly AxisBox[];
  readonly rooms: readonly HouseRoom[];
  readonly furniture: readonly HouseFurniture[];
  readonly stair: HouseStair | null;
  /** Guard rails round the stairwell, solid like the towers' rails. */
  readonly rails: readonly AxisBox[];
  /** The front door's plane in the local frame (axis z, the room toward -z). */
  readonly door: DoorPlane;
}

export const WALL_THICKNESS = 0.2;
export const PARTITION_THICKNESS = 0.12;
export const DOOR_WIDTH = 1.1;
export const DOOR_HEIGHT = 2.1;
export const DOORWAY_WIDTH = 1.1;
export const DOORWAY_HEIGHT = 2.05;
/** The lamp panel hangs this far under its ceiling (its centre). */
const LAMP_DROP = 0.04;
/** Wall pieces thinner than this are left out (a sill a few millimetres high is noise). */
const MIN_PIECE = 0.02;
const RAIL_HEIGHT = 1.0;
const RAIL_THICKNESS = 0.05;

export const axisBox = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): AxisBox =>
  ({ minX, maxX, minY, maxY, minZ, maxZ });

/** A piece of furniture standing on `floor`, centred on (x, z). */
const piece = (kind: HouseFurnitureKind, x: number, z: number, floor: number, width: number, depth: number, height: number): HouseFurniture =>
  ({ kind, bounds: axisBox(x - width / 2, x + width / 2, floor, floor + height, z - depth / 2, z + depth / 2) });

const room = (name: string, bounds: AxisBox, lampX = (bounds.minX + bounds.maxX) / 2, lampZ = (bounds.minZ + bounds.maxZ) / 2): HouseRoom =>
  ({ name, bounds, lamp: { x: lampX, y: bounds.maxY - LAMP_DROP, z: lampZ } });

const window_ = (along: number, centreY: number, width: number, height: number): HouseOpening =>
  ({ kind: 'window', along, bottom: centreY - height / 2, width, height });

/** The four walls of a rectangular shell whose outer faces are at +-halfX and +-halfZ: the long
 * sides run the full depth, the ends fit between them. */
function shell(halfX: number, halfZ: number, bottom: number, top: number, material: HouseWall['material'],
  openings: { left?: HouseOpening[]; right?: HouseOpening[]; front?: HouseOpening[]; back?: HouseOpening[] }, plinth = 0): HouseWall[] {
  const t = WALL_THICKNESS, c = t / 2;
  return [
    { run: 'z', at: -halfX + c, from: -halfZ, to: halfZ, bottom, top, thickness: t, outward: -1, material, plinth, openings: openings.left ?? [] },
    { run: 'z', at: halfX - c, from: -halfZ, to: halfZ, bottom, top, thickness: t, outward: 1, material, plinth, openings: openings.right ?? [] },
    { run: 'x', at: halfZ - c, from: -halfX + t, to: halfX - t, bottom, top, thickness: t, outward: 1, material, plinth, openings: openings.front ?? [] },
    { run: 'x', at: -halfZ + c, from: -halfX + t, to: halfX - t, bottom, top, thickness: t, outward: -1, material, plinth, openings: openings.back ?? [] },
  ];
}

const partition = (run: 'x' | 'z', at: number, from: number, to: number, bottom: number, top: number, openings: HouseOpening[]): HouseWall =>
  ({ run, at, from, to, bottom, top, thickness: PARTITION_THICKNESS, outward: 0, material: 'concrete', plinth: 0, openings });

const frontDoor = (x: number, halfZ: number, floor: number): DoorPlane =>
  ({ axis: 'z', side: -1, x, z: halfZ - WALL_THICKNESS / 2, y: floor, width: DOOR_WIDTH, height: DOOR_HEIGHT });

const doorOpening = (door: DoorPlane): HouseOpening =>
  ({ kind: 'door', along: door.x, bottom: door.y ?? 0, width: door.width, height: door.height });

const doorway = (along: number, floor: number): HouseOpening =>
  ({ kind: 'doorway', along, bottom: floor, width: DOORWAY_WIDTH, height: DOORWAY_HEIGHT });

/** Bunkhouse (3.83 x 7.0 m): a front room and a bunk room behind a partition with a doorway. Its
 * concrete plinth is the walls' lowest course, so the floor is level with the street (the player's
 * controller does not step a 0.3 m sill reliably). */
function bunkhouse(): HouseLayout {
  const halfX = 1.65, halfZ = 3.25, floor = 0.05, wallTop = 3.0, ceiling = 2.9;
  const inX = halfX - WALL_THICKNESS, inZ = halfZ - WALL_THICKNESS;
  const side = [window_(-1.7, 1.75, 1.2, 0.75), window_(1.4, 1.75, 1.2, 0.75)];
  const door = frontDoor(0.3, halfZ, 0);
  const split = 0, half = PARTITION_THICKNESS / 2;
  return {
    name: 'bunkhouse',
    walls: [
      ...shell(halfX, halfZ, 0, wallTop, 'cladding', { left: side, right: side, front: [doorOpening(door)] }, 0.5),
      partition('x', split, -inX, inX, floor, ceiling, [doorway(-0.55, floor)]),
    ],
    floors: [axisBox(-inX, inX, 0, floor, -inZ, inZ)],
    ceilings: [axisBox(-inX, inX, ceiling, wallTop, -inZ, inZ)],
    rooms: [
      room('front room', axisBox(-inX, inX, floor, ceiling, split + half, inZ)),
      room('bunk room', axisBox(-inX, inX, floor, ceiling, -inZ, split - half)),
    ],
    furniture: [
      piece('table', -1.1, 1.9, floor, 0.7, 1.2, 0.75),
      piece('crate', 1.05, 0.55, floor, 0.8, 0.8, 0.8),
      piece('crate', 1.15, 1.25, floor, 0.6, 0.6, 0.6),
      piece('bunk', 1.05, -2.0, floor, 0.8, 2.0, 0.55),
      piece('bunk', -1.05, -2.0, floor, 0.8, 2.0, 0.55),
      piece('shelf', 0, -2.83, floor, 1.0, 0.44, 1.6),
    ],
    stair: null,
    rails: [],
    door,
  };
}

/** Two-storey block (3.58 x 7.22 m): a ground floor room and an upper room over the street, joined by
 * a straight stair along the right-hand wall. */
function block(): HouseLayout {
  const halfX = 1.7, halfZ = 3.5, ground = 0.05, upper = 3.05, slab = 2.8, storey = 3.0, roof = 5.8;
  const inX = halfX - WALL_THICKNESS, inZ = halfZ - WALL_THICKNESS;
  const lower = [window_(-2, 1.6, 1.1, 0.8), window_(0.4, 1.6, 1.1, 0.8)];
  const higher = [window_(-2.3, 4.45, 1.0, 0.9), window_(0, 4.45, 1.0, 0.9), window_(2.3, 4.45, 1.0, 0.9)];
  const door = frontDoor(-0.3, halfZ, 0);
  // The stair climbs toward the back along the right wall; its well is open above the flight where a
  // climbing head would meet the slab, and the upper floor is whole over its foot and its landing.
  const stair: HouseStair = { minX: 0.5, maxX: inX, bottomZ: 2.6, topZ: -2.2, bottomY: ground, topY: upper };
  const wellFront = 1.5;
  return {
    name: 'block',
    walls: [
      ...shell(halfX, halfZ, 0, storey, 'concrete', { left: lower, right: lower, front: [doorOpening(door)] }),
      ...shell(halfX, halfZ, storey, roof, 'cladding', { left: higher, right: higher, front: [window_(0, 4.45, 1.4, 0.9)] }),
    ],
    floors: [
      axisBox(-inX, inX, 0, ground, -inZ, inZ),
      axisBox(-inX, stair.minX, slab, upper, -inZ, inZ),
      axisBox(stair.minX, inX, slab, upper, wellFront, inZ),
      axisBox(stair.minX, inX, slab, upper, -inZ, stair.topZ),
    ],
    // The ground floor's ceiling is the upper floor; the upper room's is the roof slab.
    ceilings: [],
    rooms: [
      room('ground floor', axisBox(-inX, inX, ground, slab, -inZ, inZ), -0.5, -0.3),
      room('upper floor', axisBox(-inX, inX, upper, roof, -inZ, inZ), -0.5, 0),
    ],
    furniture: [
      piece('table', -1.2, -1.0, ground, 0.6, 1.2, 0.75),
      piece('crate', -1.05, -2.85, ground, 0.8, 0.8, 0.8),
      piece('crate', -0.25, -2.95, ground, 0.6, 0.6, 0.6),
      piece('shelf', -1.28, 2.0, ground, 0.44, 1.2, 1.8),
      piece('bunk', -1.1, -2.3, upper, 0.8, 2.0, 0.55),
      piece('crate', -1.1, 2.85, upper, 0.7, 0.7, 0.7),
      piece('crate', 1.1, 2.9, upper, 0.6, 0.6, 0.6),
    ],
    stair,
    rails: [
      axisBox(stair.minX - RAIL_THICKNESS, stair.minX, upper, upper + RAIL_HEIGHT, stair.topZ, wellFront),
      axisBox(stair.minX, inX, upper, upper + RAIL_HEIGHT, wellFront - RAIL_THICKNESS, wellFront),
    ],
    door,
  };
}

/** Workshop (6.56 x 7.22 m): a hall behind the (shut) roller door, entered by the side door, with an
 * office in the back corner through a doorway. */
function workshop(): HouseLayout {
  const halfX = 3.0, halfZ = 3.45, floor = 0.05, wallTop = 3.6, ceiling = 3.45;
  const inX = halfX - WALL_THICKNESS, inZ = halfZ - WALL_THICKNESS;
  const side = [window_(-2.2, 1.875, 1.4, 0.75), window_(0, 1.875, 1.4, 0.75), window_(2.2, 1.875, 1.4, 0.75)];
  const door = frontDoor(1.65, halfZ, 0);
  // The office: x from officeX to the right wall, z from the back wall to officeZ.
  const officeX = 0.66, officeZ = -1.0, half = PARTITION_THICKNESS / 2;
  return {
    name: 'workshop',
    walls: [
      ...shell(halfX, halfZ, 0, wallTop, 'concrete', { left: side, right: side, front: [doorOpening(door)] }),
      partition('x', officeZ, officeX - half, inX, floor, ceiling, [doorway(1.75, floor)]),
      partition('z', officeX, -inZ, officeZ - half, floor, ceiling, []),
    ],
    floors: [axisBox(-inX, inX, 0, floor, -inZ, inZ)],
    ceilings: [axisBox(-inX, inX, ceiling, wallTop, -inZ, inZ)],
    rooms: [
      room('hall', axisBox(-inX, inX, floor, ceiling, -inZ, inZ), -0.9, 0.6),
      room('office', axisBox(officeX + half, inX, floor, ceiling, -inZ, officeZ - half)),
    ],
    furniture: [
      piece('table', -2.45, 0, floor, 0.7, 1.8, 0.9),
      piece('crate', -2.3, -2.75, floor, 0.9, 0.9, 0.9),
      piece('crate', -2.3, 2.75, floor, 0.9, 0.9, 0.9),
      piece('crate', -0.4, 1.3, floor, 1.0, 1.0, 1.2),
      piece('shelf', -0.6, -3.03, floor, 1.6, 0.44, 1.8),
      piece('table', 2.4, -2.3, floor, 0.8, 0.9, 0.75),
      piece('shelf', 1.21, -3.03, floor, 0.98, 0.44, 1.8),
    ],
    stair: null,
    rails: [],
    door,
  };
}

/** In HOUSE_DESIGNS order: bunkhouse, block, workshop. */
export const HOUSE_LAYOUTS: readonly HouseLayout[] = [bunkhouse(), block(), workshop()];

/** The solid parts of a wall around its openings: a full-height piece between neighbouring openings
 * (and at both ends), and pieces under and over each opening. */
export function wallPieces(wall: HouseWall): AxisBox[] {
  const pieces: AxisBox[] = [];
  const add = (a0: number, a1: number, y0: number, y1: number): void => {
    if (a1 - a0 < MIN_PIECE || y1 - y0 < MIN_PIECE) return;
    const h = wall.thickness / 2;
    pieces.push(wall.run === 'x'
      ? axisBox(a0, a1, y0, y1, wall.at - h, wall.at + h)
      : axisBox(wall.at - h, wall.at + h, y0, y1, a0, a1));
  };
  const openings = [...wall.openings].sort((a, b) => a.along - b.along);
  let cursor = wall.from;
  for (const opening of openings) {
    const a0 = opening.along - opening.width / 2, a1 = opening.along + opening.width / 2;
    add(cursor, a0, wall.bottom, wall.top);
    add(a0, a1, wall.bottom, opening.bottom);
    add(a0, a1, opening.bottom + opening.height, wall.top);
    cursor = a1;
  }
  add(cursor, wall.to, wall.bottom, wall.top);
  return pieces;
}

/** The part of a piece of furniture that stops players and shots: a table's top (its legs are drawn
 * only, so a shot under it carries on); everything else whole. */
export function furnitureCollider(item: HouseFurniture): AxisBox {
  const b = item.bounds;
  return item.kind === 'table' ? { ...b, minY: b.maxY - 0.1 } : b;
}

/** Thickness of the stair's ramp slab. */
export const STAIR_RAMP_THICKNESS = 0.2;

/** The stair's collider: a sloped slab whose top face runs from the foot of the flight to the edge
 * of the upper floor (the line through the steps' inner corners), as the segment along its centre
 * for structureKit's boxAlong (local Y across the slab, local Z across the flight). The steps are
 * drawn over it and the space under the flight stays open. */
export function stairRamp(stair: HouseStair): { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number }; thickness: number; width: number } {
  const run = stair.bottomZ - stair.topZ, rise = stair.topY - stair.bottomY, length = Math.hypot(run, rise);
  // The slab's upward normal: perpendicular to the slope, leaning back toward the foot (+z here).
  const ny = Math.abs(run) / length, nz = Math.sign(run) * rise / length, half = STAIR_RAMP_THICKNESS / 2;
  const x = (stair.minX + stair.maxX) / 2;
  return {
    start: { x, y: stair.bottomY - ny * half, z: stair.bottomZ - nz * half },
    end: { x, y: stair.topY - ny * half, z: stair.topZ - nz * half },
    thickness: STAIR_RAMP_THICKNESS,
    width: stair.maxX - stair.minX,
  };
}

/** The drawn steps over the ramp: `count` blocks, each from its tread down past the slab. */
export function stairSteps(stair: HouseStair): AxisBox[] {
  const rise = stair.topY - stair.bottomY, run = stair.bottomZ - stair.topZ;
  const count = Math.max(1, Math.round(rise / 0.19)), dz = run / count, dy = rise / count;
  const steps: AxisBox[] = [];
  for (let k = 0; k < count; k++) {
    const z0 = stair.bottomZ - k * dz, z1 = stair.bottomZ - (k + 1) * dz;
    steps.push(axisBox(stair.minX, stair.maxX, stair.bottomY + k * dy - STAIR_RAMP_THICKNESS * 1.2, stair.bottomY + (k + 1) * dy, Math.min(z0, z1), Math.max(z0, z1)));
  }
  return steps;
}

/** The stair's slope in degrees. */
export function stairSlopeDegrees(stair: HouseStair): number {
  return Math.atan2(stair.topY - stair.bottomY, Math.abs(stair.bottomZ - stair.topZ)) * 180 / Math.PI;
}

/** A point of a house's local frame in the world, for a house at (originX, groundY, originZ) turned
 * by rotationY about +Y (three's rotation.y, the same turn as the house's rigid body). */
export function houseToWorld(x: number, y: number, z: number, originX: number, groundY: number, originZ: number, rotationY: number): { x: number; y: number; z: number } {
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  return { x: originX + x * c + z * s, y: groundY + y, z: originZ - x * s + z * c };
}

/** A house's door in the world. Houses only turn in quarter turns, so the door stays axis-aligned:
 * its axis swaps on an odd quarter turn and its inward side turns with it. */
export function doorToWorld(door: DoorPlane, originX: number, groundY: number, originZ: number, rotationY: number): DoorPlane {
  const centre = houseToWorld(door.x, door.y ?? 0, door.z, originX, groundY, originZ, rotationY);
  // The inward direction (toward the room) in the local frame, turned into the world.
  const inX = door.axis === 'x' ? door.side : 0, inZ = door.axis === 'z' ? door.side : 0;
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  const wx = inX * c + inZ * s, wz = -inX * s + inZ * c;
  const axis = Math.abs(wx) > Math.abs(wz) ? 'x' : 'z';
  const side = (axis === 'x' ? wx : wz) > 0 ? 1 : -1;
  return { axis, side, x: centre.x, y: centre.y, z: centre.z, width: door.width, height: door.height };
}
