import { SoundEngine } from '../audio/SoundEngine.ts';
import { SOUND_CATALOG, type CatalogSound } from '../audio/soundCatalog.ts';
import { occlusionFor, type ListenerSpace, type Occlusion, type SoundPath } from '../audio/occlusion.ts';
import type { Vec3Like } from '../audio/spatial.ts';
import { Settings } from '../settings/Settings.ts';

/**
 * The sound test page (soundlab.html, docs/sound.md): every sound in the game with a Play button,
 * heard from wherever the listener chooses (near, far, behind, above, behind a wall, through a
 * window). It runs the game's own SoundEngine with no world: the listener stands at the origin
 * facing -Z, and "behind a wall" is the engine's occlusion with the path forced.
 *
 * It also renders any sound offline through the same engine and measures it (window.__soundLab),
 * which is how scripts/soundRender.mjs checks loudness, direction and dullness without ears.
 */

interface Placement {
  readonly id: string;
  readonly label: string;
  /** What the listener should notice, shown under the choices. */
  readonly hint: string;
  /** Where the sound is; several for a sequence (each `gap` seconds after the last). */
  readonly at: readonly Vec3Like[];
  readonly gap?: number;
  /** What lies between, forced. */
  readonly path?: SoundPath;
}

const ring = (radius: number, count: number): Vec3Like[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: Math.sin(angle) * radius, y: 0, z: -Math.cos(angle) * radius };
  });

export const PLACEMENTS: readonly Placement[] = [
  { id: 'near', label: 'Near', hint: 'Three metres in front of you: full and bright.', at: [{ x: 0, y: 0, z: -3 }] },
  { id: 'left', label: 'Left', hint: 'Six metres to your left.', at: [{ x: -6, y: 0, z: 0 }] },
  { id: 'right', label: 'Right', hint: 'Six metres to your right.', at: [{ x: 6, y: 0, z: 0 }] },
  { id: 'behind', label: 'Behind', hint: 'Eight metres behind you. With 3D audio on (headphones) it should sit behind your head; with it off it is duller than in front.', at: [{ x: 0, y: 0, z: 8 }] },
  { id: 'above', label: 'Above', hint: 'Eight metres over your head (a watch tower). Needs 3D audio and headphones.', at: [{ x: 0, y: 8, z: -1 }] },
  { id: 'below', label: 'Below', hint: 'Six metres under your feet. Needs 3D audio and headphones.', at: [{ x: 0, y: -6, z: -1 }] },
  { id: 'far', label: 'Far', hint: 'A hundred and twenty metres ahead: late, quiet, dull, and mostly its echo. Small sounds are silent this far.', at: [{ x: 0, y: 0, z: -120 }] },
  { id: 'wall', label: 'Behind a wall', hint: 'Eight metres ahead with one wall between: much quieter and muffled.', at: [{ x: 0, y: 0, z: -8 }], path: { solids: 1, earth: false, glass: 0, bent: false } },
  { id: 'walls', label: 'Two walls', hint: 'Eight metres ahead with two walls between: a thud more than a sound.', at: [{ x: 0, y: 0, z: -8 }], path: { solids: 2, earth: false, glass: 0, bent: false } },
  { id: 'glass', label: 'Through a window', hint: 'Eight metres ahead behind an intact pane of glass: muffled, but less than by a wall. A broken window sounds like Near.', at: [{ x: 0, y: 0, z: -8 }], path: { solids: 0, earth: false, glass: 1, bent: false } },
  { id: 'corner', label: 'Round a corner', hint: 'Eight metres ahead, out of sight round a corner: a little quieter and duller.', at: [{ x: 0, y: 0, z: -8 }], path: { solids: 0, earth: false, glass: 0, bent: true } },
  { id: 'ground', label: 'Underground', hint: 'Fifteen metres away with the ground between you (a lab below): barely there.', at: [{ x: 0, y: -12, z: -9 }], path: { solids: 0, earth: true, glass: 0, bent: false } },
  { id: 'circle', label: 'Circle round you', hint: 'Eight plays: ahead, then clockwise round you (right, behind, left). The direction test.', at: ring(6, 8), gap: 0.6 },
  { id: 'approach', label: 'Coming closer', hint: 'Five plays from 100 metres to 4 metres ahead: louder and brighter each time.', at: [100, 55, 28, 12, 4].map((d) => ({ x: 0, y: 0, z: -d })), gap: 0.9 },
];

const SPACES: readonly { readonly id: ListenerSpace; readonly label: string }[] = [
  { id: 'outdoor', label: 'Outdoors' },
  { id: 'room', label: 'In a house' },
  { id: 'hall', label: 'Facility' },
  { id: 'underground', label: 'Underground lab' },
];

let engine: SoundEngine | null = null;
let placement: Placement = PLACEMENTS[0]!;
let space: ListenerSpace = 'outdoor';
const pending: number[] = [];

const status = document.getElementById('status')!;

function ensureEngine(): SoundEngine {
  if (!engine) {
    engine = new SoundEngine(new AudioContext({ latencyHint: 'interactive' }));
    engine.setListenerSpace(space);
  }
  engine.resume();
  return engine;
}

function play(sound: CatalogSound, own: boolean): void {
  const live = ensureEngine();
  for (const timer of pending.splice(0)) window.clearTimeout(timer);
  if (own) {
    live.occlusionOverride = null;
    sound.play(live);
    status.textContent = `${sound.label}: your own`;
    return;
  }
  const occlusion: Occlusion | null = placement.path ? occlusionFor(placement.path) : null;
  placement.at.forEach((at, index) => {
    const fire = (): void => {
      live.occlusionOverride = occlusion;
      sound.play(live, at);
      live.occlusionOverride = null;
    };
    if (index === 0) fire();
    else pending.push(window.setTimeout(fire, index * (placement.gap ?? 0.6) * 1000));
  });
  status.textContent = `${sound.label}: ${placement.label.toLowerCase()}`;
}

// ------------------------------------------------------------------------------------------------
// The page

function radioGroup<T extends { readonly id: string; readonly label: string }>(label: string, items: readonly T[], selected: T, onSelect: (item: T) => void): HTMLElement {
  const control = document.createElement('div');
  control.className = 'control';
  const heading = document.createElement('span');
  heading.className = 'control-label';
  heading.id = `label-${label.replace(/\W+/g, '-').toLowerCase()}`;
  heading.textContent = label;
  const chips = document.createElement('div');
  chips.className = 'chips';
  chips.setAttribute('role', 'radiogroup');
  chips.setAttribute('aria-labelledby', heading.id);
  const buttons = items.map((item) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(item === selected));
    chip.tabIndex = item === selected ? 0 : -1;
    chip.textContent = item.label;
    chip.addEventListener('click', () => select(item));
    return chip;
  });
  const select = (item: T): void => {
    buttons.forEach((chip, index) => {
      const on = items[index] === item;
      chip.setAttribute('aria-checked', String(on));
      chip.tabIndex = on ? 0 : -1;
    });
    onSelect(item);
  };
  // A radio group is one tab stop; the arrow keys move within it.
  chips.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const current = buttons.findIndex((chip) => chip.getAttribute('aria-checked') === 'true');
    const next = (current + step + items.length) % items.length;
    select(items[next]!);
    buttons[next]!.focus();
    buttons[next]!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  chips.append(...buttons);
  control.append(heading, chips);
  return control;
}

function toggle(label: string, initial: boolean, onChange: (value: boolean) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(initial));
  const track = document.createElement('span');
  track.className = 'track';
  track.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = label;
  const state = document.createElement('span');
  state.className = 'state';
  state.setAttribute('aria-hidden', 'true');
  state.textContent = initial ? 'On' : 'Off';
  button.append(track, text, state);
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    state.textContent = next ? 'On' : 'Off';
    onChange(next);
  });
  return button;
}

function buildControls(sticky: HTMLElement, root: HTMLElement): void {
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = placement.hint;
  const where = radioGroup('Where the sound comes from', PLACEMENTS, placement, (item) => {
    placement = item;
    hint.textContent = item.hint;
  });
  where.append(hint);
  const standing = radioGroup('Where you are standing', SPACES, SPACES[0]!, (item) => {
    space = item.id;
    engine?.setListenerSpace(space);
  });

  const options = document.createElement('div');
  options.className = 'control toggles';
  const volume = document.createElement('label');
  volume.className = 'volume';
  const volumeText = document.createElement('span');
  volumeText.textContent = 'Volume';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = String(Settings.getMasterVolume());
  const readout = document.createElement('output');
  const showVolume = (): void => {
    readout.textContent = `${Math.round(Number(slider.value) * 100)}%`;
  };
  showVolume();
  slider.addEventListener('input', () => {
    Settings.setMasterVolume(Number(slider.value));
    engine?.setMasterVolume(Number(slider.value));
    showVolume();
  });
  volume.append(volumeText, slider, readout);
  options.append(
    toggle('3D audio (headphones)', Settings.getSpatialAudio(), (value) => {
      Settings.setSpatialAudio(value);
      engine?.applySettings();
    }),
    toggle('Night mode', Settings.getNightAudio(), (value) => {
      Settings.setNightAudio(value);
      engine?.applySettings();
    }),
    volume,
  );
  sticky.append(where);
  root.append(standing, options);
}

function buildSounds(root: HTMLElement): void {
  const groups = new Map<string, CatalogSound[]>();
  for (const sound of SOUND_CATALOG) groups.set(sound.group, [...(groups.get(sound.group) ?? []), sound]);
  for (const [name, sounds] of groups) {
    const section = document.createElement('section');
    section.className = 'group';
    const heading = document.createElement('h2');
    heading.textContent = name;
    const list = document.createElement('div');
    list.className = 'sounds';
    for (const sound of sounds) {
      const row = document.createElement('div');
      row.className = 'sound';
      const label = document.createElement('span');
      label.className = 'name';
      label.textContent = sound.label;
      const buttons = document.createElement('div');
      buttons.className = 'buttons';
      const button = (text: string, own: boolean, description: string): HTMLButtonElement => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = own ? 'play mine' : 'play';
        element.textContent = text;
        element.setAttribute('aria-label', `${description}: ${sound.label}`);
        element.addEventListener('click', () => play(sound, own));
        return element;
      };
      // Your own copy of a sound has no place: it plays in the middle of your head.
      if (sound.where !== 'world') buttons.append(button(sound.where === 'own' ? 'Play' : 'Mine', true, sound.where === 'own' ? 'Play' : 'Play as your own'));
      if (sound.where !== 'own') buttons.append(button('Play', false, 'Play from the chosen place'));
      row.append(label, buttons);
      list.append(row);
    }
    section.append(heading, list);
    root.append(section);
  }
}

buildControls(document.getElementById('placement')!, document.getElementById('options')!);
buildSounds(document.getElementById('sounds')!);

// ------------------------------------------------------------------------------------------------
// Offline measurement (scripts/soundRender.mjs)

export interface Measured {
  /** Largest absolute sample on either channel. Over 1 would clip. */
  readonly peak: number;
  /** RMS of the left and right channels over the whole render. */
  readonly left: number;
  readonly right: number;
  /** RMS of both channels together, in dB (0 dB = a full-scale square wave). */
  readonly rmsDb: number;
  /** How bright the sound is: the RMS of the sample-to-sample change over the RMS of the signal.
   * Dull sounds score low, hissy ones high. */
  readonly brightness: number;
  /** Seconds until the sound first rises above a whisper. */
  readonly onset: number;
  /** RMS in dB of what is still sounding 0.4 s after the sound began: its ring in the space. */
  readonly tailDb: number;
  /** Milliseconds by which the left ear hears the sound before the right (negative: the right ear
   * first). Low sounds are no louder in the nearer ear, only earlier: this is what places them. */
  readonly leftLeadMs: number;
}

interface RenderOptions {
  readonly spatial?: boolean;
  readonly night?: boolean;
  readonly space?: ListenerSpace;
  /** A place by its id (PLACEMENTS), or 'own'. A sequence renders its first place only. */
  readonly placement?: string;
  /** Overrides the placement's position. */
  readonly at?: Vec3Like;
}

const RENDER_RATE = 48000;

/** Runs `build` with Math.random replaced by a fixed sequence, so two renders of one sound start
 * from the same noise and the same pitch drift and differ only in what is being compared. */
function withFixedRandom<T>(build: () => T): T {
  const real = Math.random;
  let state = 0x2545f491;
  Math.random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  try {
    return build();
  } finally {
    Math.random = real;
  }
}

function renderBuffer(id: string, options: RenderOptions = {}): Promise<AudioBuffer> {
  return withFixedRandom(() => buildRender(id, options));
}

function buildRender(id: string, options: RenderOptions): Promise<AudioBuffer> {
  const sound = SOUND_CATALOG.find((entry) => entry.id === id);
  if (!sound) throw new Error(`No sound ${id}`);
  const chosen = PLACEMENTS.find((entry) => entry.id === options.placement);
  const ctx = new OfflineAudioContext(2, Math.ceil(RENDER_RATE * (sound.seconds + 0.6)), RENDER_RATE);
  const offline = new SoundEngine(ctx);
  // Measured at full volume, so the numbers are the mix itself and not the player's settings.
  offline.setMasterVolume(1);
  offline.applySettings({ effects: 1, spatial: options.spatial ?? true, night: options.night ?? false });
  offline.setListenerSpace(options.space ?? 'outdoor');
  if (options.placement === 'own' || (!chosen && !options.at)) {
    sound.play(offline);
  } else {
    offline.occlusionOverride = chosen?.path ? occlusionFor(chosen.path) : null;
    sound.play(offline, options.at ?? chosen!.at[0]!);
  }
  return ctx.startRendering();
}

function measure(buffer: AudioBuffer): Measured {
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  let peak = 0, sumLeft = 0, sumRight = 0, sumChange = 0, onset = -1;
  for (let i = 0; i < left.length; i++) {
    const l = left[i]!, r = right[i]!;
    const loudest = Math.max(Math.abs(l), Math.abs(r));
    if (loudest > peak) peak = loudest;
    if (onset < 0 && loudest > 0.002) onset = i / buffer.sampleRate;
    sumLeft += l * l;
    sumRight += r * r;
    if (i > 0) {
      const change = (l + r) - (left[i - 1]! + right[i - 1]!);
      sumChange += change * change;
    }
  }
  // The lag (within a head's width, about 0.8 ms) at which the two ears line up best.
  const reach = Math.round(buffer.sampleRate * 0.0009);
  let bestLag = 0, bestMatch = -Infinity;
  const from = Math.max(reach, Math.floor(Math.max(0, onset) * buffer.sampleRate)), to = Math.min(left.length - reach, from + Math.floor(buffer.sampleRate * 0.25));
  for (let lag = -reach; lag <= reach; lag++) {
    let match = 0;
    for (let i = from; i < to; i++) match += left[i]! * right[i + lag]!;
    if (match > bestMatch) {
      bestMatch = match;
      bestLag = lag;
    }
  }
  let sumTail = 0;
  const tailFrom = Math.floor((Math.max(0, onset) + 0.4) * buffer.sampleRate);
  for (let i = tailFrom; i < left.length; i++) sumTail += left[i]! * left[i]! + right[i]! * right[i]!;
  const n = left.length;
  const both = Math.sqrt((sumLeft + sumRight) / (2 * n));
  const mono = Math.sqrt((sumLeft + sumRight) / n) || 1e-12;
  return {
    peak,
    left: Math.sqrt(sumLeft / n),
    right: Math.sqrt(sumRight / n),
    rmsDb: 20 * Math.log10(both || 1e-12),
    brightness: Math.sqrt(sumChange / n) / mono,
    onset: Math.max(0, onset),
    tailDb: 20 * Math.log10(Math.sqrt(sumTail / (2 * Math.max(1, left.length - tailFrom))) || 1e-12),
    leftLeadMs: (bestLag / buffer.sampleRate) * 1000,
  };
}

/** How different two renders of one sound are: the RMS of their sample-by-sample difference over
 * the RMS of the first, per channel then averaged. 0 is identical; over about 0.3 the two are
 * plainly not the same signal. Both start from the same noise (withFixedRandom). */
async function difference(id: string, a: RenderOptions, b: RenderOptions): Promise<number> {
  const first = await renderBuffer(id, a), second = await renderBuffer(id, b);
  let total = 0;
  for (let channel = 0; channel < 2; channel++) {
    const x = first.getChannelData(channel), y = second.getChannelData(channel);
    let sumDifference = 0, sumFirst = 0;
    for (let i = 0; i < x.length; i++) {
      sumDifference += (x[i]! - y[i]!) ** 2;
      sumFirst += x[i]! ** 2;
    }
    total += Math.sqrt(sumDifference / (sumFirst || 1e-12));
  }
  return total / 2;
}

/** 16-bit stereo WAV, base64, for a listening tool or to keep a sound as a file. */
function toWav(buffer: AudioBuffer): string {
  const frames = buffer.length, bytes = new Uint8Array(44 + frames * 4), view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 4, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 4, true);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i]!)) * 32767, true);
    view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i]!)) * 32767, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Several sounds at once, three metres ahead (or the player's own for sounds that have no place):
 * a firefight in one render, to prove the limiter holds the sum under clipping. */
function renderStack(ids: readonly string[], night = false): Promise<AudioBuffer> {
  return withFixedRandom(() => buildStack(ids, night));
}

function buildStack(ids: readonly string[], night: boolean): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, RENDER_RATE * 3, RENDER_RATE);
  const offline = new SoundEngine(ctx);
  offline.setMasterVolume(1);
  offline.applySettings({ effects: 1, spatial: true, night });
  for (const id of ids) {
    const sound = SOUND_CATALOG.find((entry) => entry.id === id);
    if (!sound) throw new Error(`No sound ${id}`);
    sound.play(offline, sound.where === 'world' ? { x: 0, y: 0, z: -3 } : undefined);
  }
  return ctx.startRendering();
}

const lab = {
  stack: async (ids: readonly string[], night?: boolean): Promise<Measured> => measure(await renderStack(ids, night)),
  sounds: SOUND_CATALOG.map(({ id, label, group, where, seconds }) => ({ id, label, group, where, seconds })),
  placements: PLACEMENTS.map(({ id, label }) => ({ id, label })),
  measure: async (id: string, options?: RenderOptions): Promise<Measured> => measure(await renderBuffer(id, options)),
  difference,
  wav: async (id: string, options?: RenderOptions): Promise<string> => toWav(await renderBuffer(id, options)),
};

declare global {
  interface Window {
    __soundLab: typeof lab;
  }
}
window.__soundLab = lab;
