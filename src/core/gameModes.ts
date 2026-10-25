import { PLAYER_HEALTH } from './config.ts';

/** Multiplayer-only, host-picked pre-match (per explicit user request - single-player never has a
 * mode, always the unrestricted default loadout). Threaded alongside `gooseDifficulty`/`killLimit`
 * through the same match-start plumbing (see MatchStartMessage/WelcomeMessage.activeMatch/
 * MultiplayerSession). */
export type GameMode = 'default' | 'oneShotOneKill' | 'sniperDuel' | 'gunGame' | 'knifeOnly' | 'gooseToss' | 'kingOfTheHill' | 'gooseHorde';

export const GAME_MODES: readonly GameMode[] = [
  'default',
  'oneShotOneKill',
  'sniperDuel',
  'gunGame',
  'knifeOnly',
  'gooseToss',
  'kingOfTheHill',
  'gooseHorde',
];
export const DEFAULT_GAME_MODE: GameMode = 'default';
export const GAME_MODE_LABELS: Record<GameMode, string> = {
  default: 'Default',
  oneShotOneKill: '1 Shot 1 Kill',
  sniperDuel: 'Sniper Duel',
  gunGame: 'Gun Game',
  knifeOnly: 'Knife Only',
  gooseToss: 'Goose Toss',
  kingOfTheHill: 'King of the Hill',
  gooseHorde: 'Goose Horde (Co-op)',
};

/** Whether grenades are on in a mode (docs/squad-arsenal-night.md, section 3). Pickups use it to
 * place grenade crates only where a player can carry grenades. The grenades branch fills this in
 * with its mode table when it merges; until grenades exist no mode has them, so no crate is placed. */
export function areGrenadesOnInMode(_mode: GameMode): boolean {
  return false;
}

/** Every weapon a Gun Game start/upgrade can draw from - never the knife, per explicit user
 * request ("knife is not in this mode"). */
const GUN_GAME_POOL: readonly string[] = ['pistol', 'mp5', 'rifle', 'shotgun', 'sniper'];

/** Which loadout slot a weapon belongs to (see ui/menu/LoadoutScreen.ts) - drives both the Loadout
 * page's left-column grouping and which slot a given weapon can be dragged into. 'special' (only
 * the Goose Launcher today) is shown for reference but is never draggable/equippable - it's a
 * mid-match reward, not a loadout choice. Weapons with no entry here (currently just 'unarmed',
 * Goose Toss's placeholder) never appear on the Loadout page at all. */
export type WeaponCategory = 'primary' | 'secondary' | 'melee' | 'special';
export const WEAPON_CATEGORIES: Readonly<Record<string, WeaponCategory>> = {
  sniper: 'primary',
  rifle: 'primary',
  shotgun: 'primary',
  pistol: 'secondary',
  mp5: 'secondary',
  knife: 'melee',
  gooseLauncher: 'special',
};

/** A player's own chosen weapon per slot (see core/loadout.ts for persistence) - null means "not
 * chosen yet," resolved to LOADOUT_SLOT_DEFAULTS's entry for that slot rather than blocking match
 * start, per explicit user decision. */
export interface PlayerLoadout {
  primary: string | null;
  secondary: string | null;
  melee: string | null;
}

export const LOADOUT_SLOT_DEFAULTS: Readonly<Record<'primary' | 'secondary' | 'melee', string>> = {
  primary: 'rifle',
  secondary: 'pistol',
  melee: 'knife',
};

/** Modes that don't already restrict or manage the player's loadout themselves (Gun Game rotates
 * weapons on kill; 1 Shot 1 Kill/Sniper Duel/Knife Only/Goose Toss are single-weapon by design) -
 * these three instead use whatever the player picked on the Loadout page (see
 * resolveWeaponLoadout's own customLoadout branch), single-player and multiplayer alike per
 * explicit user request. */
const UNRESTRICTED_GAME_MODES: ReadonlySet<GameMode> = new Set(['default', 'kingOfTheHill', 'gooseHorde']);
export function modeUsesCustomLoadout(mode: GameMode): boolean {
  return UNRESTRICTED_GAME_MODES.has(mode);
}

export interface WeaponLoadout {
  /** What `WeaponManager.create()` gets as `definitionIds` - Gun Game's is always exactly one
   * entry (a random pick from GUN_GAME_POOL), decided fresh per player per match by
   * `resolveWeaponLoadout` rather than being a fixed list here. */
  readonly weaponIds: string[];
  /** Per-weapon-id damage override (see Weapon.ts's `damageOverride`) - guarantees a 1-hit kill
   * for 1 Shot 1 Kill's pistol and Sniper Duel's sniper (base sniper damage, 90, isn't quite
   * lethal against PLAYER_HEALTH=100 as-is). Absent for modes that don't need one. */
  readonly damageOverrides?: Readonly<Record<string, number>>;
}

const FIXED_LOADOUTS: Partial<Record<GameMode, WeaponLoadout>> = {
  oneShotOneKill: { weaponIds: ['pistol'], damageOverrides: { pistol: PLAYER_HEALTH } },
  sniperDuel: { weaponIds: ['sniper'], damageOverrides: { sniper: PLAYER_HEALTH } },
  knifeOnly: { weaponIds: ['knife'] },
  // Not "no weapons" (WeaponManager requires at least one) - a harmless zero-damage placeholder
  // that Game.ts's Goose Toss handling never actually lets fire, see definitions.ts's 'unarmed'.
  gooseToss: { weaponIds: ['unarmed'] },
};
/** Fallback for the three unrestricted modes when, for whatever reason, no custom loadout is
 * available at all (e.g. a caller that doesn't pass one) - the old fixed 5-weapon arsenal, so
 * behavior never regresses to "0 weapons" outside the normal per-slot-default path below. */
const FULL_ARSENAL: WeaponLoadout = { weaponIds: ['pistol', 'rifle', 'shotgun', 'sniper', 'knife'] };

/** The starting loadout for a given mode - random for Gun Game (a fresh pick per call, so two
 * players in the same Gun Game match don't necessarily start with the same weapon), fixed for
 * every other restricted mode, and player-chosen (with per-slot fallback defaults) for the three
 * unrestricted modes (see modeUsesCustomLoadout). `rng` defaults to `Math.random` - each player's
 * own weapon is purely local state (WeaponManager isn't networked - confirmed no opponent ever
 * renders a held-weapon mesh, see RemotePlayer.ts), so there's no need for any of this to agree
 * across clients the way, say, the world seed does. */
export function resolveWeaponLoadout(mode: GameMode, rng: () => number = Math.random, customLoadout?: PlayerLoadout): WeaponLoadout {
  if (mode === 'gunGame') return { weaponIds: [pickRandomGunGameWeapon(rng)] };
  if (modeUsesCustomLoadout(mode)) {
    if (!customLoadout) return FULL_ARSENAL;
    return {
      weaponIds: [
        customLoadout.primary ?? LOADOUT_SLOT_DEFAULTS.primary,
        customLoadout.secondary ?? LOADOUT_SLOT_DEFAULTS.secondary,
        customLoadout.melee ?? LOADOUT_SLOT_DEFAULTS.melee,
      ],
    };
  }
  return FIXED_LOADOUTS[mode] ?? FULL_ARSENAL;
}

function pickRandomGunGameWeapon(rng: () => number): string {
  return GUN_GAME_POOL[Math.floor(rng() * GUN_GAME_POOL.length)]!;
}

/** Gun Game's kill-upgrade: a random weapon other than whatever the player currently has (falls
 * back to the full pool if that would leave nothing to pick from - unreachable today since the
 * pool has 4 entries, but a real fallback costs nothing). */
export function pickGunGameUpgrade(currentWeaponId: string, rng: () => number = Math.random): string {
  const candidates = GUN_GAME_POOL.filter((id) => id !== currentWeaponId);
  const pool = candidates.length > 0 ? candidates : GUN_GAME_POOL;
  return pool[Math.floor(rng() * pool.length)]!;
}
