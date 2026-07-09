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

/** Every weapon a Gun Game start/upgrade can draw from - never the knife, per explicit user
 * request ("knife is not in this mode"). */
const GUN_GAME_POOL: readonly string[] = ['pistol', 'rifle', 'shotgun', 'sniper'];

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
  default: { weaponIds: ['pistol', 'rifle', 'shotgun', 'sniper', 'knife'] },
  oneShotOneKill: { weaponIds: ['pistol'], damageOverrides: { pistol: PLAYER_HEALTH } },
  sniperDuel: { weaponIds: ['sniper'], damageOverrides: { sniper: PLAYER_HEALTH } },
  knifeOnly: { weaponIds: ['knife'] },
  // Not "no weapons" (WeaponManager requires at least one) - a harmless zero-damage placeholder
  // that Game.ts's Goose Toss handling never actually lets fire, see definitions.ts's 'unarmed'.
  gooseToss: { weaponIds: ['unarmed'] },
  // Full arsenal, same as 'default' - King of the Hill's twist is the golden goose objective, not
  // a restricted loadout. Weapons are gated (fire consumed) only while carrying it - see
  // Game.ts's updateGoldenGoose, not a loadout-level restriction like gooseToss's 'unarmed'.
  kingOfTheHill: { weaponIds: ['pistol', 'rifle', 'shotgun', 'sniper', 'knife'] },
  // Full arsenal - this is a PvE co-op survival mode, not a restricted-loadout PvP variant.
  gooseHorde: { weaponIds: ['pistol', 'rifle', 'shotgun', 'sniper', 'knife'] },
};

/** The starting loadout for a given mode - random for Gun Game (a fresh pick per call, so two
 * players in the same Gun Game match don't necessarily start with the same weapon), fixed for
 * every other mode. `rng` defaults to `Math.random` - each player's own weapon is purely local
 * state (WeaponManager isn't networked), so there's no need for this to agree across clients the
 * way, say, the world seed does. */
export function resolveWeaponLoadout(mode: GameMode, rng: () => number = Math.random): WeaponLoadout {
  if (mode === 'gunGame') return { weaponIds: [pickRandomGunGameWeapon(rng)] };
  return FIXED_LOADOUTS[mode] ?? FIXED_LOADOUTS.default!;
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
