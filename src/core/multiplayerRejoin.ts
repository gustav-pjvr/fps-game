const STORAGE_KEY_PREFIX = 'fps-game-rejoin-';

/** A guest generates this once per room code and persists it in sessionStorage, sending it on
 * every `hello` for that room from then on (including a reconnect after a mid-match drop) - lets
 * the host recognize "this is the same player rejoining" and hand back their old slot/score
 * instead of treating them as a brand new player (see HostRoster.ts's grace-period reservation).
 * sessionStorage (not localStorage) is deliberate: a rejoin token should only survive within the
 * same tab's session, not silently carry over to an unrelated future visit. */
export function getOrCreateRejoinToken(roomCode: string): string {
  const key = STORAGE_KEY_PREFIX + roomCode;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const token = crypto.randomUUID();
    sessionStorage.setItem(key, token);
    return token;
  } catch {
    // sessionStorage can throw in restrictive contexts (private browsing, sandboxed iframe) - a
    // fresh token every call just means rejoin won't work this session, not a hard failure; the
    // rest of the join flow works fine with a token that happens to never match anything.
    return crypto.randomUUID();
  }
}
