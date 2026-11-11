import RAPIER from '@dimforge/rapier3d-compat';
import { CLEAR_PATH, MAX_COUNTED_SOLIDS, occlusionFor, type Occlusion, type SoundPath } from '../audio/occlusion.ts';
import type { Vec3Like } from '../audio/spatial.ts';
import { castRaySkippingCuts, isTerrainCollider } from './underground.ts';

/**
 * What lies between a sound and the listener (docs/sound.md, "Buildings matter"), asked once per
 * positioned sound as it starts, never per frame.
 *
 * The straight line is tried first. If it is clear the sound is clear (an open door, an open or
 * broken window, the open air). If it is blocked, three bent lines are tried: to points beside and
 * above the source that the source itself can see. A clear one means the sound gets round (a tree
 * trunk, a corner, the top of a wall) and it is only a little duller. Only when none is clear does
 * the straight line's count of walls stand.
 *
 * The cost is bounded: at most MAX_CASTS ray casts per sound (the straight line up to
 * MAX_COUNTED_SOLIDS + 1, each bent line 2). `probeStats` counts them for the performance report.
 */
export const MAX_CASTS = MAX_COUNTED_SOLIDS + 1 + 3 * 2;

export const probeStats = { probes: 0, casts: 0, clear: 0, bent: 0, blocked: 0 };

/** How far short of the source a line stops: a sound made on a surface (an impact, a door, a lamp
 * on a ceiling) must not count the thing it sits on as a wall in the way. */
const SOURCE_CLEARANCE = 0.35;
/** How far beside and above the source the bent lines aim. */
const BEND_REACH = 1.7;
/** Past this the walls between hardly matter and the probe is skipped by the engine anyway; here it
 * only guards a degenerate line. */
const MIN_LINE = 0.4;

const WORLD_ONLY = RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;

export interface SoundProbeOptions {
  /** Intact panes of glass a line crosses (world/glass): a window muffles less than a wall. */
  readonly glassBetween?: (from: Vec3Like, to: Vec3Like) => number;
}

function cast(world: RAPIER.World, from: Vec3Like, direction: Vec3Like, length: number, skip: Set<number> | null): RAPIER.RayColliderIntersection | null {
  probeStats.casts++;
  const ray = new RAPIER.Ray({ x: from.x, y: from.y, z: from.z }, { x: direction.x, y: direction.y, z: direction.z });
  return castRaySkippingCuts(world, ray, length, true, WORLD_ONLY, undefined, undefined, undefined,
    skip ? (collider) => !skip.has(collider.handle) : undefined);
}

function lineBetween(from: Vec3Like, to: Vec3Like): { direction: Vec3Like; length: number } {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  return { direction: length > 0 ? { x: dx / length, y: dy / length, z: dz / length } : { x: 0, y: 1, z: 0 }, length };
}

/** Whether nothing of the world's fabric lies on the segment. */
function isOpen(world: RAPIER.World, from: Vec3Like, to: Vec3Like, shorten: number): boolean {
  const { direction, length } = lineBetween(from, to);
  if (length - shorten <= 0.05) return true;
  return cast(world, from, direction, length - shorten, null) === null;
}

/** The path a sound takes from `source` to `listener`. */
export function probeSoundPath(world: RAPIER.World, listener: Vec3Like, source: Vec3Like, options: SoundProbeOptions = {}): SoundPath {
  probeStats.probes++;
  const { direction, length } = lineBetween(listener, source);
  const reach = length - SOURCE_CLEARANCE;
  if (reach <= MIN_LINE) {
    probeStats.clear++;
    return CLEAR_PATH;
  }

  // The straight line: every separate solid it crosses, nearest first.
  let solids = 0;
  let earth = false;
  const crossed = new Set<number>();
  while (solids < MAX_COUNTED_SOLIDS) {
    const hit = cast(world, listener, direction, reach, crossed.size > 0 ? crossed : null);
    if (!hit) break;
    crossed.add(hit.collider.handle);
    if (isTerrainCollider(hit.collider.handle)) {
      earth = true;
      break;
    }
    solids++;
  }
  const glass = options.glassBetween?.(listener, source) ?? 0;
  if (solids === 0 && !earth) {
    probeStats.clear++;
    return glass > 0 ? { solids: 0, earth: false, glass, bent: false } : CLEAR_PATH;
  }

  // Bent lines: beside the source on either hand, and above it.
  const flat = Math.hypot(direction.x, direction.z);
  const sideX = flat > 1e-3 ? -direction.z / flat : 1;
  const sideZ = flat > 1e-3 ? direction.x / flat : 0;
  const bends: Vec3Like[] = [
    { x: source.x + sideX * BEND_REACH, y: source.y, z: source.z + sideZ * BEND_REACH },
    { x: source.x - sideX * BEND_REACH, y: source.y, z: source.z - sideZ * BEND_REACH },
    { x: source.x, y: source.y + BEND_REACH, z: source.z },
  ];
  for (const corner of bends) {
    // The source must see the corner, or the "corner" is on the far side of its own wall.
    if (!isOpen(world, source, corner, 0)) continue;
    if (!isOpen(world, listener, corner, 0)) continue;
    probeStats.bent++;
    return { solids: 0, earth: false, glass: options.glassBetween?.(listener, corner) ?? 0, bent: true };
  }
  probeStats.blocked++;
  return { solids, earth, glass, bent: false };
}

/** The probe as the sound engine wants it: the path turned into a gain and a cutoff. */
export function probeOcclusion(world: RAPIER.World, listener: Vec3Like, source: Vec3Like, options: SoundProbeOptions = {}): Occlusion {
  return occlusionFor(probeSoundPath(world, listener, source, options));
}
