import type * as THREE from 'three';
import type { Player } from '../entities/Player.ts';
import type { WeaponManager } from '../weapons/WeaponManager.ts';
import { grenadesEnabled, type GameMode } from '../core/gameModes.ts';
import type { ActiveMultiplayer } from '../network/multiplayerMatchTypes.ts';
import type { NetworkMessage, PlayerSlot } from '../network/protocol.ts';
import type { BuildingManager } from '../world/BuildingManager.ts';
import type { FacilityLayout } from '../world/facility/facilityLayout.ts';
import type { PickupKind } from './pickupConfig.ts';
import { AMMO_PICKUP, type GrenadeSupply, type PickupRecipient } from './pickupEffects.ts';
import { pickupKindsForMode, placeFacilityPickups, placeValleyPickups, type PickupSite } from './pickupPlacement.ts';
import { PickupSystem, type PickupNetwork } from './PickupSystem.ts';
import { gatherValleyPlacementInput } from './valleyPickupInputs.ts';

export interface MatchPickupsOptions {
  readonly scene: THREE.Scene;
  readonly mode: GameMode;
  /** The Facility's layout and the single-player start (never given a pickup in its room), or the
   * Valley's buildings; exactly one of the two. */
  readonly facility: { layout: FacilityLayout; start: { x: number; z: number } } | null;
  readonly buildings: BuildingManager | null;
  readonly multiplayer: ActiveMultiplayer | null;
  readonly player: Player;
  /** A getter: a mid-match Loadout change rebuilds the weapon manager. */
  readonly weaponManager: () => WeaponManager;
  /** Where grenades come from. The match's grenade carry (grenadeSupplyFrom), or NO_GRENADES. */
  readonly grenades: GrenadeSupply;
  readonly onPickedUp: (kind: PickupKind, line: string) => void;
}

/** The pickup sites for a match: a pure function of the seed, the map and the mode, so every client
 * of a multiplayer match builds the same list and the wire only carries indices. */
export function placeMatchPickups(options: Pick<MatchPickupsOptions, 'mode' | 'facility' | 'buildings' | 'multiplayer'>): PickupSite[] {
  const kinds = pickupKindsForMode(options.mode, grenadesEnabled(options.mode));
  if (options.facility) {
    // Single-player knows its start room and keeps clear of it. A multiplayer match cannot: spawn
    // points are not part of the seed and a late joiner has different ones, so the list would differ.
    return placeFacilityPickups(options.facility.layout, kinds, options.multiplayer ? [] : [options.facility.start]);
  }
  if (!options.buildings) return [];
  return placeValleyPickups(gatherValleyPlacementInput(options.buildings), kinds);
}

/** Builds the match's PickupSystem: places the sites and wires the player, the guns, the grenade
 * supply and (in multiplayer) the network into it. */
export function createMatchPickups(options: MatchPickupsOptions): PickupSystem {
  const { player, multiplayer } = options;
  const recipient: PickupRecipient = {
    health: () => ({ current: player.currentHealth, max: player.maxHealth }),
    heal: (amount) => {
      player.heal(amount);
    },
    ammoWouldGive: () => options.weaponManager().ammoPickupWouldGive(AMMO_PICKUP.maxReserveMagazines),
    grantAmmo: () => options.weaponManager().grantAmmoPickup(AMMO_PICKUP.magazines, AMMO_PICKUP.maxReserveMagazines),
    grenades: options.grenades,
  };
  const network: PickupNetwork | null = multiplayer
    ? {
        role: multiplayer.session.role,
        ownSlot: multiplayer.session.ownSlot,
        send: (message: NetworkMessage) => multiplayer.session.connection.send(message),
        sendTo: (slot: PlayerSlot, message: NetworkMessage) => multiplayer.session.connection.sendTo(slot, message),
        opponentPosition: (slot: PlayerSlot) => {
          const position = multiplayer.opponents.get(slot)?.remotePlayer.position;
          return position ? { x: position.x, z: position.z } : null;
        },
      }
    : null;
  return new PickupSystem(options.scene, placeMatchPickups(options), recipient, network, { onPickedUp: options.onPickedUp });
}
