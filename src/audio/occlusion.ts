/**
 * What lies between a sound and the listener, and what that does to it (docs/sound.md, "Buildings
 * matter"). The world reports a path (world/soundProbe.ts casts the rays); these pure rules turn it
 * into a gain and a low-pass cutoff for the sound's voice.
 */
import { OPEN_CUTOFF } from './spatial.ts';

/** What one line from the listener to the source crosses. */
export interface SoundPath {
  /** Solid things crossed (walls, floors, closed doors, rock), capped at MAX_COUNTED_SOLIDS. */
  readonly solids: number;
  /** The ground itself is in the way: a hill, or the surface between the valley and a lab. */
  readonly earth: boolean;
  /** Intact panes of glass crossed. A broken pane is an open window and is not counted. */
  readonly glass: number;
  /** The line is not the straight one: the sound bends round a corner or over an edge to arrive. */
  readonly bent: boolean;
}

export interface Occlusion {
  /** Multiplies the sound's gain. */
  readonly gain: number;
  /** Low-pass cutoff in Hz; the voice takes the lower of this and the air's. */
  readonly cutoff: number;
  /** 0 (clear) to 1 (buried): how much of the sound is the wall's, for the reverb choice. */
  readonly blocked: number;
}

export const CLEAR_PATH: SoundPath = { solids: 0, earth: false, glass: 0, bent: false };
export const CLEAR: Occlusion = { gain: 1, cutoff: OPEN_CUTOFF, blocked: 0 };

export const MAX_COUNTED_SOLIDS = 3;

/** One wall, two walls, three or more: [gain, cutoff Hz]. A wall takes the highs first. */
const WALLS: readonly (readonly [number, number])[] = [
  [1, OPEN_CUTOFF],
  [0.32, 900],
  [0.18, 620],
  [0.1, 430],
];
/** The ground between: heavier than any wall. */
const EARTH: readonly [number, number] = [0.08, 380];
/** One intact pane: a window muffles, less than a wall does. */
const PANE_GAIN = 0.6;
const PANE_CUTOFFS: readonly number[] = [OPEN_CUTOFF, 3600, 2400];
/** A sound that had to bend to arrive loses a little level and its top. */
const BENT: readonly [number, number] = [0.72, 6500];

export function occlusionFor(path: SoundPath): Occlusion {
  const solids = Math.max(0, Math.min(MAX_COUNTED_SOLIDS, Math.floor(path.solids)));
  const panes = Math.max(0, Math.floor(path.glass));
  let [gain, cutoff] = WALLS[solids]!;
  if (path.earth) {
    gain *= EARTH[0];
    cutoff = Math.min(cutoff, EARTH[1]);
  }
  if (panes > 0) {
    gain *= Math.pow(PANE_GAIN, Math.min(panes, 3));
    cutoff = Math.min(cutoff, PANE_CUTOFFS[Math.min(panes, PANE_CUTOFFS.length - 1)]!);
  }
  if (path.bent) {
    gain *= BENT[0];
    cutoff = Math.min(cutoff, BENT[1]);
  }
  const blocked = path.earth || solids > 0 ? 1 : panes > 0 ? 0.4 : path.bent ? 0.2 : 0;
  return { gain, cutoff, blocked };
}

/** The path a sound takes when several are possible: the one that lets most of it through. */
export function loudestPath(paths: readonly SoundPath[]): SoundPath {
  let best = paths[0] ?? CLEAR_PATH;
  let bestGain = occlusionFor(best).gain;
  for (let i = 1; i < paths.length; i++) {
    const gain = occlusionFor(paths[i]!).gain;
    if (gain > bestGain) {
      best = paths[i]!;
      bestGain = gain;
    }
  }
  return best;
}

/** Where the listener stands, for the choice of reverb. */
export type ListenerSpace = 'outdoor' | 'room' | 'hall' | 'underground';
