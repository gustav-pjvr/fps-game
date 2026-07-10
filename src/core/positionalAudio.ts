import type * as THREE from 'three';
import {
  ENEMY_GUNSHOT_AUDIBLE_RANGE,
  ENEMY_GUNSHOT_FULL_VOLUME_RANGE,
  ENEMY_GUNSHOT_MIN_VOLUME,
  MULTIPLAYER_GUNSHOT_AUDIBLE_RANGE,
  MULTIPLAYER_GUNSHOT_FULL_VOLUME_RANGE,
  MULTIPLAYER_GUNSHOT_MIN_VOLUME,
} from './config.ts';

/** Shared linear gain falloff shape: full volume inside `fullVolumeRange`, fading to `minVolume`
 * (never silent - an inaudible shot that still damages would read as unfair) at `audibleRange`. */
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

/** Stereo pan (-1 full left .. 1 full right) for a sound at `sourcePosition`, from the perspective
 * of a listener at `listenerPosition` facing `listenerYaw` (see Player.facingYaw's own comment on
 * this yaw convention - 0 faces -Z) - used for opponent gunshots in multiplayer (per user request:
 * "positional audio") so a shot fired from off to the player's side is audibly distinguishable
 * from one straight ahead, not just louder/quieter with distance. Purely horizontal (XZ plane) -
 * this is a stereo pan, not full 3D audio, so vertical offset (a shot from a watch tower platform
 * above) doesn't factor in. */
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
