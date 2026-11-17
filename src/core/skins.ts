import { WEAPON_DEFINITIONS } from '../weapons/definitions.ts';
import { DEFAULT_SKIN, isSkinId, type SkinId } from '../weapons/models/skins.ts';

const STORAGE_KEY = 'fps-game-skins';

/** The skin the player has put on each weapon, by weapon id. A weapon with no entry wears the
 * default skin, so the stored object only holds what the player changed. */
export type EquippedSkins = Readonly<Record<string, SkinId>>;

/** Whatever the player last equipped on the Workbench (ui/menu/WorkbenchScreen.ts), kept across
 * sessions the same way the loadout is (core/loadout.ts). Anything malformed, any unknown weapon
 * and any unknown skin is dropped rather than trusted. */
export function loadStoredSkins(): EquippedSkins {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const skins: Record<string, SkinId> = {};
    for (const [weaponId, skinId] of Object.entries(parsed as Record<string, unknown>)) {
      if (Object.hasOwn(WEAPON_DEFINITIONS, weaponId) && isSkinId(skinId) && skinId !== DEFAULT_SKIN) skins[weaponId] = skinId;
    }
    return skins;
  } catch {
    // localStorage/JSON.parse can throw in restrictive contexts or on corrupted data - the default
    // skin on everything is a fine fallback.
    return {};
  }
}

export function saveSkins(skins: EquippedSkins): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skins));
  } catch {
    // Persistence is a nice-to-have, not required for the current session.
  }
}

/** `skins` with `skinId` on `weaponId`. Unknown weapons change nothing; the default skin removes
 * the entry. */
export function equipSkin(skins: EquippedSkins, weaponId: string, skinId: SkinId): EquippedSkins {
  if (!Object.hasOwn(WEAPON_DEFINITIONS, weaponId)) return skins;
  const next: Record<string, SkinId> = { ...skins };
  if (skinId === DEFAULT_SKIN) delete next[weaponId];
  else next[weaponId] = skinId;
  return next;
}

export function equippedSkin(skins: EquippedSkins, weaponId: string): SkinId {
  return skins[weaponId] ?? DEFAULT_SKIN;
}
