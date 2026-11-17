import { describe, expect, it } from 'vitest';
import { PacingDirector, type DirectorOptions } from './pacingDirector.ts';
import { SHOWDOWN_ACTS, SHOWDOWN_RULES, ShowdownState, showdownOptions, type ShowdownEvent, type ShowdownSignals } from './showdown.ts';

const BASE: DirectorOptions = {
  intensityPerDamage: 0.02,
  intensityPerKill: 0.15,
  decayPerSecond: 0.08,
  peakThreshold: 1,
  peakMin: 3,
  peakMax: 5,
  fadeExit: 0.3,
  relaxMin: 30,
  relaxMax: 45,
  maxAlive: 8,
  waveSize: 2,
  waveInterval: 8,
  retryDelay: 1,
  rusherWaveShare: 0.2,
  sniperWaveShare: 0.2,
};

const DT = 0.5;
const tick = (over: Partial<ShowdownSignals> = {}): ShowdownSignals => ({
  dt: DT, damageTaken: 0, nearbyKills: 0, kills: 0, engagedEnemies: 0, aliveEnemies: 2, allPlayersUnderground: false, ...over,
});

function make(players = 1) {
  const director = new PacingDirector(BASE, () => 0);
  return { director, showdown: new ShowdownState(director, BASE, () => players) };
}

/** Ticks with `signals` until an event of `kind` comes (or `limit` seconds pass); returns every event seen. */
function runUntil(showdown: ShowdownState, kind: ShowdownEvent['kind'], signals: () => ShowdownSignals, limit = 400): ShowdownEvent[] {
  const seen: ShowdownEvent[] = [];
  for (let t = 0; t < limit; t += DT) {
    const events = showdown.update(signals());
    seen.push(...events);
    if (events.some((event) => event.kind === kind)) return seen;
  }
  throw new Error(`no ${kind} within ${limit} s (stage ${showdown.stage}, act ${showdown.act})`);
}

/** Plays one whole act: a hit that brings the peak, then quiet until the next act starts. */
function playAct(showdown: ShowdownState): ShowdownEvent[] {
  const events = showdown.update(tick({ damageTaken: 60 }));
  return [...events, ...runUntil(showdown, 'actStarted', () => tick())];
}

describe('showdownOptions', () => {
  it('gives each act a larger cap than the one before, and never a smaller wave', () => {
    for (let act = 2; act <= SHOWDOWN_ACTS.length; act++) {
      const previous = showdownOptions(BASE, act - 1, 1);
      const current = showdownOptions(BASE, act, 1);
      expect(current.maxAlive).toBeGreaterThan(previous.maxAlive);
      expect(current.waveSize).toBeGreaterThanOrEqual(previous.waveSize);
    }
    expect(SHOWDOWN_ACTS).toHaveLength(5);
  });

  it('sizes an act for the squad, at well under one cap per player', () => {
    const solo = showdownOptions(BASE, 3, 1);
    const four = showdownOptions(BASE, 3, 4);
    expect(four.maxAlive).toBe(Math.round(solo.maxAlive * 2.05));
    expect(four.maxAlive).toBeLessThan(solo.maxAlive * 4);
    expect(showdownOptions(BASE, 3, 9)).toEqual(four);
    // The rest of the director's numbers are the base's.
    expect(four.peakThreshold).toBe(BASE.peakThreshold);
  });
});

describe('ShowdownState', () => {
  it('starts in act 1 with the act\'s numbers on the director, and passes its waves on', () => {
    const { showdown } = make();
    expect(showdown.view()).toMatchObject({ act: 1, totalActs: 5, stage: 'act', score: 0, multiplier: 1, redeploysLeft: 2 });
    const events = runUntil(showdown, 'spawnWave', () => tick());
    expect(events.at(-1)).toEqual({ kind: 'spawnWave', count: SHOWDOWN_ACTS[0]!.waveSize, bias: 'rusher' });
  });

  it('clears an act when its peak gives way to the breather, pays the bonus, and starts the next after it', () => {
    const { showdown } = make();
    const events = playAct(showdown);
    expect(events.filter((event) => event.kind === 'actCleared')).toEqual([{ kind: 'actCleared', act: 1, bonus: 500 }]);
    expect(events.at(-1)).toEqual({ kind: 'actStarted', act: 2 });
    expect(showdown.view()).toMatchObject({ act: 2, stage: 'act', score: 500 });
  });

  it('does not clear an act for a breather the players got by going underground', () => {
    const { showdown, director } = make();
    for (let t = 0; t < 5; t += DT) showdown.update(tick({ allPlayersUnderground: true }));
    expect(director.phase).toBe('relax');
    expect(showdown.view()).toMatchObject({ act: 1, stage: 'act', score: 0 });
    // Back on the surface the same act goes on.
    const events = runUntil(showdown, 'spawnWave', () => tick());
    expect(events.some((event) => event.kind === 'actStarted' || event.kind === 'actCleared')).toBe(false);
  });

  it('brings the peak itself when a build-up has gone on too long', () => {
    const { showdown } = make();
    // Nothing the player does raises the intensity: the act still ends.
    const events = runUntil(showdown, 'actCleared', () => tick(), SHOWDOWN_RULES.maxBuildUp + 120);
    expect(events.at(-1)).toMatchObject({ kind: 'actCleared', act: 1 });
  });

  it('ends the fifth act with the finale, and is won when the finale squad is placed and gone', () => {
    const { showdown } = make();
    for (let act = 1; act < 5; act++) playAct(showdown);
    expect(showdown.act).toBe(5);
    showdown.update(tick({ damageTaken: 60 }));
    const events = runUntil(showdown, 'finaleStarted', () => tick());
    expect(events.at(-1)).toEqual({ kind: 'finaleStarted', escorts: 4 });
    expect(events.some((event) => event.kind === 'actCleared' && event.act === 5)).toBe(false);
    expect(showdown.stage).toBe('finale');

    // Not won while the squad is not placed yet, even with the field empty, nor while any of it lives.
    expect(showdown.update(tick({ aliveEnemies: 0 }))).toEqual([]);
    showdown.confirmFinalePlaced();
    expect(showdown.update(tick({ aliveEnemies: 3 }))).toEqual([]);
    const before = showdown.view().score;
    expect(showdown.update(tick({ aliveEnemies: 0 }))).toEqual([{ kind: 'won', bonus: 2500 }]);
    expect(showdown.view()).toMatchObject({ stage: 'won', score: before + 2500 });
    expect(showdown.update(tick())).toEqual([]);
  });

  it('brings more escorts to the finale for a bigger squad', () => {
    const { showdown } = make(4);
    for (let act = 1; act < 5; act++) playAct(showdown);
    showdown.update(tick({ damageTaken: 60 }));
    expect(runUntil(showdown, 'finaleStarted', () => tick()).at(-1)).toEqual({ kind: 'finaleStarted', escorts: 10 });
  });

  it('scores kills at the multiplier, which climbs while the fight stays hot and falls when it goes cold', () => {
    const { showdown } = make();
    showdown.update(tick({ kills: 2 }));
    expect(showdown.view().score).toBe(200);

    // An enemy chasing keeps the intensity from draining; a hit keeps it hot.
    const hot = () => tick({ damageTaken: 5, engagedEnemies: 1 });
    const up = runUntil(showdown, 'multiplier', hot);
    expect(up.at(-1)).toEqual({ kind: 'multiplier', value: 2 });
    showdown.update(tick({ kills: 1, engagedEnemies: 1 }));
    expect(showdown.view().score).toBe(200 + 200);
    expect(showdown.view().bestMultiplier).toBe(2);

    const down = runUntil(showdown, 'multiplier', () => tick());
    expect(down.at(-1)).toEqual({ kind: 'multiplier', value: 1 });
    expect(showdown.view().bestMultiplier).toBe(2);
  });

  it('never takes the multiplier past its cap', () => {
    const { showdown } = make();
    const hot = () => tick({ damageTaken: 5, engagedEnemies: 1 });
    for (let t = 0; t < SHOWDOWN_RULES.heatSeconds * 10; t += DT) showdown.update(hot());
    expect(showdown.view().multiplier).toBe(SHOWDOWN_RULES.maxMultiplier);
    expect(showdown.view().heat).toBe(0);
  });

  it('survives two deaths with the multiplier reset, and is lost on the third', () => {
    const { showdown } = make();
    runUntil(showdown, 'multiplier', () => tick({ damageTaken: 5, engagedEnemies: 1 }));
    expect(showdown.playerFell()).toBe('redeploy');
    expect(showdown.view()).toMatchObject({ multiplier: 1, redeploysLeft: 1, stage: 'act' });
    expect(showdown.playerFell()).toBe('redeploy');
    expect(showdown.playerFell()).toBe('lost');
    expect(showdown.stage).toBe('lost');
    expect(showdown.update(tick({ kills: 3 }))).toEqual([]);
    expect(showdown.view().kills).toBe(0);
  });

  it('grades a clean hot win S, a win with a redeploy left A, a scraped win B, and a loss by how far it got', () => {
    const win = (falls: number, hot: boolean): ShowdownState => {
      const { showdown } = make();
      if (hot) for (let t = 0; t < SHOWDOWN_RULES.heatSeconds * 4; t += DT) showdown.update(tick({ damageTaken: 1, engagedEnemies: 1 }));
      for (let i = 0; i < falls; i++) showdown.playerFell();
      // A hit during each build-up brings its peak; nothing after it, so the fade can end.
      for (let t = 0; showdown.stage !== 'finale'; t += DT) {
        if (t > 2000) throw new Error(`no finale (stage ${showdown.stage}, act ${showdown.act})`);
        showdown.update(tick({ damageTaken: showdown.view().phase === 'buildUp' ? 60 : 0 }));
      }
      showdown.confirmFinalePlaced();
      showdown.update(tick({ aliveEnemies: 0 }));
      expect(showdown.stage).toBe('won');
      return showdown;
    };
    expect(win(0, true).grade()).toBe('S');
    expect(win(1, true).grade()).toBe('A');
    expect(win(2, false).grade()).toBe('B');

    const { showdown } = make();
    for (let i = 0; i < 3; i++) showdown.playerFell();
    expect(showdown.grade()).toBe('C');
  });
});
