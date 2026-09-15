import { describe, expect, it } from 'vitest';
import { SearchGrid, type SearchGridOptions } from './searchGrid.ts';
import { ENEMY_SEARCH_DIFFUSION_RATE } from '../../core/config.ts';

const OPTIONS: SearchGridOptions = { cellSize: 4, radiusCells: 5, diffusionRate: 0.15 };
const open = (): boolean => false;
const at = (grid: SearchGrid, gx: number, gz: number) => grid.cells.find((cell) => cell.gx === gx && cell.gz === gz);

describe('SearchGrid start', () => {
  it('puts almost all the probability at the last known position, a little next to it, summing to 1', () => {
    const grid = new SearchGrid({ x: 10, z: -5 }, OPTIONS, open);
    expect(grid.totalProbability).toBeCloseTo(1);
    expect(grid.peakCell()).toMatchObject({ gx: 0, gz: 0, x: 10, z: -5 });
    expect(at(grid, 1, 0)!.probability).toBeGreaterThan(0);
    expect(at(grid, 2, 0)!.probability).toBe(0);
  });

  it('covers a disc of cells and leaves out blocked ground', () => {
    const full = new SearchGrid({ x: 0, z: 0 }, OPTIONS, open);
    const blockedEast = new SearchGrid({ x: 0, z: 0 }, OPTIONS, (x) => x > 6);
    expect(full.cells.every((cell) => cell.gx * cell.gx + cell.gz * cell.gz <= 25)).toBe(true);
    expect(blockedEast.cells.length).toBeLessThan(full.cells.length);
    expect(blockedEast.cells.every((cell) => cell.x <= 6)).toBe(true);
  });

  it('starts from the nearest usable cells when the last known cell itself is blocked', () => {
    const grid = new SearchGrid({ x: 0, z: 0 }, OPTIONS, (x, z) => x === 0 && z === 0);
    expect(grid.totalProbability).toBeCloseTo(1);
    expect(at(grid, 0, 0)).toBeUndefined();
    expect(at(grid, 1, 0)!.probability).toBeGreaterThan(0);
  });
});

describe('SearchGrid over time', () => {
  it('spreads probability outward without losing any', () => {
    const grid = new SearchGrid({ x: 0, z: 0 }, OPTIONS, open);
    const centreBefore = at(grid, 0, 0)!.probability;
    for (let i = 0; i < 60; i++) grid.update(0.1);
    expect(grid.totalProbability).toBeCloseTo(1);
    expect(at(grid, 0, 0)!.probability).toBeLessThan(centreBefore);
    expect(at(grid, 2, 0)!.probability).toBeGreaterThan(0);
    expect(grid.age).toBeCloseTo(6);
  });

  it('at the game rate keeps pace with a player slipping away: after 5 s most of the chance is 2 or more cells out', () => {
    const outerShare = (rate: number) => {
      const grid = new SearchGrid({ x: 0, z: 0 }, { ...OPTIONS, diffusionRate: rate }, open);
      grid.update(5);
      return grid.cells.filter((cell) => Math.hypot(cell.gx, cell.gz) >= 2).reduce((sum, cell) => sum + cell.probability, 0);
    };
    expect(outerShare(ENEMY_SEARCH_DIFFUSION_RATE)).toBeGreaterThan(0.5);
    // The first rate kept over four fifths within a cell of the spot, so one glance ended a search.
    expect(outerShare(0.15)).toBeLessThan(0.2);
  });

  it('gives the same spread for one long step as for many short ones', () => {
    const fast = { ...OPTIONS, diffusionRate: ENEMY_SEARCH_DIFFUSION_RATE };
    const oneStep = new SearchGrid({ x: 0, z: 0 }, fast, open);
    const manySteps = new SearchGrid({ x: 0, z: 0 }, fast, open);
    oneStep.update(1);
    for (let i = 0; i < 60; i++) manySteps.update(1 / 60);
    for (const cell of oneStep.cells) {
      expect(cell.probability).toBeGreaterThanOrEqual(0);
      expect(cell.probability).toBeCloseTo(at(manySteps, cell.gx, cell.gz)!.probability, 2);
    }
  });

  it('spreadFor gives a head start without ageing the grid', () => {
    const grid = new SearchGrid({ x: 0, z: 0 }, OPTIONS, open);
    const centreBefore = at(grid, 0, 0)!.probability;
    grid.spreadFor(3);
    expect(grid.age).toBe(0);
    expect(at(grid, 0, 0)!.probability).toBeLessThan(centreBefore);
    expect(grid.totalProbability).toBeCloseTo(1);
  });

  it('loses probability only where cells are cleared, and the peak moves off a cleared cell', () => {
    const grid = new SearchGrid({ x: 0, z: 0 }, OPTIONS, open);
    for (let i = 0; i < 20; i++) grid.update(0.1);
    grid.clearNear(0, 0, 1);
    expect(at(grid, 0, 0)!.probability).toBe(0);
    expect(grid.totalProbability).toBeLessThan(1);
    const peak = grid.peakCell()!;
    expect(peak.gx !== 0 || peak.gz !== 0).toBe(true);
  });
});

describe('SearchGrid clearing by sight', () => {
  it('checks only cells in front and in range, likeliest first, up to the allowance', () => {
    const grid = new SearchGrid({ x: 0, z: 0 }, OPTIONS, open);
    for (let i = 0; i < 40; i++) grid.update(0.1);
    const checked: string[] = [];
    // Standing 8 m south of the centre facing north (+z): the centre is 8 m ahead.
    const used = grid.clearVisibleFrom({ x: 0, z: -8 }, 0, 12, 45, (cell) => (checked.push(`${cell.gx},${cell.gz}`), true), 3);
    expect(used).toBe(3);
    expect(checked[0]).toBe('0,0');
    expect(at(grid, 0, 0)!.probability).toBe(0);
    for (const key of checked) {
      const [gx, gz] = key.split(',').map(Number);
      expect(gz!).toBeGreaterThanOrEqual(-1);
      expect(Math.abs(gx!)).toBeLessThanOrEqual(3);
    }
  });

  it('leaves cells it cannot see', () => {
    const grid = new SearchGrid({ x: 0, z: 0 }, OPTIONS, open);
    const before = grid.totalProbability;
    grid.clearVisibleFrom({ x: 0, z: -8 }, 0, 12, 45, () => false, 10);
    expect(grid.totalProbability).toBeCloseTo(before);
  });
});

describe('SearchGrid pairs', () => {
  it('sends two searchers to the likeliest cell and a cell beside it', () => {
    const grid = new SearchGrid({ x: 0, z: 0 }, OPTIONS, open);
    const targets = grid.assignTargets([
      { id: 7, x: -20, z: 0 },
      { id: 3, x: 20, z: 0 },
    ]);
    const cells = [...targets.values()];
    expect(cells).toHaveLength(2);
    expect(cells.some((cell) => cell.gx === 0 && cell.gz === 0)).toBe(true);
    const [a, b] = cells as [NonNullable<(typeof cells)[number]>, NonNullable<(typeof cells)[number]>];
    expect(Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gz - b.gz))).toBe(1);
  });

  it('sends a second pair to a separate likely spot', () => {
    const grid = new SearchGrid({ x: 0, z: 0 }, OPTIONS, open);
    for (let i = 0; i < 40; i++) grid.update(0.1);
    grid.clearNear(0, 0, 5);
    const targets = grid.assignTargets([
      { id: 1, x: -20, z: 0 },
      { id: 2, x: -20, z: 1 },
      { id: 3, x: 20, z: 0 },
      { id: 4, x: 20, z: 1 },
    ]);
    const leads = [targets.get(1)!, targets.get(3)!];
    expect(Math.max(Math.abs(leads[0]!.gx - leads[1]!.gx), Math.abs(leads[0]!.gz - leads[1]!.gz))).toBeGreaterThan(1);
  });

  it('is deterministic for the same grid and searchers', () => {
    const make = () => {
      const grid = new SearchGrid({ x: 0, z: 0 }, OPTIONS, open);
      for (let i = 0; i < 30; i++) grid.update(0.1);
      return grid.assignTargets([
        { id: 1, x: 5, z: 5 },
        { id: 2, x: -5, z: 5 },
        { id: 3, x: 0, z: -9 },
      ]);
    };
    const a = make();
    const b = make();
    for (const id of [1, 2, 3]) expect(a.get(id)).toEqual(b.get(id));
  });
});
