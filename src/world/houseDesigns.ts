import * as THREE from 'three';
import { addRailing, box, boxAlong, PieceCollector, prism, type BoxTransform, type PieceMaterial } from './structureKit.ts';
import { STRUCTURE_TILE_METRES } from './structureMaterials.ts';

/**
 * The town houses, rebuilt in the Opus station language (docs/world-redesign.md): prefab outpost
 * buildings in concrete, ribbed sage cladding and corrugated roofing, with lit windows and a work
 * lamp at each door. Exteriors only for now; enterable rooms are a later phase.
 *
 * Each design keeps the footprint of the Kenney house it replaces (measured from the GLBs at their
 * old scale), so town layouts, cover points and spawn checks see the same rectangles. Every solid
 * part is built as both a collider and a mesh; trim, frames, lamps and pipes are drawn only.
 * Local frame: ground at y = 0, centred on the footprint, the long side along z, the front door
 * at +z.
 */

export interface HouseSolid {
  readonly box: BoxTransform;
  readonly material: PieceMaterial;
}

export interface HouseDesign {
  readonly name: string;
  /** Full extent along x and z, eaves and steps included. */
  readonly footprintWidth: number;
  readonly footprintDepth: number;
  readonly solids: readonly HouseSolid[];
  /** Convex solids (gable fills), as corner points for a hull collider. */
  readonly hulls: readonly Float32Array[];
  /** One mesh per material, solids and detail together. */
  build(): THREE.Group;
}

/** Which windows are lit: a fixed pattern from the window's position, so every placement of a
 * design and every client agree, with about half the rooms lit. A wall of identical glowing panes
 * read as fake in the first screenshots. */
function isLit(at: THREE.Vector3): boolean {
  const n = Math.sin(at.x * 12.9898 + at.y * 78.233 + at.z * 37.719) * 43758.5453;
  return n - Math.floor(n) < 0.5;
}

/** A window in a wall: a steel frame proud of the wall, a pane inside it (lit or dark glass), and
 * a mullion across wide ones. `normal` is the wall's outward direction along x or z. */
function addWindow(pieces: PieceCollector, at: THREE.Vector3, normal: 'x+' | 'x-' | 'z+' | 'z-', width: number, height: number): void {
  const alongZ = normal[0] === 'x';
  const sign = normal[1] === '+' ? 1 : -1;
  const frame = (depth: number, inset: number) =>
    alongZ
      ? box(at.x + sign * depth / 2, at.y, at.z, depth, height - inset, width - inset)
      : box(at.x, at.y, at.z + sign * depth / 2, width - inset, height - inset, depth);
  pieces.addBox('steel', frame(0.06, 0));
  pieces.addBox(isLit(at) ? 'window' : 'glass', frame(0.08, 0.12));
  if (width > 0.9) {
    pieces.addBox('steel', alongZ ? box(at.x + sign * 0.05, at.y, at.z, 0.1, height - 0.12, 0.05) : box(at.x, at.y, at.z + sign * 0.05, 0.05, height - 0.12, 0.1));
  }
  // A sill under it.
  pieces.addBox('steel', alongZ ? box(at.x + sign * 0.06, at.y - height / 2 - 0.03, at.z, 0.12, 0.06, width + 0.1) : box(at.x, at.y - height / 2 - 0.03, at.z + sign * 0.06, width + 0.1, 0.06, 0.12));
}

/** A steel door in a +z or -z end wall with a small awning and a warm lamp under it. */
function addDoor(pieces: PieceCollector, x: number, wallZ: number, sign: 1 | -1, width = 1, height = 2.1): void {
  pieces.addBox('steel', box(x, height / 2, wallZ + sign * 0.04, width, height, 0.08));
  pieces.addBox('steel', box(x, height + 0.25, wallZ + sign * 0.2, width + 0.5, 0.08, 0.4));
  pieces.addBox('lamp', box(x, height + 0.18, wallZ + sign * 0.12, 0.3, 0.06, 0.12));
}

/** Vertical steel trim on a box's four corners, which keeps a clad volume from reading as a crate. */
function addCornerTrim(pieces: PieceCollector, halfX: number, halfZ: number, y0: number, y1: number): void {
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pieces.addBox('steel', box(sx! * halfX, (y0 + y1) / 2, sz! * halfZ, 0.12, y1 - y0, 0.12));
  }
}

function makeDesign(name: string, footprintWidth: number, footprintDepth: number, solids: HouseSolid[], hulls: { geometry: THREE.BufferGeometry; points: Float32Array; material: PieceMaterial }[], detail: (pieces: PieceCollector) => void): HouseDesign {
  return {
    name,
    footprintWidth,
    footprintDepth,
    solids,
    hulls: hulls.map((hull) => hull.points),
    build() {
      const pieces = new PieceCollector();
      for (const solid of solids) {
        if (solid.material === 'perforated') addRailing(pieces, solid.box);
        else pieces.addBox(solid.material, solid.box);
      }
      for (const hull of hulls) pieces.add(hull.material, hull.geometry.clone(), new THREE.Matrix4());
      detail(pieces);
      return pieces.build();
    },
  };
}

/** Bunkhouse: one storey of sage cladding on a concrete plinth under a single-pitch roof. Replaces
 * Kenney house A (3.83 x 7.0 m, 4 m tall). */
function bunkhouse(): HouseDesign {
  const W = 3.83;
  const D = 7.0;
  const wallX = 1.65;
  const wallZ = 3.25;
  const wallTop = 3.0;
  const roofLow = 3.1;
  const roofHigh = 3.62;
  const roofSlope = (roofHigh - roofLow) / W;
  // The triangle between the wall top and the sloping roof's underside, clad like the walls.
  const fill = prism(
    new THREE.Vector2(-wallX, wallTop),
    new THREE.Vector2(wallX, wallTop),
    new THREE.Vector2(wallX, roofLow + roofSlope * (wallX + W / 2) - 0.08),
    -wallZ,
    wallZ,
    STRUCTURE_TILE_METRES.cladding,
  );
  const solids: HouseSolid[] = [
    { box: box(0, 0.25, 0, wallX * 2 + 0.1, 0.5, wallZ * 2 + 0.1), material: 'concrete' },
    { box: box(0, (0.5 + wallTop) / 2, 0, wallX * 2, wallTop - 0.5, wallZ * 2), material: 'cladding' },
    { box: boxAlong(new THREE.Vector3(-W / 2, roofLow, 0), new THREE.Vector3(W / 2, roofHigh, 0), 0.16, D), material: 'roof' },
  ];
  return makeDesign('bunkhouse', W, D, solids, [{ ...fill, material: 'cladding' }], (pieces) => {
    addCornerTrim(pieces, wallX, wallZ, 0.5, wallTop);
    addDoor(pieces, 0.7, wallZ, 1);
    for (const z of [-1.7, 1.4]) {
      addWindow(pieces, new THREE.Vector3(wallX, 1.75, z), 'x+', 1.2, 0.75);
      addWindow(pieces, new THREE.Vector3(-wallX, 1.75, z), 'x-', 1.2, 0.75);
    }
    addWindow(pieces, new THREE.Vector3(-0.8, 1.75, wallZ), 'z+', 0.7, 0.75);
    // An air handler on the back wall and a vent stack through the roof.
    pieces.addBox('steel', box(0.4, 0.95, -wallZ - 0.12, 0.9, 0.7, 0.24));
    pieces.addBox('steel', box(-0.9, roofLow + 0.45, -1.8, 0.6, 0.5, 0.6));
    pieces.add('steel', new THREE.CylinderGeometry(0.09, 0.09, 0.9, 8), new THREE.Matrix4().makeTranslation(0.8, roofHigh + 0.2, 2.2));
  });
}

/** Two-storey block: a concrete ground floor, a clad upper floor, a flat roof behind a low parapet
 * with a water tank on it. Replaces Kenney house B (3.58 x 7.22 m, 6.5 m tall). */
function block(): HouseDesign {
  const W = 3.58;
  const D = 7.22;
  const wallX = 1.7;
  const wallZ = 3.5;
  const floor = 3.0;
  const roof = 5.8;
  const parapet = 0.35;
  const solids: HouseSolid[] = [
    { box: box(0, floor / 2, 0, wallX * 2, floor, wallZ * 2), material: 'concrete' },
    { box: box(0, (floor + roof) / 2, 0, wallX * 2, roof - floor, wallZ * 2), material: 'cladding' },
    { box: box(0, roof + 0.1, 0, W, 0.2, D), material: 'concrete' },
    { box: box(0, roof + 0.2 + parapet / 2, -D / 2 + 0.075, W, parapet, 0.15), material: 'concrete' },
    { box: box(0, roof + 0.2 + parapet / 2, D / 2 - 0.075, W, parapet, 0.15), material: 'concrete' },
    { box: box(-W / 2 + 0.075, roof + 0.2 + parapet / 2, 0, 0.15, parapet, D - 0.3), material: 'concrete' },
    { box: box(W / 2 - 0.075, roof + 0.2 + parapet / 2, 0, 0.15, parapet, D - 0.3), material: 'concrete' },
    { box: box(0.5, roof + 0.2 + 0.55, -1.9, 1.1, 0.7, 1.1), material: 'steel' },
  ];
  return makeDesign('block', W, D, solids, [], (pieces) => {
    // A steel band at the upper floor's slab edge.
    pieces.addBox('steel', box(0, floor, 0, wallX * 2 + 0.08, 0.18, wallZ * 2 + 0.08));
    addCornerTrim(pieces, wallX, wallZ, floor, roof);
    addDoor(pieces, -0.6, wallZ, 1);
    for (const z of [-2, 0.4]) {
      addWindow(pieces, new THREE.Vector3(wallX, 1.6, z), 'x+', 1.1, 0.8);
      addWindow(pieces, new THREE.Vector3(-wallX, 1.6, z), 'x-', 1.1, 0.8);
    }
    for (const z of [-2.3, 0, 2.3]) {
      addWindow(pieces, new THREE.Vector3(wallX, 4.45, z), 'x+', 1.0, 0.9);
      addWindow(pieces, new THREE.Vector3(-wallX, 4.45, z), 'x-', 1.0, 0.9);
    }
    addWindow(pieces, new THREE.Vector3(0, 4.45, wallZ), 'z+', 1.4, 0.9);
    // A drain pipe down the front corner and the tank's legs.
    pieces.add('steel', new THREE.CylinderGeometry(0.06, 0.06, roof, 6), new THREE.Matrix4().makeTranslation(wallX + 0.1, roof / 2, wallZ - 0.2));
    for (const [lx, lz] of [[0.05, -2.35], [0.95, -2.35], [0.05, -1.45], [0.95, -1.45]]) pieces.addBox('steel', box(lx!, roof + 0.3, lz!, 0.08, 0.2, 0.08));
  });
}

/** Workshop: a wide concrete hall under a corrugated gable roof, with a roller door and high
 * windows. Replaces Kenney house C (6.56 x 7.22 m, 6.5 m tall). */
function workshop(): HouseDesign {
  const W = 6.56;
  const D = 7.22;
  const wallX = 3.0;
  const wallZ = 3.45;
  const wallTop = 3.6;
  const eave = 3.45;
  const ridge = 5.75;
  const roofThickness = 0.15;
  const gable = prism(
    new THREE.Vector2(-wallX, wallTop),
    new THREE.Vector2(wallX, wallTop),
    new THREE.Vector2(0, ridge - roofThickness),
    -wallZ,
    wallZ,
    STRUCTURE_TILE_METRES.cladding,
  );
  const solids: HouseSolid[] = [
    { box: box(0, wallTop / 2, 0, wallX * 2, wallTop, wallZ * 2), material: 'concrete' },
    { box: boxAlong(new THREE.Vector3(-W / 2, eave, 0), new THREE.Vector3(0.02, ridge, 0), roofThickness, D), material: 'roof' },
    { box: boxAlong(new THREE.Vector3(W / 2, eave, 0), new THREE.Vector3(-0.02, ridge, 0), roofThickness, D), material: 'roof' },
  ];
  return makeDesign('workshop', W, D, solids, [{ ...gable, material: 'cladding' }], (pieces) => {
    pieces.addBox('steel', box(0, ridge + 0.05, 0, 0.36, 0.12, D + 0.02));
    // The roller door: a ribbed steel shutter in a hazard-striped frame, and a side door.
    pieces.addBox('cladding', box(-0.9, 1.45, wallZ + 0.03, 2.8, 2.9, 0.06));
    pieces.addBox('hazard', box(-0.9 - 1.5, 1.5, wallZ + 0.05, 0.16, 3.0, 0.1));
    pieces.addBox('hazard', box(-0.9 + 1.5, 1.5, wallZ + 0.05, 0.16, 3.0, 0.1));
    pieces.addBox('steel', box(-0.9, 3.05, wallZ + 0.06, 3.2, 0.2, 0.12));
    pieces.addBox('lamp', box(-0.9, 3.25, wallZ + 0.1, 0.4, 0.08, 0.14));
    addDoor(pieces, 1.9, wallZ, 1, 0.95, 2.1);
    for (const z of [-2.2, 0, 2.2]) {
      addWindow(pieces, new THREE.Vector3(wallX, 2.75, z), 'x+', 1.4, 0.55);
      addWindow(pieces, new THREE.Vector3(-wallX, 2.75, z), 'x-', 1.4, 0.55);
    }
    // A roof vent on the ridge and a generator against the back wall.
    pieces.addBox('steel', box(0, ridge + 0.3, -1.6, 0.8, 0.5, 0.8));
    pieces.addBox('steel', box(1.2, 0.5, -wallZ - 0.15, 1.3, 1.0, 0.3));
    pieces.addBox('hazard', box(1.2, 0.08, -wallZ - 0.15, 1.36, 0.16, 0.34));
  });
}

export const HOUSE_DESIGNS: readonly HouseDesign[] = [bunkhouse(), block(), workshop()];
