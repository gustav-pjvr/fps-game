import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeBuildingColliderShapes, isPointNearFootprint, type HouseFootprint, type ModelBounds } from './buildingColliders.ts';

type Point = [number, number, number];

function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(u: Point, v: Point): Point {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

/** Two triangles for a planar quad, wound counter-clockwise as seen from `outward` (glTF's
 * front-face convention, which the collider code relies on to tell a roof's top from its
 * underside). Flips the order if the given corners happen to wind the other way. */
function quad(a: Point, b: Point, c: Point, d: Point, outward: Point): number[] {
  const normal = cross(subtract(b, a), subtract(c, a));
  const facesOutward = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] > 0;
  const [p, q, r, s] = facesOutward ? [a, b, c, d] : [a, d, c, b];
  return [...p, ...q, ...r, ...p, ...r, ...s];
}

/** A gable along Z over z0..z1: ridge at x=0 / ridgeY, eaves at x=+-eaveX / eaveY. Returns the two
 * roof slopes (top faces) and their undersides, which face down and must be ignored. */
function gable(z0: number, z1: number, eaveX: number, eaveY: number, ridgeY: number): number[] {
  const thickness = 0.1;
  return [
    ...quad([-eaveX, eaveY, z0], [0, ridgeY, z0], [0, ridgeY, z1], [-eaveX, eaveY, z1], [-1, 1, 0]),
    ...quad([eaveX, eaveY, z0], [0, ridgeY, z0], [0, ridgeY, z1], [eaveX, eaveY, z1], [1, 1, 0]),
    ...quad([-eaveX, eaveY - thickness, z0], [0, ridgeY - thickness, z0], [0, ridgeY - thickness, z1], [-eaveX, eaveY - thickness, z1], [1, -1, 0]),
    ...quad([eaveX, eaveY - thickness, z0], [0, ridgeY - thickness, z0], [0, ridgeY - thickness, z1], [eaveX, eaveY - thickness, z1], [-1, -1, 0]),
  ];
}

/** An upward-facing horizontal slab over [x0,x1] x [z0,z1] at height y. */
function slab(x0: number, x1: number, z0: number, z1: number, y: number): number[] {
  return quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0]);
}

/** The four vertical walls of a box, which face sideways and must never become roof pieces. */
function walls(halfX: number, halfZ: number, height: number): number[] {
  return [
    ...quad([-halfX, 0, halfZ], [halfX, 0, halfZ], [halfX, height, halfZ], [-halfX, height, halfZ], [0, 0, 1]),
    ...quad([-halfX, 0, -halfZ], [halfX, 0, -halfZ], [halfX, height, -halfZ], [-halfX, height, -halfZ], [0, 0, -1]),
    ...quad([halfX, 0, -halfZ], [halfX, 0, halfZ], [halfX, height, halfZ], [halfX, height, -halfZ], [1, 0, 0]),
    ...quad([-halfX, 0, -halfZ], [-halfX, 0, halfZ], [-halfX, height, halfZ], [-halfX, height, -halfZ], [-1, 0, 0]),
  ];
}

function hullPoints(hull: Float32Array): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 2 < hull.length; i += 3) points.push([hull[i]!, hull[i + 1]!, hull[i + 2]!]);
  return points;
}

const SHRINK = 0.85;
const EPSILON = 1e-4;

// One-storey house shaped like the Kenney presets: walls x +-2, z +-3 up to a 2.5m slab, a gable
// along Z whose eaves overhang to x +-2.3 at 2.6m and whose ridge is at 4m, plus a tiny sloped
// trim face on the front wall that's too small to deserve a collider.
const SINGLE_STOREY: number[] = [
  ...walls(2, 3, 2.5),
  ...slab(-2, 2, -3, 3, 2.5),
  ...gable(-3, 3, 2.3, 2.6, 4),
  ...quad([-0.1, 1, 3], [0.1, 1, 3], [0.1, 1.05, 3.08], [-0.1, 1.05, 3.08], [0, 1, 1]),
];
const SINGLE_STOREY_BOUNDS: ModelBounds = { minX: -2.3, minY: 0, minZ: -3, maxX: 2.3, maxY: 4, maxZ: 3 };

describe('computeBuildingColliderShapes', () => {
  it('finds the eave and ridge of a gabled roof from its faces', () => {
    const shapes = computeBuildingColliderShapes(SINGLE_STOREY, SINGLE_STOREY_BOUNDS, SHRINK);

    expect(shapes.eaveHeight).toBeCloseTo(2.6, 6);
    expect(shapes.ridgeHeight).toBeCloseTo(4, 6);
  });

  it('keeps the shrunk wall box but stops it at the storey top instead of the ridge', () => {
    const { wallBox } = computeBuildingColliderShapes(SINGLE_STOREY, SINGLE_STOREY_BOUNDS, SHRINK);

    expect(wallBox.halfX).toBeCloseTo(2.3 * SHRINK, 6);
    expect(wallBox.halfZ).toBeCloseTo(3 * SHRINK, 6);
    expect(wallBox.centerY - wallBox.halfY).toBeCloseTo(0, 6);
    expect(wallBox.centerY + wallBox.halfY).toBeCloseTo(2.5, 6);
  });

  it('gives each roof slope one prism, ignoring undersides, walls and tiny trim', () => {
    const { roofHulls } = computeBuildingColliderShapes(SINGLE_STOREY, SINGLE_STOREY_BOUNDS, SHRINK);

    expect(roofHulls).toHaveLength(2);
  });

  it('never puts a roof prism above its slope, so the air over the roof stays empty', () => {
    const { roofHulls } = computeBuildingColliderShapes(SINGLE_STOREY, SINGLE_STOREY_BOUNDS, SHRINK);
    const slopeHeightAt = (x: number): number => 4 - (Math.abs(x) / 2.3) * (4 - 2.6);

    for (const hull of roofHulls) {
      const points = hullPoints(hull);
      for (const [x, y] of points) expect(y).toBeLessThanOrEqual(slopeHeightAt(x) + EPSILON);
      // ...while still reaching the full ridge and eave, so a shot at the roof itself hits.
      expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(4, 6);
      expect(Math.max(...points.map(([x]) => Math.abs(x)))).toBeCloseTo(2.3, 6);
    }
  });

  it('drops each prism onto the slab it sits on, tucked inside the walls rather than hanging under the eave', () => {
    const { roofHulls } = computeBuildingColliderShapes(SINGLE_STOREY, SINGLE_STOREY_BOUNDS, SHRINK);

    for (const hull of roofHulls) {
      const points = hullPoints(hull);
      const bottom = points.filter(([, y]) => Math.abs(y - 2.5) < EPSILON);
      expect(bottom.length).toBeGreaterThan(0);
      for (const [x] of bottom) expect(Math.abs(x)).toBeLessThanOrEqual(2 + EPSILON);
      expect(Math.min(...points.map(([, y]) => y))).toBeCloseTo(2.5, 6);
    }
  });

  it('stands a stacked upper storey on its own slab and fills its walls down to the lower one', () => {
    // Kenney house B's shape: ground storey slab at 2.5 over the whole footprint, a low gable over
    // the back half, and an upper storey (slab at 4.5) with its own higher gable over the front.
    const triangles = [
      ...slab(-2, 2, -3, 3, 2.5),
      ...gable(-3, 0, 2.3, 2.6, 4),
      ...slab(-2, 2, 0, 3, 4.5),
      ...gable(0, 3, 2.3, 4.6, 6),
    ];
    const bounds: ModelBounds = { minX: -2.3, minY: 0, minZ: -3, maxX: 2.3, maxY: 6, maxZ: 3 };
    const shapes = computeBuildingColliderShapes(triangles, bounds, SHRINK);

    expect(shapes.eaveHeight).toBeCloseTo(2.6, 6);
    expect(shapes.ridgeHeight).toBeCloseTo(6, 6);
    expect(shapes.wallBox.centerY + shapes.wallBox.halfY).toBeCloseTo(2.5, 6);

    const round = (y: number): number => Math.round(y * 100) / 100;
    const spans = shapes.roofHulls
      .map((hull): [number, number] => {
        const ys = hullPoints(hull).map(([, y]) => y);
        return [round(Math.min(...ys)), round(Math.max(...ys))];
      })
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    // Two low slopes on the ground storey, the upper storey's walls (its slab, 2.5 up to 4.5), and
    // two high slopes standing on the upper slab rather than reaching back down to 2.5.
    expect(spans).toEqual([
      [2.5, 4],
      [2.5, 4],
      [2.5, 4.5],
      [4.5, 6],
      [4.5, 6],
    ]);
  });

  it('keeps two disjoint patches of the same roof plane as separate prisms', () => {
    // Kenney house C's side wings: identical slopes on either side of the building share one plane.
    const wing = (x0: number, x1: number): number[] =>
      quad([x0, 2.6, -1], [x1, 2.6, -1], [x1, 4, 0.5], [x0, 4, 0.5], [0, 1, -1]);
    const triangles = [...slab(-4, 4, -3, 3, 2.5), ...wing(-4, -2), ...wing(2, 4)];
    const bounds: ModelBounds = { minX: -4, minY: 0, minZ: -3, maxX: 4, maxY: 4, maxZ: 3 };
    const { roofHulls } = computeBuildingColliderShapes(triangles, bounds, SHRINK);

    expect(roofHulls).toHaveLength(2);
    for (const hull of roofHulls) {
      const xs = hullPoints(hull).map(([x]) => x);
      // Neither prism bridges the 4m gap between the wings.
      expect(Math.min(...xs) >= 2 - EPSILON || Math.max(...xs) <= -2 + EPSILON).toBe(true);
    }
  });

  it('falls back to one full-height box for a model with no sloped roof', () => {
    const triangles = [...walls(2, 3, 3), ...slab(-2, 2, -3, 3, 3)];
    const bounds: ModelBounds = { minX: -2, minY: 0, minZ: -3, maxX: 2, maxY: 3, maxZ: 3 };
    const shapes = computeBuildingColliderShapes(triangles, bounds, SHRINK);

    expect(shapes.roofHulls).toHaveLength(0);
    expect(shapes.eaveHeight).toBeCloseTo(3, 6);
    expect(shapes.wallBox.centerY + shapes.wallBox.halfY).toBeCloseTo(3, 6);
  });
});

describe('isPointNearFootprint', () => {
  const base: HouseFootprint = { originX: 10, originZ: -5, offsetX: 0, offsetZ: 0, halfWidth: 2, halfDepth: 4, rotationY: 0 };

  it('is true inside the footprint and false just outside it with no margin', () => {
    expect(isPointNearFootprint(10, -5, base, 0)).toBe(true);
    expect(isPointNearFootprint(11.9, -1.1, base, 0)).toBe(true);
    expect(isPointNearFootprint(12.1, -5, base, 0)).toBe(false);
    expect(isPointNearFootprint(10, -0.9, base, 0)).toBe(false);
  });

  it('reaches `margin` metres past each edge and rounds the corners', () => {
    expect(isPointNearFootprint(12.9, -5, base, 1)).toBe(true);
    expect(isPointNearFootprint(13.1, -5, base, 1)).toBe(false);
    // 0.8m past both the +X edge and the +Z edge: inside a squared-off margin, but 1.13m from the
    // corner, so outside the true 1m distance.
    expect(isPointNearFootprint(12.8, -0.2, base, 1)).toBe(false);
    expect(isPointNearFootprint(12.6, -0.4, base, 1)).toBe(true);
  });

  it('treats a negative margin as zero', () => {
    expect(isPointNearFootprint(11.9, -5, base, -3)).toBe(true);
    expect(isPointNearFootprint(12.1, -5, base, -3)).toBe(false);
  });

  it('swaps which world axis each dimension covers when the house is turned 90 degrees', () => {
    const turned: HouseFootprint = { ...base, rotationY: Math.PI / 2 };

    expect(isPointNearFootprint(10, -1.5, turned, 0)).toBe(false);
    expect(isPointNearFootprint(13.5, -5, turned, 0)).toBe(true);
  });

  it('matches where three.js actually draws the rotated, off-center model', () => {
    // An off-center footprint at an arbitrary rotation, checked against the same local-to-world
    // transform the visual group gets in BuildingManager.createBuilding.
    const footprint: HouseFootprint = { originX: 3, originZ: 7, offsetX: 1.5, offsetZ: -0.5, halfWidth: 1, halfDepth: 2.5, rotationY: 0.7 };
    const group = new THREE.Object3D();
    group.position.set(footprint.originX, 0, footprint.originZ);
    group.rotation.y = footprint.rotationY;
    group.updateMatrixWorld(true);
    const toWorld = (localX: number, localZ: number): THREE.Vector3 => group.localToWorld(new THREE.Vector3(localX, 0, localZ));

    const insideCorner = toWorld(footprint.offsetX + 0.95, footprint.offsetZ - 2.45);
    const outsideEdge = toWorld(footprint.offsetX + 1.05, footprint.offsetZ);
    const pastMargin = toWorld(footprint.offsetX, footprint.offsetZ + 2.5 + 0.6);
    const withinMargin = toWorld(footprint.offsetX, footprint.offsetZ + 2.5 + 0.4);

    expect(isPointNearFootprint(insideCorner.x, insideCorner.z, footprint, 0)).toBe(true);
    expect(isPointNearFootprint(outsideEdge.x, outsideEdge.z, footprint, 0)).toBe(false);
    expect(isPointNearFootprint(pastMargin.x, pastMargin.z, footprint, 0.5)).toBe(false);
    expect(isPointNearFootprint(withinMargin.x, withinMargin.z, footprint, 0.5)).toBe(true);
  });
});
