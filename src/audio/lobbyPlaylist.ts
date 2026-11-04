/**
 * Which lobby track plays next (docs/music.md). Not a plain shuffle: a track that has not been
 * heard yet always comes before one that has. Once every track has had its turn the round starts
 * over, and the track that just finished is left out of the first pick so it never plays twice in
 * a row. The state survives a reload, so a new visit starts with whatever was not heard last time.
 */

export const LOBBY_TRACK_IDS = [
  'calm-rock',
  'strange',
  'space-debris',
  'boundless-slumber',
  'star-rock',
  'a-fools-affair',
  'diving-into-spring',
] as const;

export interface PlaylistState {
  /** Tracks heard in the current round, oldest first. */
  readonly played: readonly string[];
  /** The track that played most recently, or null before the first. */
  readonly last: string | null;
}

export const EMPTY_PLAYLIST: PlaylistState = { played: [], last: null };

/** The next track: a random one of those not yet heard this round; with none left, a random one of
 * all tracks except the last. `random` returns [0, 1). */
export function pickNextTrack(ids: readonly string[], state: PlaylistState, random: () => number): string {
  if (ids.length === 0) throw new Error('No lobby tracks to pick from');
  const unheard = ids.filter((id) => !state.played.includes(id));
  let pool: readonly string[] = unheard.length > 0 ? unheard : ids.filter((id) => id !== state.last);
  if (pool.length === 0) pool = ids;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}

/** The state after `id` counted as heard. A finished round starts a new one with this track in it. */
export function markPlayed(ids: readonly string[], state: PlaylistState, id: string): PlaylistState {
  const round = ids.every((known) => state.played.includes(known)) ? [] : state.played;
  return { played: round.includes(id) ? round : [...round, id], last: id };
}

const STORAGE_KEY = 'hunter-n-goose.lobby-music';

/** Reads the saved state, ignoring anything that is not the expected shape or names an unknown track. */
export function parsePlaylistState(raw: string | null, ids: readonly string[]): PlaylistState {
  if (!raw) return EMPTY_PLAYLIST;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_PLAYLIST;
    const { played, last } = parsed as { played?: unknown; last?: unknown };
    const known = Array.isArray(played) ? played.filter((id): id is string => typeof id === 'string' && ids.includes(id)) : [];
    return {
      played: [...new Set(known)],
      last: typeof last === 'string' && ids.includes(last) ? last : null,
    };
  } catch {
    return EMPTY_PLAYLIST;
  }
}

export function loadPlaylistState(ids: readonly string[]): PlaylistState {
  try {
    return parsePlaylistState(localStorage.getItem(STORAGE_KEY), ids);
  } catch {
    return EMPTY_PLAYLIST;
  }
}

export function savePlaylistState(state: PlaylistState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private browsing etc.): the order just will not carry over a reload.
  }
}
