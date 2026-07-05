import { mulberry32 } from '../../utils/rng.ts';

/** Distinct offset from every other mulberry32 seed derivation in this codebase (ZoneMap/
 * VegetationManager/BuildingManager each add their own small offset to getWorldSeed()) so archetype
 * assignment draws from its own independent stream rather than accidentally correlating with
 * terrain/vegetation/building placement. */
const ARCHETYPE_SEED_OFFSET = 101;

export interface EnemyArchetype {
  readonly name: string;
  readonly flavor: string;
  readonly health: number;
  /** Chase-speed only - pre-aggro patrol speed/roam behavior is identical across archetypes on
   * purpose (an archetype reveals itself in combat, not while wandering at 50m). */
  readonly moveSpeed: number;
  readonly detectionRange: number;
  readonly leashRange: number;
  readonly rangedRange: number;
  readonly rangedDamage: number;
  readonly burstCount: number;
  readonly fireInterval: number;
  readonly burstPause: number;
  readonly aimErrorMaxDeg: number;
  readonly aimErrorMinDeg: number;
  readonly aimSettleTime: number;
  readonly meleeDamage: number;
  /** 'kite' backs away and keeps firing if the player closes inside kiteTriggerRange, instead of
   * just standing and firing - see Enemy.ts's updateKiteRetreat. Non-kiters don't read
   * kiteTriggerRange/kiteStopRange at all; 0 there is a dead value, not a meaningful "never kite". */
  readonly movementStyle: 'direct' | 'kite';
  readonly kiteTriggerRange: number;
  readonly kiteStopRange: number;
  /** Relative weight for createArchetypePicker's weighted-random spawn assignment - not a
   * probability itself, just compared against the sum of all archetypes' weights. */
  readonly spawnWeight: number;
}

/**
 * Three archetypes with real behavioral differences (enemy AI overhaul follow-up: per-archetype
 * loadouts, designed via a Fable architect pass grounded in the working Phases A-E state machine).
 * Two of the original five flavor-only names (Grass Sitter, The Other One) stay reserved, unused,
 * for future archetypes (ambush/pack-support) - same as before this pass, just narrowed from "all
 * five unused but one" to "three real, two still reserved."
 */
export const ENEMY_ARCHETYPES: readonly EnemyArchetype[] = [
  {
    // Today's tuned Phase A-E values, unchanged - every other archetype deviates from this baseline.
    name: 'The Straggler',
    flavor: 'Separated from a column that no longer exists. Takes it out on whoever’s nearest.',
    health: 60,
    moveSpeed: 2.5,
    detectionRange: 18,
    leashRange: 26,
    rangedRange: 16,
    rangedDamage: 9,
    burstCount: 3,
    fireInterval: 0.5,
    burstPause: 1.1,
    aimErrorMaxDeg: 9,
    aimErrorMinDeg: 1.5,
    aimSettleTime: 2.5,
    meleeDamage: 8,
    movementStyle: 'direct',
    kiteTriggerRange: 0,
    kiteStopRange: 0,
    spawnWeight: 50,
  },
  {
    // Sniper-style kiter: long reach, high per-hit damage, low health (a stationary long-range
    // attacker needs to be more punishable, not less, to stay fair), backs away if closed on.
    // detectionRange deliberately stays below ENEMY_RING_BASE_RADIUS (25, config.ts) - a first
    // draft set it to 30, which meant a Ridge Walker detected (and sniped) a completely passive
    // player right from match start, before they'd done anything at all, since 30 exceeds the
    // enemy spawn ring's own radius. rangedRange can still exceed detectionRange safely (30 here)
    // since an enemy only ever reaches ranged combat *after* first detecting within
    // detectionRange and closing in - by then it's already well inside rangedRange too.
    name: 'Ridge Walker',
    flavor: 'Patrols the high ground, silhouetted against the sky. Tactics were never the appeal.',
    health: 40,
    moveSpeed: 2.2,
    detectionRange: 20,
    leashRange: 32,
    rangedRange: 30,
    rangedDamage: 22,
    burstCount: 1,
    fireInterval: 0.5,
    burstPause: 2.4,
    aimErrorMaxDeg: 6,
    aimErrorMinDeg: 1.0,
    aimSettleTime: 3.0,
    meleeDamage: 5,
    movementStyle: 'kite',
    kiteTriggerRange: 10,
    kiteStopRange: 14,
    spawnWeight: 20,
  },
  {
    // Shotgun-style rusher: rangedRange 0 makes the ranged branch in Enemy.updateChase
    // unreachable (melee already owns everything <= ENEMY_ATTACK_RANGE) - "never shoot" falls out
    // of the existing branch order for free, no separate skip-ranged flag needed. Tankier and
    // faster than the player's walk speed so it actually closes the gap; melee payoff for surviving
    // the approach.
    name: 'Rush Job',
    flavor: 'Closes distance like the distance insulted him.',
    health: 90,
    moveSpeed: 3.4,
    detectionRange: 18,
    leashRange: 26,
    rangedRange: 0,
    rangedDamage: 0,
    burstCount: 0,
    fireInterval: 0.5,
    burstPause: 1.1,
    aimErrorMaxDeg: 9,
    aimErrorMinDeg: 1.5,
    aimSettleTime: 2.5,
    meleeDamage: 14,
    movementStyle: 'direct',
    kiteTriggerRange: 0,
    kiteStopRange: 0,
    spawnWeight: 30,
  },
];

/**
 * Seeded weighted-random archetype assignment, so a given match's enemy loadout composition is
 * reproducible from its world seed - same pattern as ZoneMap/VegetationManager/BuildingManager's
 * own mulberry32(getWorldSeed() + offset) derivations. Call once per match (EntityManager's
 * constructor) and reuse the returned picker for every spawnEnemy call - each call advances the same
 * seeded stream, so spawn order (not just spawn count) determines the resulting loadout.
 */
export function createArchetypePicker(seed: number): () => EnemyArchetype {
  const rng = mulberry32(seed + ARCHETYPE_SEED_OFFSET);
  const totalWeight = ENEMY_ARCHETYPES.reduce((sum, archetype) => sum + archetype.spawnWeight, 0);

  return () => {
    let roll = rng() * totalWeight;
    for (const archetype of ENEMY_ARCHETYPES) {
      roll -= archetype.spawnWeight;
      if (roll <= 0) return archetype;
    }
    // Floating-point edge case only (roll landing exactly on the boundary) - last archetype covers it.
    return ENEMY_ARCHETYPES[ENEMY_ARCHETYPES.length - 1]!;
  };
}
