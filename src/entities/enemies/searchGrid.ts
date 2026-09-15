import type { PlanarPoint } from './perception.ts';

/**
 * Where the player might be now (enemy AI v2, step 4 - docs/enemy-ai-v2.md). The Last of Us
 * search map: when the squad loses the player, a grid of cells around the last known position
 * holds a probability for each cell. Over time it spreads outward (the player could have moved in
 * any direction), and it is wiped wherever an enemy looks or walks. Searchers head for the
 * likeliest cells, in pairs, instead of all walking to one point and standing there.
 *
 * Pure: blocked ground, visibility and the clock all arrive from the caller, and every setting is
 * a constructor option, so every rule here is unit-tested without Rapier.
 */

export interface SearchGridOptions {
  /** Cell edge, metres. */
  readonly cellSize: number;
  /** Cells from the centre to the edge; the grid is the disc of cells within this radius. */
  readonly radiusCells: number;
  /** How fast probability flows to neighbouring cells, per second (0 to 1 of the difference). */
  readonly diffusionRate: number;
}

export interface SearchCell {
  readonly gx: number;
  readonly gz: number;
  readonly x: number;
  readonly z: number;
  probability: number;
}

/** Initial share of the neighbours of the last known cell, before normalising: the player was
 * most likely still right there, but could already be a step away. */
const NEIGHBOUR_START_WEIGHT = 0.15;
/** Longest single diffusion step, seconds: keeps the explicit update stable, and the result the same
 * whatever step the caller passes (spreadFor passes several seconds at once). */
const MAX_DIFFUSION_STEP = 0.05;

function cellKey(gx: number, gz: number): string {
  return `${gx},${gz}`;
}

export class SearchGrid {
  readonly cells: SearchCell[] = [];
  private readonly byKey = new Map<string, SearchCell>();
  private elapsed = 0;

  constructor(
    centre: PlanarPoint,
    private readonly options: SearchGridOptions,
    isBlocked: (x: number, z: number) => boolean,
  ) {
    const radius = options.radiusCells;
    for (let gz = -radius; gz <= radius; gz++) {
      for (let gx = -radius; gx <= radius; gx++) {
        if (gx * gx + gz * gz > radius * radius) continue;
        const x = centre.x + gx * options.cellSize;
        const z = centre.z + gz * options.cellSize;
        if (isBlocked(x, z)) continue;
        const ring = Math.max(Math.abs(gx), Math.abs(gz));
        const cell: SearchCell = { gx, gz, x, z, probability: ring === 0 ? 1 : ring === 1 ? NEIGHBOUR_START_WEIGHT : 0 };
        this.cells.push(cell);
        this.byKey.set(cellKey(gx, gz), cell);
      }
    }
    // The last known cell itself can be unusable (the player stood by a wall): spread the start
    // evenly over whatever ring of cells is nearest instead.
    if (this.total() === 0 && this.cells.length > 0) {
      const nearest = Math.min(...this.cells.map((cell) => Math.max(Math.abs(cell.gx), Math.abs(cell.gz))));
      for (const cell of this.cells) {
        if (Math.max(Math.abs(cell.gx), Math.abs(cell.gz)) === nearest) cell.probability = 1;
      }
    }
    this.normalise(1);
  }

  /** Probability mass still unaccounted for: 1 at the start, falling only as cells are cleared. */
  get totalProbability(): number {
    return this.total();
  }

  /** Seconds since the grid was created. */
  get age(): number {
    return this.elapsed;
  }

  /** Ages the grid and spreads its probability for `dt` seconds. */
  update(dt: number): void {
    this.elapsed += dt;
    this.diffuse(dt);
  }

  /** Spreads as if `seconds` had passed, without ageing the grid: a grid built some time after the
   * player was last seen starts already spread for the head start they had. */
  spreadFor(seconds: number): void {
    this.diffuse(seconds);
  }

  private diffuse(seconds: number): void {
    for (let left = seconds; left > 1e-9; left -= MAX_DIFFUSION_STEP) this.diffuseStep(Math.min(left, MAX_DIFFUSION_STEP));
  }

  /** Spreads probability to the 4 neighbours of every cell (p' = p (1 - k) + k * mean of
   * neighbours), then rescales so the total is unchanged: clearing is the only way mass leaves. */
  private diffuseStep(dt: number): void {
    const k = Math.min(1, this.options.diffusionRate * dt);
    if (k <= 0) return;
    const before = this.total();
    const next = this.cells.map((cell) => {
      const neighbours = [
        this.byKey.get(cellKey(cell.gx + 1, cell.gz)),
        this.byKey.get(cellKey(cell.gx - 1, cell.gz)),
        this.byKey.get(cellKey(cell.gx, cell.gz + 1)),
        this.byKey.get(cellKey(cell.gx, cell.gz - 1)),
      ].filter((neighbour): neighbour is SearchCell => neighbour !== undefined);
      if (neighbours.length === 0) return cell.probability;
      const mean = neighbours.reduce((sum, neighbour) => sum + neighbour.probability, 0) / neighbours.length;
      return cell.probability * (1 - k) + k * mean;
    });
    this.cells.forEach((cell, index) => {
      cell.probability = next[index]!;
    });
    this.normalise(before);
  }

  /** A searcher standing near a cell has checked it, no ray needed. */
  clearNear(x: number, z: number, radius: number): void {
    for (const cell of this.cells) {
      if (cell.probability > 0 && Math.hypot(cell.x - x, cell.z - z) <= radius) cell.probability = 0;
    }
  }

  /**
   * A searcher at `eye` facing `yaw` looks over the cells in front of it: every cell with any
   * probability left, within `range` and `halfAngleDeg` of its facing, likeliest first, gets one
   * `isVisible` check until `rayAllowance` runs out; the ones it can see are cleared. Returns the
   * checks spent.
   */
  clearVisibleFrom(
    eye: PlanarPoint,
    yaw: number,
    range: number,
    halfAngleDeg: number,
    isVisible: (cell: SearchCell) => boolean,
    rayAllowance: number,
  ): number {
    const cosHalf = Math.cos((halfAngleDeg * Math.PI) / 180);
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const inView = this.cells
      .filter((cell) => {
        if (cell.probability <= 0) return false;
        const dx = cell.x - eye.x;
        const dz = cell.z - eye.z;
        const distance = Math.hypot(dx, dz);
        if (distance > range) return false;
        if (distance < 1e-6) return true;
        return (dx * forwardX + dz * forwardZ) / distance >= cosHalf;
      })
      .sort((a, b) => b.probability - a.probability);
    let used = 0;
    for (const cell of inView) {
      if (used >= rayAllowance) break;
      used++;
      if (isVisible(cell)) cell.probability = 0;
    }
    return used;
  }

  /** The likeliest cell, or null once every cell is cleared. */
  peakCell(): SearchCell | null {
    let peak: SearchCell | null = null;
    for (const cell of this.cells) {
      if (cell.probability > 0 && (!peak || cell.probability > peak.probability)) peak = cell;
    }
    return peak;
  }

  /**
   * Sends searchers out in pairs: the likeliest cell goes to the two searchers nearest it (one to
   * the cell, one to its likeliest neighbour, so they sweep side by side); the next pair gets the
   * likeliest cell not next to an already chosen one, and so on. Deterministic for the same grid
   * and searchers.
   */
  assignTargets(searchers: readonly { readonly id: number; readonly x: number; readonly z: number }[]): Map<number, SearchCell> {
    const assignments = new Map<number, SearchCell>();
    const unassigned = [...searchers].sort((a, b) => a.id - b.id);
    const chosen: SearchCell[] = [];
    const ranked = this.cells.filter((cell) => cell.probability > 0).sort((a, b) => b.probability - a.probability);

    while (unassigned.length > 0) {
      const peak = ranked.find((cell) => chosen.every((other) => Math.max(Math.abs(cell.gx - other.gx), Math.abs(cell.gz - other.gz)) > 1));
      if (!peak) break;
      chosen.push(peak);
      unassigned.sort((a, b) => Math.hypot(a.x - peak.x, a.z - peak.z) - Math.hypot(b.x - peak.x, b.z - peak.z) || a.id - b.id);
      const lead = unassigned.shift()!;
      assignments.set(lead.id, peak);
      const partner = unassigned.shift();
      if (partner) assignments.set(partner.id, this.bestNeighbour(peak) ?? peak);
    }
    // More searchers than separate peaks: the rest join the likeliest cell.
    const top = ranked[0];
    if (top) for (const searcher of unassigned) assignments.set(searcher.id, top);
    return assignments;
  }

  private bestNeighbour(cell: SearchCell): SearchCell | null {
    let best: SearchCell | null = null;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const neighbour = this.byKey.get(cellKey(cell.gx + dx, cell.gz + dz));
        if (neighbour && neighbour.probability > 0 && (!best || neighbour.probability > best.probability)) best = neighbour;
      }
    }
    return best;
  }

  private total(): number {
    return this.cells.reduce((sum, cell) => sum + cell.probability, 0);
  }

  private normalise(target: number): void {
    const total = this.total();
    if (total <= 0) return;
    const scale = target / total;
    for (const cell of this.cells) cell.probability *= scale;
  }
}
