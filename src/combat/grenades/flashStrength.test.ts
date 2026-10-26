import { describe, expect, it } from 'vitest';
import { FlashBlindness, flashDistanceFactor, flashFacingFactor, flashSeconds, flashStrength } from './flashStrength.ts';
import { FLASH_FADE_SECONDS, FLASH_PLAYER_MAX_SECONDS } from './grenadeTuning.ts';

describe('flash distance factor', () => {
  it('is 1 within 5 m, 0 from 22 m, linear between', () => {
    expect(flashDistanceFactor(0)).toBe(1);
    expect(flashDistanceFactor(5)).toBe(1);
    expect(flashDistanceFactor(13.5)).toBeCloseTo(0.5);
    expect(flashDistanceFactor(22)).toBe(0);
    expect(flashDistanceFactor(40)).toBe(0);
  });
});

describe('flash facing factor', () => {
  it('is 1 looking at it, 0.45 at 90 degrees and 0.15 straight behind', () => {
    expect(flashFacingFactor(1)).toBeCloseTo(1);
    expect(flashFacingFactor(0)).toBeCloseTo(0.45);
    expect(flashFacingFactor(-1)).toBeCloseTo(0.15);
  });

  it('falls steadily as the flash moves round from ahead to behind', () => {
    let last = Infinity;
    for (let degrees = 0; degrees <= 180; degrees += 15) {
      const factor = flashFacingFactor(Math.cos((degrees * Math.PI) / 180));
      expect(factor).toBeLessThan(last);
      last = factor;
    }
  });
});

describe('flash strength', () => {
  it('is distance times facing, and nothing without a line of sight', () => {
    expect(flashStrength(3, 1, true)).toBeCloseTo(1);
    expect(flashStrength(13.5, 0, true)).toBeCloseTo(0.5 * 0.45);
    expect(flashStrength(3, 1, false)).toBe(0);
  });

  it('a flash right behind the player at close range stays just above the threshold', () => {
    const strength = flashStrength(2, -1, true);
    expect(strength).toBeCloseTo(0.15);
    expect(flashSeconds(strength, FLASH_PLAYER_MAX_SECONDS)).toBeCloseTo(0.525);
  });

  it('a flash too weak to matter lasts no time at all', () => {
    expect(flashSeconds(0.1, FLASH_PLAYER_MAX_SECONDS)).toBe(0);
    expect(flashSeconds(1, FLASH_PLAYER_MAX_SECONDS)).toBeCloseTo(3.5);
    expect(flashSeconds(1, 4)).toBe(4);
  });
});

describe('FlashBlindness', () => {
  it('holds the strength for the scaled time, then clears', () => {
    const blind = new FlashBlindness();
    expect(blind.apply(0.8, FLASH_PLAYER_MAX_SECONDS)).toBeCloseTo(2.8);
    expect(blind.level).toBeCloseTo(0.8);
    blind.update(2.7);
    expect(blind.level).toBeCloseTo(0.8);
    blind.update(0.1 + (FLASH_FADE_SECONDS * 0.8) / 2);
    expect(blind.level).toBeCloseTo(0.4);
    blind.update(10);
    expect(blind.level).toBe(0);
  });

  it('ignores a flash too weak to matter', () => {
    const blind = new FlashBlindness();
    expect(blind.apply(0.05, FLASH_PLAYER_MAX_SECONDS)).toBe(0);
    expect(blind.level).toBe(0);
  });

  it('a second, weaker flash does not cut a strong white-out short', () => {
    const blind = new FlashBlindness();
    blind.apply(1, FLASH_PLAYER_MAX_SECONDS);
    blind.update(1);
    blind.apply(0.3, FLASH_PLAYER_MAX_SECONDS);
    expect(blind.level).toBeCloseTo(1);
    expect(blind.holdRemaining).toBeCloseTo(2.5);
    blind.reset();
    expect(blind.level).toBe(0);
  });
});
