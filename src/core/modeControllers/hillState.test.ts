import { describe, expect, it } from 'vitest';
import type { PlayerSlot } from '../../network/protocol.ts';
import { hillEvents, HILL_RULES, HillState, playsInTeams, sideOf, spreadSites, type HillPlayer, type HillSite } from './hillState.ts';

const SITES: HillSite[] = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 0, z: 40 }];
/** Always the first site first, then one step on: site 0, then 1, then 2, then 0. */
const firstThenNext = (): number => 0;

function at(slot: PlayerSlot, x: number, z: number, counts = true): HillPlayer {
  return { slot, x, z, counts };
}

function run(state: HillState, seconds: number, players: HillPlayer[]): void {
  for (let t = 0; t < seconds * 10; t++) state.update(0.1, players);
}

describe('sides', () => {
  it('plays two against two only with four players', () => {
    expect([1, 2, 3, 4].map(playsInTeams)).toEqual([false, false, false, true]);
    expect([0, 1, 2, 3].map((slot) => sideOf(slot as PlayerSlot, true))).toEqual([0, 1, 0, 1]);
    expect([0, 1, 2, 3].map((slot) => sideOf(slot as PlayerSlot, false))).toEqual([0, 1, 2, 3]);
  });
});

describe('HillState', () => {
  it('scores a point a second for a side alone on the hill, and nothing while it is contested or empty', () => {
    const state = new HillState(SITES, 120, false, firstThenNext);
    run(state, 5, [at(0, 2, 2), at(1, 30, 30)]);
    expect(state.scoreOf(0)).toBe(5);
    expect(state.scoreOf(1)).toBe(0);
    expect(state.snapshot()).toMatchObject({ hold: 'held', holder: 0 });
    // The other player steps in: contested, the clock runs but nobody scores.
    run(state, 5, [at(0, 2, 2), at(1, -3, 0)]);
    expect(state.scoreOf(0)).toBe(5);
    expect(state.snapshot()).toMatchObject({ hold: 'contested', holder: null });
    run(state, 3, [at(0, 30, 2), at(1, 30, 30)]);
    expect(state.snapshot().hold).toBe('empty');
    expect(state.scoreOf(0)).toBe(5);
  });

  it('does not count a dead player or one below ground, on the hill or for the crown', () => {
    const state = new HillState(SITES, 120, false, firstThenNext);
    run(state, 4, [at(0, 1, 1, false), at(1, 2, 2)]);
    expect(state.scoreOf(0)).toBe(0);
    expect(state.scoreOf(1)).toBe(4);
    expect(state.claimCrown(at(0, 0, 0, false))).toBe(false);
  });

  it('scores a team once however many of it stand on the hill, and blocks only on the other team', () => {
    const state = new HillState(SITES, 120, true, firstThenNext);
    run(state, 5, [at(0, 1, 1), at(2, -2, 1), at(1, 30, 30), at(3, 31, 30)]);
    expect(state.scoreOf(0)).toBe(5);
    expect(state.scoreOf(2)).toBe(5);
    expect(state.scoreOf(1)).toBe(0);
    run(state, 2, [at(0, 1, 1), at(2, -2, 1), at(1, 30, 30), at(3, 3, 3)]);
    expect(state.scoreOf(0)).toBe(5);
    expect(state.snapshot().hold).toBe('contested');
  });

  it('doubles the score while the crown is worn on the hill, by reach only', () => {
    const state = new HillState(SITES, 120, false, firstThenNext);
    expect(state.snapshot().crownAt).toEqual({ x: 0, z: 0 });
    expect(state.claimCrown(at(0, HILL_RULES.crownReach + 0.5, 0))).toBe(false);
    expect(state.claimCrown(at(0, HILL_RULES.crownReach + 0.5, 0), HILL_RULES.crownReachSlack)).toBe(true);
    expect(state.claimCrown(at(1, 0, 0))).toBe(false);
    expect(state.snapshot()).toMatchObject({ crown: 0, crownAt: null });
    run(state, 5, [at(0, 1, 1), at(1, 30, 30)]);
    expect(state.scoreOf(0)).toBe(10);
    // Wearing it off the hill scores nothing.
    run(state, 5, [at(0, 30, 1), at(1, 30, 30)]);
    expect(state.scoreOf(0)).toBe(10);
  });

  it('drops the crown where its wearer fell, and where the hill is when they leave the match', () => {
    const state = new HillState(SITES, 120, false, firstThenNext);
    state.claimCrown(at(0, 0, 0));
    state.dropCrown(1, { x: 9, z: 9 });
    expect(state.snapshot().crown).toBe(0);
    state.dropCrown(0, { x: 5, z: -3 });
    expect(state.snapshot()).toMatchObject({ crown: null, crownAt: { x: 5, z: -3 } });
    expect(state.claimCrown(at(1, 5.5, -3))).toBe(true);
    state.update(0.1, [at(0, 30, 30)]);
    expect(state.snapshot()).toMatchObject({ crown: null, crownAt: { x: 0, z: 0 } });
  });

  it('moves the hill when its time is up, takes the crown back and never repeats a site', () => {
    const state = new HillState(SITES, 1000, false, firstThenNext);
    state.claimCrown(at(0, 0, 0));
    const first = state.snapshot();
    expect(first.next).toEqual({ x: 40, z: 0 });
    run(state, HILL_RULES.duration + 0.5, [at(0, 0, 0)]);
    const second = state.snapshot();
    expect(second.hill).toEqual({ x: 40, z: 0 });
    expect(second.next).toEqual({ x: 0, z: 40 });
    expect(second).toMatchObject({ crown: null, crownAt: { x: 40, z: 0 } });
    expect(second.moveIn).toBeGreaterThan(HILL_RULES.duration - 1);
    // Whatever the roll, the next hill is never the one it is on.
    for (const roll of [0, 0.3, 0.6, 0.999]) {
      const other = new HillState(SITES, 1000, false, () => roll);
      for (let i = 0; i < 6; i++) {
        const snap = other.snapshot();
        expect(snap.next).not.toEqual(snap.hill);
        run(other, HILL_RULES.duration + 0.5, []);
      }
    }
  });

  it('starts the Final Push at three quarters of the target: a smaller hill that moves sooner', () => {
    const state = new HillState(SITES, 20, false, firstThenNext);
    run(state, 14, [at(0, 7, 0)]);
    expect(state.snapshot()).toMatchObject({ push: false, radius: HILL_RULES.radius });
    run(state, 1.5, [at(0, 7, 0)]);
    const pushed = state.snapshot();
    expect(pushed).toMatchObject({ push: true, radius: HILL_RULES.pushRadius });
    expect(pushed.moveIn).toBeLessThanOrEqual(HILL_RULES.pushDuration);
    // 7 m from the centre was on the big hill and is off the small one.
    run(state, 3, [at(0, 7, 0)]);
    expect(state.snapshot().hold).toBe('empty');
  });

  it('never scores past the target', () => {
    const state = new HillState(SITES, 10, false, firstThenNext);
    run(state, 40, [at(0, 0, 0)]);
    expect(state.scoreOf(0)).toBe(10);
  });
});

describe('hillEvents', () => {
  const base = new HillState(SITES, 120, false, firstThenNext).snapshot();

  it('says nothing for the first snapshot a client sees', () => {
    expect(hillEvents(null, base)).toEqual([]);
  });

  it('announces the warning once, the move, the crown, the push and a change of holder', () => {
    expect(hillEvents({ ...base, moveIn: 8.2 }, { ...base, moveIn: 7.9 })).toEqual([{ kind: 'movingSoon' }]);
    expect(hillEvents({ ...base, moveIn: 7.9 }, { ...base, moveIn: 7.6 })).toEqual([]);
    expect(hillEvents(base, { ...base, crown: 2, crownAt: null })).toEqual([{ kind: 'crownTaken', slot: 2 }]);
    expect(hillEvents({ ...base, crown: 2, crownAt: null }, { ...base, crownAt: { x: 1, z: 1 } })).toEqual([{ kind: 'crownDropped' }]);
    expect(hillEvents(base, { ...base, push: true })).toEqual([{ kind: 'finalPush' }]);
    expect(hillEvents(base, { ...base, hold: 'held', holder: 1 })).toEqual([{ kind: 'holdChanged', hold: 'held', holder: 1 }]);
    // A move takes the crown back without calling it dropped.
    expect(hillEvents({ ...base, crown: 2, crownAt: null }, { ...base, hill: base.next, crownAt: base.next })).toEqual([{ kind: 'hillMoved' }]);
  });
});

describe('spreadSites', () => {
  it('keeps the first candidate and then takes the farthest each time', () => {
    const candidates = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 50, z: 0 }, { x: 0, z: 50 }, { x: 49, z: 1 }];
    expect(spreadSites(candidates, 3)).toEqual([{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 0, z: 50 }]);
    expect(spreadSites(candidates, 99)).toHaveLength(5);
    expect(spreadSites([], 3)).toEqual([]);
  });
});
