import { GOOSE_LAUNCHER_EXPLOSION_KNOCKBACK_STRENGTH } from '../../core/config.ts';

/** Frag and flash grenades (docs/grenades.md, design: docs/squad-arsenal-night.md section 3). Every
 * tuning number lives here so the design's table and the code read side by side. */
export type GrenadeKind = 'frag' | 'flash';
export const GRENADE_KINDS: readonly GrenadeKind[] = ['frag', 'flash'];

export function isGrenadeKind(value: unknown): value is GrenadeKind {
  return value === 'frag' || value === 'flash';
}

/** Carried at spawn and on every respawn, per kind. */
export const GRENADE_START_COUNT = 2;
/** The most of one kind a player can carry (pickups top up to this). */
export const GRENADE_MAX_COUNT = 3;

/** Throw speed along the aim, in m/s, on top of the player's own velocity. */
export const GRENADE_THROW_SPEED = 17;
/** The swept sphere's radius in metres. */
export const GRENADE_RADIUS = 0.07;
/** Share of the speed into a surface that comes back out of it. */
export const GRENADE_RESTITUTION = 0.35;
/** Coulomb friction at a contact: the tangential speed lost is at most this times the normal
 * impulse, so a hard landing skids less far than a gentle one and a grenade on the floor rolls to a
 * stop instead of sliding forever. */
export const GRENADE_FRICTION = 0.6;
/** Below this speed, on a floor (normal pointing up), a grenade comes to rest. */
export const GRENADE_REST_SPEED = 0.4;
/** Fuse per kind in seconds, counted from the moment cooking started. */
export const GRENADE_FUSE: Readonly<Record<GrenadeKind, number>> = { frag: 3.0, flash: 1.6 };
/** The gun is lowered and the arm swings for this long after the release. */
export const GRENADE_THROW_ANIMATION_SECONDS = 0.45;
/** Where a throw leaves the hand, in the camera's frame: right, down, forward (metres). */
export const GRENADE_HAND_OFFSET = { right: 0.18, up: -0.1, forward: 0.45 } as const;
/** A copy of someone else's grenade that never got its grenadeDetonated (a lost message, the thrower
 * left) is dropped this long after its fuse ran out. */
export const GRENADE_ORPHAN_GRACE_SECONDS = 2;

/** Frag: full damage within FRAG_FULL_DAMAGE_RADIUS, falling linearly to 0 at FRAG_RADIUS. */
export const FRAG_RADIUS = 7;
export const FRAG_FULL_DAMAGE_RADIUS = 1.5;
export const FRAG_MAX_DAMAGE = 130;
/** Knockback as the Goose Launcher: the same peak speed, falling off over the frag's radius. */
export const FRAG_KNOCKBACK_STRENGTH = GOOSE_LAUNCHER_EXPLOSION_KNOCKBACK_STRENGTH;
/** Every Facility lamp within this distance of a frag is shot out. */
export const FRAG_LAMP_RADIUS = 4;
/** Camera shake falls off to nothing at this distance from a frag. */
export const FRAG_SHAKE_RANGE = 15;
/** Peak camera shake (metres of camera offset) at the blast itself. */
export const FRAG_SHAKE_PEAK = 0.09;
/** How long one frag's shake lasts, in seconds. */
export const FRAG_SHAKE_SECONDS = 0.6;
/** Chest and head heights above a player's body centre (Player.position) for the wall check. */
export const FRAG_CHEST_OFFSET = 0.3;
export const FRAG_HEAD_OFFSET = 0.75;

/** Flash: distance factor 1 within FLASH_FULL_RANGE, 0 at FLASH_MAX_RANGE. */
export const FLASH_FULL_RANGE = 5;
export const FLASH_MAX_RANGE = 22;
/** Facing factor at 90 degrees off the view direction and straight behind (1 when looking at it). */
export const FLASH_FACING_SIDE = 0.45;
export const FLASH_FACING_BEHIND = 0.15;
/** A flash weaker than this does nothing. */
export const FLASH_MIN_STRENGTH = 0.1;
/** White-out (and muffled hearing) at full strength, in seconds; scaled by strength. */
export const FLASH_PLAYER_MAX_SECONDS = 3.5;
/** After the white-out, the screen clears over this long. */
export const FLASH_FADE_SECONDS = 1.2;
/** An enemy's blindness at full strength, in seconds; scaled by strength. */
export const FLASH_ENEMY_MAX_SECONDS = 4;
/** The flash's own light: how long it shines, how bright and how far. */
export const FLASH_LIGHT_SECONDS = 0.15;
export const FLASH_LIGHT_INTENSITY = 260;
export const FLASH_LIGHT_RANGE = 28;
/** The frag's light: the same light as the flash's (made at match start, never added mid-match),
 * warmer, shorter and smaller. */
export const FRAG_LIGHT_SECONDS = 0.22;
export const FRAG_LIGHT_INTENSITY = 160;
export const FRAG_LIGHT_RANGE = 16;

/** A live frag nearer than this to the player shows the on-screen danger marker. */
export const GRENADE_DANGER_RANGE = 8;

/** Frag damage at `distance` from the blast: FRAG_MAX_DAMAGE out to FRAG_FULL_DAMAGE_RADIUS, then
 * linear to 0 at FRAG_RADIUS and beyond. */
export function computeFragDamage(distance: number): number {
  if (!(distance < FRAG_RADIUS)) return 0;
  if (distance <= FRAG_FULL_DAMAGE_RADIUS) return FRAG_MAX_DAMAGE;
  return FRAG_MAX_DAMAGE * (1 - (distance - FRAG_FULL_DAMAGE_RADIUS) / (FRAG_RADIUS - FRAG_FULL_DAMAGE_RADIUS));
}

/** Camera shake amplitude for a frag `distance` away: FRAG_SHAKE_PEAK at the blast, 0 at
 * FRAG_SHAKE_RANGE. */
export function fragShakeAmplitude(distance: number): number {
  if (!(distance < FRAG_SHAKE_RANGE)) return 0;
  return FRAG_SHAKE_PEAK * (1 - Math.max(0, distance) / FRAG_SHAKE_RANGE);
}
