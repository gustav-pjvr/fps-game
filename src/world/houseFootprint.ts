/** A house's footprint as placed in the world: the design's XZ rectangle, centred
 * `offsetX/offsetZ` from its local origin (0 for every current design, see houseDesigns.ts), turned
 * by the same Y rotation as the visual and positioned at `originX/originZ`. */
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
