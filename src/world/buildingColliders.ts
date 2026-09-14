/**
 * Plain-number geometry behind BuildingManager's house colliders and its spawn-safety footprint
 * query. Deliberately free of three.js and Rapier so the WASM-free unit layer can test it: the
 * caller feeds in the model's triangles already transformed into its scaled local frame (the frame
 * the visual group's own scale is applied in, before its Y rotation and world position) and turns
 * the returned shapes into Rapier colliders on a body carrying that same rotation and position.
 */

/** Axis-aligned bounds of the model, in the same scaled local frame as its triangles. */
export interface ModelBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface WallBoxShape {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}

export interface BuildingColliderShapes {
  /** Ground up to the storey top the lowest eaves sit on, over the shrunk footprint. */
  wallBox: WallBoxShape;
  /** One flat xyz point list per roof piece, ready for RAPIER.ColliderDesc.convexHull. */
  roofHulls: Float32Array[];
  /** Lowest point of any real roof slope, i.e. the eave line. The model's max Y if it has none. */
  eaveHeight: number;
  /** Highest point of any real roof slope, i.e. the ridge. The model's max Y if it has none. */
  ridgeHeight: number;
}

/** A face counts as roof or slab surface only if it's flatter than ~78 degrees - anything steeper
 * is wall or trim, which the wall box and the roof prisms' own sides already stand in for. */
const MIN_UPWARD_NORMAL_Y = 0.2;
/** cos(~2.5 degrees): anything flatter than this is a horizontal slab (a storey's top face, a flat
 * roof deck, an awning), not a slope. */
const FLAT_NORMAL_Y = 0.999;
/** Faces join one plane when their unit normals and plane offsets agree this closely - loose enough
 * to absorb float32 noise in the GLB (the same Kenney roof slope comes out as both n.z = +0.00 and
 * -0.00), far tighter than the gap between two parallel slopes at different heights. */
const PLANE_NORMAL_TOLERANCE = 0.01;
const PLANE_OFFSET_TOLERANCE = 0.01;
/** Vertex positions are welded on this grid (metres) to find which faces of one plane touch. */
const WELD_GRID = 0.001;
/** A connected piece of one plane gets a collider only if it covers at least this fraction of the
 * footprint's area. Measured on the three house GLBs: the smallest real roof slope (house C's side
 * wings) is 6.2%, the door-pediment trim is at most 0.3%, so 2% sits well clear of both. */
const MIN_PIECE_AREA_FRACTION = 0.02;
/** Height tolerance (metres) when comparing slab, eave and support levels. */
const HEIGHT_EPSILON = 0.01;

/** One connected, coplanar patch of upward-facing surface. */
interface SurfacePiece {
  /** Unique vertex positions, flat xyz. */
  points: number[];
  isFlat: boolean;
  /** Area projected onto the XZ plane, i.e. how much footprint it covers seen from above. */
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** A level a roof prism is dropped down onto, and the rectangle its bottom is kept inside. */
interface Support {
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface PlaneGroup {
  nx: number;
  ny: number;
  nz: number;
  offset: number;
  /** Start index (into the flat triangle array) of every face on this plane. */
  faceStarts: number[];
}

/** In-range read of a flat coordinate array. Every index in this file is derived from the array's
 * own length, so noUncheckedIndexedAccess's `undefined` can't actually occur (the same `!`
 * convention as ZoneMap.radiusAtAngle), and routing the reads through here keeps it to one place. */
function at(values: ArrayLike<number>, index: number): number {
  return values[index]!;
}

function weldKey(triangles: ArrayLike<number>, start: number): string {
  return `${Math.round(at(triangles, start) / WELD_GRID)},${Math.round(at(triangles, start + 1) / WELD_GRID)},${Math.round(at(triangles, start + 2) / WELD_GRID)}`;
}

function groupUpwardFacesByPlane(triangles: ArrayLike<number>): PlaneGroup[] {
  const groups: PlaneGroup[] = [];
  for (let start = 0; start + 8 < triangles.length; start += 9) {
    const ax = at(triangles, start);
    const ay = at(triangles, start + 1);
    const az = at(triangles, start + 2);
    const ux = at(triangles, start + 3) - ax;
    const uy = at(triangles, start + 4) - ay;
    const uz = at(triangles, start + 5) - az;
    const vx = at(triangles, start + 6) - ax;
    const vy = at(triangles, start + 7) - ay;
    const vz = at(triangles, start + 8) - az;
    // glTF front faces wind counter-clockwise, so (b-a) x (c-a) points out of the surface.
    const crossX = uy * vz - uz * vy;
    const crossY = uz * vx - ux * vz;
    const crossZ = ux * vy - uy * vx;
    const length = Math.hypot(crossX, crossY, crossZ);
    if (length < 1e-12) continue;
    const nx = crossX / length;
    const ny = crossY / length;
    const nz = crossZ / length;
    if (ny < MIN_UPWARD_NORMAL_Y) continue;

    const offset = nx * ax + ny * ay + nz * az;
    let group = groups.find(
      (g) =>
        Math.abs(g.nx - nx) <= PLANE_NORMAL_TOLERANCE &&
        Math.abs(g.ny - ny) <= PLANE_NORMAL_TOLERANCE &&
        Math.abs(g.nz - nz) <= PLANE_NORMAL_TOLERANCE &&
        Math.abs(g.offset - offset) <= PLANE_OFFSET_TOLERANCE,
    );
    if (!group) {
      group = { nx, ny, nz, offset, faceStarts: [] };
      groups.push(group);
    }
    group.faceStarts.push(start);
  }
  return groups;
}

/** One plane can hold several disjoint patches (house C's two side wings share a slope plane, a
 * whole building apart) - each needs its own hull, or the hull would bridge the gap between them. */
function splitIntoConnectedPieces(triangles: ArrayLike<number>, group: PlaneGroup): SurfacePiece[] {
  const parent = group.faceStarts.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (at(parent, root) !== root) root = at(parent, root);
    return root;
  };
  const firstFaceAtVertex = new Map<string, number>();
  group.faceStarts.forEach((start, face) => {
    for (let corner = 0; corner < 3; corner++) {
      const key = weldKey(triangles, start + corner * 3);
      const other = firstFaceAtVertex.get(key);
      if (other === undefined) firstFaceAtVertex.set(key, face);
      else parent[find(other)] = find(face);
    }
  });

  const facesByRoot = new Map<number, number[]>();
  group.faceStarts.forEach((start, face) => {
    const root = find(face);
    const faces = facesByRoot.get(root) ?? [];
    faces.push(start);
    facesByRoot.set(root, faces);
  });
  return [...facesByRoot.values()].map((faceStarts) => buildPiece(triangles, faceStarts, group.ny >= FLAT_NORMAL_Y));
}

function buildPiece(triangles: ArrayLike<number>, faceStarts: number[], isFlat: boolean): SurfacePiece {
  const piece: SurfacePiece = {
    points: [],
    isFlat,
    area: 0,
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  const seen = new Set<string>();
  for (const start of faceStarts) {
    const ux = at(triangles, start + 3) - at(triangles, start);
    const uz = at(triangles, start + 5) - at(triangles, start + 2);
    const vx = at(triangles, start + 6) - at(triangles, start);
    const vz = at(triangles, start + 8) - at(triangles, start + 2);
    piece.area += Math.abs(uz * vx - ux * vz) / 2;

    for (let corner = 0; corner < 3; corner++) {
      const vertex = start + corner * 3;
      const key = weldKey(triangles, vertex);
      if (seen.has(key)) continue;
      seen.add(key);
      const x = at(triangles, vertex);
      const y = at(triangles, vertex + 1);
      const z = at(triangles, vertex + 2);
      piece.points.push(x, y, z);
      piece.minX = Math.min(piece.minX, x);
      piece.maxX = Math.max(piece.maxX, x);
      piece.minY = Math.min(piece.minY, y);
      piece.maxY = Math.max(piece.maxY, y);
      piece.minZ = Math.min(piece.minZ, z);
      piece.maxZ = Math.max(piece.maxZ, z);
    }
  }
  return piece;
}

/** The highest slab under a roof piece whose outline contains the piece's center - the storey top
 * it actually sits on (house B's upper gable sits on the upper storey's slab, not the ground
 * storey's). Only slabs strictly below the piece's top and no higher than its lowest point
 * qualify, so a prism always has real height. Falls back to the wall box's own top. */
function findSupport(piece: SurfacePiece, slabs: SurfacePiece[], base: Support): Support {
  const centerX = (piece.minX + piece.maxX) / 2;
  const centerZ = (piece.minZ + piece.maxZ) / 2;
  let best = base;
  for (const slab of slabs) {
    if (slab === piece) continue;
    if (slab.maxY > piece.minY + HEIGHT_EPSILON || slab.maxY >= piece.maxY - HEIGHT_EPSILON) continue;
    if (slab.maxY < best.y - HEIGHT_EPSILON) continue;
    if (centerX < slab.minX || centerX > slab.maxX || centerZ < slab.minZ || centerZ > slab.maxZ) continue;
    best = { y: slab.maxY, minX: slab.minX, maxX: slab.maxX, minZ: slab.minZ, maxZ: slab.maxZ };
  }
  return best;
}

/** The piece's own vertices on top, plus the same vertices dropped onto the support level with
 * their XZ pulled inside the support's outline. Dropping straight down would hang an invisible
 * ledge under every eave overhang (the exact v3.3.1 complaint, just up at eave height); clamping
 * to the slab's outline instead tucks the prism's underside up inside the visible eave. */
function buildRoofHull(piece: SurfacePiece, support: Support): Float32Array {
  const count = piece.points.length;
  const hull = new Float32Array(count * 2);
  hull.set(piece.points, 0);
  for (let i = 0; i < count; i += 3) {
    hull[count + i] = Math.min(Math.max(at(piece.points, i), support.minX), support.maxX);
    hull[count + i + 1] = support.y;
    hull[count + i + 2] = Math.min(Math.max(at(piece.points, i + 2), support.minZ), support.maxZ);
  }
  return hull;
}

/**
 * Colliders that follow a house's visible shape instead of one box up to the ridge, whose flat top
 * filled the empty air above both roof slopes (shots that visibly cleared a roof stopped mid-air,
 * and a player on the roof hovered at ridge height). Derived from the model's own faces so any
 * preset works:
 * - Upward faces are grouped into connected coplanar pieces; pieces too small to matter (trim) are
 *   dropped. Sloped pieces are roof slopes, flat ones are slabs (storey tops, decks, awnings).
 * - The wall box keeps the v3.3.1 shrunk footprint and rises to the highest slab at or below the
 *   lowest eave - the storey top the roof sits on - so a flat roof deck is stood on at its real
 *   height, not the eave's.
 * - Every piece above that gets its own convex prism down to the slab it sits on (see findSupport
 *   and buildRoofHull): each roof slope, plus any higher slab, which is what fills in an upper
 *   storey's walls.
 * `triangles` is flat xyz, nine numbers per face, counter-clockwise front faces.
 */
export function computeBuildingColliderShapes(
  triangles: ArrayLike<number>,
  bounds: ModelBounds,
  footprintShrink: number,
): BuildingColliderShapes {
  const footprintArea = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
  const pieces = groupUpwardFacesByPlane(triangles)
    .flatMap((group) => splitIntoConnectedPieces(triangles, group))
    .filter((piece) => piece.area >= footprintArea * MIN_PIECE_AREA_FRACTION);
  const slopes = pieces.filter((piece) => !piece.isFlat);
  const slabs = pieces.filter((piece) => piece.isFlat);

  const eaveHeight = slopes.length > 0 ? Math.min(...slopes.map((piece) => piece.minY)) : bounds.maxY;
  const ridgeHeight = slopes.length > 0 ? Math.max(...slopes.map((piece) => piece.maxY)) : bounds.maxY;
  const slabsBelowEave = slabs.filter((slab) => slab.maxY <= eaveHeight + HEIGHT_EPSILON).map((slab) => slab.maxY);
  const wallTop = slabsBelowEave.length > 0 ? Math.max(...slabsBelowEave) : eaveHeight;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const halfX = ((bounds.maxX - bounds.minX) / 2) * footprintShrink;
  const halfZ = ((bounds.maxZ - bounds.minZ) / 2) * footprintShrink;
  const wallBox: WallBoxShape = {
    centerX,
    centerY: (bounds.minY + wallTop) / 2,
    centerZ,
    halfX,
    halfY: (wallTop - bounds.minY) / 2,
    halfZ,
  };

  const base: Support = { y: wallTop, minX: centerX - halfX, maxX: centerX + halfX, minZ: centerZ - halfZ, maxZ: centerZ + halfZ };
  const roofHulls = pieces
    .filter((piece) => piece.maxY > wallTop + HEIGHT_EPSILON)
    .map((piece) => buildRoofHull(piece, findSupport(piece, slabs, base)));

  return { wallBox, roofHulls, eaveHeight, ridgeHeight };
}

/** A house's footprint as placed in the world: the model's measured XZ rectangle, centered
 * `offsetX/offsetZ` from its local origin (see BuildingManager.measurePreset), turned by the same Y
 * rotation as the visual and positioned at `originX/originZ`. */
export interface HouseFootprint {
  originX: number;
  originZ: number;
  offsetX: number;
  offsetZ: number;
  halfWidth: number;
  halfDepth: number;
  rotationY: number;
}

/** True if world (x, z) is within `margin` metres of the footprint rectangle (inside counts as
 * distance 0). The point is taken into the model's local frame, undoing the rotation three.js
 * applies to the visual (world = R * local, so local = R^T * (world - origin)), which keeps any
 * rotation exact rather than assuming 90-degree steps, and the distance is true Euclidean, so the
 * margin rounds the corners instead of squaring them off. A negative margin counts as 0. */
export function isPointNearFootprint(x: number, z: number, footprint: HouseFootprint, margin: number): boolean {
  const dx = x - footprint.originX;
  const dz = z - footprint.originZ;
  const cos = Math.cos(footprint.rotationY);
  const sin = Math.sin(footprint.rotationY);
  const localX = dx * cos - dz * sin - footprint.offsetX;
  const localZ = dx * sin + dz * cos - footprint.offsetZ;
  const outsideX = Math.max(Math.abs(localX) - footprint.halfWidth, 0);
  const outsideZ = Math.max(Math.abs(localZ) - footprint.halfDepth, 0);
  const reach = Math.max(margin, 0);
  return outsideX * outsideX + outsideZ * outsideZ <= reach * reach;
}
