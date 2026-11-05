import type * as THREE from 'three';
import {
  ENEMY_GUNSHOT_AUDIBLE_RANGE,
  ENEMY_GUNSHOT_FULL_VOLUME_RANGE,
  ENEMY_GUNSHOT_MIN_VOLUME,
  FACILITY_OBJECT_AUDIBLE_RANGE,
  FACILITY_OBJECT_FULL_VOLUME_RANGE,
  KNIFE_SWING_AUDIBLE_RANGE,
  KNIFE_SWING_FULL_VOLUME_RANGE,
  LAMP_BREAK_AUDIBLE_RANGE,
  MULTIPLAYER_GUNSHOT_AUDIBLE_RANGE,
  MULTIPLAYER_GUNSHOT_FULL_VOLUME_RANGE,
  MULTIPLAYER_GUNSHOT_MIN_VOLUME,
} from './config.ts';

/** A surface boundary buries a sound only when its endpoints are on different sides. */
export function undergroundMuffleFactor(listenerUnderground: boolean, sourceUnderground: boolean): number {
  return listenerUnderground === sourceUnderground ? 1 : 0.35;
}

/** Shared linear gain falloff shape: full volume inside `fullVolumeRange`, fading to `minVolume`
 * at `audibleRange` (gunshots never go silent - an inaudible shot that still damages would read as
 * unfair; the knife swing and lamp break do). */
function distanceGainFalloff(distance: number, fullVolumeRange: number, audibleRange: number, minVolume: number): number {
  const t = (distance - fullVolumeRange) / (audibleRange - fullVolumeRange);
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - clamped * (1 - minVolume);
}

/** Single-player enemy gunshots and goose explosions - see the ENEMY_GUNSHOT_* constants'
 * comment in config.ts. */
export function enemyGunshotVolume(distance: number): number {
  return distanceGainFalloff(distance, ENEMY_GUNSHOT_FULL_VOLUME_RANGE, ENEMY_GUNSHOT_AUDIBLE_RANGE, ENEMY_GUNSHOT_MIN_VOLUME);
}

/** Multiplayer opponent gunshots/footsteps specifically - a deliberately more generous full-volume
 * range than enemyGunshotVolume (see MULTIPLAYER_GUNSHOT_* constants' comment in config.ts for
 * why this needed to be a separate function rather than widening the shared one). */
export function multiplayerGunshotVolume(distance: number): number {
  return distanceGainFalloff(distance, MULTIPLAYER_GUNSHOT_FULL_VOLUME_RANGE, MULTIPLAYER_GUNSHOT_AUDIBLE_RANGE, MULTIPLAYER_GUNSHOT_MIN_VOLUME);
}

/** An opponent's knife swing: full within KNIFE_SWING_FULL_VOLUME_RANGE, silent from
 * KNIFE_SWING_AUDIBLE_RANGE. */
export function knifeSwingVolume(distance: number): number {
  return distanceGainFalloff(distance, KNIFE_SWING_FULL_VOLUME_RANGE, KNIFE_SWING_AUDIBLE_RANGE, 0);
}

/** A Facility lamp breaking: the multiplayer gunshot's full-volume range, then fading to silence at
 * LAMP_BREAK_AUDIBLE_RANGE. */
export function lampBreakVolume(distance: number): number {
  return distanceGainFalloff(distance, MULTIPLAYER_GUNSHOT_FULL_VOLUME_RANGE, LAMP_BREAK_AUDIBLE_RANGE, 0);
}

/** A Facility door sliding or a breaker thrown (docs/facility-map.md, section 12): full within
 * FACILITY_OBJECT_FULL_VOLUME_RANGE, silent from FACILITY_OBJECT_AUDIBLE_RANGE. */
export function facilityObjectVolume(distance: number): number {
  return distanceGainFalloff(distance, FACILITY_OBJECT_FULL_VOLUME_RANGE, FACILITY_OBJECT_AUDIBLE_RANGE, 0);
}

/** Stereo pan (-1 full left .. 1 full right) for a sound at `sourcePosition`, from the perspective
 * of a listener at `listenerPosition` facing `listenerYaw` (see Player.facingYaw's own comment on
 * this yaw convention - 0 faces -Z) - used for opponent gunshots in multiplayer (per user request:
 * "positional audio") so a shot fired from off to the player's side is audibly distinguishable
 * from one straight ahead, not just louder/quieter with distance. Purely horizontal (XZ plane) -
 * this is a stereo pan, not full 3D audio, so vertical offset (a shot from a watch tower platform
 * above) doesn't factor in. */
/** A grenade's bounce clink: full volume within GRENADE_BOUNCE_FULL_VOLUME_RANGE, gone past
 * GRENADE_BOUNCE_AUDIBLE_RANGE, and as loud as the impact (full at GRENADE_BOUNCE_LOUD_SPEED m/s). */
export const GRENADE_BOUNCE_FULL_VOLUME_RANGE = 3;
export const GRENADE_BOUNCE_AUDIBLE_RANGE = 28;
export const GRENADE_BOUNCE_LOUD_SPEED = 9;

export function grenadeBounceVolume(distance: number, impactSpeed: number): number {
  const speed = Math.max(0, Math.min(1, impactSpeed / GRENADE_BOUNCE_LOUD_SPEED));
  return speed * distanceGainFalloff(distance, GRENADE_BOUNCE_FULL_VOLUME_RANGE, GRENADE_BOUNCE_AUDIBLE_RANGE, 0);
}

export function computeStereoPan(listenerPosition: THREE.Vector3, listenerYaw: number, sourcePosition: THREE.Vector3): number {
  const dx = sourcePosition.x - listenerPosition.x;
  const dz = sourcePosition.z - listenerPosition.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.001) return 0; // Coincident points - direction is undefined, default centered.

  // The listener's own "right" direction in world space, derived from the same yaw convention
  // Player.ts's debugLookAt uses (yaw = atan2(-dx, -dz), i.e. forward = (-sin(yaw), -cos(yaw))) -
  // rotating that forward vector -90 degrees around Y gives right = (cos(yaw), -sin(yaw)).
  const rightX = Math.cos(listenerYaw);
  const rightZ = -Math.sin(listenerYaw);
  return Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / distance));
}
