import { describe, expect, it } from 'vitest';
import { facilityObjectVolume, knifeSwingVolume, lampBreakVolume, multiplayerGunshotVolume } from './positionalAudio.ts';

describe('positional audio falloffs', () => {
  it('plays an opponent knife swing at full volume within 5 m and not at all beyond 15 m', () => {
    expect(knifeSwingVolume(0)).toBe(1);
    expect(knifeSwingVolume(5)).toBe(1);
    expect(knifeSwingVolume(10)).toBeCloseTo(0.5);
    expect(knifeSwingVolume(15)).toBe(0);
    expect(knifeSwingVolume(60)).toBe(0);
  });

  it('fades a lamp break like a gunshot up close and to silence by 40 m', () => {
    expect(lampBreakVolume(10)).toBe(multiplayerGunshotVolume(10));
    expect(lampBreakVolume(25)).toBe(1);
    expect(lampBreakVolume(32.5)).toBeCloseTo(0.5);
    expect(lampBreakVolume(40)).toBe(0);
    expect(lampBreakVolume(200)).toBe(0);
  });

  it('plays a Facility door or breaker at full volume within 8 m and not at all beyond 30 m', () => {
    expect(facilityObjectVolume(2)).toBe(1);
    expect(facilityObjectVolume(19)).toBeCloseTo(0.5);
    expect(facilityObjectVolume(30)).toBe(0);
    expect(facilityObjectVolume(90)).toBe(0);
  });

  it('keeps the gunshot floor so a far shot is never silent', () => {
    expect(multiplayerGunshotVolume(500)).toBeCloseTo(0.15);
  });
});
