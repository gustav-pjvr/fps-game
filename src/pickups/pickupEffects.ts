import {
  PICKUP_AMMO_MAGAZINES,
  PICKUP_AMMO_RESERVE_CAP_MAGAZINES,
  PICKUP_GRENADE_CAP,
  PICKUP_GRENADE_AMOUNT,
  PICKUP_HEALTH_AMOUNT,
  type PickupKind,
} from './pickupConfig.ts';
import type { GrenadeKind } from '../combat/grenades/grenadeTuning.ts';

/** The grenade side of a pickup, handed in by the Game, so pickups only see this small interface.
 * The player carries one kind (their loadout's). `wouldGive` says whether a crate would add
 * anything (the count below its cap); `grant` adds `amount` of that kind, clamped to the cap, and
 * returns the kind, or null when nothing was given. NO_GRENADES is the supply where there is no
 * grenade carry. */
export interface GrenadeSupply {
  wouldGive(): boolean;
  grant(amount: number): GrenadeKind | null;
}

export const NO_GRENADES: GrenadeSupply = { wouldGive: () => false, grant: () => null };

/** The part of the grenade system (combat/grenades/GrenadeSystem.ts) a crate needs: whether the
 * mode carries grenades, the kind and count carried, and the top-up that clamps to the cap. */
export interface GrenadeCarry {
  readonly enabled: boolean;
  readonly kind: GrenadeKind;
  readonly count: number;
  addGrenades(amount: number): number;
}

/** A supply backed by the match's grenade carry. A getter, since the Game builds the pickups before
 * the grenade system; while it returns null (or grenades are off) the crate gives nothing. */
export function grenadeSupplyFrom(carry: () => GrenadeCarry | null): GrenadeSupply {
  return {
    wouldGive: () => {
      const grenades = carry();
      return !!grenades?.enabled && grenades.count < PICKUP_GRENADE_CAP;
    },
    grant: (amount) => {
      const grenades = carry();
      if (!grenades?.enabled) return null;
      return grenades.addGrenades(amount) > 0 ? grenades.kind : null;
    },
  };
}

/** What a pickup can do to the local player, assembled by the Game from the player, the weapon
 * manager and the grenade supply. */
export interface PickupRecipient {
  health(): { current: number; max: number };
  heal(amount: number): void;
  ammoWouldGive(): boolean;
  /** Stocks every gun by PICKUP_AMMO_MAGAZINES; true when anything was given. */
  grantAmmo(): boolean;
  readonly grenades: GrenadeSupply;
}

/** Health a pack restores: its amount, cut to what is missing, and none for a dead player (a pack
 * does not revive) or one at full health. */
export function healthGain(current: number, max: number, amount: number): number {
  if (!(current > 0) || !(current < max)) return 0;
  return Math.max(0, Math.min(amount, max - current));
}

/** Whether taking a `kind` pickup would give the recipient anything. A pickup that would give
 * nothing is skipped (left on the map) rather than wasted. */
export function pickupWouldGive(kind: PickupKind, recipient: PickupRecipient): boolean {
  switch (kind) {
    case 'health': {
      const { current, max } = recipient.health();
      return healthGain(current, max, PICKUP_HEALTH_AMOUNT) > 0;
    }
    case 'ammo':
      return recipient.ammoWouldGive();
    case 'grenade':
      return recipient.grenades.wouldGive();
  }
}

/** Gives the recipient a `kind` pickup. Returns the line to show ("+40 HEALTH"), or null when it
 * gave nothing. */
export function applyPickup(kind: PickupKind, recipient: PickupRecipient): string | null {
  switch (kind) {
    case 'health': {
      const { current, max } = recipient.health();
      const gain = healthGain(current, max, PICKUP_HEALTH_AMOUNT);
      if (gain <= 0) return null;
      recipient.heal(gain);
      return `+${Math.round(gain)} HEALTH`;
    }
    case 'ammo':
      return recipient.grantAmmo() ? 'AMMO RESTOCKED' : null;
    case 'grenade': {
      const carried = recipient.grenades.grant(PICKUP_GRENADE_AMOUNT);
      return carried ? `+${PICKUP_GRENADE_AMOUNT} ${carried.toUpperCase()}` : null;
    }
  }
}

/** The ammo box's own numbers, for the weapon manager call. */
export const AMMO_PICKUP = { magazines: PICKUP_AMMO_MAGAZINES, maxReserveMagazines: PICKUP_AMMO_RESERVE_CAP_MAGAZINES } as const;
