import { DEFAULT_KEY_BINDINGS, type Action } from '../input/actions.ts';

const STORAGE_KEY = 'fps-game-settings-v1';

interface StoredSettings {
  masterVolume: number;
  mouseSensitivity: number;
  keyBindings: Record<string, Action>;
}

function defaults(): StoredSettings {
  return { masterVolume: 0.5, mouseSensitivity: 1, keyBindings: { ...DEFAULT_KEY_BINDINGS } };
}

function loadFromStorage(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();

    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    const base = defaults();
    return {
      masterVolume: typeof parsed.masterVolume === 'number' ? parsed.masterVolume : base.masterVolume,
      mouseSensitivity: typeof parsed.mouseSensitivity === 'number' ? parsed.mouseSensitivity : base.mouseSensitivity,
      keyBindings:
        parsed.keyBindings && typeof parsed.keyBindings === 'object'
          ? { ...base.keyBindings, ...parsed.keyBindings }
          : base.keyBindings,
    };
  } catch {
    return defaults();
  }
}

let state = loadFromStorage();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private browsing etc.) - settings just won't survive a reload.
  }
}

/** Persisted (localStorage) user settings: volume, mouse sensitivity, key bindings. Module-level
 * singleton, not a class - there's exactly one settings state for the whole app. */
export const Settings = {
  getMasterVolume(): number {
    return state.masterVolume;
  },
  setMasterVolume(value: number): void {
    state.masterVolume = Math.max(0, Math.min(1, value));
    persist();
  },

  getMouseSensitivity(): number {
    return state.mouseSensitivity;
  },
  setMouseSensitivity(value: number): void {
    state.mouseSensitivity = Math.max(0.1, Math.min(3, value));
    persist();
  },

  /** Returns a copy - handing out the internal object would let a caller's mutation silently
   * persist wrong bindings on the next persist(). All rebinding goes through rebindKey. */
  getKeyBindings(): Record<string, Action> {
    return { ...state.keyBindings };
  },
  /** Clears any existing binding for this action and any existing binding on the new key, then binds them. */
  rebindKey(action: Action, newCode: string): void {
    const next: Record<string, Action> = {};
    for (const [code, boundAction] of Object.entries(state.keyBindings)) {
      if (boundAction !== action && code !== newCode) next[code] = boundAction;
    }
    next[newCode] = action;
    state.keyBindings = next;
    persist();
  },
  resetKeyBindings(): void {
    state.keyBindings = { ...DEFAULT_KEY_BINDINGS };
    persist();
  },
};
