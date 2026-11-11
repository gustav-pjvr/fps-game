import { CAMERA_FOV } from '../core/config.ts';
import type { MeleePoseId } from './meleeSwing.ts';
import { MOA, type GunRecoil, type GunSpread } from './gunHandling.ts';

/** Which loadout slot a weapon fills (ui/menu/LoadoutScreen.ts). 'special' is a mid-match reward
 * (the Goose Launcher): shown for reference, never equipped. A weapon with no category (the empty
 * hands of Goose Toss) never appears on the Loadout page. */
export type WeaponCategory = 'primary' | 'secondary' | 'melee' | 'special';

/** Damage by distance: full to `start` metres, then falling in a straight line to `min` (a
 * fraction of full) at `end` metres and beyond. */
export interface DamageFalloff {
  readonly start: number;
  readonly end: number;
  readonly min: number;
}

/** One way of striking with a blade. */
export interface MeleeAttack {
  /** Damage to each target the strike reaches (once per target, however many rays find it). */
  readonly damage: number;
  /** Reach in metres. */
  readonly range: number;
  /** Rays fanned across the strike, and the half-angle of the fan in radians. */
  readonly rays: number;
  readonly spread: number;
  /** Length of the swing animation in seconds. */
  readonly duration: number;
  /** Seconds into the swing at which the blade connects. */
  readonly hitAt: number;
  /** Seconds from the start of this attack until the next may begin. */
  readonly cooldown: number;
  /** The swing poses, used in turn (weapons/meleeSwing.ts). */
  readonly poses: readonly MeleePoseId[];
  /** Further strikes in the same attack (a flurry): how many more, and the seconds between them. */
  readonly repeats?: number;
  readonly repeatInterval?: number;
}

export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category?: WeaponCategory;
  /** Damage per pellet - for pelletCount 1 this is just "damage per shot". For a blade, its
   * primary attack's damage (the attack table below is what the game uses). */
  readonly damage: number;
  readonly fireRate: number;
  /** Infinity for melee - Weapon.tryFire's plain ammoInMagazine > 0 check never needs
   * special-casing, since Infinity - 1 === Infinity in JS. */
  readonly magazineSize: number;
  readonly reloadTime: number;
  /** The hip-fire cone's half-angle in radians (a blade's fan). For a gun, the same as `spread.hip`. */
  readonly spreadRadians: number;
  /** Upward camera kick per shot, in radians. For a gun, the same as `recoil.kick`. */
  readonly recoilKick: number;
  /** Largest sideways camera kick per shot, in radians. For a gun, the same as `recoil.side`. */
  readonly recoilSide?: number;
  /** A gun's scatter by how it is held and fired, and how its bursts kick (weapons/gunHandling.ts,
   * docs/gun-handling.md). Every hitscan gun has both; the blades, the empty hands and the launcher
   * (which throws a goose, not a round) have neither. */
  readonly spread?: GunSpread;
  readonly recoil?: GunRecoil;
  /** Camera FOV while fully aimed down sights (lower = more zoom). */
  readonly adsFov: number;
  /** Spread while fully aimed, as a fraction of hip-fire spread. For a gun, `spread.aimed / spread.hip`. */
  readonly adsSpreadMultiplier: number;
  /** Full-screen scope overlay at full ADS (sniper-style) vs. a plain FOV zoom (pistol/rifle-style). */
  readonly hasScope: boolean;
  /** Holding fire keeps firing (rate-limited by fireRate) instead of one shot per click. */
  readonly automatic: boolean;
  /** Rays fired per trigger pull, each independently spread within spreadRadians. */
  readonly pelletCount: number;
  /** 'melee' skips ammo/reload UI (see Hud.setAmmo) and strikes through its attack table. */
  readonly kind: 'ranged' | 'melee';
  /** Max hitscan distance - only meaningful for melee; ranged weapons share WeaponManager's
   * HITSCAN_RANGE constant instead. */
  readonly range?: number;
  /** Fires a real ballistic projectile (a ThrownGoose) instead of instant hitscan - see
   * WeaponManager.fireShot's isProjectile branch. Currently only the Goose Launcher reward weapon. */
  readonly isProjectile?: boolean;
  /** `startReload` always fails for this weapon (see Weapon.ts) - once its magazine empties it
   * cannot be refilled, only replaced. Currently only the Goose Launcher, which WeaponManager
   * automatically swaps back out for the player's previous weapon the moment it empties (see
   * grantBonusWeapon). */
  readonly disableReload?: boolean;
  /** A single trigger pull fires this many rounds in rapid succession (see WeaponManager's
   * WEAPON_BURST_SHOT_INTERVAL_SECONDS-paced burst handling) before `fireRate`'s cooldown gates the
   * next pull. Undefined/1 = one round per press/tick. Currently only the S5. */
  readonly burstCount?: number;
  /** Hitscan damage by distance. Absent: full damage at any range (the sniper, the launcher). */
  readonly falloff?: DamageFalloff;
  /** How fast the weapon comes up to the eye (the damp rate of the aim blend; default ADS_LERP_SPEED). */
  readonly adsSpeed?: number;
  /** Walking and sprinting speed while this weapon is held, as a fraction (default 1). */
  readonly mobility?: number;
  /** A blade's two attacks: fire strikes with `primary`, fire while holding aim with `alt`. */
  readonly melee?: { readonly primary: MeleeAttack; readonly alt: MeleeAttack };
}

/** The whole arsenal (docs/arsenal.md): 5 secondaries, 7 primaries, 6 blades, the reward launcher
 * and the empty hands. Names are fictional. Models are in weapons/models, sounds in
 * audio/weaponSounds.ts, both keyed by the same id. */
export const WEAPON_DEFINITIONS: Record<string, WeaponDefinition> = {
  // --- Secondaries -------------------------------------------------------------------------------
  pistol: {
    id: 'pistol',
    name: 'P9 Pistol',
    description: 'Accurate semi-auto sidearm with a fast reload.',
    category: 'secondary',
    damage: 22,
    fireRate: 5,
    magazineSize: 15,
    reloadTime: 1.3,
    spreadRadians: 0.012,
    recoilKick: 0.014,
    recoilSide: 0.004,
    adsFov: 55,
    adsSpreadMultiplier: 0.097,
    // 9 mm in the hand: a light, snappy kick; rapid shots open the group.
    spread: { aimed: 4 * MOA, hip: 0.012, moving: 0.004, bloomPerShot: 0.0015, bloomMax: 0.006 },
    recoil: { kick: 0.014, side: 0.004, climbShots: 3, sustain: 0.8, drift: 0.15, aimed: 0.85 },
    hasScope: false,
    automatic: false,
    pelletCount: 1,
    kind: 'ranged',
    falloff: { start: 18, end: 45, min: 0.6 },
    adsSpeed: 18,
    mobility: 1.03,
  },
  /** Burst-fire SMG - fires 3 rounds per trigger pull (see WeaponManager's burst handling), never
   * fully automatic. Sits between the pistol and the rifle: a controlled-burst niche. */
  mp5: {
    id: 'mp5',
    name: 'S5 Burst SMG',
    description: 'Three-round bursts reward controlled aim at close to mid range.',
    category: 'secondary',
    damage: 17,
    fireRate: 2.6,
    magazineSize: 30,
    reloadTime: 1.7,
    spreadRadians: 0.016,
    recoilKick: 0.0065,
    recoilSide: 0.003,
    adsFov: 50,
    adsSpreadMultiplier: 0.0545,
    // 9 mm from the shoulder in three round bursts: every round of a burst climbs.
    spread: { aimed: 3 * MOA, hip: 0.016, moving: 0.006, bloomPerShot: 0.0008, bloomMax: 0.004 },
    recoil: { kick: 0.0065, side: 0.003, climbShots: 3, sustain: 1, drift: 0.2, aimed: 0.8 },
    hasScope: false,
    automatic: false,
    pelletCount: 1,
    kind: 'ranged',
    burstCount: 3,
    falloff: { start: 16, end: 40, min: 0.55 },
    adsSpeed: 15,
    mobility: 1.02,
  },
  revolver: {
    id: 'revolver',
    name: 'Rook .44 Revolver',
    description: 'Six heavy rounds: two to the body, one to the head.',
    category: 'secondary',
    damage: 58,
    fireRate: 1.8,
    magazineSize: 6,
    reloadTime: 2.6,
    spreadRadians: 0.014,
    recoilKick: 0.055,
    recoilSide: 0.012,
    adsFov: 50,
    adsSpreadMultiplier: 0.0623,
    // A magnum in the hand: the hardest flip of any sidearm, one aimed shot at a time.
    spread: { aimed: 3 * MOA, hip: 0.014, moving: 0.005, bloomPerShot: 0.003, bloomMax: 0.008 },
    recoil: { kick: 0.055, side: 0.012, climbShots: 1, sustain: 1, drift: 0.3, aimed: 0.9 },
    hasScope: false,
    automatic: false,
    pelletCount: 1,
    kind: 'ranged',
    falloff: { start: 25, end: 60, min: 0.6 },
    adsSpeed: 14,
  },
  machinePistol: {
    id: 'machinePistol',
    name: 'Hornet Machine Pistol',
    description: 'A full-auto sidearm that empties itself in a breath. Close range only.',
    category: 'secondary',
    damage: 12,
    fireRate: 15,
    magazineSize: 20,
    reloadTime: 1.5,
    spreadRadians: 0.02,
    recoilKick: 0.012,
    recoilSide: 0.009,
    adsFov: 58,
    adsSpreadMultiplier: 0.0873,
    // Full automatic with no stock: it climbs and wanders more than any other gun.
    spread: { aimed: 6 * MOA, hip: 0.02, moving: 0.006, bloomPerShot: 0.0016, bloomMax: 0.014 },
    recoil: { kick: 0.012, side: 0.009, climbShots: 6, sustain: 0.6, drift: 0.4, aimed: 0.85 },
    hasScope: false,
    automatic: true,
    pelletCount: 1,
    kind: 'ranged',
    falloff: { start: 10, end: 28, min: 0.5 },
    adsSpeed: 18,
    mobility: 1.03,
  },
  sawnOff: {
    id: 'sawnOff',
    name: 'Stub 12 Sawn-off',
    description: 'Two barrels, two shells, ten pellets each. Nothing past arm\'s length.',
    category: 'secondary',
    damage: 11,
    fireRate: 3,
    magazineSize: 2,
    reloadTime: 2.1,
    spreadRadians: 0.045,
    recoilKick: 0.075,
    recoilSide: 0.02,
    adsFov: 62,
    adsSpreadMultiplier: 0.7556,
    // A short open barrel throws a wide pattern, and a light gun takes the whole kick.
    spread: { aimed: 0.034, hip: 0.045, moving: 0.004, bloomPerShot: 0, bloomMax: 0 },
    recoil: { kick: 0.075, side: 0.02, climbShots: 1, sustain: 1, drift: 0, aimed: 0.95 },
    hasScope: false,
    automatic: false,
    pelletCount: 10,
    kind: 'ranged',
    falloff: { start: 5, end: 14, min: 0.2 },
    adsSpeed: 16,
    mobility: 1.02,
  },

  // --- Primaries ---------------------------------------------------------------------------------
  rifle: {
    id: 'rifle',
    name: 'VR-4 Assault Rifle',
    description: 'Automatic fire for sustained pressure at mid range.',
    category: 'primary',
    damage: 17,
    fireRate: 10,
    magazineSize: 30,
    reloadTime: 2.0,
    spreadRadians: 0.022,
    recoilKick: 0.0085,
    recoilSide: 0.0035,
    adsFov: 45,
    adsSpreadMultiplier: 0.0264,
    // An intermediate cartridge: a service rifle holds about 4 MOA, climbs for seven rounds, then settles.
    spread: { aimed: 2 * MOA, hip: 0.022, moving: 0.01, bloomPerShot: 0.0008, bloomMax: 0.006 },
    recoil: { kick: 0.0085, side: 0.0035, climbShots: 7, sustain: 0.35, drift: 0.25, aimed: 0.8 },
    hasScope: false,
    automatic: true,
    pelletCount: 1,
    kind: 'ranged',
    falloff: { start: 35, end: 75, min: 0.7 },
  },
  smg: {
    id: 'smg',
    name: 'Wasp SMG',
    description: 'The fastest fire in the arsenal and the lightest to carry. Fades quickly with range.',
    category: 'primary',
    damage: 13,
    fireRate: 14,
    magazineSize: 32,
    reloadTime: 1.6,
    spreadRadians: 0.018,
    recoilKick: 0.0055,
    recoilSide: 0.0045,
    adsFov: 52,
    adsSpreadMultiplier: 0.0646,
    // A pistol cartridge in a shouldered gun: little climb, more sideways chatter.
    spread: { aimed: 4 * MOA, hip: 0.018, moving: 0.006, bloomPerShot: 0.0007, bloomMax: 0.007 },
    recoil: { kick: 0.0055, side: 0.0045, climbShots: 5, sustain: 0.45, drift: -0.2, aimed: 0.8 },
    hasScope: false,
    automatic: true,
    pelletCount: 1,
    kind: 'ranged',
    falloff: { start: 12, end: 32, min: 0.5 },
    adsSpeed: 16,
    mobility: 1.05,
  },
  battleRifle: {
    id: 'battleRifle',
    name: 'Kestrel Battle Rifle',
    description: 'Hard-hitting automatic that holds its damage far out. Kicks to match.',
    category: 'primary',
    damage: 26,
    fireRate: 6.5,
    magazineSize: 25,
    reloadTime: 2.3,
    spreadRadians: 0.028,
    recoilKick: 0.019,
    recoilSide: 0.008,
    adsFov: 42,
    adsSpreadMultiplier: 0.0156,
    // A full power cartridge: about three times the recoil energy of the VR-4, hard to hold on automatic.
    spread: { aimed: 1.5 * MOA, hip: 0.028, moving: 0.012, bloomPerShot: 0.0016, bloomMax: 0.009 },
    recoil: { kick: 0.019, side: 0.008, climbShots: 4, sustain: 0.55, drift: 0.35, aimed: 0.8 },
    hasScope: false,
    automatic: true,
    pelletCount: 1,
    kind: 'ranged',
    falloff: { start: 45, end: 90, min: 0.8 },
    adsSpeed: 10,
    mobility: 0.97,
  },
  lmg: {
    id: 'lmg',
    name: 'R60 Light Machine Gun',
    description: 'Eighty rounds on a belt. Slow to raise, slow to reload, hard to stop.',
    category: 'primary',
    damage: 18,
    fireRate: 9,
    magazineSize: 80,
    reloadTime: 4.4,
    spreadRadians: 0.04,
    recoilKick: 0.0075,
    recoilSide: 0.005,
    adsFov: 48,
    adsSpreadMultiplier: 0.0291,
    // Its weight soaks the kick: slow to settle, then steadier than any rifle; poor from the hip and on the move.
    spread: { aimed: 4 * MOA, hip: 0.04, moving: 0.02, bloomPerShot: 0.0006, bloomMax: 0.005 },
    recoil: { kick: 0.0075, side: 0.005, climbShots: 10, sustain: 0.25, drift: 0.15, aimed: 0.7 },
    hasScope: false,
    automatic: true,
    pelletCount: 1,
    kind: 'ranged',
    falloff: { start: 40, end: 85, min: 0.75 },
    adsSpeed: 7,
    mobility: 0.9,
  },
  dmr: {
    id: 'dmr',
    name: 'K14 Marksman Rifle',
    description: 'Scoped semi-auto: three to the body or one to the head, as fast as you can aim.',
    category: 'primary',
    damage: 45,
    fireRate: 3.3,
    magazineSize: 12,
    reloadTime: 2.2,
    spreadRadians: 0.035,
    recoilKick: 0.022,
    recoilSide: 0.006,
    adsFov: 26,
    adsSpreadMultiplier: 0.0062,
    // A full power cartridge fired one aimed round at a time: precise, and wasted from the hip.
    spread: { aimed: 0.75 * MOA, hip: 0.035, moving: 0.015, bloomPerShot: 0.0025, bloomMax: 0.006 },
    recoil: { kick: 0.022, side: 0.006, climbShots: 2, sustain: 0.8, drift: 0.2, aimed: 0.8 },
    hasScope: true,
    automatic: false,
    pelletCount: 1,
    kind: 'ranged',
    falloff: { start: 70, end: 140, min: 0.85 },
    adsSpeed: 10,
    mobility: 0.97,
  },
  shotgun: {
    id: 'shotgun',
    name: 'H12 Shotgun',
    description: 'Eight pellets deliver lethal damage at close range.',
    category: 'primary',
    // 13 a pellet: 104 with all eight, a one-shot kill at true point-blank only.
    damage: 13,
    fireRate: 1.2,
    magazineSize: 6,
    reloadTime: 2.2,
    spreadRadians: 0.03,
    recoilKick: 0.05,
    recoilSide: 0.012,
    adsFov: 60,
    adsSpreadMultiplier: 0.6667,
    // Buckshot from an open barrel spreads about 8 inches at 10 yards; the pattern belongs to the gun, aimed or not.
    spread: { aimed: 0.02, hip: 0.03, moving: 0.004, bloomPerShot: 0, bloomMax: 0 },
    recoil: { kick: 0.05, side: 0.012, climbShots: 1, sustain: 1, drift: 0, aimed: 0.9 },
    hasScope: false,
    automatic: false,
    pelletCount: 8,
    kind: 'ranged',
    falloff: { start: 8, end: 24, min: 0.3 },
    adsSpeed: 11,
  },
  sniper: {
    id: 'sniper',
    name: 'L7 Sniper Rifle',
    description: 'High damage and precise scoped fire reward patient aim.',
    category: 'primary',
    damage: 90,
    fireRate: 0.8,
    magazineSize: 5,
    reloadTime: 2.4,
    spreadRadians: 0.06,
    recoilKick: 0.06,
    recoilSide: 0.006,
    adsFov: 15,
    adsSpreadMultiplier: 0.0012,
    // Half a minute of angle through the scope, a heavy magnum kick, and no accuracy without the scope.
    spread: { aimed: 0.25 * MOA, hip: 0.06, moving: 0.03, bloomPerShot: 0, bloomMax: 0 },
    recoil: { kick: 0.06, side: 0.006, climbShots: 1, sustain: 1, drift: 0.1, aimed: 0.85 },
    hasScope: true,
    automatic: false,
    pelletCount: 1,
    kind: 'ranged',
    adsSpeed: 8,
    mobility: 0.95,
  },

  // --- Blades ------------------------------------------------------------------------------------
  knife: {
    id: 'knife',
    name: 'Combat Knife',
    description: 'The all-rounder: quick slashes, a harder stab while aiming.',
    category: 'melee',
    ...blade({
      primary: { damage: 55, range: 2.2, rays: 3, spread: 0.12, duration: 0.35, hitAt: 0.08, cooldown: 0.55, poses: ['slashRight', 'slashLeft'] },
      alt: { damage: 80, range: 2.4, rays: 2, spread: 0.05, duration: 0.42, hitAt: 0.12, cooldown: 0.8, poses: ['stab'] },
    }),
    mobility: 1.06,
  },
  karambit: {
    id: 'karambit',
    name: 'Talon Karambit',
    description: 'The fastest blade: short hooking cuts in a three-strike rhythm.',
    category: 'melee',
    ...blade({
      primary: { damage: 36, range: 1.9, rays: 3, spread: 0.14, duration: 0.26, hitAt: 0.06, cooldown: 0.34, poses: ['hookRight', 'hookLeft', 'uppercut'] },
      alt: { damage: 60, range: 2.0, rays: 3, spread: 0.1, duration: 0.42, hitAt: 0.14, cooldown: 0.62, poses: ['backhand'] },
    }),
    mobility: 1.08,
  },
  machete: {
    id: 'machete',
    name: 'Bushline Machete',
    description: 'Long reach and a wide arc that catches everything in front of you.',
    category: 'melee',
    ...blade({
      primary: { damage: 70, range: 2.9, rays: 5, spread: 0.3, duration: 0.5, hitAt: 0.16, cooldown: 0.85, poses: ['slashRight', 'slashLeft'] },
      alt: { damage: 100, range: 2.8, rays: 3, spread: 0.08, duration: 0.7, hitAt: 0.26, cooldown: 1.15, poses: ['chop'] },
    }),
    mobility: 1.03,
  },
  tanto: {
    id: 'tanto',
    name: 'Kiri Tanto',
    description: 'Precise cuts, and a lunging thrust that reaches further than any other blade.',
    category: 'melee',
    ...blade({
      primary: { damage: 55, range: 2.3, rays: 3, spread: 0.1, duration: 0.36, hitAt: 0.09, cooldown: 0.6, poses: ['slashRight', 'slashLeft'] },
      alt: { damage: 90, range: 3.1, rays: 2, spread: 0.04, duration: 0.5, hitAt: 0.14, cooldown: 0.95, poses: ['lunge'] },
    }),
    mobility: 1.06,
  },
  hatchet: {
    id: 'hatchet',
    name: 'Trail Hatchet',
    description: 'Slow and brutal: two chops down a target, the overhead blow does it in one.',
    category: 'melee',
    ...blade({
      primary: { damage: 80, range: 2.3, rays: 3, spread: 0.16, duration: 0.55, hitAt: 0.2, cooldown: 0.95, poses: ['chopRight', 'chopLeft'] },
      alt: { damage: 120, range: 2.4, rays: 3, spread: 0.08, duration: 0.8, hitAt: 0.3, cooldown: 1.4, poses: ['chop'] },
    }),
    mobility: 1.02,
  },
  spike: {
    id: 'spike',
    name: 'Trench Spike',
    description: 'Fast straight jabs, or a three-strike flurry while aiming.',
    category: 'melee',
    ...blade({
      primary: { damage: 42, range: 2.4, rays: 2, spread: 0.03, duration: 0.24, hitAt: 0.07, cooldown: 0.42, poses: ['jab'] },
      alt: { damage: 32, range: 2.4, rays: 2, spread: 0.04, duration: 0.56, hitAt: 0.08, cooldown: 0.95, poses: ['flurry'], repeats: 2, repeatInterval: 0.15 },
    }),
    mobility: 1.06,
  },

  /** Goose Toss mode's loadout (see core/gameModes.ts) - players fight purely by throwing geese,
   * so this exists only to satisfy WeaponManager's "at least one weapon" requirement without
   * actually being usable: damage 0, negligible range, harmless if 'fire' ever reaches it (in
   * practice it never does - Game.ts's Goose Toss handling consumes 'fire' itself before
   * WeaponManager sees it, see updateGooseToss). No view model. */
  unarmed: {
    id: 'unarmed',
    name: 'Empty-Handed',
    description: 'Throw explosive geese with no conventional weapon equipped.',
    damage: 0,
    fireRate: 1,
    magazineSize: Infinity,
    reloadTime: 0,
    spreadRadians: 0,
    recoilKick: 0,
    adsFov: CAMERA_FOV,
    adsSpreadMultiplier: 1,
    hasScope: false,
    automatic: false,
    pelletCount: 1,
    kind: 'melee',
    range: 0.01,
  },
  /** Reward for landing the killing hit on the bonus golden goose (see entities/BonusGooseManager.ts)
   * - granted instantly via WeaponManager.grantBonusWeapon, never a starting/pickable loadout entry.
   * Fires a real ballistic projectile (isProjectile, see WeaponManager.fireShot) rather than instant
   * hitscan - `damage` itself is unused (the projectile's explosion damage comes from
   * GOOSE_LAUNCHER_EXPLOSION_MAX_DAMAGE in config.ts instead, same split Goose Toss's thrown geese
   * already use). Exactly 4 shots, disableReload - once empty, WeaponManager reverts to whatever
   * was equipped before automatically. */
  gooseLauncher: {
    id: 'gooseLauncher',
    name: 'Goose Launcher',
    description: 'Four explosive projectiles with no reload.',
    category: 'special',
    damage: 0,
    fireRate: 1.4,
    magazineSize: 4,
    reloadTime: 0,
    disableReload: true,
    spreadRadians: 0,
    recoilKick: 0.05,
    adsFov: CAMERA_FOV,
    adsSpreadMultiplier: 1,
    hasScope: false,
    automatic: false,
    pelletCount: 1,
    kind: 'ranged',
    isProjectile: true,
    adsSpeed: 10,
  },
};

/** The fields every blade shares, with the legacy single-attack numbers (damage, rate, reach)
 * filled from its primary attack for the code that still reads them (stat badges, enemy hearing). */
function blade(melee: { primary: MeleeAttack; alt: MeleeAttack }) {
  return {
    damage: melee.primary.damage,
    fireRate: 1 / melee.primary.cooldown,
    magazineSize: Infinity,
    reloadTime: 0,
    spreadRadians: melee.primary.spread,
    recoilKick: 0,
    adsFov: CAMERA_FOV,
    adsSpreadMultiplier: 1,
    hasScope: false,
    automatic: false,
    pelletCount: melee.primary.rays,
    kind: 'melee' as const,
    range: melee.primary.range,
    melee,
  };
}

export function weaponIdsIn(category: WeaponCategory): string[] {
  return Object.values(WEAPON_DEFINITIONS).filter((definition) => definition.category === category).map((definition) => definition.id);
}

/** Damage multiplier of a hitscan hit at `distance` metres. */
export function falloffMultiplier(falloff: DamageFalloff | undefined, distance: number): number {
  if (!falloff || distance <= falloff.start) return 1;
  if (distance >= falloff.end) return falloff.min;
  return 1 - (1 - falloff.min) * (distance - falloff.start) / (falloff.end - falloff.start);
}
