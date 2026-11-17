import type { HordeWaveSpec } from '../core/config.ts';

/** Goose Horde's rules as numbers and pure functions (docs/goose-horde.md): what each kind of
 * goose is, how a wave grows with the squad, and what the squad earns for its kills. */

export type HordeGooseFlavor = 'walker' | 'jumper' | 'flyer' | 'brute' | 'boss';

export interface HordeFlavorStats {
  /** Hit points. The three small geese die to any hit. */
  readonly health: number;
  /** Size of the model and its collider, as a multiple of an ordinary goose. */
  readonly scale: number;
  /** Chase speed as a share of the wave's speed. */
  readonly speed: number;
  /** The blast when it reaches a player: reach in metres, damage at its centre, push. */
  readonly blastRadius: number;
  readonly blastDamage: number;
  readonly knockback: number;
  /** How close it must get to a player to go off. */
  readonly contactRadius: number;
  /** Body and glow colours. Null keeps the ordinary goose's white. */
  readonly tint: number | null;
}

const SMALL: HordeFlavorStats = { health: 1, scale: 1, speed: 1, blastRadius: 5, blastDamage: 60, knockback: 10, contactRadius: 1.2, tint: null };

export const HORDE_FLAVORS: Readonly<Record<HordeGooseFlavor, HordeFlavorStats>> = {
  walker: SMALL,
  jumper: SMALL,
  flyer: SMALL,
  /** Armoured, slow, and it takes the whole squad's fire: the reason to call a target. */
  brute: { health: 220, scale: 1.8, speed: 0.6, blastRadius: 7, blastDamage: 80, knockback: 14, contactRadius: 1.9, tint: 0x8c2a22 },
  /** A boss does not die when it reaches a player: it stomps (the blast below) and keeps coming. */
  boss: { health: 1500, scale: 3.2, speed: 0.42, blastRadius: 8, blastDamage: 55, knockback: 18, contactRadius: 3, tint: 0x6b2fa0 },
};

export type HordeBossId = 'mother' | 'matriarch';

export interface HordeBossStats {
  readonly name: string;
  /** Hit points for one player; hordeBossHealth scales it to the squad. */
  readonly health: number;
  /** Seconds between broods, and how many walkers hatch each time. */
  readonly broodEvery: number;
  readonly broodSize: number;
  /** Seconds between stomps while it stands on a player. */
  readonly stompEvery: number;
  readonly tint: number;
}

export const HORDE_BOSSES: Readonly<Record<HordeBossId, HordeBossStats>> = {
  mother: { name: 'MOTHER GOOSE', health: 1500, broodEvery: 7, broodSize: 2, stompEvery: 2.5, tint: 0x6b2fa0 },
  matriarch: { name: 'THE MATRIARCH', health: 2600, broodEvery: 5, broodSize: 3, stompEvery: 2, tint: 0xd4a017 },
};

/** How many players a wave is sized for: at least one, at most four. */
function squad(players: number): number {
  return Math.max(1, Math.min(4, Math.floor(players)));
}

/** A wave's small geese for a squad of `players`: the table's count is for one player, and each
 * further player adds 45 percent of it, so four face a little under two and a half times the
 * flock, not four times it. */
export function hordeWaveCount(spec: HordeWaveSpec, players: number): number {
  return Math.round(spec.count * (0.55 + 0.45 * squad(players)));
}

/** Brutes in a wave: the table's number for one or two players, one and a half times it for
 * three or four. */
export function hordeBruteCount(spec: HordeWaveSpec, players: number): number {
  const base = spec.brutes ?? 0;
  return squad(players) >= 3 ? Math.ceil(base * 1.5) : base;
}

/** A boss's hit points for a squad: half as much again for each player past the first. */
export function hordeBossHealth(boss: HordeBossId, players: number): number {
  return Math.round(HORDE_BOSSES[boss].health * (0.5 + 0.5 * squad(players)));
}

/** A brute's hit points for a squad: a quarter more for each player past the first. */
export function hordeBruteHealth(players: number): number {
  return Math.round(HORDE_FLAVORS.brute.health * (0.75 + 0.25 * squad(players)));
}

/** Kills the squad needs to earn a supply drop: more players kill faster, so the price rises. */
export function supplyKillsNeeded(players: number): number {
  return 10 + 4 * squad(players);
}

/** The squad meter after a kill: small geese count one, a brute three, a boss fills it. */
export function supplyKillValue(flavor: HordeGooseFlavor): number {
  return flavor === 'boss' ? 1000 : flavor === 'brute' ? 3 : 1;
}

/** Solo has no teammate to revive it, so it has Second Winds instead: the health one leaves, how
 * long it shields the player (s), the radius of the blast that clears the geese on top of them (m),
 * how many a run starts with and may hold, and the waves between earning one and the next. */
export const SECOND_WIND_RULES = { health: 35, shield: 2.5, clearRadius: 7, start: 1, max: 2, everyWaves: 4 } as const;

/** What one supply crate gives the player who takes it: magazines for the weapon in hand (where the
 * mode limits ammo), health, and a grenade. */
export const SUPPLY_CRATE = { magazines: 2, health: 35, grenades: 1 } as const;
