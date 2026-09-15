import { describe, expect, it } from 'vitest';
import { pickReinforcementSpawns, type SpawnOptions, type SpawnProbeContext } from './reinforcementSpawner.ts';
import { mulberry32 } from '../../../utils/rng.ts';

const OPTIONS: SpawnOptions = {
  minRadius: 18,
  maxRadius: 30,
  behindHalfAngleDeg: 100,
  candidates: 6,
  rays: 6,
  headHeight: 1.6,
  minSpacing: 3,
};

/** Player at the origin looking down -z (yaw 0), so "behind" is +z; a 16:9 screen's view plus margin. */
function context(overrides: Partial<SpawnProbeContext> = {}, seed = 1): SpawnProbeContext {
  return {
    player: { x: 0, z: 0, forwardX: 0, forwardZ: -1 },
    viewHalfAngleDeg: 67,
    isBlocked: () => false,
    heightAt: () => 0,
    canPlayerSee: () => false,
    rng: mulberry32(seed),
    ...overrides,
  };
}

/** Degrees between the player's forward (-z) and the direction to a point. */
const offForward = (point: { x: number; z: number }) => (Math.acos(-point.z / Math.hypot(point.x, point.z)) * 180) / Math.PI;

describe('pickReinforcementSpawns', () => {
  it('places points behind the player, between the two radii', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { points } = pickReinforcementSpawns(context({}, seed), 2, false, OPTIONS);
      expect(points).toHaveLength(2);
      for (const point of points) {
        const distance = Math.hypot(point.x, point.z);
        expect(distance).toBeGreaterThanOrEqual(OPTIONS.minRadius - 1e-9);
        expect(distance).toBeLessThanOrEqual(OPTIONS.maxRadius + 1e-9);
        // Within 100 degrees of straight behind: never in the 80-degree wedge dead ahead.
        expect(offForward(point)).toBeGreaterThanOrEqual(80 - 1e-9);
        expect(point.hidden).toBe(true);
      }
    }
  });

  it('never places a point on screen, and spends no ray on one', () => {
    // Draw from the whole circle: only the view check keeps points off the screen.
    for (let seed = 1; seed <= 20; seed++) {
      const { points, raysUsed } = pickReinforcementSpawns(context({}, seed), 6, false, { ...OPTIONS, behindHalfAngleDeg: 180 });
      for (const point of points) expect(offForward(point)).toBeGreaterThan(67);
      expect(raysUsed).toBe(points.length);
    }
  });

  it('uses a hidden point before an exposed one, and says which it is', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const verdicts: boolean[] = [];
      const canPlayerSee = (x: number) => {
        verdicts.push(x < 0);
        return x < 0;
      };
      const { points } = pickReinforcementSpawns(context({ canPlayerSee }, seed), 1, false, OPTIONS);
      expect(points).toHaveLength(1);
      expect(points[0]!.hidden).toBe(points[0]!.x >= 0);
      if (verdicts.includes(false)) expect(points[0]!.hidden).toBe(true);
    }
  });

  it('still sends the wave when the player can see everywhere behind them, off screen', () => {
    const { points, raysUsed } = pickReinforcementSpawns(context({ canPlayerSee: () => true }), 2, false, OPTIONS);
    expect(points).toHaveLength(2);
    expect(raysUsed).toBeLessThanOrEqual(OPTIONS.rays);
    for (const point of points) {
      expect(point.hidden).toBe(false);
      expect(offForward(point)).toBeGreaterThan(67);
    }
  });

  it('never uses a point inside a house or tower, and spends no ray on one', () => {
    let rays = 0;
    const { points } = pickReinforcementSpawns(
      context({
        isBlocked: (x) => x > 0,
        canPlayerSee: () => {
          rays++;
          return false;
        },
      }),
      6,
      false,
      OPTIONS,
    );
    for (const point of points) expect(point.x).toBeLessThanOrEqual(0);
    expect(rays).toBe(points.length);
  });

  it('keeps reinforcements apart', () => {
    const { points } = pickReinforcementSpawns(context({}, 7), 6, false, OPTIONS);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.z - points[j]!.z)).toBeGreaterThanOrEqual(OPTIONS.minSpacing);
      }
    }
  });

  it('puts a Ridge Walker wave on the highest hidden ground drawn', () => {
    // Ground rises to the right; the highest candidate drawn wins the first place.
    const heightAt = (x: number) => x;
    const all = pickReinforcementSpawns(context({ heightAt }, 3), 6, false, OPTIONS);
    const high = pickReinforcementSpawns(context({ heightAt }, 3), 1, true, OPTIONS);
    const highest = Math.max(...all.points.map((point) => point.y));
    expect(high.points[0]?.y).toBe(highest);
  });
});
