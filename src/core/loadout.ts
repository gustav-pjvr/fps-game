import type { PlayerLoadout } from './gameModes.ts';

const STORAGE_KEY = 'fps-game-loadout';

const EMPTY_LOADOUT: PlayerLoadout = { primary: null, secondary: null, melee: null };

/** Whatever the player last equipped on the Loadout page (see ui/menu/LoadoutScreen.ts), so it
 * carries across sessions the same way the saved username does (see core/username.ts, the exact
 * shape this mirrors). Falls back to an all-null loadout (resolved to per-slot defaults by
 * gameModes.ts's resolveWeaponLoadout) if nothing's been chosen yet, or if the stored value is
 * malformed. */
export function loadStoredLoadout(): PlayerLoadout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return EMPTY_LOADOUT;
    const parsed: unknown = JSON.parse(stored);
    if (!isPlayerLoadout(parsed)) return EMPTY_LOADOUT;
    return parsed;
  } catch {
    // localStorage/JSON.parse can throw in restrictive contexts or on corrupted data - a fresh
    // default is a fine fallback, this is a convenience, not a required feature.
    return EMPTY_LOADOUT;
  }
}

export function saveLoadout(loadout: PlayerLoadout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout));
  } catch {
    // Same as above - persistence is a nice-to-have, not required for the current session.
  }
}

function isPlayerLoadout(value: unknown): value is PlayerLoadout {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return isNullableString(record.primary) && isNullableString(record.secondary) && isNullableString(record.melee);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
