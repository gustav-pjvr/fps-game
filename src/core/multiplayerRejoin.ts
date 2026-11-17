import { MULTIPLAYER_REJOIN_GRACE_PERIOD_MS } from './config.ts';

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

/** How long after a guest's match ended by disconnect the host still holds that guest's slot (the
 * host's reservation, HostRoster.ts). Rejoin is only offered inside this window; after it the room
 * has forgotten this player, so a rejoin would just be a fresh join into whatever state the room is in. */
export const REJOIN_WINDOW_MS = MULTIPLAYER_REJOIN_GRACE_PERIOD_MS;

const LAST_ROOM_KEY = 'fps-game-rejoin-last-room';

export interface RememberedRoom {
  code: string;
  endedAt: number;
}

/** Rejoin is offered only to a guest whose match ended because the connection to the host dropped.
 * A normal end (kill limit, horde cleared or wiped) has nothing to come back to, and the host is
 * the room, so there is nothing for it to rejoin. */
export function offersRejoin(reason: string, role: string): boolean {
  return role === 'guest' && (reason === 'opponentDisconnected' || reason === 'serverLost');
}

/** Remembers the room a guest just lost, in sessionStorage (same tab-session scope as the rejoin
 * token itself, which is what makes the rejoin recognised by the host). */
export function rememberLastRoom(code: string, now: number = Date.now()): void {
  try {
    sessionStorage.setItem(LAST_ROOM_KEY, JSON.stringify({ code, endedAt: now } satisfies RememberedRoom));
  } catch {
    // Storage unavailable: no Rejoin shortcut this session, the Join screen still works by hand.
  }
}

export function clearLastRoom(): void {
  try {
    sessionStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/** The remembered room, or null when none is stored, it is malformed, or it ended REJOIN_WINDOW_MS
 * or more ago (the host has released the slot by then). */
export function recentRoom(now: number = Date.now()): RememberedRoom | null {
  try {
    const raw = sessionStorage.getItem(LAST_ROOM_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { code, endedAt } = parsed as Partial<RememberedRoom>;
    if (typeof code !== 'string' || code.length === 0 || typeof endedAt !== 'number' || !Number.isFinite(endedAt)) return null;
    const age = now - endedAt;
    if (age < 0 || age >= REJOIN_WINDOW_MS) return null;
    return { code, endedAt };
  } catch {
    return null;
  }
}

/** What the Join Room screen opens with: a code to fill in, and whether to start joining at once. */
export interface JoinRoomOptions {
  prefillCode?: string;
  autoJoin?: boolean;
}

/** Normalizes JoinRoomOptions the way the code field does (trimmed, uppercase, 6 characters).
 * Auto-join needs a code to join with, so it is dropped when none is given. */
export function resolveJoinOptions(options?: JoinRoomOptions): { code: string; autoJoin: boolean } {
  const code = (options?.prefillCode ?? '').trim().toUpperCase().slice(0, 6);
  return { code, autoJoin: code.length > 0 && options?.autoJoin === true };
}
