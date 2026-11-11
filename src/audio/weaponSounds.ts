/** Every weapon sound is synthesised (SoundEngine): no recorded samples, so nothing in the public
 * repository needs a licence (docs/arsenal.md, "Sounds"). A gunshot is three layers: the crack (a
 * short bright noise burst whose filter closes), the thump (a sine falling in pitch, the weight of
 * the cartridge) and the tail (darker noise rolling off, sent to the valley reverb). Some guns add
 * the clack of their action a moment later. */
export interface GunSound {
  /** [seconds, filter Hz at the start, filter Hz at the end, gain]. */
  readonly crack: readonly [number, number, number, number];
  /** [Hz at the start, Hz at the end, seconds, gain]. */
  readonly thump: readonly [number, number, number, number];
  /** [seconds, filter Hz, gain]. */
  readonly tail: readonly [number, number, number];
  /** The bark, the band of the report that tells one gun from another: [centre Hz, seconds, gain]. */
  readonly bark: readonly [number, number, number];
  /** The action cycling by hand (a pump, a bolt): [seconds after the shot, gain]. */
  readonly action?: readonly [number, number];
}

export const GUN_SOUNDS: Readonly<Record<string, GunSound>> = {
  pistol: { crack: [0.07, 5200, 1400, 0.55], thump: [220, 70, 0.09, 0.5], tail: [0.28, 1500, 0.2], bark: [1500, 0.05, 0.3] },
  mp5: { crack: [0.05, 4800, 1600, 0.45], thump: [200, 80, 0.07, 0.4], tail: [0.2, 1400, 0.16], bark: [1300, 0.04, 0.26] },
  revolver: { crack: [0.1, 4200, 900, 0.75], thump: [150, 45, 0.16, 0.8], tail: [0.5, 1000, 0.32], bark: [900, 0.08, 0.42] },
  machinePistol: { crack: [0.045, 5600, 1800, 0.42], thump: [240, 90, 0.06, 0.35], tail: [0.16, 1600, 0.12], bark: [1750, 0.035, 0.24] },
  sawnOff: { crack: [0.14, 3000, 500, 0.9], thump: [110, 35, 0.22, 0.95], tail: [0.6, 700, 0.4], bark: [600, 0.11, 0.5] },
  rifle: { crack: [0.06, 6000, 1500, 0.5], thump: [180, 60, 0.08, 0.5], tail: [0.32, 1800, 0.22], bark: [1200, 0.05, 0.3] },
  smg: { crack: [0.045, 5200, 1700, 0.42], thump: [210, 85, 0.06, 0.36], tail: [0.18, 1500, 0.14], bark: [1400, 0.04, 0.25] },
  battleRifle: { crack: [0.08, 5000, 1100, 0.65], thump: [140, 48, 0.12, 0.7], tail: [0.45, 1300, 0.3], bark: [850, 0.07, 0.4] },
  lmg: { crack: [0.07, 4600, 1200, 0.55], thump: [150, 52, 0.1, 0.62], tail: [0.36, 1200, 0.26], bark: [780, 0.06, 0.36] },
  dmr: { crack: [0.09, 5600, 1000, 0.7], thump: [130, 42, 0.14, 0.75], tail: [0.6, 1500, 0.34], bark: [1000, 0.07, 0.4] },
  shotgun: { crack: [0.13, 3200, 600, 0.85], thump: [100, 34, 0.2, 0.9], tail: [0.55, 800, 0.38], bark: [540, 0.1, 0.5], action: [0.3, 0.2] },
  sniper: { crack: [0.11, 6000, 800, 0.9], thump: [95, 30, 0.24, 1], tail: [0.95, 1100, 0.45], bark: [700, 0.09, 0.5], action: [0.45, 0.16] },
  gooseLauncher: { crack: [0.1, 1400, 300, 0.6], thump: [90, 40, 0.25, 0.8], tail: [0.3, 500, 0.25], bark: [380, 0.12, 0.4] },
  /** The enemies' rifle (entities/enemies): duller than the player's own. */
  'enemy-rifle': { crack: [0.07, 4200, 1300, 0.5], thump: [170, 60, 0.08, 0.45], tail: [0.3, 1500, 0.22], bark: [1100, 0.05, 0.28] },
};
export const DEFAULT_GUN_SOUND: GunSound = GUN_SOUNDS.rifle!;

/** One sound in a reload: a magazine coming out, one going in, a shell pushed home, the action
 * racked, a latch closing. */
export type ReloadStep = 'out' | 'in' | 'shell' | 'rack' | 'click';

const MAGAZINE_RELOAD: readonly (readonly [number, ReloadStep])[] = [[0.14, 'out'], [0.55, 'in'], [0.86, 'rack']];

/** What a reload sounds like: steps at fractions of the weapon's reload time, matching the moves
 * of its reload clip (weapons/models). A weapon with no entry uses the magazine reload. */
export const RELOAD_SOUNDS: Readonly<Record<string, readonly (readonly [number, ReloadStep])[]>> = {
  pistol: [[0.12, 'out'], [0.52, 'in'], [0.82, 'rack']],
  machinePistol: [[0.12, 'out'], [0.52, 'in'], [0.82, 'rack']],
  revolver: [[0.14, 'click'], [0.3, 'out'], [0.6, 'in'], [0.86, 'click']],
  sawnOff: [[0.1, 'click'], [0.42, 'shell'], [0.58, 'shell'], [0.86, 'click']],
  shotgun: [[0.18, 'shell'], [0.38, 'shell'], [0.58, 'shell'], [0.86, 'rack']],
  lmg: [[0.07, 'click'], [0.24, 'out'], [0.52, 'in'], [0.72, 'click'], [0.9, 'rack']],
};

export function reloadSteps(weaponId: string): readonly (readonly [number, ReloadStep])[] {
  return RELOAD_SOUNDS[weaponId] ?? MAGAZINE_RELOAD;
}

/** A blade through the air: [seconds, filter Hz at the start, filter Hz at the end, gain]. A light
 * blade whips high and short, a heavy one swoops low and long. */
export const BLADE_SWINGS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  knife: [0.18, 3600, 650, 0.28],
  karambit: [0.12, 4600, 1100, 0.24],
  machete: [0.3, 2400, 380, 0.34],
  tanto: [0.16, 4000, 800, 0.27],
  hatchet: [0.34, 1800, 300, 0.36],
  spike: [0.11, 5000, 1400, 0.22],
};
export const DEFAULT_BLADE_SWING = BLADE_SWINGS.knife!;
