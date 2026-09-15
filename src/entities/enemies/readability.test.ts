import { describe, expect, it } from 'vitest';
import { GlintTelegraph, StaggerState } from './readability.ts';

const LEAD = 0.5;

describe('GlintTelegraph', () => {
  it('glints once before the first shot of a burst and holds that shot for the lead time', () => {
    const glint = new GlintTelegraph();
    // Cooldown still long: too early to glint.
    expect(glint.beforeFiring(true, 0, 2, LEAD)).toEqual({ showGlint: false, holdCooldown: 0 });
    // Inside the lead window: glint now, and hold the shot for the full lead.
    expect(glint.beforeFiring(true, 0, 0.25, LEAD)).toEqual({ showGlint: true, holdCooldown: LEAD });
    // Same burst, still waiting: no second glint.
    expect(glint.beforeFiring(true, 0, 0.25, LEAD)).toEqual({ showGlint: false, holdCooldown: 0 });
  });

  it('does not glint mid-burst, and glints again once the burst has ended', () => {
    const glint = new GlintTelegraph();
    expect(glint.beforeFiring(true, 0, 0, LEAD).showGlint).toBe(true);
    expect(glint.beforeFiring(true, 1, 0, LEAD).showGlint).toBe(false);
    expect(glint.beforeFiring(true, 2, 0, LEAD).showGlint).toBe(false);
    // The pause before the next burst, without the end being reported: still no glint.
    expect(glint.beforeFiring(true, 0, 0.25, LEAD).showGlint).toBe(false);
    glint.onBurstEnded();
    expect(glint.beforeFiring(true, 0, 0.25, LEAD).showGlint).toBe(true);
  });

  it('glints before every shot of one-shot bursts, the Ridge Walker case', () => {
    // A one-shot burst's counter is 0 before every shot: only the reported end can re-arm it.
    const glint = new GlintTelegraph();
    for (let shot = 0; shot < 3; shot++) {
      expect(glint.beforeFiring(true, 0, 0.25, LEAD).showGlint).toBe(true);
      glint.onBurstEnded();
    }
  });

  it('never glints or holds a shot that is not a telegraphed long shot', () => {
    const glint = new GlintTelegraph();
    expect(glint.beforeFiring(false, 0, 0, LEAD)).toEqual({ showGlint: false, holdCooldown: 0 });
  });

  it('starts fresh after a reset', () => {
    const glint = new GlintTelegraph();
    expect(glint.beforeFiring(true, 0, 0, LEAD).showGlint).toBe(true);
    glint.reset();
    expect(glint.beforeFiring(true, 0, 0, LEAD).showGlint).toBe(true);
  });
});

describe('StaggerState', () => {
  it('is set off only by a hit at or above the threshold', () => {
    const stagger = new StaggerState(25, 0.5);
    expect(stagger.onHit(24)).toBe(false);
    expect(stagger.active).toBe(false);
    expect(stagger.onHit(25)).toBe(true);
    expect(stagger.active).toBe(true);
  });

  it('lasts its duration, with the lurch full at the hit and easing to nothing', () => {
    const stagger = new StaggerState(25, 0.5);
    stagger.onHit(40);
    expect(stagger.lurch).toBeCloseTo(1);
    stagger.update(0.25);
    expect(stagger.lurch).toBeGreaterThan(0);
    expect(stagger.lurch).toBeLessThan(1);
    stagger.update(0.25);
    expect(stagger.active).toBe(false);
    expect(stagger.lurch).toBe(0);
  });

  it('is not extended by a light hit, and is restarted by a heavy one', () => {
    const stagger = new StaggerState(25, 0.5);
    stagger.onHit(30);
    stagger.update(0.4);
    stagger.onHit(10);
    stagger.update(0.1);
    expect(stagger.active).toBe(false);

    stagger.onHit(30);
    stagger.update(0.4);
    stagger.onHit(30);
    stagger.update(0.4);
    expect(stagger.active).toBe(true);
  });
});
