import type { InspectStyle } from '../animation/clips.ts';

/** A skin is a look family that exists for every weapon (docs/skins.md). It may change colour and
 * material (models/skinMaterials.ts), shape (the features below, read by the weapon kit) and
 * animation (the inspect turn, the light pulse). It never changes how a weapon handles. */
export type SkinId = 'service' | 'ranger' | 'whiteout' | 'ember' | 'gilded' | 'pulse';

/** Shape changes a skin asks of every weapon model. The kit's helpers read them
 * (kit/GunBuilder.ts, kit/sights.ts), so a weapon file places a feature once and each skin decides
 * whether it is drawn. */
export interface SkinFeatures {
  /** Replaces a weapon's own iron sights (scopes and fixed sights are left alone). */
  readonly sight?: 'aperture' | 'reflex';
  /** Swaps a muzzle device for the long ported brake. */
  readonly muzzle?: 'ported';
  /** Cloth and cord wraps on stocks, barrels and handles. */
  readonly wraps?: boolean;
  /** Raised engraved plates. */
  readonly engraving?: boolean;
  /** The golden goose medallion. */
  readonly medallion?: boolean;
  /** Light lines along the body. */
  readonly lightLines?: boolean;
}

export interface SkinDefinition {
  readonly id: SkinId;
  readonly name: string;
  readonly description: string;
  readonly features: SkinFeatures;
  /** The ammo witness light: its colour on a healthy magazine and on the last quarter. */
  readonly glow: { readonly full: number; readonly low: number };
  /** Sight dot colour. */
  readonly sightColor: number;
  readonly inspect: InspectStyle;
  /** The light lines breathe: cycles a second and depth (0 to 1) of the swing. */
  readonly pulse?: { readonly rate: number; readonly depth: number };
}

export const DEFAULT_SKIN: SkinId = 'service';

export const SKINS: Readonly<Record<SkinId, SkinDefinition>> = {
  service: {
    id: 'service',
    name: 'Service',
    description: 'Factory finish: phosphate steel and black polymer, as issued.',
    features: {},
    glow: { full: 0x6ff0dc, low: 0xe8a64a },
    sightColor: 0xff6a3a,
    inspect: 'standard',
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    description: 'Woodland paint, burlap wraps and a peep sight for the long patrol.',
    features: { sight: 'aperture', wraps: true },
    glow: { full: 0xa8d66a, low: 0xe8a64a },
    sightColor: 0xffb347,
    inspect: 'standard',
  },
  whiteout: {
    id: 'whiteout',
    name: 'Whiteout',
    description: 'Splinter snow camouflage over pale ceramic coat, taped for the cold.',
    features: { wraps: true },
    glow: { full: 0x9fd8ff, low: 0xe8a64a },
    sightColor: 0xff5a3c,
    inspect: 'standard',
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    description: 'Burnt bronze over carbon weave, with a ported brake that glows as it works.',
    features: { muzzle: 'ported' },
    glow: { full: 0xff9a3c, low: 0xff4a2a },
    sightColor: 0xffc24a,
    inspect: 'standard',
  },
  gilded: {
    id: 'gilded',
    name: 'Gilded Goose',
    description: 'Presentation grade: gold plate, hand engraving, walnut and the goose medallion.',
    features: { engraving: true, medallion: true },
    glow: { full: 0xffd97a, low: 0xff7a3c },
    sightColor: 0xfff0b0,
    inspect: 'showcase',
  },
  pulse: {
    id: 'pulse',
    name: 'Pulse',
    description: 'Graphite shell with live light lines and a reflex sight in place of the irons.',
    features: { sight: 'reflex', lightLines: true },
    glow: { full: 0xc77dff, low: 0xff4f9a },
    sightColor: 0x7df9ff,
    inspect: 'flick',
    pulse: { rate: 0.7, depth: 0.55 },
  },
};

export const SKIN_IDS: readonly SkinId[] = ['service', 'ranger', 'whiteout', 'ember', 'gilded', 'pulse'];

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && Object.hasOwn(SKINS, value);
}

/** A stored or received skin id made safe: anything unknown falls back to the default. */
export function resolveSkinId(value: unknown): SkinId {
  return isSkinId(value) ? value : DEFAULT_SKIN;
}
