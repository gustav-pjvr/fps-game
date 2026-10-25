import { describe, expect, it } from 'vitest';
import { FacilityObjectState, interactPrompt, parseWorldObjectWire } from './facilityObjectState.ts';

describe('Facility object state', () => {
  it('toggles, sets idempotently, round trips the wire and resets to match defaults', () => {
    const state = new FacilityObjectState([true, false, true], 2);
    expect(state.doorCount).toBe(3); expect(state.breakers).toBe(2);
    expect(state.encode()).toEqual({ doors: '101', breakers: '11' });
    expect(state.toggle('door', 0)).toBe(false);
    expect(state.set('door', 1, true)).toBe(true);
    expect(state.set('door', 1, true)).toBe(false);
    expect(state.toggle('breaker', 1)).toBe(false);
    const wire = parseWorldObjectWire(JSON.parse(JSON.stringify(state.encode())), 3, 2)!;
    expect(wire).toEqual({ doors: '011', breakers: '10' });
    const mirror = new FacilityObjectState([true, false, true], 2);
    expect(mirror.apply(wire)).toEqual({ doors: [0, 1], breakers: [1] });
    expect(mirror.encode()).toEqual(state.encode());
    expect(mirror.apply(wire)).toEqual({ doors: [], breakers: [] });
    expect(mirror.reset()).toEqual({ doors: [0, 1], breakers: [1] });
    expect(mirror.encode()).toEqual({ doors: '101', breakers: '11' });
    expect(mirror.reset()).toEqual({ doors: [], breakers: [] });
  });

  it('rejects unknown ids without mutating state and gives prompts for both states', () => {
    const state = new FacilityObjectState([false], 1), before = state.encode();
    for (const kind of ['door', 'breaker'] as const) for (const id of [-1, 1, 0.5, NaN, Infinity]) {
      expect(state.has(kind, id)).toBe(false); expect(state.isActive(kind, id)).toBe(false);
      expect(state.set(kind, id, true)).toBe(false); expect(state.toggle(kind, id)).toBeNull();
    }
    expect(state.encode()).toEqual(before);
    expect(interactPrompt('door', false)).toBe('Open door'); expect(interactPrompt('door', true)).toBe('Close door');
    expect(interactPrompt('breaker', false)).toBe('Power on'); expect(interactPrompt('breaker', true)).toBe('Power off');
  });

  it('accepts empty layouts and rejects malformed or mismatched wire state whole', () => {
    expect(parseWorldObjectWire({ doors: '', breakers: '' }, 0, 0)).toEqual({ doors: '', breakers: '' });
    for (const value of [null, undefined, true, '01', [], {}, { doors: '01' },
      { doors: 1, breakers: '1' }, { doors: '01', breakers: [1] },
      { doors: '0', breakers: '1' }, { doors: '010', breakers: '1' },
      { doors: '01', breakers: '' }, { doors: '01', breakers: '11' },
      { doors: '02', breakers: '1' }, { doors: '01', breakers: 'x' }, { doors: '0\n', breakers: '1' }]) {
      expect(parseWorldObjectWire(value, 2, 1)).toBeNull();
    }
  });
});
