import { afterEach, describe, expect, it } from 'vitest';
import { hasEnemyNavigator, resolveMoveTarget, setEnemyNavigator } from './enemyNavigator.ts';
import { generateFacilityLayout, isWalkable } from '../../world/facility/facilityLayout.ts';
import { FacilityNav, segmentClear } from '../../world/facility/facilityNav.ts';

describe('enemy navigator hook', () => {
  afterEach(() => setEnemyNavigator(null));

  it('steers straight at the target when no navigator is set (the Valley)', () => {
    expect(hasEnemyNavigator()).toBe(false);
    expect(resolveMoveTarget(1, 2, 30, -4)).toEqual({ x: 30, z: -4 });
  });

  it('steers at the navigator waypoint while one is set, and straight again once cleared', () => {
    const calls: number[][] = [];
    setEnemyNavigator((fromX, fromZ, toX, toZ) => {
      calls.push([fromX, fromZ, toX, toZ]);
      return { x: fromX + 1, z: fromZ };
    });
    expect(hasEnemyNavigator()).toBe(true);
    expect(resolveMoveTarget(1, 2, 30, -4)).toEqual({ x: 2, z: 2 });
    expect(calls).toEqual([[1, 2, 30, -4]]);
    setEnemyNavigator(null);
    expect(hasEnemyNavigator()).toBe(false);
    expect(resolveMoveTarget(1, 2, 30, -4)).toEqual({ x: 30, z: -4 });
  });

  it('routes around Facility walls with a FacilityNav navigator, the way Game wires it', () => {
    const layout = generateFacilityLayout(1), nav = new FacilityNav(layout);
    setEnemyNavigator((fromX, fromZ, toX, toZ) => nav.nextWaypoint(fromX, fromZ, toX, toZ));
    // Two room centres with a wall between them: the waypoint is not the raw target, and the way
    // to it is clear.
    const centres = layout.rooms.map(room => ({
      x: ((room.i0 + room.i1) / 2 - layout.size / 2) * layout.cell,
      z: ((room.j0 + room.j1) / 2 - layout.size / 2) * layout.cell,
    })).filter(point => isWalkable(layout, point.x, point.z, 0.45));
    let checked = 0;
    for (const from of centres) for (const to of centres) {
      if (from === to || segmentClear(layout, from.x, from.z, to.x, to.z, 0.45)) continue;
      const waypoint = resolveMoveTarget(from.x, from.z, to.x, to.z);
      expect(waypoint).not.toEqual({ x: to.x, z: to.z });
      expect(segmentClear(layout, from.x, from.z, waypoint.x, waypoint.z, 0.45)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
