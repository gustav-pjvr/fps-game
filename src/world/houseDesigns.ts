import * as THREE from 'three';
import { addRailing, box, boxAlong, PieceCollector, prism, type BoxTransform, type PieceMaterial } from './structureKit.ts';
import { STRUCTURE_TILE_METRES } from './structureMaterials.ts';
import {
  furnitureCollider, HOUSE_LAYOUTS, stairRamp, stairSteps, wallPieces,
  type AxisBox, type HouseFurniture, type HouseLayout, type HouseOpening, type HouseWall,
} from './houses/houseLayout.ts';

/**
 * The town houses, rebuilt in the Opus station language (docs/world-redesign.md): prefab outpost
 * buildings in concrete, ribbed sage cladding and corrugated roofing, with a work lamp at each door.
 * Since v4.6 they are enterable (docs/enterable-buildings.md): walls with thickness and real
 * openings, floors, ceilings, rooms with furniture, and on the block a stair to the upper floor. The
 * rooms, walls and openings are the pure layout in world/houses/houseLayout.ts; this file builds the
 * colliders and meshes from it.
 *
 * Each design keeps the footprint of the Kenney house it replaces (measured from the GLBs at their
 * old scale), so town layouts, cover points and spawn checks see the same rectangles. Every solid
 * part is built as both a collider and a mesh (a wall's collider is drawn as an outer skin and an
 * inner lining); trim, frames, lamps and pipes are drawn only. Local frame: ground at y = 0, centred
 * on the footprint, the long side along z, the front door at +z.
 */

export interface HouseSolid {
  readonly box: BoxTransform;
  /** Null when the collider's look is drawn by other pieces (a wall's skin and lining, furniture, the
   * stair's steps, a rail). */
  readonly material: PieceMaterial | null;
}

export interface HouseDesign {
  readonly name: string;
  /** Full extent along x and z, eaves and steps included. */
  readonly footprintWidth: number;
  readonly footprintDepth: number;
  readonly solids: readonly HouseSolid[];
  /** Convex solids (gable fills), as corner points for a hull collider. */
  readonly hulls: readonly Float32Array[];
  /** Rooms, walls, openings, furniture and the stair. */
  readonly layout: HouseLayout;
  /** The shell (walls, floors, ceilings, roof, frames, trim): one mesh per material. */
  build(): THREE.Group;
  /** What is only seen from inside or close by (partitions, furniture, the stair, rails, lamp
   * housings), kept apart so it can be hidden at a distance. */
  buildInterior(): THREE.Group;
}

/** The inner face of an exterior wall: an interior lining this thick over the outer skin. */
const LINING = 0.04;
/** Steel frame bars round an opening. */
const FRAME = 0.06;
/** Size of a ceiling lamp's emissive panel (world/houses/HouseLights.ts draws it). */
export const LAMP_PANEL = { width: 0.6, height: 0.03, depth: 0.6 } as const;

/** Which windows are lit: a fixed pattern from the window's position, so every placement of a
 * design and every client agree, with about half the rooms lit. A wall of identical glowing panes
 * read as fake in the first screenshots. Only the bunkhouse's front pane is still glass. */
function isLit(at: THREE.Vector3): boolean {
  const n = Math.sin(at.x * 12.9898 + at.y * 78.233 + at.z * 37.719) * 43758.5453;
  return n - Math.floor(n) < 0.5;
}

const toBox = (b: AxisBox): BoxTransform =>
  box((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);

/** A drawn window on a solid wall (no opening behind it): a steel frame proud of the wall, a pane
 * inside it (lit or dark glass) and a sill. `normal` is the wall's outward direction. */
function addGlazedPanel(pieces: PieceCollector, at: THREE.Vector3, normal: 'z+', width: number, height: number): void {
  const sign = normal === 'z+' ? 1 : -1;
  const frame = (depth: number, inset: number) => box(at.x, at.y, at.z + sign * depth / 2, width - inset, height - inset, depth);
  pieces.addBox('steel', frame(0.06, 0));
  pieces.addBox(isLit(at) ? 'window' : 'glass', frame(0.08, 0.12));
  pieces.addBox('steel', box(at.x, at.y - height / 2 - 0.03, at.z + sign * 0.06, width + 0.1, 0.06, 0.12));
}

/** A wall's look over its colliders: an exterior wall's pieces as an outer skin in its material and
 * an interior lining; a partition lined on both faces. Planar UVs keep the cut pieces one surface. */
function addWallSkins(pieces: PieceCollector, wall: HouseWall): void {
  for (const p of wallPieces(wall)) {
    if (wall.outward === 0) {
      pieces.addPlanarBox('inner-concrete', p.minX, p.maxX, p.minY, p.maxY, p.minZ, p.maxZ);
      continue;
    }
    // Across the wall: from its inside face to its outside face.
    const acrossZ = wall.run === 'x';
    const lo = acrossZ ? p.minZ : p.minX, hi = acrossZ ? p.maxZ : p.maxX;
    const [innerLo, innerHi, outerLo, outerHi] = wall.outward > 0 ? [lo, lo + LINING, lo + LINING, hi] : [hi - LINING, hi, lo, hi - LINING];
    const add = (material: PieceMaterial, a: number, b: number) => acrossZ
      ? pieces.addPlanarBox(material, p.minX, p.maxX, p.minY, p.maxY, a, b)
      : pieces.addPlanarBox(material, a, b, p.minY, p.maxY, p.minZ, p.maxZ);
    add('inner-concrete', innerLo, innerHi);
    if (wall.plinth > p.minY && wall.plinth < p.maxY) {
      // The plinth course: concrete up to its height, the wall's material above.
      const [minY, maxY] = [p.minY, p.maxY];
      acrossZ ? pieces.addPlanarBox('concrete', p.minX, p.maxX, minY, wall.plinth, outerLo, outerHi) : pieces.addPlanarBox('concrete', outerLo, outerHi, minY, wall.plinth, p.minZ, p.maxZ);
      acrossZ ? pieces.addPlanarBox(wall.material, p.minX, p.maxX, wall.plinth, maxY, outerLo, outerHi) : pieces.addPlanarBox(wall.material, outerLo, outerHi, wall.plinth, maxY, p.minZ, p.maxZ);
    } else add(wall.plinth >= p.maxY ? 'concrete' : wall.material, outerLo, outerHi);
  }
}

/** Steel bars round each opening, through the wall's full thickness and a little proud of both
 * faces: jambs, a head and, under a window, a sill (outside also a deeper drip sill). */
function addOpeningFrames(pieces: PieceCollector, wall: HouseWall, steel: PieceMaterial): void {
  const depth = wall.thickness + 0.04;
  const bar = (a0: number, a1: number, y0: number, y1: number, d = depth, offset = 0) => {
    const centre = wall.at + offset;
    pieces.addBox(steel, wall.run === 'x'
      ? box((a0 + a1) / 2, (y0 + y1) / 2, centre, a1 - a0, y1 - y0, d)
      : box(centre, (y0 + y1) / 2, (a0 + a1) / 2, d, y1 - y0, a1 - a0));
  };
  for (const opening of wall.openings) {
    const a0 = opening.along - opening.width / 2, a1 = opening.along + opening.width / 2;
    const y0 = opening.bottom, y1 = opening.bottom + opening.height;
    bar(a0 - FRAME, a0, y0, y1 + FRAME);
    bar(a1, a1 + FRAME, y0, y1 + FRAME);
    bar(a0 - FRAME, a1 + FRAME, y1, y1 + FRAME);
    if (opening.kind === 'window') {
      bar(a0 - FRAME, a1 + FRAME, y0 - FRAME, y0);
      if (wall.outward !== 0) bar(a0 - 0.05, a1 + 0.05, y0 - FRAME, y0 - 0.02, 0.12, wall.outward * (wall.thickness / 2 + 0.06));
    }
  }
}

/** The work lamp and awning over the front door, outside. */
function addDoorAwning(pieces: PieceCollector, layout: HouseLayout, wallZ: number): void {
  const { x, width, height } = layout.door, y = layout.door.y ?? 0;
  pieces.addBox('steel', box(x, y + height + 0.25, wallZ + 0.2, width + 0.5, 0.08, 0.4));
  pieces.addBox('lamp', box(x, y + height + 0.18, wallZ + 0.12, 0.3, 0.06, 0.12));
}

/** Vertical steel trim on a box's four corners, which keeps a clad volume from reading as a crate. */
function addCornerTrim(pieces: PieceCollector, halfX: number, halfZ: number, y0: number, y1: number): void {
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pieces.addBox('steel', box(sx! * halfX, (y0 + y1) / 2, sz! * halfZ, 0.12, y1 - y0, 0.12));
  }
}

/** One piece of furniture, drawn in the interior materials (the Facility's look: clad crates with
 * steel caps, steel tables and shelving, a cot with an olive canvas top). */
function addFurniture(pieces: PieceCollector, item: HouseFurniture): void {
  const b = item.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ, h = b.maxY - b.minY;
  const legs = (inset: number, y0: number, y1: number) => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pieces.addBox('inner-steel', box(cx + sx! * (w / 2 - inset), (y0 + y1) / 2, cz + sz! * (d / 2 - inset), 0.05, y1 - y0, 0.05));
    }
  };
  switch (item.kind) {
    case 'crate':
      pieces.addBox('inner-cladding', box(cx, b.minY + (h - 0.04) / 2, cz, w, h - 0.04, d));
      pieces.addBox('inner-steel', box(cx, b.maxY - 0.03, cz, w + 0.03, 0.06, d + 0.03));
      pieces.addBox('inner-steel', box(cx, b.minY + 0.04, cz, w + 0.02, 0.08, d + 0.02));
      break;
    case 'table':
      pieces.addBox('inner-steel', box(cx, b.maxY - 0.03, cz, w, 0.06, d));
      legs(0.05, b.minY, b.maxY - 0.06);
      break;
    case 'shelf': {
      const alongX = w >= d;
      for (const end of [-1, 1]) {
        pieces.addBox('inner-steel', alongX ? box(cx + end * (w / 2 - 0.03), b.minY + h / 2, cz, 0.06, h, d) : box(cx, b.minY + h / 2, cz + end * (d / 2 - 0.03), w, h, 0.06));
      }
      for (let k = 0; k < 4; k++) {
        const y = b.minY + 0.12 + k * (h - 0.16) / 3;
        pieces.addBox('inner-grating', box(cx, y, cz, alongX ? w - 0.1 : w, 0.03, alongX ? d : d - 0.1));
      }
      // A few boxes on the shelves, so they read as stores rather than a rack.
      for (let k = 0; k < 3; k++) {
        const y = b.minY + 0.12 + k * (h - 0.16) / 3 + 0.13, offset = ((k * 0.37) % 0.6) - 0.3;
        pieces.addBox('inner-cladding', alongX
          ? box(cx + offset * (w / 2 - 0.2), y, cz, 0.3, 0.22, d * 0.7)
          : box(cx, y, cz + offset * (d / 2 - 0.2), w * 0.7, 0.22, 0.3));
      }
      break;
    }
    case 'bunk':
      pieces.addBox('inner-steel', box(cx, b.minY + h - 0.2, cz, w, 0.08, d));
      pieces.addBox('inner-cladding', box(cx, b.maxY - 0.07, cz, w - 0.06, 0.14, d - 0.06));
      legs(0.04, b.minY, b.maxY - 0.2);
      break;
  }
}

interface ShellParts {
  /** Exterior solids drawn in the shell (roofs, parapets, plinths, tanks). */
  readonly solids: HouseSolid[];
  readonly hulls: { geometry: THREE.BufferGeometry; points: Float32Array; material: PieceMaterial }[];
  /** The material the floors are drawn in: a slab inside the walls is interior; the bunkhouse's
   * plinth is seen from outside and gets a lining on its top. */
  readonly floorMaterial: PieceMaterial;
  /** Drawn-only exterior detail. */
  readonly detail: (pieces: PieceCollector) => void;
}

function makeDesign(name: string, footprintWidth: number, footprintDepth: number, layout: HouseLayout, shell: ShellParts): HouseDesign {
  const walls = layout.walls;
  const rail = (b: AxisBox): BoxTransform => {
    const y = (b.minY + b.maxY) / 2, h = b.maxY - b.minY;
    return b.maxZ - b.minZ > b.maxX - b.minX
      ? boxAlong(new THREE.Vector3((b.minX + b.maxX) / 2, y, b.minZ), new THREE.Vector3((b.minX + b.maxX) / 2, y, b.maxZ), h, b.maxX - b.minX)
      : boxAlong(new THREE.Vector3(b.minX, y, (b.minZ + b.maxZ) / 2), new THREE.Vector3(b.maxX, y, (b.minZ + b.maxZ) / 2), h, b.maxZ - b.minZ);
  };
  const ramp = layout.stair ? stairRamp(layout.stair) : null;
  const solids: HouseSolid[] = [
    ...shell.solids,
    ...layout.floors.map((b) => ({ box: toBox(b), material: shell.floorMaterial })),
    ...layout.ceilings.map((b) => ({ box: toBox(b), material: 'inner-concrete' as const })),
    ...walls.flatMap((wall) => wallPieces(wall).map((b) => ({ box: toBox(b), material: null }))),
    ...layout.furniture.map((item) => ({ box: toBox(furnitureCollider(item)), material: null })),
    ...layout.rails.map((b) => ({ box: rail(b), material: null })),
    ...(ramp ? [{ box: boxAlong(new THREE.Vector3(ramp.start.x, ramp.start.y, ramp.start.z), new THREE.Vector3(ramp.end.x, ramp.end.y, ramp.end.z), ramp.thickness, ramp.width), material: null }] : []),
  ];
  return {
    name,
    footprintWidth,
    footprintDepth,
    solids,
    hulls: shell.hulls.map((hull) => hull.points),
    layout,
    build() {
      const pieces = new PieceCollector();
      for (const solid of solids) {
        if (solid.material === 'perforated') addRailing(pieces, solid.box);
        else if (solid.material) pieces.addBox(solid.material, solid.box);
      }
      for (const hull of shell.hulls) pieces.add(hull.material, hull.geometry.clone(), new THREE.Matrix4());
      for (const wall of walls) {
        if (wall.outward === 0) continue;
        addWallSkins(pieces, wall);
        addOpeningFrames(pieces, wall, 'steel');
      }
      shell.detail(pieces);
      return pieces.build();
    },
    buildInterior() {
      const pieces = new PieceCollector();
      for (const wall of walls) {
        if (wall.outward !== 0) continue;
        addWallSkins(pieces, wall);
        addOpeningFrames(pieces, wall, 'inner-steel');
      }
      for (const item of layout.furniture) addFurniture(pieces, item);
      if (layout.stair) for (const step of stairSteps(layout.stair)) pieces.addPlanarBox('inner-concrete', step.minX, step.maxX, step.minY, step.maxY, step.minZ, step.maxZ);
      for (const b of layout.rails) addRailing(pieces, rail(b));
      for (const room of layout.rooms) {
        pieces.addBox('inner-steel', box(room.lamp.x, room.bounds.maxY - 0.02, room.lamp.z, LAMP_PANEL.width + 0.1, 0.04, LAMP_PANEL.depth + 0.1));
      }
      return pieces.build();
    },
  };
}

/** Bunkhouse: one storey of sage cladding on a concrete plinth under a single-pitch roof. Replaces
 * Kenney house A (3.83 x 7.0 m, 4 m tall). */
function bunkhouse(layout: HouseLayout): HouseDesign {
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
  return makeDesign('bunkhouse', W, D, layout, {
    solids: [{ box: boxAlong(new THREE.Vector3(-W / 2, roofLow, 0), new THREE.Vector3(W / 2, roofHigh, 0), 0.16, D), material: 'roof' }],
    hulls: [{ ...fill, material: 'cladding' }],
    floorMaterial: 'inner-concrete',
    detail: (pieces) => {
      addCornerTrim(pieces, wallX, wallZ, 0.5, wallTop);
      addDoorAwning(pieces, layout, wallZ);
      // The front's small window stays a glazed panel: the door's leaves slide into the wall behind it.
      addGlazedPanel(pieces, new THREE.Vector3(-0.95, 1.75, wallZ), 'z+', 0.6, 0.75);
      // An air handler on the back wall and a vent stack through the roof.
      pieces.addBox('steel', box(0.4, 0.95, -wallZ - 0.12, 0.9, 0.7, 0.24));
      pieces.addBox('steel', box(-0.9, roofLow + 0.45, -1.8, 0.6, 0.5, 0.6));
      pieces.add('steel', new THREE.CylinderGeometry(0.09, 0.09, 0.9, 8), new THREE.Matrix4().makeTranslation(0.8, roofHigh + 0.2, 2.2));
    },
  });
}

/** Two-storey block: a concrete ground floor, a clad upper floor, a flat roof behind a low parapet
 * with a water tank on it. Replaces Kenney house B (3.58 x 7.22 m, 6.5 m tall). */
function block(layout: HouseLayout): HouseDesign {
  const W = 3.58;
  const D = 7.22;
  const wallX = 1.7;
  const wallZ = 3.5;
  const floor = 3.0;
  const roof = 5.8;
  const parapet = 0.35;
  return makeDesign('block', W, D, layout, {
    solids: [
      { box: box(0, roof + 0.1, 0, W, 0.2, D), material: 'concrete' },
      { box: box(0, roof + 0.2 + parapet / 2, -D / 2 + 0.075, W, parapet, 0.15), material: 'concrete' },
      { box: box(0, roof + 0.2 + parapet / 2, D / 2 - 0.075, W, parapet, 0.15), material: 'concrete' },
      { box: box(-W / 2 + 0.075, roof + 0.2 + parapet / 2, 0, 0.15, parapet, D - 0.3), material: 'concrete' },
      { box: box(W / 2 - 0.075, roof + 0.2 + parapet / 2, 0, 0.15, parapet, D - 0.3), material: 'concrete' },
      { box: box(0.5, roof + 0.2 + 0.55, -1.9, 1.1, 0.7, 1.1), material: 'steel' },
    ],
    hulls: [],
    floorMaterial: 'inner-concrete',
    detail: (pieces) => {
      // The upper room's ceiling: a lining under the roof slab.
      pieces.addPlanarBox('inner-concrete', -wallX + 0.2, wallX - 0.2, roof - 0.01, roof, -wallZ + 0.2, wallZ - 0.2);
      // A steel band at the upper floor's slab edge.
      for (const wall of layout.walls.slice(0, 4)) {
        const across = wall.outward * (wall.thickness / 2 + 0.02);
        pieces.addBox('steel', wall.run === 'x'
          ? box(0, floor, wall.at + across, wallX * 2 + 0.08, 0.18, 0.04)
          : box(wall.at + across, floor, 0, 0.04, 0.18, wallZ * 2 + 0.08));
      }
      addCornerTrim(pieces, wallX, wallZ, floor, roof);
      addDoorAwning(pieces, layout, wallZ);
      // A drain pipe down the front corner and the tank's legs.
      pieces.add('steel', new THREE.CylinderGeometry(0.06, 0.06, roof, 6), new THREE.Matrix4().makeTranslation(wallX + 0.1, roof / 2, wallZ - 0.2));
      for (const [lx, lz] of [[0.05, -2.35], [0.95, -2.35], [0.05, -1.45], [0.95, -1.45]]) pieces.addBox('steel', box(lx!, roof + 0.3, lz!, 0.08, 0.2, 0.08));
    },
  });
}

/** Workshop: a wide concrete hall under a corrugated gable roof, with a roller door (shut) and a side
 * door. Replaces Kenney house C (6.56 x 7.22 m, 6.5 m tall). */
function workshop(layout: HouseLayout): HouseDesign {
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
  return makeDesign('workshop', W, D, layout, {
    solids: [
      { box: boxAlong(new THREE.Vector3(-W / 2, eave, 0), new THREE.Vector3(0.02, ridge, 0), roofThickness, D), material: 'roof' },
      { box: boxAlong(new THREE.Vector3(W / 2, eave, 0), new THREE.Vector3(-0.02, ridge, 0), roofThickness, D), material: 'roof' },
    ],
    hulls: [{ ...gable, material: 'cladding' }],
    floorMaterial: 'inner-concrete',
    detail: (pieces) => {
      pieces.addBox('steel', box(0, ridge + 0.05, 0, 0.36, 0.12, D + 0.02));
      // The roller door: a ribbed steel shutter (shut, on the wall) in a hazard-striped frame.
      pieces.addBox('cladding', box(-0.9, 1.45, wallZ + 0.03, 2.8, 2.9, 0.06));
      pieces.addBox('hazard', box(-0.9 - 1.5, 1.5, wallZ + 0.05, 0.16, 3.0, 0.1));
      pieces.addBox('hazard', box(-0.9 + 1.5, 1.5, wallZ + 0.05, 0.16, 3.0, 0.1));
      pieces.addBox('steel', box(-0.9, 3.05, wallZ + 0.06, 3.2, 0.2, 0.12));
      pieces.addBox('lamp', box(-0.9, 3.25, wallZ + 0.1, 0.4, 0.08, 0.14));
      addDoorAwning(pieces, layout, wallZ);
      // A roof vent on the ridge and a generator against the back wall.
      pieces.addBox('steel', box(0, ridge + 0.3, -1.6, 0.8, 0.5, 0.8));
      pieces.addBox('steel', box(1.2, 0.5, -wallZ - 0.15, 1.3, 1.0, 0.3));
      pieces.addBox('hazard', box(1.2, 0.08, -wallZ - 0.15, 1.36, 0.16, 0.34));
    },
  });
}

export const HOUSE_DESIGNS: readonly HouseDesign[] = [bunkhouse(HOUSE_LAYOUTS[0]!), block(HOUSE_LAYOUTS[1]!), workshop(HOUSE_LAYOUTS[2]!)];

/** Every opening of a design's outside walls, for tests and the minimap: which wall, and the opening. */
export function outsideOpenings(design: HouseDesign): { wall: HouseWall; opening: HouseOpening }[] {
  return design.layout.walls.filter((wall) => wall.outward !== 0).flatMap((wall) => wall.openings.map((opening) => ({ wall, opening })));
}
