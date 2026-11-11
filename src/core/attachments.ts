import { WEAPON_DEFINITIONS } from '../weapons/definitions.ts';
import { sanitizeAttachments, toggleAttachment, type AttachmentId } from '../weapons/models/attachments.ts';

const STORAGE_KEY = 'fps-game-attachments';

/** The attachments the player has fitted to each gun, by weapon id (docs/attachments.md). A gun
 * with no entry carries none, so the stored object only holds what the player fitted. */
export type FittedAttachments = Readonly<Record<string, readonly AttachmentId[]>>;

/** Whatever the player last fitted on the Workbench (ui/menu/WorkbenchScreen.ts), kept across
 * sessions the same way skins are (core/skins.ts). Anything malformed, any unknown weapon and any
 * attachment the gun cannot take is dropped rather than trusted. */
export function loadStoredAttachments(): FittedAttachments {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const fitted: Record<string, AttachmentId[]> = {};
    for (const [weaponId, ids] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Object.hasOwn(WEAPON_DEFINITIONS, weaponId) || !Array.isArray(ids)) continue;
      const kept = sanitizeAttachments(weaponId, ids);
      if (kept.length > 0) fitted[weaponId] = kept;
    }
    return fitted;
  } catch {
    // localStorage/JSON.parse can throw in restrictive contexts or on corrupted data: bare guns
    // are a fine fallback.
    return {};
  }
}

export function saveAttachments(fitted: FittedAttachments): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fitted));
  } catch {
    // Persistence is a nice-to-have, not required for the current session.
  }
}

export function fittedAttachments(fitted: FittedAttachments, weaponId: string): readonly AttachmentId[] {
  return fitted[weaponId] ?? [];
}

/** `fitted` with `id` fitted to or taken off `weaponId`. A gun that cannot take it changes nothing;
 * a gun left bare loses its entry. */
export function toggleFitted(fitted: FittedAttachments, weaponId: string, id: AttachmentId): FittedAttachments {
  const next = toggleAttachment(weaponId, fittedAttachments(fitted, weaponId), id);
  const out: Record<string, readonly AttachmentId[]> = { ...fitted };
  if (next.length === 0) delete out[weaponId];
  else out[weaponId] = next;
  return out;
}
