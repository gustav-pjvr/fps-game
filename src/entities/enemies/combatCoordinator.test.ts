import { describe, expect, it } from 'vitest';
import { CombatCoordinator, shooterScore, type RoleCandidate } from './combatCoordinator.ts';
import { mulberry32 } from '../../utils/rng.ts';
import {
  ENEMY_FLANK_COOLDOWN,
  ENEMY_FLANK_MAX_DURATION,
  ENEMY_FLANK_SHOT_BONUS,
  ENEMY_FLANKER_CAP_LARGE_SQUAD,
  ENEMY_LARGE_SQUAD_SIZE,
  ENEMY_TOKEN_MIN_HOLD,
} from '../../core/config.ts';

const THREAT = { x: 0, z: 0 };

/** An enemy at (x, z) with a 16 m ranged range (the Straggler's) and a clear sightline. */
function gunner(id: number, x: number, z: number, overrides: Partial<RoleCandidate> = {}): RoleCandidate {
  return { id, x, z, canShoot: true, rangedRange: 16, hasLineOfSight: true, ...overrides };
}

function coordinator(): CombatCoordinator {
  return new CombatCoordinator({ shooter: 2 }, mulberry32(7));
}

const visible = (now: number) => ({ now, threat: THREAT, isThreatVisible: true });

describe('shooterScore', () => {
  it('is zero without a sightline, out of range, or for a melee-only enemy', () => {
    expect(shooterScore(gunner(1, 0, 10, { hasLineOfSight: false }), THREAT, null)).toBe(0);
    expect(shooterScore(gunner(1, 0, 20), THREAT, null)).toBe(0);
    expect(shooterScore(gunner(1, 0, 3, { canShoot: false, rangedRange: 0 }), THREAT, null)).toBe(0);
  });

  it('peaks at the ideal fraction of the enemy range and halves at the extremes', () => {
    const ideal = shooterScore(gunner(1, 0, 16 * 0.6), THREAT, null);
    expect(ideal).toBeCloseTo(1);
    expect(shooterScore(gunner(1, 0, 16), THREAT, null)).toBeLessThan(ideal);
    expect(shooterScore(gunner(1, 0, 0.01), THREAT, null)).toBeCloseTo(0.5, 1);
  });

  it('adds the crossfire bonus to a spot well off the main line', () => {
    // Combat bearing 0 means the squad sits along +z from the threat; a spot along +x is 90 degrees off.
    const onLine = shooterScore(gunner(1, 0, 9.6), THREAT, 0);
    const offLine = shooterScore(gunner(2, 9.6, 0), THREAT, 0);
    expect(offLine).toBeCloseTo(onLine + ENEMY_FLANK_SHOT_BONUS);
  });
});

describe('CombatCoordinator shooter tokens', () => {
  it('never hands out more shooter tokens than the cap', () => {
    const c = coordinator();
    const roster = [gunner(1, 0, 9), gunner(2, 2, 9), gunner(3, -2, 9), gunner(4, 4, 9)];
    c.update(roster, visible(0));
    expect(c.countRoles().shooter).toBe(2);
  });

  it('gives the tokens to the best-placed enemies, not the first to ask', () => {
    const c = coordinator();
    // id 1 is at the edge of its range, ids 2 and 3 near the ideal distance.
    c.update([gunner(1, 0, 15.5), gunner(2, 1, 9.6), gunner(3, -1, 9.6)], visible(0));
    expect(c.roleOf(1)).not.toBe('shooter');
    expect(c.roleOf(2)).toBe('shooter');
    expect(c.roleOf(3)).toBe('shooter');
  });

  it('takes the token back at once when a holder loses its sightline', () => {
    const c = coordinator();
    c.update([gunner(1, 0, 9.6)], visible(0));
    expect(c.roleOf(1)).toBe('shooter');
    c.update([gunner(1, 0, 9.6, { hasLineOfSight: false })], visible(0.1));
    expect(c.roleOf(1)).toBe('reserve');
  });

  it('lets a clearly better-placed enemy steal a token, but only after the minimum hold', () => {
    const c = coordinator();
    const poor = [gunner(1, 0, 15.8), gunner(2, 0.5, 15.8)];
    c.update(poor, visible(0));
    expect(c.countRoles().shooter).toBe(2);

    const withChallenger = [...poor, gunner(3, -0.5, 9.6)];
    c.update(withChallenger, visible(ENEMY_TOKEN_MIN_HOLD / 2));
    expect(c.roleOf(3)).not.toBe('shooter');

    c.update(withChallenger, visible(ENEMY_TOKEN_MIN_HOLD + 0.1));
    expect(c.roleOf(3)).toBe('shooter');
    expect(c.countRoles().shooter).toBe(2);
  });

  it('does not steal for a marginally better spot', () => {
    const c = coordinator();
    c.update([gunner(1, 0, 10), gunner(2, 0.5, 10)], visible(0));
    c.update([gunner(1, 0, 10), gunner(2, 0.5, 10), gunner(3, -0.5, 9.6)], visible(ENEMY_TOKEN_MIN_HOLD * 3));
    expect(c.roleOf(3)).not.toBe('shooter');
  });

  it('labels melee-only enemies as rushers and never gives them a token', () => {
    const c = coordinator();
    c.update([gunner(1, 0, 2, { canShoot: false, rangedRange: 0 })], visible(0));
    expect(c.roleOf(1)).toBe('rusher');
  });

  it('drops enemies that leave combat and on release', () => {
    const c = coordinator();
    c.update([gunner(1, 0, 9.6), gunner(2, 1, 9.6)], visible(0));
    c.update([gunner(2, 1, 9.6)], visible(0.1));
    expect(c.roleOf(1)).toBeNull();
    c.release(2);
    expect(c.roleOf(2)).toBeNull();
  });
});

describe('CombatCoordinator flankers', () => {
  it('sends one waiting enemy to flank while the player is in sight of a squad of two or more', () => {
    const c = coordinator();
    c.update([gunner(1, 0, 9.6), gunner(2, 1, 9.6), gunner(3, -1, 12)], visible(0));
    expect(c.countRoles()).toMatchObject({ shooter: 2, flanker: 1 });
    expect(c.roleOf(3)).toBe('flanker');
  });

  it('does not flank alone or when nobody can see the player', () => {
    const lone = coordinator();
    lone.update([gunner(1, 0, 20, { hasLineOfSight: false })], visible(0));
    expect(lone.countRoles().flanker).toBe(0);

    const blind = coordinator();
    blind.update([gunner(1, 0, 9.6), gunner(2, 1, 9.6), gunner(3, -1, 12)], { now: 0, threat: THREAT, isThreatVisible: false });
    expect(blind.countRoles().flanker).toBe(0);
  });

  it('allows a second flanker in a large squad', () => {
    const c = coordinator();
    const roster: RoleCandidate[] = [];
    for (let i = 0; i < ENEMY_LARGE_SQUAD_SIZE; i++) roster.push(gunner(i + 1, i - 3, 12));
    c.update(roster, visible(0));
    expect(c.countRoles().flanker).toBe(ENEMY_FLANKER_CAP_LARGE_SQUAD);
  });

  it('ends a flank after its maximum duration, with a cooldown before that enemy flanks again', () => {
    const c = coordinator();
    const roster = [gunner(1, 0, 9.6), gunner(2, 1, 9.6), gunner(3, -1, 12)];
    c.update(roster, visible(0));
    expect(c.roleOf(3)).toBe('flanker');
    c.update(roster, visible(ENEMY_FLANK_MAX_DURATION + 0.1));
    expect(c.roleOf(3)).toBe('reserve');
    c.update(roster, visible(ENEMY_FLANK_MAX_DURATION + ENEMY_FLANK_COOLDOWN + 0.2));
    expect(c.roleOf(3)).toBe('flanker');
  });

  it('turns an arrived flanker into a shooter through the crossfire bonus', () => {
    const c = coordinator();
    // Front line along +z; the flanker has worked round to +x, 90 degrees off the line.
    const front = [gunner(1, 0, 13), gunner(2, 0.5, 13)];
    c.update([...front, gunner(3, -0.5, 14)], visible(0));
    expect(c.roleOf(3)).toBe('flanker');
    c.update([...front, gunner(3, 9.6, 0)], visible(ENEMY_TOKEN_MIN_HOLD + 0.1));
    expect(c.roleOf(3)).toBe('shooter');
  });

  it('is deterministic for the same roster and seed', () => {
    const roster = [gunner(1, 0, 9.6), gunner(2, 1, 9.6), gunner(3, -1, 12), gunner(4, 3, 12)];
    const a = coordinator();
    const b = coordinator();
    a.update(roster, visible(0));
    b.update(roster, visible(0));
    for (const candidate of roster) {
      expect(a.roleOf(candidate.id)).toBe(b.roleOf(candidate.id));
      expect(a.flankSideOf(candidate.id)).toBe(b.flankSideOf(candidate.id));
    }
  });
});
