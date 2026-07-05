import { DEFAULT_KEY_BINDINGS, type Action } from '../input/actions.ts';
import { isGraphicsQuality, type GraphicsQuality } from './graphicsQuality.ts';

const STORAGE_KEY = 'fps-game-settings-v1';

interface StoredSettings {
  masterVolume: number;
  mouseSensitivity: number;
  keyBindings: Record<string, Action>;
  graphicsQuality: GraphicsQuality;
}

function defaults(): StoredSettings {
  return {
    masterVolume: 0.5,
    mouseSensitivity: 1,
    keyBindings: { ...DEFAULT_KEY_BINDINGS },
    // Matches what this project's own e2e suite is verified against - see the comment on
    // GRAPHICS_QUALITY_PRESETS in graphicsQuality.ts for why Medium, not High, is the safe default.
    graphicsQuality: 'medium',
  };
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
      graphicsQuality: isGraphicsQuality(parsed.graphicsQuality) ? parsed.graphicsQuality : base.graphicsQuality,
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

  /** Read once per match at Game.create() (see Renderer/Game.addLighting), not live-applied to a
   * running match - shadow map resolution is baked into a GPU render target at creation, and
   * hot-swapping it mid-match is real risk (a stale/disposed render target, or a frame where the
   * light and renderer disagree on size) for a setting a player only changes occasionally. A
   * change here takes effect next match, same as most games' graphics settings. */
  getGraphicsQuality(): GraphicsQuality {
    return state.graphicsQuality;
  },
  setGraphicsQuality(value: GraphicsQuality): void {
    state.graphicsQuality = value;
    persist();
  },
};
