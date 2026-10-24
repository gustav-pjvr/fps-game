import { cellOf, OPEN, PROP, SOLID, type FacilityLayout } from '../world/facility/facilityLayout.ts';
import type { MinimapLayer } from './minimap.ts';

/** The minimap's world radius on the Facility (docs/facility-map.md, section 8): rooms are a few
 * metres across, so the Valley's 90 m would shrink the plan to a smudge. */
export const FACILITY_MAP_RADIUS = 26;
/** Plan image resolution. At 26 m across 70 px a cell (1.5 m) is about 4 px on screen. */
const PX_PER_CELL = 4;

/** Cell fills: the plan is dim from the start, a room or corridor stretch the player has entered is
 * brighter, crates (PROP) darker than the floor around them, wall mass (SOLID) not drawn at all. */
const FILL_OPEN = 'rgba(147, 168, 160, 0.2)';
const FILL_OPEN_REVEALED = 'rgba(201, 226, 216, 0.5)';
const FILL_PROP = 'rgba(147, 168, 160, 0.08)';
const FILL_PROP_REVEALED = 'rgba(201, 226, 216, 0.2)';

/** The fill for a cell of `kind`, or null for a cell left transparent. Pure. */
export function cellFill(kind: number, revealed: boolean): string | null {
  if (kind === OPEN) return revealed ? FILL_OPEN_REVEALED : FILL_OPEN;
  if (kind === PROP) return revealed ? FILL_PROP_REVEALED : FILL_PROP;
  return null;
}

/** The parts of the plan that light up together, per cell (index j * size + i): a room cell takes
 * its room index, a corridor cell `rooms.length + k` for the k-th connected stretch of corridor
 * (corridors all share region -1, and the rooms between them split them into stretches), a SOLID
 * cell -1. Pure. */
export function revealGroups(layout: FacilityLayout): { groups: Int32Array; count: number } {
  const { size, kinds, region } = layout;
  const groups = new Int32Array(size * size).fill(-1);
  let count = layout.rooms.length;
  const stack: number[] = [];
  for (let index = 0; index < groups.length; index++) {
    if (kinds[index] === SOLID) continue;
    const cellRegion = region[index]!;
    if (cellRegion >= 0) {
      groups[index] = cellRegion;
      continue;
    }
    if (cellRegion !== -1 || groups[index] !== -1) continue;
    // A new corridor stretch: flood fill its 4-connected corridor cells.
    const group = count++;
    groups[index] = group;
    stack.push(index);
    while (stack.length > 0) {
      const current = stack.pop()!;
      const i = current % size;
      const j = (current - i) / size;
      const neighbours = [i > 0 ? current - 1 : -1, i < size - 1 ? current + 1 : -1, j > 0 ? current - size : -1, j < size - 1 ? current + size : -1];
      for (const next of neighbours) {
        if (next < 0 || groups[next] !== -1 || kinds[next] === SOLID || region[next] !== -1) continue;
        groups[next] = group;
        stack.push(next);
      }
    }
  }
  return { groups, count };
}

/** Which parts of the plan the player has entered. Pure (no DOM), so the reveal rules are unit-tested. */
export class FacilityMapReveal {
  readonly groups: Int32Array;
  private readonly revealed: Uint8Array;

  constructor(private readonly layout: FacilityLayout) {
    const { groups, count } = revealGroups(layout);
    this.groups = groups;
    this.revealed = new Uint8Array(count);
  }

  /** The group under (x, z), or -1 outside the grid or in wall mass. */
  groupAt(x: number, z: number): number {
    const { i, j } = cellOf(x, z);
    const size = this.layout.size;
    if (i < 0 || j < 0 || i >= size || j >= size) return -1;
    return this.groups[j * size + i]!;
  }

  /** Marks the group under (x, z) entered. Returns that group when this is the first time, else -1. */
  enter(x: number, z: number): number {
    const group = this.groupAt(x, z);
    if (group < 0 || this.revealed[group]) return -1;
    this.revealed[group] = 1;
    return group;
  }

  isRevealed(group: number): boolean {
    return group >= 0 && this.revealed[group] === 1;
  }
}

/** The plan's footprint in world metres: the grid is centred on the origin, so it spans
 * [-size * cell / 2, size * cell / 2) on both axes. Pure. */
export function planWorldRect(layout: FacilityLayout): { x: number; z: number; size: number } {
  const extent = layout.size * layout.cell;
  return { x: -extent / 2, z: -extent / 2, size: extent };
}

/** World (x, z) to a pixel of the plan image at `pxPerCell` (x to the right, z down). Pure. */
export function worldToPlanPixel(layout: FacilityLayout, x: number, z: number, pxPerCell = PX_PER_CELL): { u: number; v: number } {
  const rect = planWorldRect(layout);
  const scale = pxPerCell / layout.cell;
  return { u: (x - rect.x) * scale, v: (z - rect.z) * scale };
}

/** The Facility's plan on the minimap (docs/facility-map.md, section 8). The whole layout is
 * prerendered once into an offscreen canvas; entering a room or corridor stretch repaints only its
 * cells, brighter. The minimap then draws the image every update with a single drawImage. */
export class FacilityMapLayer implements MinimapLayer {
  readonly testId = 'facility-map';
  private readonly reveal: FacilityMapReveal;
  private readonly plan: HTMLCanvasElement;
  private readonly planContext: CanvasRenderingContext2D;
  private readonly rect: { x: number; z: number; size: number };

  constructor(private readonly layout: FacilityLayout) {
    this.reveal = new FacilityMapReveal(layout);
    this.rect = planWorldRect(layout);
    this.plan = document.createElement('canvas');
    this.plan.width = layout.size * PX_PER_CELL;
    this.plan.height = layout.size * PX_PER_CELL;
    const context = this.plan.getContext('2d');
    if (!context) throw new Error('Facility map: no 2D canvas context');
    this.planContext = context;
    for (let index = 0; index < layout.kinds.length; index++) this.paintCell(index, false);
  }

  update(x: number, z: number): void {
    const group = this.reveal.enter(x, z);
    if (group < 0) return;
    const groups = this.reveal.groups;
    for (let index = 0; index < groups.length; index++) {
      if (groups[index] === group) this.paintCell(index, true);
    }
  }

  draw(context: CanvasRenderingContext2D): void {
    context.imageSmoothingEnabled = false;
    context.drawImage(this.plan, this.rect.x, this.rect.z, this.rect.size, this.rect.size);
  }

  private paintCell(index: number, revealed: boolean): void {
    const fill = cellFill(this.layout.kinds[index]!, revealed);
    if (!fill) return;
    const size = this.layout.size;
    const i = index % size;
    const j = (index - i) / size;
    this.planContext.clearRect(i * PX_PER_CELL, j * PX_PER_CELL, PX_PER_CELL, PX_PER_CELL);
    this.planContext.fillStyle = fill;
    this.planContext.fillRect(i * PX_PER_CELL, j * PX_PER_CELL, PX_PER_CELL, PX_PER_CELL);
  }
}
