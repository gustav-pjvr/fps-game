import { inspect } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wrap timingSafeEqual so the tests can prove every check goes through it.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const crypto = await import('node:crypto');
const { AccessCodes, parseAccessCodes } = await import('./access.ts');
const timingSafeEqual = vi.mocked(crypto.timingSafeEqual);

describe('AccessCodes', () => {
  beforeEach(() => {
    timingSafeEqual.mockClear();
  });

  it('accepts a configured code and refuses anything else', () => {
    const access = new AccessCodes(['goose-party', 'second-code']);
    expect(access.check('goose-party')).toBe(true);
    expect(access.check('second-code')).toBe(true);
    expect(access.check('goose-part')).toBe(false);
    expect(access.check('GOOSE-PARTY')).toBe(false);
    expect(access.check('goose-party ')).toBe(false);
    expect(access.check('')).toBe(false);
    for (const junk of [undefined, null, 42, {}, ['goose-party']]) expect(access.check(junk)).toBe(false);
  });

  it('compares SHA-256 digests with timingSafeEqual against every code, without stopping at a match', () => {
    const access = new AccessCodes(['first', 'second', 'third']);
    expect(access.check('first')).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledTimes(3);
    for (const [a, b] of timingSafeEqual.mock.calls) {
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    }
    timingSafeEqual.mockClear();
    expect(access.check('nope')).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(3);
    timingSafeEqual.mockClear();
    expect(access.check(17)).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(3);
  });

  it('never holds or shows the code in readable form', () => {
    const access = new AccessCodes(['very-secret-code']);
    for (const shown of [JSON.stringify(access), String(access), inspect(access, { showHidden: true, depth: 5 }), JSON.stringify(Object.entries(access))]) {
      expect(shown).not.toContain('very-secret-code');
    }
    expect(access.count).toBe(1);
  });

  it('refuses to start with no code', () => {
    expect(() => new AccessCodes([])).toThrow();
    expect(() => new AccessCodes(['ok', ''])).toThrow();
  });
});

describe('parseAccessCodes', () => {
  it('splits on commas, trims and drops empty entries', () => {
    expect(parseAccessCodes(' alpha , beta,,gamma ,')).toEqual(['alpha', 'beta', 'gamma']);
    expect(parseAccessCodes('')).toEqual([]);
    expect(parseAccessCodes(undefined)).toEqual([]);
  });
});
