/**
 * A grenade's flight (docs/grenades.md): gravity, then a sphere swept along the step's motion; on a
 * hit it stops at the surface and bounces off it with restitution and Coulomb friction, up to
 * MAX_BOUNCES_PER_STEP times inside one step, and comes to rest on a floor once slow enough.
 *
 * Pure: the sweep against the world is passed in (GrenadeSystem wraps a Rapier shape cast), so every
 * rule is unit-tested against simple planes. Plain {x, y, z} objects, no three.js.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The first thing a sphere moving from `from` by `displacement` touches: how far along the motion
 * (0 to 1) and the surface normal there (unit length, pointing out of the surface). */
export interface SweepHit {
  readonly fraction: number;
  readonly normal: Vec3;
}

export type Sweep = (from: Vec3, displacement: Vec3) => SweepHit | null;

export interface FlightParams {
  readonly gravity: number;
  readonly restitution: number;
  readonly friction: number;
  readonly restSpeed: number;
  readonly radius: number;
  /** Ground height under (x, z), a last line of defence where the world has no collider yet (a
   * Valley chunk not streamed in): the sphere never sinks below it. Optional. */
  readonly floor?: (x: number, y: number, z: number) => number;
}

export interface GrenadeBody {
  readonly position: Vec3;
  readonly velocity: Vec3;
  resting: boolean;
}

export interface StepResult {
  /** The speed into the surface of the hardest contact this step (0 for none), for bounce sounds. */
  readonly impactSpeed: number;
}

/** A hit surface's normal is pushed this far clear of after each contact, so the next sweep does not
 * start touching it. */
const SKIN = 0.002;
const MAX_BOUNCES_PER_STEP = 4;
/** A contact normal at least this upright counts as a floor a grenade can rest on. */
const FLOOR_NORMAL_Y = 0.7;
/** A resting grenade looks this far below itself each step for what holds it up: nothing there (a
 * capsule that walked off, a door that opened) and it wakes and falls. Past the contact skin, short
 * of anything a grenade could visibly hang above. */
const SUPPORT_PROBE = 0.04;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

/** The velocity after hitting a surface with unit normal `normal`. The normal part reverses, scaled
 * by `restitution`; the tangential part loses at most `friction` times the normal impulse (Coulomb),
 * never reversing. A velocity already leaving the surface is returned unchanged. */
export function bounceVelocity(velocity: Vec3, normal: Vec3, restitution: number, friction: number): Vec3 {
  const into = dot(velocity, normal);
  if (into >= 0) return { x: velocity.x, y: velocity.y, z: velocity.z };
  const tangent = { x: velocity.x - into * normal.x, y: velocity.y - into * normal.y, z: velocity.z - into * normal.z };
  const tangentSpeed = length(tangent);
  const impulse = -into * (1 + restitution);
  const keep = tangentSpeed > 1e-9 ? Math.max(0, tangentSpeed - friction * impulse) / tangentSpeed : 0;
  const out = -into * restitution;
  return {
    x: tangent.x * keep + normal.x * out,
    y: tangent.y * keep + normal.y * out,
    z: tangent.z * keep + normal.z * out,
  };
}

/** Whether something still holds a resting grenade up: a floor-facing surface (or the terrain floor)
 * within SUPPORT_PROBE below it. */
function isSupported(body: GrenadeBody, sweep: Sweep, params: FlightParams): boolean {
  const { position } = body;
  if (params.floor && position.y <= params.floor(position.x, position.y, position.z) + params.radius + SUPPORT_PROBE) return true;
  const hit = sweep(position, { x: 0, y: -SUPPORT_PROBE, z: 0 });
  return hit !== null && hit.normal.y >= FLOOR_NORMAL_Y;
}

/** Advances `body` by `dt` seconds in place. A resting grenade stays put while something holds it up
 * and wakes the step that nothing does. */
export function stepGrenade(body: GrenadeBody, dt: number, sweep: Sweep, params: FlightParams): StepResult {
  if (!(dt > 0)) return { impactSpeed: 0 };
  if (body.resting) {
    if (isSupported(body, sweep, params)) return { impactSpeed: 0 };
    body.resting = false;
  }
  const { position, velocity } = body;
  velocity.y += params.gravity * dt;

  let remaining = dt;
  let impactSpeed = 0;
  let floorContact = false;
  for (let bounce = 0; bounce < MAX_BOUNCES_PER_STEP && remaining > 1e-6; bounce++) {
    const displacement = { x: velocity.x * remaining, y: velocity.y * remaining, z: velocity.z * remaining };
    if (length(displacement) < 1e-7) break;
    const hit = sweep(position, displacement);
    if (!hit) {
      position.x += displacement.x;
      position.y += displacement.y;
      position.z += displacement.z;
      break;
    }
    const fraction = Math.min(1, Math.max(0, hit.fraction));
    // A normal pointing along the motion is the far side of a surface the sphere is leaving: face it
    // against the motion so the bounce below always pushes the sphere back out.
    const normal = dot(hit.normal, displacement) > 0 ? { x: -hit.normal.x, y: -hit.normal.y, z: -hit.normal.z } : hit.normal;
    position.x += displacement.x * fraction + normal.x * SKIN;
    position.y += displacement.y * fraction + normal.y * SKIN;
    position.z += displacement.z * fraction + normal.z * SKIN;
    impactSpeed = Math.max(impactSpeed, -dot(velocity, normal));
    const next = bounceVelocity(velocity, normal, params.restitution, params.friction);
    velocity.x = next.x;
    velocity.y = next.y;
    velocity.z = next.z;
    if (normal.y >= FLOOR_NORMAL_Y) floorContact = true;
    remaining *= 1 - fraction;
  }

  if (params.floor) {
    const floorY = params.floor(position.x, position.y, position.z) + params.radius;
    if (position.y < floorY) {
      position.y = floorY;
      const floorNormal = { x: 0, y: 1, z: 0 };
      impactSpeed = Math.max(impactSpeed, -velocity.y);
      const next = bounceVelocity(velocity, floorNormal, params.restitution, params.friction);
      velocity.x = next.x;
      velocity.y = next.y;
      velocity.z = next.z;
      floorContact = true;
    }
  }

  if (floorContact && length(velocity) < params.restSpeed) {
    velocity.x = 0;
    velocity.y = 0;
    velocity.z = 0;
    body.resting = true;
  }
  return { impactSpeed };
}

export interface ArcPrediction {
  /** Points along the flight, from the hand to the first contact (or the time limit). */
  readonly points: Vec3[];
  /** Where it first touches something and that surface's normal, or null when it never does. */
  readonly landing: { point: Vec3; normal: Vec3 } | null;
}

/** The throw preview: the path from `origin` at `velocity` up to its first contact, sampled every
 * `step` seconds for at most `maxTime` seconds. */
export function predictArc(origin: Vec3, velocity: Vec3, sweep: Sweep, params: FlightParams, maxTime: number, step: number): ArcPrediction {
  const position = { x: origin.x, y: origin.y, z: origin.z };
  const v = { x: velocity.x, y: velocity.y, z: velocity.z };
  const points: Vec3[] = [{ ...position }];
  for (let t = 0; t < maxTime; t += step) {
    v.y += params.gravity * step;
    const displacement = { x: v.x * step, y: v.y * step, z: v.z * step };
    const hit = sweep(position, displacement);
    if (hit) {
      const fraction = Math.min(1, Math.max(0, hit.fraction));
      const point = { x: position.x + displacement.x * fraction, y: position.y + displacement.y * fraction, z: position.z + displacement.z * fraction };
      points.push(point);
      return { points, landing: { point, normal: hit.normal } };
    }
    // The floor lookup (a ray underground) is only the safety net for a sweep that found nothing, so
    // a step that hit something never pays for it.
    const floorY = params.floor ? params.floor(position.x + displacement.x, position.y, position.z + displacement.z) + params.radius : -Infinity;
    position.x += displacement.x;
    position.y += displacement.y;
    position.z += displacement.z;
    if (position.y < floorY) {
      position.y = floorY;
      points.push({ ...position });
      return { points, landing: { point: { ...position }, normal: { x: 0, y: 1, z: 0 } } };
    }
    points.push({ ...position });
  }
  return { points, landing: null };
}
