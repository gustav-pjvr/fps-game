import { describe, expect, it } from 'vitest';
import { bounceVelocity, predictArc, slopeHolds, stepGrenade, type FlightParams, type GrenadeBody, type Sweep, type Vec3 } from './grenadeFlight.ts';

const RADIUS = 0.07;
const PARAMS: FlightParams = { gravity: -20, radius: RADIUS, restitution: 0.4, softImpactSpeed: 1.4, friction: 0.3, rollingResistance: 0.2, restSpeed: 0.25 };
const DT = 1 / 60;

/** A sweep against infinite planes (point, unit normal), the nearest first. */
function planes(...list: { point: Vec3; normal: Vec3 }[]): Sweep {
  return (from, displacement) => {
    let best: { fraction: number; normal: Vec3 } | null = null;
    for (const { point, normal } of list) {
      const start = (from.x - point.x) * normal.x + (from.y - point.y) * normal.y + (from.z - point.z) * normal.z - RADIUS;
      const approach = displacement.x * normal.x + displacement.y * normal.y + displacement.z * normal.z;
      if (approach >= 0 || start + approach > 0) continue;
      const fraction = Math.max(0, start / -approach);
      if (!best || fraction < best.fraction) best = { fraction, normal };
    }
    return best;
  };
}

const UP = { x: 0, y: 1, z: 0 };
const FLOOR = planes({ point: { x: 0, y: 0, z: 0 }, normal: UP });

/** A plane through the origin tilted `degrees` so that it falls away toward +x. */
function slope(degrees: number): { sweep: Sweep; normal: Vec3 } {
  const a = (degrees * Math.PI) / 180;
  const normal = { x: Math.sin(a), y: Math.cos(a), z: 0 };
  return { sweep: planes({ point: { x: 0, y: 0, z: 0 }, normal }), normal };
}

function body(position: Vec3, velocity: Vec3): GrenadeBody {
  return { position: { ...position }, velocity: { ...velocity }, resting: false };
}

function run(grenade: GrenadeBody, sweep: Sweep, seconds: number, params = PARAMS, each?: (bounces: number, impact: number) => void): void {
  for (let i = 0; i < seconds / DT && !grenade.resting; i++) {
    const result = stepGrenade(grenade, DT, sweep, params);
    each?.(result.bounces, result.impactSpeed);
  }
}

describe('bounceVelocity', () => {
  it('reverses the normal part scaled by restitution', () => {
    const v = bounceVelocity({ x: 0, y: -10, z: 0 }, UP, 0.4, 0.3);
    expect(v.y).toBeCloseTo(4);
    expect(v.x).toBe(0);
  });

  it('takes at most friction times the normal impulse off the tangential speed, never reversing it', () => {
    // Impulse 10 * 1.4 = 14, friction 0.3 of it = 4.2 off a tangential 12.
    const hard = bounceVelocity({ x: 12, y: -10, z: 0 }, UP, 0.4, 0.3);
    expect(hard.x).toBeCloseTo(7.8);
    const slow = bounceVelocity({ x: 1, y: -10, z: 0 }, UP, 0.4, 0.3);
    expect(slow.x).toBe(0);
  });

  it('leaves a velocity already moving away from the surface alone', () => {
    expect(bounceVelocity({ x: 1, y: 2, z: 3 }, UP, 0.4, 0.3)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('in the air', () => {
  it('falls under gravity in free flight', () => {
    const grenade = body({ x: 0, y: 10, z: 0 }, { x: 5, y: 0, z: 0 });
    stepGrenade(grenade, 0.1, FLOOR, PARAMS);
    expect(grenade.velocity.y).toBeCloseTo(-2);
    expect(grenade.position.x).toBeCloseTo(0.5);
    // Sub-stepped: within a centimetre of the exact 10 - 0.5 * 20 * 0.01.
    expect(grenade.position.y).toBeCloseTo(9.9, 1);
  });

  it('flies the same arc whatever the tick length', () => {
    const fine = body({ x: 0, y: 1.5, z: 0 }, { x: 15, y: 6, z: 0 });
    const coarse = body({ x: 0, y: 1.5, z: 0 }, { x: 15, y: 6, z: 0 });
    for (let i = 0; i < 48; i++) stepGrenade(fine, 1 / 120, FLOOR, PARAMS);
    for (let i = 0; i < 12; i++) stepGrenade(coarse, 1 / 30, FLOOR, PARAMS);
    expect(coarse.position.x).toBeCloseTo(fine.position.x, 5);
    expect(coarse.position.y).toBeCloseTo(fine.position.y, 5);
  });

  it('never passes through a floor, even at a speed that would cross it in one step', () => {
    const grenade = body({ x: 0, y: 0.5, z: 0 }, { x: 0, y: -60, z: 0 });
    const result = stepGrenade(grenade, DT, FLOOR, PARAMS);
    expect(grenade.position.y).toBeGreaterThanOrEqual(RADIUS);
    expect(grenade.velocity.y).toBeGreaterThan(0);
    expect(result.impactSpeed).toBeGreaterThan(50);
    expect(result.bounces).toBe(1);
  });

  it('bounces off a wall instead of tunnelling through it, whichever way the sweep reports the normal', () => {
    for (const sign of [1, -1]) {
      const wall = planes({ point: { x: 2, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } });
      const flipped: Sweep = (from, displacement) => {
        const hit = wall(from, displacement);
        return hit && { fraction: hit.fraction, normal: { x: hit.normal.x * sign, y: 0, z: 0 } };
      };
      const grenade = body({ x: 1.9, y: 5, z: 0 }, { x: 17, y: 0, z: 0 });
      stepGrenade(grenade, 1 / 120, flipped, PARAMS);
      expect(grenade.position.x).toBeLessThanOrEqual(2 - RADIUS + 1e-6);
      expect(grenade.velocity.x).toBeCloseTo(-17 * 0.4);
    }
  });
});

describe('landing, rolling and resting', () => {
  it('a throw lands, bounces lower each time, rolls on and stops', () => {
    const grenade = body({ x: 0, y: 1.5, z: 0 }, { x: 10, y: 4, z: 0 });
    const impacts: number[] = [];
    let rolledFrom: number | null = null;
    run(grenade, FLOOR, 8, PARAMS, (bounces, impact) => {
      if (bounces > 0) impacts.push(impact);
      if (grenade.rolling && rolledFrom === null) rolledFrom = grenade.position.x;
    });
    expect(grenade.resting).toBe(true);
    expect(grenade.position.y).toBeCloseTo(RADIUS, 2);
    // A few bounces, each softer than the last, and never a buzz of tiny ones.
    expect(impacts.length).toBeGreaterThanOrEqual(2);
    expect(impacts.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < impacts.length; i++) expect(impacts[i]!).toBeLessThan(impacts[i - 1]!);
    expect(impacts[impacts.length - 1]!).toBeGreaterThan(PARAMS.softImpactSpeed);
    // It rolled after the last bounce: further than it bounced to, but not across the map.
    expect(rolledFrom).not.toBeNull();
    expect(grenade.position.x).toBeGreaterThan(rolledFrom! + 0.3);
    expect(grenade.position.x).toBeLessThan(25);
    // At rest it stays put.
    const restingAt = { ...grenade.position };
    stepGrenade(grenade, DT, FLOOR, PARAMS);
    expect(grenade.position).toEqual(restingAt);
  });

  it('rolling slows at the rolling resistance: 5 m/s on the flat stops in about 3 m', () => {
    const grenade = body({ x: 0, y: RADIUS + 0.002, z: 0 }, { x: 5, y: 0, z: 0 });
    run(grenade, FLOOR, 6);
    expect(grenade.resting).toBe(true);
    // v^2 / (2 * 0.2 * 20) = 3.125 m.
    expect(grenade.position.x).toBeGreaterThan(2.8);
    expect(grenade.position.x).toBeLessThan(3.4);
  });

  it('a gentle drop does not bounce', () => {
    const grenade = body({ x: 0, y: RADIUS + 0.03, z: 0 }, { x: 0, y: 0, z: 0 });
    let bounces = 0;
    run(grenade, FLOOR, 1, PARAMS, (count) => { bounces += count; });
    expect(bounces).toBe(0);
    expect(grenade.resting).toBe(true);
  });

  it('holds on a shallow slope and keeps rolling down a steep one', () => {
    expect(slopeHolds(slope(6).normal, PARAMS.rollingResistance)).toBe(true);
    expect(slopeHolds(slope(20).normal, PARAMS.rollingResistance)).toBe(false);

    const shallow = slope(6);
    const still = body({ x: shallow.normal.x * (RADIUS + 0.002), y: shallow.normal.y * (RADIUS + 0.002), z: 0 }, { x: 0, y: 0, z: 0 });
    run(still, shallow.sweep, 2);
    expect(still.resting).toBe(true);

    const steep = slope(20);
    const rolling = body({ x: steep.normal.x * (RADIUS + 0.002), y: steep.normal.y * (RADIUS + 0.002), z: 0 }, { x: 0, y: 0, z: 0 });
    run(rolling, steep.sweep, 2);
    expect(rolling.resting).toBe(false);
    // Downhill is +x, and it gathers speed: g * (sin 20 - 0.2 cos 20) is about 3 m/s2.
    expect(rolling.position.x).toBeGreaterThan(3);
    expect(rolling.velocity.x).toBeGreaterThan(3);
    expect(rolling.rolling).toBe(true);
  });

  it('rolls off an edge and falls', () => {
    // A floor that ends at x = 1: beyond it only a lower floor at y = -2.
    const ledge: Sweep = (from, displacement) => (from.x < 1 ? FLOOR(from, displacement) : planes({ point: { x: 0, y: -2, z: 0 }, normal: UP })(from, displacement));
    const grenade = body({ x: 0, y: RADIUS + 0.002, z: 0 }, { x: 4, y: 0, z: 0 });
    run(grenade, ledge, 4);
    expect(grenade.position.y).toBeLessThan(-1.8);
    expect(grenade.resting).toBe(true);
  });

  it('a resting grenade wakes and falls once what held it up is gone, and stays while it is there', () => {
    let shelf = true;
    const shelfSweep: Sweep = (from, displacement) => (shelf ? planes({ point: { x: 0, y: 1, z: 0 }, normal: UP })(from, displacement) : FLOOR(from, displacement));
    const grenade = body({ x: 0, y: 1 + RADIUS + 0.002, z: 0 }, { x: 0, y: 0, z: 0 });
    grenade.resting = true;
    stepGrenade(grenade, DT, shelfSweep, PARAMS);
    expect(grenade.resting).toBe(true);
    expect(grenade.position.y).toBeCloseTo(1 + RADIUS + 0.002);
    shelf = false;
    for (let i = 0; i < 30 && grenade.position.y > 1; i++) stepGrenade(grenade, DT, shelfSweep, PARAMS);
    expect(grenade.resting).toBe(false);
    expect(grenade.position.y).toBeLessThan(1);
    run(grenade, shelfSweep, 4);
    expect(grenade.resting).toBe(true);
    expect(grenade.position.y).toBeLessThan(RADIUS + 0.01);
  });

  it('a resting grenade on the terrain floor fallback stays resting', () => {
    const nothing: Sweep = () => null;
    const grenade = body({ x: 0, y: 2 + RADIUS + 0.002, z: 0 }, { x: 0, y: 0, z: 0 });
    grenade.resting = true;
    stepGrenade(grenade, DT, nothing, { ...PARAMS, floor: () => 2 });
    expect(grenade.resting).toBe(true);
  });

  it('does not come to rest against a wall in mid-air', () => {
    const wall = planes({ point: { x: 1, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } });
    const grenade = body({ x: 0.929, y: 5, z: 0 }, { x: 0.2, y: 0, z: 0 });
    stepGrenade(grenade, DT, wall, PARAMS);
    expect(grenade.resting).toBe(false);
    expect(grenade.rolling).toBe(false);
  });

  it('the floor fallback catches a grenade where the world has no collider', () => {
    const nothing: Sweep = () => null;
    const grenade = body({ x: 0, y: 2.05, z: 0 }, { x: 0, y: -30, z: 0 });
    stepGrenade(grenade, DT, nothing, { ...PARAMS, floor: () => 2 });
    expect(grenade.position.y).toBeGreaterThanOrEqual(2 + RADIUS);
    expect(grenade.velocity.y).toBeGreaterThan(0);
  });
});

describe('predictArc', () => {
  it('follows the throw to its first contact and reports the landing point and normal', () => {
    const arc = predictArc({ x: 0, y: 1.5, z: 0 }, { x: 10, y: 3, z: 0 }, FLOOR, PARAMS, 3, 1 / 30);
    expect(arc.landing).not.toBeNull();
    expect(arc.landing!.normal).toEqual(UP);
    expect(arc.landing!.point.y).toBeCloseTo(RADIUS, 2);
    // Matches the ballistic landing: y = 1.5 + 3t - 10t^2 reaches 0.07 at t of about 0.56 s.
    expect(arc.landing!.point.x).toBeGreaterThan(5.2);
    expect(arc.landing!.point.x).toBeLessThan(6);
    expect(arc.points.length).toBeGreaterThan(10);
    expect(arc.points[0]).toEqual({ x: 0, y: 1.5, z: 0 });
  });

  it('reports the landing normal out of the surface even when the sweep gives it reversed', () => {
    const reversed: Sweep = (from, displacement) => {
      const hit = FLOOR(from, displacement);
      return hit && { fraction: hit.fraction, normal: { x: 0, y: -1, z: 0 } };
    };
    const arc = predictArc({ x: 0, y: 1.5, z: 0 }, { x: 10, y: 3, z: 0 }, reversed, PARAMS, 3, 1 / 30);
    expect(arc.landing!.normal).toEqual(UP);
  });

  it('gives no landing when nothing is hit in time', () => {
    const arc = predictArc({ x: 0, y: 100, z: 0 }, { x: 1, y: 0, z: 0 }, FLOOR, PARAMS, 0.5, 0.05);
    expect(arc.landing).toBeNull();
  });
});
