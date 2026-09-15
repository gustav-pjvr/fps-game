import {
  ENEMY_FLANK_COOLDOWN,
  ENEMY_FLANK_MAX_DURATION,
  ENEMY_FLANK_MIN_SQUAD,
  ENEMY_FLANK_SHOT_BONUS,
  ENEMY_FLANK_SHOT_MIN_ANGLE_DEG,
  ENEMY_FLANKER_CAP,
  ENEMY_FLANKER_CAP_LARGE_SQUAD,
  ENEMY_LARGE_SQUAD_SIZE,
  ENEMY_SHOOTER_IDEAL_RANGE_FRACTION,
  ENEMY_TOKEN_MIN_HOLD,
  ENEMY_TOKEN_STEAL_MARGIN,
} from '../../core/config.ts';

/**
 * Who does what in a fight (enemy AI v2, step 2 - docs/enemy-ai-v2.md). The Last of Us's Combat
 * Coordinator and DOOM's attack tokens: rather than every enemy that sees the player deciding for
 * itself, one coordinator per match hands out roles to the enemies currently in combat.
 *
 * - shooter: allowed to fire. Capped (ENEMY_MAX_CONCURRENT_ENGAGERS, 2) so the player is pinned,
 *   not dogpiled. Tokens go to the best-placed enemies, and a clearly better-placed enemy can take
 *   one from a holder that has had it for at least ENEMY_TOKEN_MIN_HOLD.
 * - flanker: works around to the player's side while the shooters pin them. Arriving there
 *   earns a placement bonus for a shooter token, which is what turns a flank into crossfire.
 * - rusher: melee-only archetypes, which always close in (their rush is their attack).
 * - reserve: everyone else in combat - tracks the player and waits for a token.
 *
 * Replaces engagementSlots.ts (first-come-first-served firing slots). Pure and deterministic: the
 * injected rng (a seeded stream) only picks which side a new flanker goes to.
 */

export type CombatRole = 'shooter' | 'flanker' | 'rusher' | 'reserve';

export interface RoleCandidate {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** False for melee-only archetypes (rangedRange 0). */
  readonly canShoot: boolean;
  readonly rangedRange: number;
  readonly hasLineOfSight: boolean;
}

export interface CombatSituation {
  /** Squad clock, seconds. */
  readonly now: number;
  /** Where the squad believes the player is (SquadKnowledge's belief), or null. */
  readonly threat: { readonly x: number; readonly z: number } | null;
  /** True while at least one enemy has the player in sight. */
  readonly isThreatVisible: boolean;
}

export interface RoleCaps {
  readonly shooter: number;
}

interface Assignment {
  role: CombatRole;
  since: number;
  flankSide: 1 | -1;
}

function bearing(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function angleBetween(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/** How good a spot this enemy is in to hold a shooter token, 0 (cannot shoot from there) to about
 * 1.3. Needs a sightline and the player inside the enemy's own ranged range; best at
 * ENEMY_SHOOTER_IDEAL_RANGE_FRACTION of that range, down to half at point-blank or at the range
 * limit. An enemy firing from well off the squad's main line (ENEMY_FLANK_SHOT_MIN_ANGLE_DEG away
 * from the combat direction) earns ENEMY_FLANK_SHOT_BONUS: crossfire is worth more than a second
 * gun on the same line. */
export function shooterScore(
  candidate: RoleCandidate,
  threat: { x: number; z: number },
  combatBearing: number | null,
): number {
  if (!candidate.canShoot || !candidate.hasLineOfSight || candidate.rangedRange <= 0) return 0;
  const distance = Math.hypot(candidate.x - threat.x, candidate.z - threat.z);
  if (distance > candidate.rangedRange) return 0;
  const ideal = candidate.rangedRange * ENEMY_SHOOTER_IDEAL_RANGE_FRACTION;
  const rangeFit = 1 - 0.5 * Math.min(1, Math.abs(distance - ideal) / ideal);
  if (combatBearing === null) return rangeFit;
  const offLine = angleBetween(bearing(threat, candidate), combatBearing);
  return offLine >= (ENEMY_FLANK_SHOT_MIN_ANGLE_DEG * Math.PI) / 180 ? rangeFit + ENEMY_FLANK_SHOT_BONUS : rangeFit;
}

export class CombatCoordinator {
  private readonly assignments = new Map<number, Assignment>();
  /** Squad clock time until which an enemy may not be picked as a flanker again. */
  private readonly flankCooldownUntil = new Map<number, number>();
  private combatBearingValue: number | null = null;

  constructor(
    private readonly caps: RoleCaps,
    private readonly rng: () => number,
  ) {}

  /** Recomputes every role; call once per tick, before any enemy acts on its role. `roster` is
   * every enemy currently in combat (chasing); anyone missing from it loses their role. */
  update(roster: readonly RoleCandidate[], situation: CombatSituation): void {
    const present = new Set(roster.map((candidate) => candidate.id));
    for (const id of [...this.assignments.keys()]) {
      if (!present.has(id)) this.assignments.delete(id);
    }
    const threat = situation.threat;
    this.combatBearingValue = threat && roster.length > 0 ? this.centroidBearing(roster, threat) : null;

    for (const candidate of roster) {
      if (!this.assignments.has(candidate.id)) {
        this.assignments.set(candidate.id, { role: candidate.canShoot ? 'reserve' : 'rusher', since: situation.now, flankSide: 1 });
      }
    }
    if (!threat) {
      for (const candidate of roster) this.setRole(candidate.id, candidate.canShoot ? 'reserve' : 'rusher', situation.now);
      return;
    }

    const scores = new Map<number, number>();
    for (const candidate of roster) scores.set(candidate.id, shooterScore(candidate, threat, this.combatBearingValue));
    this.assignShooters(roster, scores, situation.now);
    this.assignFlankers(roster, situation, threat);
  }

  roleOf(id: number): CombatRole | null {
    return this.assignments.get(id)?.role ?? null;
  }

  /** Which side (+1 or -1 around the combat direction) this enemy's flank goes to. */
  flankSideOf(id: number): 1 | -1 {
    return this.assignments.get(id)?.flankSide ?? 1;
  }

  /** Bearing (mesh yaw convention, atan2(dx, dz)) from the threat toward the centroid of everyone
   * in combat - "the front". Flanks go ninety degrees either side of it. Null with no combat. */
  get combatBearing(): number | null {
    return this.combatBearingValue;
  }

  /** An enemy died or despawned. */
  release(id: number): void {
    this.assignments.delete(id);
    this.flankCooldownUntil.delete(id);
  }

  countRoles(): Record<CombatRole, number> {
    const counts: Record<CombatRole, number> = { shooter: 0, flanker: 0, rusher: 0, reserve: 0 };
    for (const assignment of this.assignments.values()) counts[assignment.role] += 1;
    return counts;
  }

  reset(): void {
    this.assignments.clear();
    this.flankCooldownUntil.clear();
    this.combatBearingValue = null;
  }

  private centroidBearing(roster: readonly RoleCandidate[], threat: { x: number; z: number }): number {
    let x = 0;
    let z = 0;
    for (const candidate of roster) {
      x += candidate.x;
      z += candidate.z;
    }
    return bearing(threat, { x: x / roster.length, z: z / roster.length });
  }

  private setRole(id: number, role: CombatRole, now: number): void {
    const assignment = this.assignments.get(id);
    if (!assignment || assignment.role === role) return;
    if (assignment.role === 'flanker') this.flankCooldownUntil.set(id, now + ENEMY_FLANK_COOLDOWN);
    assignment.role = role;
    assignment.since = now;
  }

  /** Holders who can no longer shoot lose the token at once (as the old slots did on losing sight
   * or range). Free tokens go to the best-scoring candidates. Then at most one steal per tick: the
   * best waiting candidate takes the weakest holder's token if it scores clearly higher
   * (ENEMY_TOKEN_STEAL_MARGIN) and that holder has fired for at least ENEMY_TOKEN_MIN_HOLD. */
  private assignShooters(roster: readonly RoleCandidate[], scores: ReadonlyMap<number, number>, now: number): void {
    const scoreOf = (id: number): number => scores.get(id) ?? 0;
    const holders = roster.filter((candidate) => this.roleOf(candidate.id) === 'shooter');
    for (const holder of holders) {
      if (scoreOf(holder.id) <= 0) this.setRole(holder.id, 'reserve', now);
    }

    const waiting = roster
      .filter((candidate) => this.roleOf(candidate.id) !== 'shooter' && scoreOf(candidate.id) > 0)
      .sort((a, b) => scoreOf(b.id) - scoreOf(a.id) || a.id - b.id);
    let shooterCount = roster.filter((candidate) => this.roleOf(candidate.id) === 'shooter').length;
    while (shooterCount < this.caps.shooter && waiting.length > 0) {
      const next = waiting.shift()!;
      this.setRole(next.id, 'shooter', now);
      shooterCount++;
    }

    const challenger = waiting[0];
    if (!challenger) return;
    const weakest = roster
      .filter((candidate) => this.roleOf(candidate.id) === 'shooter')
      .sort((a, b) => scoreOf(a.id) - scoreOf(b.id) || b.id - a.id)[0];
    if (!weakest) return;
    const heldFor = now - (this.assignments.get(weakest.id)?.since ?? now);
    if (scoreOf(challenger.id) >= scoreOf(weakest.id) + ENEMY_TOKEN_STEAL_MARGIN && heldFor >= ENEMY_TOKEN_MIN_HOLD) {
      this.setRole(weakest.id, 'reserve', now);
      this.setRole(challenger.id, 'shooter', now);
    }
  }

  /** Flankers only while the player is in sight of the squad and at least ENEMY_FLANK_MIN_SQUAD
   * enemies are fighting (a flank needs someone else to do the pinning). A flank ends after
   * ENEMY_FLANK_MAX_DURATION (the enemy goes back to reserve and cannot flank again for
   * ENEMY_FLANK_COOLDOWN). New flankers are the waiting enemies nearest the player - the ones who
   * can get round fastest - and each is sent to a side picked by the seeded rng. */
  private assignFlankers(roster: readonly RoleCandidate[], situation: CombatSituation, threat: { x: number; z: number }): void {
    const now = situation.now;
    for (const candidate of roster) {
      const assignment = this.assignments.get(candidate.id);
      if (assignment?.role === 'flanker' && now - assignment.since >= ENEMY_FLANK_MAX_DURATION) {
        this.setRole(candidate.id, 'reserve', now);
      }
    }
    if (!situation.isThreatVisible || roster.length < ENEMY_FLANK_MIN_SQUAD) return;

    const cap = roster.length >= ENEMY_LARGE_SQUAD_SIZE ? ENEMY_FLANKER_CAP_LARGE_SQUAD : ENEMY_FLANKER_CAP;
    let flankers = roster.filter((candidate) => this.roleOf(candidate.id) === 'flanker').length;
    if (flankers >= cap) return;

    const eligible = roster
      .filter(
        (candidate) =>
          candidate.canShoot &&
          this.roleOf(candidate.id) === 'reserve' &&
          (this.flankCooldownUntil.get(candidate.id) ?? Number.NEGATIVE_INFINITY) <= now,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - threat.x, a.z - threat.z) - Math.hypot(b.x - threat.x, b.z - threat.z) || a.id - b.id,
      );
    for (const candidate of eligible) {
      if (flankers >= cap) break;
      this.setRole(candidate.id, 'flanker', now);
      const assignment = this.assignments.get(candidate.id);
      if (assignment) assignment.flankSide = this.rng() < 0.5 ? 1 : -1;
      flankers++;
    }
  }
}
