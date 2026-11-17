import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REJOIN_WINDOW_MS, clearLastRoom, offersRejoin, recentRoom, rememberLastRoom, resolveJoinOptions } from './multiplayerRejoin.ts';

let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('remembered room store', () => {
  it('uses the host reservation length as its window', () => {
    expect(REJOIN_WINDOW_MS).toBe(90_000);
  });

  it('stores and reads back the code inside the window', () => {
    rememberLastRoom('ABCDEF', 1_000);
    expect(recentRoom(1_000)).toEqual({ code: 'ABCDEF', endedAt: 1_000 });
    expect(recentRoom(1_000 + REJOIN_WINDOW_MS - 1)?.code).toBe('ABCDEF');
  });

  it('expires at exactly 90 seconds', () => {
    rememberLastRoom('ABCDEF', 1_000);
    expect(recentRoom(1_000 + REJOIN_WINDOW_MS)).toBeNull();
    expect(recentRoom(1_000 + REJOIN_WINDOW_MS + 5_000)).toBeNull();
  });

  it('returns null when nothing is stored, after clearing, and for malformed or future entries', () => {
    expect(recentRoom(0)).toBeNull();
    rememberLastRoom('ABCDEF', 1_000);
    clearLastRoom();
    expect(recentRoom(1_000)).toBeNull();
    stored.set('fps-game-rejoin-last-room', 'not json');
    expect(recentRoom(1_000)).toBeNull();
    stored.set('fps-game-rejoin-last-room', JSON.stringify({ code: '', endedAt: 1 }));
    expect(recentRoom(2)).toBeNull();
    rememberLastRoom('ABCDEF', 5_000);
    expect(recentRoom(1_000)).toBeNull();
  });

  it('never throws when storage throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    expect(() => rememberLastRoom('ABCDEF', 1)).not.toThrow();
    expect(() => clearLastRoom()).not.toThrow();
    expect(recentRoom(1)).toBeNull();
  });

  it('shows the Multiplayer menu Rejoin button only inside the window (the menu shows it when recentRoom is non-null)', () => {
    rememberLastRoom('QWERTY', 10_000);
    expect(recentRoom(10_000 + 30_000)?.code).toBe('QWERTY');
    expect(recentRoom(10_000 + 91_000)).toBeNull();
  });
});

describe('offersRejoin', () => {
  it('offers it to a guest after either disconnect reason', () => {
    expect(offersRejoin('opponentDisconnected', 'guest')).toBe(true);
    expect(offersRejoin('serverLost', 'guest')).toBe(true);
  });

  it('never offers it to the host', () => {
    expect(offersRejoin('opponentDisconnected', 'host')).toBe(false);
    expect(offersRejoin('serverLost', 'host')).toBe(false);
  });

  it('never offers it after a normal match end', () => {
    for (const reason of ['killLimit', 'hordeCleared', 'hordeWipe']) expect(offersRejoin(reason, 'guest')).toBe(false);
  });
});

describe('resolveJoinOptions (Join Room prefill and auto-join)', () => {
  it('prefills a normalized code and auto-joins when asked', () => {
    expect(resolveJoinOptions({ prefillCode: ' abcdef ', autoJoin: true })).toEqual({ code: 'ABCDEF', autoJoin: true });
  });

  it('only prefills without autoJoin', () => {
    expect(resolveJoinOptions({ prefillCode: 'ABCDEF' })).toEqual({ code: 'ABCDEF', autoJoin: false });
  });

  it('does not auto-join without a code, and the plain open is unchanged', () => {
    expect(resolveJoinOptions({ autoJoin: true })).toEqual({ code: '', autoJoin: false });
    expect(resolveJoinOptions()).toEqual({ code: '', autoJoin: false });
  });
});
