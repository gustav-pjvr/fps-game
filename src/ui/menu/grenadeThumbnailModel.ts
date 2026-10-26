import type * as THREE from 'three';
import { buildGrenadeModel } from '../../combat/grenades/grenadeModels.ts';
import type { GrenadeKind } from '../../combat/grenades/grenadeTuning.ts';

/** The Loadout page's grenade thumbnails (see weaponThumbnail.ts) use the same models the game
 * throws (combat/grenades/grenadeModels.ts). The thumbnail renderer renders a clone and frames it
 * whatever its size, and never disposes the shared geometry or materials. */
export function buildGrenadeThumbnailModel(kind: GrenadeKind): THREE.Group {
  return buildGrenadeModel(kind);
}
