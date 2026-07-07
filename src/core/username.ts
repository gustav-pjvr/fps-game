const STORAGE_KEY = 'fps-game-username';
const MAX_USERNAME_LENGTH = 16;

function randomDefaultUsername(): string {
  return `Player${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Whatever the player last typed into a room screen's username field, so returning to create/join
 * a room again doesn't require retyping it every time - falls back to a fresh random default (not
 * a fixed one) if nothing's stored yet, so two players who both skip the field don't show up as
 * identically-named in each other's player list. */
export function loadStoredUsername(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim().length > 0) return stored;
  } catch {
    // localStorage can throw in restrictive contexts (private browsing, sandboxed iframe) - a
    // fresh default is a fine fallback, this is a convenience, not a required feature.
  }
  return randomDefaultUsername();
}

export function saveUsername(username: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, username);
  } catch {
    // Same as above - persistence is a nice-to-have, not required for the current session.
  }
}

/** Applied right before a username crosses the network (see protocol.ts's HelloMessage) - trims
 * whitespace, caps length, and never sends an empty string (an opponent's name blanking out mid-UI
 * would be a worse experience than falling back to a generated one). */
export function normalizeUsername(rawInput: string): string {
  const trimmed = rawInput.trim().slice(0, MAX_USERNAME_LENGTH);
  return trimmed.length > 0 ? trimmed : randomDefaultUsername();
}
