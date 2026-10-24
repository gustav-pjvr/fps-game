import { describe, expect, it } from 'vitest';
import { acceptsSnapshot, afterStateEvent, createSendClock, SENDER_RESTART_GAP_MS } from './stateOrder.ts';

describe('acceptsSnapshot', () => {
  it('accepts newer snapshots and drops late ones', () => {
    expect(acceptsSnapshot(1000, 1033)).toBe(true);
    expect(acceptsSnapshot(1033, 1000)).toBe(false);
    expect(acceptsSnapshot(1033, 1033)).toBe(false);
  });

  it('drops a snapshot sent before a death or respawn that arrives after it', () => {
    let last = 5000; // last snapshot
    last = afterStateEvent(last, 5020)!; // died at 5020
    expect(acceptsSnapshot(last, 5010)).toBe(false); // sent before death, arrived after
    expect(acceptsSnapshot(last, 9000)).toBe(true); // after respawn
  });

  it('accepts everything from a sender with no clock, or before the first clocked state', () => {
    expect(acceptsSnapshot(5000, undefined)).toBe(true);
    expect(acceptsSnapshot(undefined, 10)).toBe(true);
  });

  it('treats a clock far behind the last as a reloaded page, not a late packet', () => {
    expect(acceptsSnapshot(60_000, 60_000 - SENDER_RESTART_GAP_MS - 1)).toBe(true);
    expect(afterStateEvent(60_000, 200)).toBe(200);
  });

  it('a death or respawn never lowers the floor and ignores a missing clock', () => {
    expect(afterStateEvent(5000, 4000)).toBe(5000);
    expect(afterStateEvent(5000, undefined)).toBe(5000);
    expect(afterStateEvent(undefined, 7)).toBe(7);
  });
});

describe('createSendClock', () => {
  it('never repeats or goes backwards, even on a coarse clock', () => {
    let now = 1000;
    const clock = createSendClock(() => now);
    const a = clock();
    const b = clock(); // same coarse reading
    now = 900; // a clock that steps back must not either
    const c = clock();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(acceptsSnapshot(a, b)).toBe(true);
  });
});
