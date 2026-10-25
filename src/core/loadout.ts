import {
  isGrenadeKind,
  LOADOUT_GRENADE_DEFAULT,
  LOADOUT_SLOT_DEFAULTS,
  WEAPON_CATEGORIES,
  type GrenadeKind,
  type PlayerLoadout,
} from './gameModes.ts';

const STORAGE_KEY = 'fps-game-loadout';

export type LoadoutWeaponSlot = 'primary' | 'secondary' | 'melee';

const EMPTY_LOADOUT: PlayerLoadout = { primary: null, secondary: null, melee: null, grenade: LOADOUT_GRENADE_DEFAULT };

/** Whatever the player last equipped on the Loadout page (see ui/menu/LoadoutScreen.ts), so it
 * carries across sessions the same way the saved username does (see core/username.ts, the exact
 * shape this mirrors). Falls back to an all-null loadout (resolved to per-slot defaults by
 * gameModes.ts's resolveWeaponLoadout) if nothing's been chosen yet, or if the stored value is
 * malformed. The grenade is always filled in: loadouts saved before the grenade choice existed (or
 * holding an unknown grenade) keep their weapons and get LOADOUT_GRENADE_DEFAULT. */
export function loadStoredLoadout(): PlayerLoadout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...EMPTY_LOADOUT };
    const parsed: unknown = JSON.parse(stored);
    if (!hasWeaponSlots(parsed)) return { ...EMPTY_LOADOUT };
    const record = parsed as Record<string, unknown>;
    return {
      primary: parsed.primary,
      secondary: parsed.secondary,
      melee: parsed.melee,
      grenade: isGrenadeKind(record.grenade) ? record.grenade : LOADOUT_GRENADE_DEFAULT,
    };
  } catch {
    // localStorage/JSON.parse can throw in restrictive contexts or on corrupted data - a fresh
    // default is a fine fallback, this is a convenience, not a required feature.
    return { ...EMPTY_LOADOUT };
  }
}

export function saveLoadout(loadout: PlayerLoadout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout));
  } catch {
    // Same as above - persistence is a nice-to-have, not required for the current session.
  }
}

/** The loadout with `weaponId` in its own category's slot. A weapon only ever fills its own slot,
 * which is what stops a player stacking two primaries; reward-only and unknown weapons change
 * nothing. */
export function equipWeapon(loadout: PlayerLoadout, weaponId: string): PlayerLoadout {
  const category = WEAPON_CATEGORIES[weaponId];
  if (category !== 'primary' && category !== 'secondary' && category !== 'melee') return loadout;
  return { ...loadout, [category]: weaponId };
}

export function equipGrenade(loadout: PlayerLoadout, grenade: GrenadeKind): PlayerLoadout {
  return { ...loadout, grenade };
}

/** The weapon a slot holds, its default when nothing has been chosen yet. */
export function equippedWeaponId(loadout: PlayerLoadout, slot: LoadoutWeaponSlot): string {
  return loadout[slot] ?? LOADOUT_SLOT_DEFAULTS[slot];
}

export function equippedGrenade(loadout: PlayerLoadout): GrenadeKind {
  return loadout.grenade ?? LOADOUT_GRENADE_DEFAULT;
}

function hasWeaponSlots(value: unknown): value is Pick<PlayerLoadout, LoadoutWeaponSlot> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return isNullableString(record.primary) && isNullableString(record.secondary) && isNullableString(record.melee);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
