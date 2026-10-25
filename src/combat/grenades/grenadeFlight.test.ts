import { describe, expect, it } from 'vitest';
import { bounceVelocity, predictArc, stepGrenade, type FlightParams, type GrenadeBody, type Sweep, type Vec3 } from './grenadeFlight.ts';

const RADIUS = 0.07;
const PARAMS: FlightParams = { gravity: -20, restitution: 0.35, friction: 0.6, restSpeed: 0.4, radius: RADIUS };

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

const FLOOR = planes({ point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } });

function body(position: Vec3, velocity: Vec3): GrenadeBody {
  return { position: { ...position }, velocity: { ...velocity }, resting: false };
}

describe('bounceVelocity', () => {
  it('reverses the normal part scaled by restitution', () => {
    const v = bounceVelocity({ x: 0, y: -10, z: 0 }, { x: 0, y: 1, z: 0 }, 0.35, 0.6);
    expect(v.y).toBeCloseTo(3.5);
    expect(v.x).toBe(0);
  });

  it('takes at most friction times the normal impulse off the tangential speed, never reversing it', () => {
    // Impulse 10 * 1.35 = 13.5, friction 0.6 of it = 8.1 off a tangential 12.
    const hard = bounceVelocity({ x: 12, y: -10, z: 0 }, { x: 0, y: 1, z: 0 }, 0.35, 0.6);
    expect(hard.x).toBeCloseTo(3.9);
    // A gentle touch barely slows a fast roll; a slow roll stops instead of reversing.
    const slow = bounceVelocity({ x: 1, y: -10, z: 0 }, { x: 0, y: 1, z: 0 }, 0.35, 0.6);
    expect(slow.x).toBe(0);
  });

  it('leaves a velocity already moving away from the surface alone', () => {
    expect(bounceVelocity({ x: 1, y: 2, z: 3 }, { x: 0, y: 1, z: 0 }, 0.35, 0.6)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('stepGrenade', () => {
  it('falls under gravity in free flight', () => {
    const grenade = body({ x: 0, y: 10, z: 0 }, { x: 5, y: 0, z: 0 });
    stepGrenade(grenade, 0.1, FLOOR, PARAMS);
    expect(grenade.velocity.y).toBeCloseTo(-2);
    expect(grenade.position.x).toBeCloseTo(0.5);
    expect(grenade.position.y).toBeCloseTo(9.8);
  });

  it('never passes through a floor, even at a speed that would cross it in one step', () => {
    const grenade = body({ x: 0, y: 0.5, z: 0 }, { x: 0, y: -60, z: 0 });
    const result = stepGrenade(grenade, 1 / 60, FLOOR, PARAMS);
    expect(grenade.position.y).toBeGreaterThanOrEqual(RADIUS);
    expect(grenade.velocity.y).toBeGreaterThan(0);
    expect(result.impactSpeed).toBeGreaterThan(50);
  });

  it('bounces off a wall instead of tunnelling through it', () => {
    const wall = planes({ point: { x: 2, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } });
    const grenade = body({ x: 1.9, y: 5, z: 0 }, { x: 17, y: 0, z: 0 });
    stepGrenade(grenade, 1 / 30, wall, PARAMS);
    expect(grenade.position.x).toBeLessThanOrEqual(2 - RADIUS + 1e-6);
    expect(grenade.velocity.x).toBeCloseTo(-17 * 0.35);
  });

  it('a throw lands, bounces lower each time and rolls to rest on the floor', () => {
    const grenade = body({ x: 0, y: 1.5, z: 0 }, { x: 10, y: 4, z: 0 });
    let peaksAfterLanding = 0;
    let lastY = grenade.position.y;
    let wasRising = true;
    const peaks: number[] = [];
    for (let i = 0; i < 60 * 6 && !grenade.resting; i++) {
      stepGrenade(grenade, 1 / 60, FLOOR, PARAMS);
      const rising = grenade.position.y > lastY;
      if (wasRising && !rising && i > 5) {
        peaks.push(lastY);
        peaksAfterLanding++;
      }
      wasRising = rising;
      lastY = grenade.position.y;
    }
    expect(grenade.resting).toBe(true);
    // On the floor, give or take the last tiny hop.
    expect(grenade.position.y).toBeGreaterThanOrEqual(RADIUS);
    expect(grenade.position.y).toBeLessThan(RADIUS + 0.01);
    expect(grenade.position.x).toBeGreaterThan(5);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]!).toBeLessThan(peaks[i - 1]!);
    expect(peaksAfterLanding).toBeGreaterThan(0);
    // At rest it stays put.
    const restingAt = { ...grenade.position };
    stepGrenade(grenade, 1 / 60, FLOOR, PARAMS);
    expect(grenade.position).toEqual(restingAt);
  });

  it('does not come to rest against a wall in mid-air', () => {
    const wall = planes({ point: { x: 1, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } });
    const grenade = body({ x: 0.929, y: 5, z: 0 }, { x: 0.2, y: 0, z: 0 });
    stepGrenade(grenade, 1 / 60, wall, PARAMS);
    expect(grenade.resting).toBe(false);
  });

  it('the floor fallback catches a grenade where the world has no collider', () => {
    const nothing: Sweep = () => null;
    const grenade = body({ x: 0, y: 2.05, z: 0 }, { x: 0, y: -30, z: 0 });
    stepGrenade(grenade, 0.1, nothing, { ...PARAMS, floor: () => 2 });
    expect(grenade.position.y).toBeCloseTo(2 + RADIUS);
    expect(grenade.velocity.y).toBeGreaterThan(0);
  });
});

describe('predictArc', () => {
  it('follows the throw to its first contact and reports the landing point and normal', () => {
    const arc = predictArc({ x: 0, y: 1.5, z: 0 }, { x: 10, y: 3, z: 0 }, FLOOR, PARAMS, 3, 1 / 30);
    expect(arc.landing).not.toBeNull();
    expect(arc.landing!.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(arc.landing!.point.y).toBeCloseTo(RADIUS, 2);
    // Matches the ballistic landing: y = 1.5 + 3t - 10t^2 reaches 0.07 at t of about 0.56 s.
    expect(arc.landing!.point.x).toBeGreaterThan(5.2);
    expect(arc.landing!.point.x).toBeLessThan(6);
    expect(arc.points.length).toBeGreaterThan(10);
    expect(arc.points[0]).toEqual({ x: 0, y: 1.5, z: 0 });
  });

  it('gives no landing when nothing is hit in time', () => {
    const arc = predictArc({ x: 0, y: 100, z: 0 }, { x: 1, y: 0, z: 0 }, FLOOR, PARAMS, 0.5, 0.05);
    expect(arc.landing).toBeNull();
  });
});
