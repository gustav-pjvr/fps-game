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

/** Throw speed in m/s, on top of the player's own velocity. With the game's gravity (20 m/s2) a
 * level throw first lands about 11 m out and a 45 degree lob carries about 23 m. */
export const GRENADE_THROW_SPEED = 21;
/** A throw leaves the hand this far above the line of aim (radians): an overarm lob, so aiming at
 * a target at mid range drops the grenade near it instead of at the thrower's feet. */
export const GRENADE_THROW_LOFT = 0.1;
/** The swept sphere's radius in metres. */
export const GRENADE_RADIUS = 0.07;
/** Share of the speed into a surface that comes back out of a hard contact: a steel ball on
 * concrete or packed earth gives back well under half. */
export const GRENADE_RESTITUTION = 0.4;
/** A contact slower than this into the surface (m/s) does not bounce: the grenade rolls on. */
export const GRENADE_SOFT_IMPACT_SPEED = 1.4;
/** Coulomb friction at a contact: the tangential speed lost is at most this times the normal
 * impulse, so a steep drop keeps little forward speed and a flat skip keeps most of it. */
export const GRENADE_FRICTION = 0.45;
/** Rolling deceleration as a share of the weight on the floor. A grenade is a lumpy half-kilo
 * ovoid on dirt, grass or rough concrete, not a ball bearing: 0.45 times 20 m/s2 is 9 m/s2, so one
 * still doing 7 m/s after its bounces rolls about 3 m more, and only a slope steeper than about 24
 * degrees keeps it rolling. */
export const GRENADE_ROLLING_RESISTANCE = 0.45;
/** Below this speed, on a floor that can hold it, a grenade comes to rest. */
export const GRENADE_REST_SPEED = 0.25;
/** Fuse per kind in seconds, counted from the moment cooking started. */
export const GRENADE_FUSE: Readonly<Record<GrenadeKind, number>> = { frag: 3.5, flash: 1.6 };
/** The gun is lowered and the arm swings for this long after the release. */
export const GRENADE_THROW_ANIMATION_SECONDS = 0.45;
/** Where a throw leaves the hand, in the camera's frame: right, down, forward (metres). */
export const GRENADE_HAND_OFFSET = { right: 0.18, up: -0.1, forward: 0.45 } as const;
/** A copy of someone else's grenade that never got its grenadeDetonated (a lost message, the thrower
 * left) is dropped this long after its fuse ran out. */
export const GRENADE_ORPHAN_GRACE_SECONDS = 2;

/** Frag: FRAG_MAX_DAMAGE within FRAG_FULL_DAMAGE_RADIUS (the blast itself), then the fragments
 * thinning out with the square of the distance left, to nothing at FRAG_RADIUS. Against 100 health
 * in the open that kills out to about 3.5 m, takes half at about 5 m and scratches to 9 m. Cover
 * scales it down (grenadeBlast.ts blastExposure). */
export const FRAG_RADIUS = 9;
export const FRAG_FULL_DAMAGE_RADIUS = 2;
export const FRAG_MAX_DAMAGE = 160;
/** Knockback as the Goose Launcher: the same peak speed, falling off over FRAG_KNOCKBACK_RADIUS. */
export const FRAG_KNOCKBACK_STRENGTH = GOOSE_LAUNCHER_EXPLOSION_KNOCKBACK_STRENGTH;
/** The blast wave shoves bodies out to here; the fragments reach further than the shove. */
export const FRAG_KNOCKBACK_RADIUS = 6;
/** Every Facility lamp within this distance of a frag is shot out. */
export const FRAG_LAMP_RADIUS = 5;
/** Camera shake falls off to nothing at this distance from a frag. */
export const FRAG_SHAKE_RANGE = 24;
/** Peak camera shake (metres of camera offset) at the blast itself. */
export const FRAG_SHAKE_PEAK = 0.11;
/** How long one frag's shake lasts, in seconds. */
export const FRAG_SHAKE_SECONDS = 0.6;

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
export const FRAG_LIGHT_SECONDS = 0.28;
export const FRAG_LIGHT_INTENSITY = 230;
export const FRAG_LIGHT_RANGE = 22;

/** A live frag nearer than this to the player shows the on-screen danger marker. */
export const GRENADE_DANGER_RANGE = 10;

/** Frag damage in the open at `distance` from the blast: FRAG_MAX_DAMAGE out to
 * FRAG_FULL_DAMAGE_RADIUS, then falling with the square of the share of the radius left, to 0 at
 * FRAG_RADIUS and beyond. */
export function computeFragDamage(distance: number): number {
  if (!(distance < FRAG_RADIUS)) return 0;
  if (distance <= FRAG_FULL_DAMAGE_RADIUS) return FRAG_MAX_DAMAGE;
  const left = 1 - (distance - FRAG_FULL_DAMAGE_RADIUS) / (FRAG_RADIUS - FRAG_FULL_DAMAGE_RADIUS);
  return FRAG_MAX_DAMAGE * left * left;
}

/** Knockback speed at `distance`: FRAG_KNOCKBACK_STRENGTH at the blast, linear to 0 at
 * FRAG_KNOCKBACK_RADIUS. */
export function fragKnockback(distance: number): number {
  if (!(distance < FRAG_KNOCKBACK_RADIUS)) return 0;
  return FRAG_KNOCKBACK_STRENGTH * (1 - Math.max(0, distance) / FRAG_KNOCKBACK_RADIUS);
}

/** Camera shake amplitude for a frag `distance` away: FRAG_SHAKE_PEAK at the blast, 0 at
 * FRAG_SHAKE_RANGE. */
export function fragShakeAmplitude(distance: number): number {
  if (!(distance < FRAG_SHAKE_RANGE)) return 0;
  return FRAG_SHAKE_PEAK * (1 - Math.max(0, distance) / FRAG_SHAKE_RANGE);
}
