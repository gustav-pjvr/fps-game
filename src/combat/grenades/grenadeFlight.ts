/**
 * A grenade's motion (docs/grenades.md): a small heavy ball that flies, bounces, rolls and stops.
 *
 * - **In the air** it is a projectile under gravity. A sphere is swept along each sub-step's motion,
 *   so it never passes through anything thin.
 * - **A hard contact** (it meets a surface faster than `softImpactSpeed`) bounces: the speed into
 *   the surface comes back times `restitution`, and the speed along it loses at most `friction`
 *   times the hit (Coulomb), so a steep drop keeps little forward speed and a glancing skip keeps
 *   most of it.
 * - **A soft contact** does not bounce at all: the grenade keeps only its speed along the surface.
 *   On a floor that makes it roll: it follows the ground, gravity pulls it down a slope, and rolling
 *   resistance slows it at `rollingResistance` times the weight on the surface.
 * - **It rests** once it is on a floor, slower than `restSpeed`, and the slope is too shallow for
 *   gravity to beat the rolling resistance. A resting grenade stays put until what holds it up is
 *   gone.
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
 * (0 to 1) and the surface normal there (unit length; either way round, the step faces it). */
export interface SweepHit {
  readonly fraction: number;
  readonly normal: Vec3;
}

export type Sweep = (from: Vec3, displacement: Vec3) => SweepHit | null;

export interface FlightParams {
  /** Metres per second squared, negative (down). */
  readonly gravity: number;
  readonly radius: number;
  /** Share of the speed into a surface that comes back out of a hard contact. */
  readonly restitution: number;
  /** A contact slower than this into the surface (m/s) does not bounce. */
  readonly softImpactSpeed: number;
  /** Coulomb coefficient at a contact: the speed along the surface lost is at most this times the
   * change in speed across it. */
  readonly friction: number;
  /** Rolling deceleration as a share of the weight pressing on the surface. */
  readonly rollingResistance: number;
  /** Below this speed, on a floor that can hold it, a grenade comes to rest. */
  readonly restSpeed: number;
  /** Ground height under (x, z), a last line of defence where the world has no collider yet (a
   * Valley chunk not streamed in): the sphere never sinks below it. Optional. */
  readonly floor?: (x: number, y: number, z: number) => number;
}

export interface GrenadeBody {
  readonly position: Vec3;
  readonly velocity: Vec3;
  resting: boolean;
  /** Rolling on a floor since the last step, with that floor's normal (for the rolling resistance
   * and the model's roll). Optional so a body can be made from a position and a velocity alone. */
  rolling?: boolean;
  groundNormal?: Vec3;
}

export interface StepResult {
  /** The speed into the surface of the hardest bounce this step (0 for none), for bounce sounds. */
  readonly impactSpeed: number;
  /** How many hard contacts (bounces) happened this step. */
  readonly bounces: number;
}

/** A hit surface is stood this far clear of after each contact, so the next sweep does not start
 * touching it. */
const SKIN = 0.002;
/** Motion is advanced in pieces no longer than this (seconds), so a fast grenade's arc and its
 * contacts do not depend on the tick length. */
const MAX_SUBSTEP = 1 / 120;
const MAX_CONTACTS_PER_SUBSTEP = 4;
/** A contact normal at least this upright counts as a floor a grenade can roll and rest on. */
const FLOOR_NORMAL_Y = 0.7;
/** A resting grenade looks this far below itself each step for what holds it up: nothing there (a
 * capsule that walked off, a door that opened) and it wakes and falls. Past the contact skin, short
 * of anything a grenade could visibly hang above. */
const SUPPORT_PROBE = 0.04;
/** A rolling grenade is still on its floor while the floor is within this of it. */
const GROUND_PROBE = 0.012;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

/** `normal` turned to face against `motion` (a sweep may report it either way round). */
function facing(normal: Vec3, motion: Vec3): Vec3 {
  return dot(normal, motion) > 0 ? { x: -normal.x || 0, y: -normal.y || 0, z: -normal.z || 0 } : normal;
}

/** The velocity after a hard contact with a surface of unit normal `normal`. The normal part
 * reverses, scaled by `restitution`; the tangential part loses at most `friction` times the normal
 * impulse (Coulomb), never reversing. A velocity already leaving the surface is returned unchanged. */
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

/** Whether a floor of unit normal `normal` holds a still grenade: the pull of gravity along the
 * slope is no more than the rolling resistance. */
export function slopeHolds(normal: Vec3, rollingResistance: number): boolean {
  const along = Math.sqrt(Math.max(0, 1 - normal.y * normal.y));
  return normal.y >= FLOOR_NORMAL_Y && along <= rollingResistance * normal.y;
}

/** Whether something still holds a resting grenade up: a floor-facing surface (or the terrain floor)
 * within SUPPORT_PROBE below it. */
function isSupported(body: GrenadeBody, sweep: Sweep, params: FlightParams): boolean {
  const { position } = body;
  if (params.floor && position.y <= params.floor(position.x, position.y, position.z) + params.radius + SUPPORT_PROBE) return true;
  const hit = sweep(position, { x: 0, y: -SUPPORT_PROBE, z: 0 });
  return hit !== null && Math.abs(hit.normal.y) >= FLOOR_NORMAL_Y;
}

/** One sub-step. Returns the hardest bounce's speed and the number of bounces. */
function substep(body: GrenadeBody, dt: number, sweep: Sweep, params: FlightParams): { impactSpeed: number; bounces: number } {
  const { position, velocity } = body;
  const weight = -params.gravity;

  // Rolling resistance from the floor it was on at the end of the last sub-step.
  if (body.rolling && body.groundNormal) {
    const speed = length(velocity);
    const slowed = Math.max(0, speed - params.rollingResistance * weight * body.groundNormal.y * dt);
    const keep = speed > 1e-9 ? slowed / speed : 0;
    velocity.x *= keep;
    velocity.y *= keep;
    velocity.z *= keep;
  }
  velocity.y += params.gravity * dt;

  let remaining = dt;
  let impactSpeed = 0;
  let bounces = 0;
  let floor: Vec3 | null = null;
  for (let contact = 0; contact < MAX_CONTACTS_PER_SUBSTEP && remaining > 1e-7; contact++) {
    const displacement = { x: velocity.x * remaining, y: velocity.y * remaining, z: velocity.z * remaining };
    if (length(displacement) < 1e-8) break;
    const hit = sweep(position, displacement);
    if (!hit) {
      position.x += displacement.x;
      position.y += displacement.y;
      position.z += displacement.z;
      remaining = 0;
      break;
    }
    const fraction = Math.min(1, Math.max(0, hit.fraction));
    // Face the normal against the motion, whichever way round the sweep reported it, so the
    // contact below always sends the sphere back out of the surface.
    const normal = facing(hit.normal, displacement);
    position.x += displacement.x * fraction + normal.x * SKIN;
    position.y += displacement.y * fraction + normal.y * SKIN;
    position.z += displacement.z * fraction + normal.z * SKIN;
    const into = -dot(velocity, normal);
    if (into > params.softImpactSpeed) {
      impactSpeed = Math.max(impactSpeed, into);
      bounces++;
      const next = bounceVelocity(velocity, normal, params.restitution, params.friction);
      velocity.x = next.x;
      velocity.y = next.y;
      velocity.z = next.z;
    } else {
      // Too gentle to bounce: it keeps what it has along the surface and no more.
      velocity.x += normal.x * into;
      velocity.y += normal.y * into;
      velocity.z += normal.z * into;
      if (normal.y >= FLOOR_NORMAL_Y) floor = normal;
    }
    remaining *= 1 - fraction;
  }

  if (params.floor) {
    const floorY = params.floor(position.x, position.y, position.z) + params.radius;
    if (position.y < floorY) {
      position.y = floorY;
      const up = { x: 0, y: 1, z: 0 };
      const into = -velocity.y;
      if (into > params.softImpactSpeed) {
        impactSpeed = Math.max(impactSpeed, into);
        bounces++;
        const next = bounceVelocity(velocity, up, params.restitution, params.friction);
        velocity.x = next.x;
        velocity.y = next.y;
        velocity.z = next.z;
      } else {
        if (velocity.y < 0) velocity.y = 0;
        floor = up;
      }
    }
  }

  // A rolling grenade stands a hair clear of its floor (the skin), so a sub-step's fall may not
  // reach it: look just under it before deciding it has left the ground.
  if (!floor && body.rolling && body.groundNormal) {
    const n = body.groundNormal;
    const probe = { x: -n.x * GROUND_PROBE, y: -n.y * GROUND_PROBE, z: -n.z * GROUND_PROBE };
    const hit = sweep(position, probe);
    if (hit) {
      const normal = facing(hit.normal, probe);
      if (normal.y >= FLOOR_NORMAL_Y) {
        const into = -dot(velocity, normal);
        if (into > 0) {
          velocity.x += normal.x * into;
          velocity.y += normal.y * into;
          velocity.z += normal.z * into;
        }
        floor = normal;
      }
    }
  }

  body.rolling = floor !== null;
  body.groundNormal = floor ?? undefined;
  if (floor && length(velocity) < params.restSpeed && slopeHolds(floor, params.rollingResistance)) {
    velocity.x = 0;
    velocity.y = 0;
    velocity.z = 0;
    body.resting = true;
    body.rolling = false;
  }
  return { impactSpeed, bounces };
}

/** Advances `body` by `dt` seconds in place. A resting grenade stays put while something holds it up
 * and wakes the step that nothing does. */
export function stepGrenade(body: GrenadeBody, dt: number, sweep: Sweep, params: FlightParams): StepResult {
  if (!(dt > 0)) return { impactSpeed: 0, bounces: 0 };
  if (body.resting) {
    if (isSupported(body, sweep, params)) return { impactSpeed: 0, bounces: 0 };
    body.resting = false;
  }
  const pieces = Math.max(1, Math.ceil(dt / MAX_SUBSTEP - 1e-9));
  let impactSpeed = 0;
  let bounces = 0;
  for (let i = 0; i < pieces && !body.resting; i++) {
    const result = substep(body, dt / pieces, sweep, params);
    impactSpeed = Math.max(impactSpeed, result.impactSpeed);
    bounces += result.bounces;
  }
  return { impactSpeed, bounces };
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
      // Out of the surface, toward where the grenade came from.
      return { points, landing: { point, normal: facing(hit.normal, displacement) } };
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
