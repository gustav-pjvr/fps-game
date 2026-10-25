import { HOUSE_LAYOUTS, houseToWorld, WALL_THICKNESS, type HouseLayout } from './houseLayout.ts';
import { buildHouseWalkGrid, pointClear, type HouseWalkGrid } from './houseWalkGrid.ts';

/**
 * Cover spots inside a house (docs/enterable-buildings.md, part 2), for the enemy tactics' cover
 * system (entities/enemies/tactics/coverPoints.ts): beside each piece of furniture tall enough to
 * hide behind, and beside each ground floor window. Each slot is a `cover` spot against a face and a
 * `peek` spot a step out (round the piece's end, or square in front of the window) to fire from;
 * `normal` is the face's outward direction, so a slot hides an enemy from a threat on the far side
 * of that face. Only the ground floor: tactics' points are planar, and the floor under a planar
 * point is the ground floor (an upper floor spot could not be told apart from the one below it).
 */

export interface InteriorCoverSlot {
  readonly cover: { readonly x: number; readonly z: number };
  readonly peek: { readonly x: number; readonly z: number };
  /** Unit direction out of the face the cover spot stands against. */
  readonly normal: { readonly x: number; readonly z: number };
  readonly kind: 'furniture' | 'window';
}

/** Furniture lower than this hides nothing (an enemy cannot crouch). */
export const COVER_MIN_HEIGHT = 0.75;
/** A spot stands this far off the face it hides behind: an enemy's radius and a little (m). Rooms are
 * too small for the outdoor stand-off. */
export const INTERIOR_STAND_OFF = 0.55;

/** How far off the wall (m) a window spot may stand, in the order tried. */
const WINDOW_OFFS = [INTERIOR_STAND_OFF, 0.45, 0.7];
/** How far past a window's edge (m) the spot beside it may stand, in the order tried. */
const WINDOW_SLIDES = [0.35, 0.55, 0.75, 0.95];

/** A design's slots in its local frame, on cells its walk grid says a body may stand on. */
export function houseCoverSlots(layout: HouseLayout, grid: HouseWalkGrid = buildHouseWalkGrid(layout)): InteriorCoverSlot[] {
  const ground = grid.levels[0]!, groundY = ground.y;
  const slots: InteriorCoverSlot[] = [];
  const add = (slot: InteriorCoverSlot): void => {
    if (pointClear(ground, slot.cover.x, slot.cover.z) && pointClear(ground, slot.peek.x, slot.peek.z)) slots.push(slot);
  };
  for (const item of layout.furniture) {
    const b = item.bounds;
    if (Math.abs(b.minY - groundY) > 1e-3 || b.maxY - b.minY < COVER_MIN_HEIGHT) continue;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, hx = (b.maxX - b.minX) / 2, hz = (b.maxZ - b.minZ) / 2;
    // Each face: the spot off its middle, peeking round either end.
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const out = (nx !== 0 ? hx : hz) + INTERIOR_STAND_OFF, half = nx !== 0 ? hz : hx;
      const cover = { x: cx + nx * out, z: cz + nz * out };
      for (const side of [1, -1]) {
        const along = (half + INTERIOR_STAND_OFF) * side;
        add({ cover, peek: { x: cover.x + Math.abs(nz) * along, z: cover.z + Math.abs(nx) * along }, normal: { x: nx, z: nz }, kind: 'furniture' });
      }
    }
  }
  for (const wall of layout.walls) {
    if (wall.outward === 0 || wall.bottom > groundY + 1e-3) continue;
    // The wall's inner face and the direction into the room.
    const face = wall.at - wall.outward * WALL_THICKNESS / 2, inward = -wall.outward;
    for (const opening of wall.openings) {
      if (opening.kind !== 'window') continue;
      const point = (along: number, off: number) => {
        const across = face + inward * off;
        return wall.run === 'x' ? { x: along, z: across } : { x: across, z: along };
      };
      const normal = wall.run === 'x' ? { x: 0, z: inward } : { x: inward, z: 0 };
      // Furniture often stands near a window: the nearest clear places, a little further off the
      // wall or along it if need be.
      const peek = WINDOW_OFFS.map((off) => point(opening.along, off)).find((p) => pointClear(ground, p.x, p.z));
      if (!peek) continue;
      for (const side of [1, -1]) {
        const cover = WINDOW_SLIDES.flatMap((slide) => WINDOW_OFFS.map((off) => point(opening.along + side * (opening.width / 2 + slide), off)))
          .find((p) => pointClear(ground, p.x, p.z));
        if (cover) add({ cover, peek, normal, kind: 'window' });
      }
    }
  }
  return slots;
}

const cache: (InteriorCoverSlot[] | undefined)[] = [];

/** A design's slots placed in the world for a house at (originX, originZ) turned by rotationY. */
export function houseCoverSlotsInWorld(design: number, originX: number, originZ: number, rotationY: number): InteriorCoverSlot[] {
  const layout = HOUSE_LAYOUTS[design];
  if (!layout) return [];
  const local = cache[design] ??= houseCoverSlots(layout);
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  const at = (p: { x: number; z: number }) => { const w = houseToWorld(p.x, 0, p.z, originX, 0, originZ, rotationY); return { x: w.x, z: w.z }; };
  return local.map((slot) => ({
    cover: at(slot.cover),
    peek: at(slot.peek),
    normal: { x: slot.normal.x * c + slot.normal.z * s, z: -slot.normal.x * s + slot.normal.z * c },
    kind: slot.kind,
  }));
}
