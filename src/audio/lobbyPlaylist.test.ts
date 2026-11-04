import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../utils/rng.ts';
import { EMPTY_PLAYLIST, LOBBY_TRACK_IDS, markPlayed, parsePlaylistState, pickNextTrack, type PlaylistState } from './lobbyPlaylist.ts';

const IDS = ['a', 'b', 'c', 'd'];

/** Plays `count` tracks in a row, each counted as heard, and returns them in order. */
function playRun(count: number, seed: number, start: PlaylistState = EMPTY_PLAYLIST): string[] {
  const random = mulberry32(seed);
  const order: string[] = [];
  let state = start;
  for (let i = 0; i < count; i++) {
    const id = pickNextTrack(IDS, state, random);
    order.push(id);
    state = markPlayed(IDS, state, id);
  }
  return order;
}

describe('pickNextTrack', () => {
  it('plays every track once before any repeats', () => {
    for (let seed = 1; seed <= 40; seed++) {
      expect(new Set(playRun(IDS.length, seed)).size).toBe(IDS.length);
    }
  });

  it('only ever offers tracks that have not been heard', () => {
    const state: PlaylistState = { played: ['a', 'b', 'c'], last: 'c' };
    for (let seed = 1; seed <= 20; seed++) expect(pickNextTrack(IDS, state, mulberry32(seed))).toBe('d');
  });

  it('never repeats the track that just finished when a round starts over', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const order = playRun(IDS.length * 3, seed);
      for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    }
  });

  it('plays every track once per round across several rounds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const order = playRun(IDS.length * 3, seed);
      for (let round = 0; round < 3; round++) {
        expect(new Set(order.slice(round * IDS.length, (round + 1) * IDS.length)).size).toBe(IDS.length);
      }
    }
  });

  it('is not always the same order', () => {
    const orders = new Set(Array.from({ length: 20 }, (_, i) => playRun(IDS.length, i + 1).join('')));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('picks the only track there is, even straight after itself', () => {
    expect(pickNextTrack(['solo'], { played: ['solo'], last: 'solo' }, () => 0.5)).toBe('solo');
  });

  it('stays in range for the largest and smallest random values', () => {
    expect(pickNextTrack(IDS, EMPTY_PLAYLIST, () => 0)).toBe('a');
    expect(pickNextTrack(IDS, EMPTY_PLAYLIST, () => 0.999999)).toBe('d');
  });

  it('refuses an empty list', () => {
    expect(() => pickNextTrack([], EMPTY_PLAYLIST, () => 0)).toThrow();
  });
});

describe('markPlayed', () => {
  it('adds the track and remembers it as the last one', () => {
    expect(markPlayed(IDS, EMPTY_PLAYLIST, 'b')).toEqual({ played: ['b'], last: 'b' });
  });

  it('does not list a track twice', () => {
    expect(markPlayed(IDS, { played: ['b'], last: 'b' }, 'b').played).toEqual(['b']);
  });

  it('starts a new round once every track has been heard', () => {
    const full: PlaylistState = { played: [...IDS], last: 'd' };
    expect(markPlayed(IDS, full, 'a')).toEqual({ played: ['a'], last: 'a' });
  });
});

describe('parsePlaylistState', () => {
  it('reads what was saved', () => {
    expect(parsePlaylistState(JSON.stringify({ played: ['a', 'c'], last: 'c' }), IDS)).toEqual({ played: ['a', 'c'], last: 'c' });
  });

  it('falls back to a fresh state for anything unreadable', () => {
    for (const raw of [null, '', 'not json', 'null', '42', '[]', '{"played":"a"}']) {
      expect(parsePlaylistState(raw, IDS).played).toEqual([]);
    }
  });

  it('drops tracks that no longer exist and duplicates', () => {
    const state = parsePlaylistState(JSON.stringify({ played: ['a', 'gone', 'a', 7], last: 'gone' }), IDS);
    expect(state).toEqual({ played: ['a'], last: null });
  });
});

describe('the shipped lobby tracks', () => {
  it('has seven distinct tracks', () => {
    expect(new Set(LOBBY_TRACK_IDS).size).toBe(7);
  });
});
