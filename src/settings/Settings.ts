import { DEFAULT_KEY_BINDINGS, REBINDABLE_ACTIONS, type Action } from '../input/actions.ts';
import { isGraphicsQuality, type GraphicsQuality } from './graphicsQuality.ts';
import { CAMERA_FOV, CAMERA_FOV_MAX, CAMERA_FOV_MIN } from '../core/config.ts';

const STORAGE_KEY = 'fps-game-settings-v1';

interface StoredSettings {
  masterVolume: number;
  musicVolume: number;
  mouseSensitivity: number;
  keyBindings: Record<string, Action>;
  graphicsQuality: GraphicsQuality;
  fov: number;
}

function defaults(): StoredSettings {
  return {
    masterVolume: 0.5,
    musicVolume: 0.6,
    mouseSensitivity: 1,
    keyBindings: { ...DEFAULT_KEY_BINDINGS },
    // Matches what this project's own e2e suite is verified against - see the comment on
    // GRAPHICS_QUALITY_PRESETS in graphicsQuality.ts for why Medium, not High, is the safe default.
    graphicsQuality: 'medium',
    fov: CAMERA_FOV,
  };
}

/** The player's stored bindings, then every default binding whose action has no key yet (a
 * binding added since they saved, such as KeyF for the torch) on its default key, but only while
 * that key is free: a player's own binding is never taken away, and an action they moved to another
 * key is not bound twice. Rebindable actions first, so they get their key ahead of fixed ones. A
 * player who had put another action on KeyF keeps it, and binds the torch in Settings. */
export function mergeKeyBindings(stored: Record<string, Action>): Record<string, Action> {
  const merged: Record<string, Action> = { ...stored };
  const bound = new Set(Object.values(merged));
  const defaults = Object.entries(DEFAULT_KEY_BINDINGS);
  const order = [...REBINDABLE_ACTIONS, ...defaults.map(([, action]) => action)];
  for (const action of order) {
    if (bound.has(action)) continue;
    for (const [code, defaultAction] of defaults) {
      if (defaultAction === action && !(code in merged)) {
        merged[code] = action;
        bound.add(action);
        break;
      }
    }
  }
  return merged;
}

function loadFromStorage(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();

    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    const base = defaults();
    return {
      masterVolume: typeof parsed.masterVolume === 'number' ? parsed.masterVolume : base.masterVolume,
      musicVolume: typeof parsed.musicVolume === 'number' ? Math.max(0, Math.min(1, parsed.musicVolume)) : base.musicVolume,
      mouseSensitivity: typeof parsed.mouseSensitivity === 'number' ? parsed.mouseSensitivity : base.mouseSensitivity,
      keyBindings:
        parsed.keyBindings && typeof parsed.keyBindings === 'object'
          ? mergeKeyBindings(parsed.keyBindings)
          : base.keyBindings,
      graphicsQuality: isGraphicsQuality(parsed.graphicsQuality) ? parsed.graphicsQuality : base.graphicsQuality,
      fov: typeof parsed.fov === 'number' ? Math.max(CAMERA_FOV_MIN, Math.min(CAMERA_FOV_MAX, parsed.fov)) : base.fov,
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

  /** The combat music's level (docs/visual-overhaul.md, phase 6), under the master volume. Read
   * live by SoundEngine every tick, so a change applies at once in a running match. */
  getMusicVolume(): number {
    return state.musicVolume;
  },
  setMusicVolume(value: number): void {
    state.musicVolume = Math.max(0, Math.min(1, value));
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

  /** Read live every frame by WeaponManager.updateAim (the same "no explicit push, just re-read
   * Settings continuously" pattern getMouseSensitivity/getKeyBindings already use elsewhere) so a
   * change here takes effect the moment simulation next runs, no separate live-apply plumbing
   * needed for the per-frame camera.fov assignment itself. SettingsPanel additionally applies it
   * directly to the live camera on change (see onFovChange) purely for instant visual feedback
   * while the settings panel itself is open (gameplay - and therefore WeaponManager.update - is
   * frozen behind it, same as every other pause-menu overlay). */
  getFov(): number {
    return state.fov;
  },
  setFov(value: number): void {
    state.fov = Math.max(CAMERA_FOV_MIN, Math.min(CAMERA_FOV_MAX, value));
    persist();
  },
};
