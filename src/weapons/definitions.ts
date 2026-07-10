import { CAMERA_FOV } from '../core/config.ts';

export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Damage per pellet - for pelletCount 1 this is just "damage per shot". */
  readonly damage: number;
  readonly fireRate: number;
  /** Infinity for melee (Phase D) - Weapon.tryFire's plain ammoInMagazine > 0 check never needs
   * special-casing, since Infinity - 1 === Infinity in JS. */
  readonly magazineSize: number;
  readonly reloadTime: number;
  readonly spreadRadians: number;
  readonly recoilKick: number;
  /** Camera FOV while fully aimed down sights (lower = more zoom). */
  readonly adsFov: number;
  /** Spread while fully aimed, as a fraction of hip-fire spread. */
  readonly adsSpreadMultiplier: number;
  /** Full-screen scope overlay at full ADS (sniper-style) vs. a plain FOV zoom (pistol/rifle-style). */
  readonly hasScope: boolean;
  /** Holding fire keeps firing (rate-limited by fireRate) instead of one shot per click. */
  readonly automatic: boolean;
  /** Rays fired per trigger pull, each independently spread within spreadRadians (shotgun-style,
   * or melee's "small fan of raycasts" swing - see WeaponManager.firePellet). */
  readonly pelletCount: number;
  /** Placeholder view-model look, until real .glb models exist. */
  readonly viewModelColor: number;
  readonly barrelLength: number;
  /** 'melee' skips ammo/reload UI (see Hud.setAmmo) and uses `range` instead of the shared
   * long-range hitscan distance every gun uses. */
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
   * next pull. Undefined/1 = today's behavior (one round per press/tick) for every other weapon.
   * Currently only the MP5. */
  readonly burstCount?: number;
}

export const WEAPON_DEFINITIONS: Record<string, WeaponDefinition> = {
  pistol: {
    id: 'pistol',
    name: 'Kestrel P9',
    description: "Standard issue. Nobody's first choice, everybody's last one.",
    damage: 20,
    fireRate: 4,
    magazineSize: 12,
    reloadTime: 1.2,
    spreadRadians: 0.01,
    recoilKick: 0.015,
    adsFov: 55,
    adsSpreadMultiplier: 0.4,
    hasScope: false,
    automatic: false,
    pelletCount: 1,
    viewModelColor: 0x2a2a2a,
    barrelLength: 0.22,
    kind: 'ranged',
  },
  /** Burst-fire SMG - fires 3 rounds per trigger pull (see WeaponManager's burst handling), never
   * fully automatic. Sits between the pistol (weak, reliable) and rifle (full-auto spray) in the
   * power curve - a controlled-burst niche neither existing gun covers. */
  mp5: {
    id: 'mp5',
    name: 'Sable MP-5',
    description: 'Three at a time. Every time.',
    damage: 17,
    fireRate: 2.6,
    magazineSize: 30,
    reloadTime: 1.6,
    spreadRadians: 0.014,
    recoilKick: 0.018,
    adsFov: 50,
    adsSpreadMultiplier: 0.45,
    hasScope: false,
    automatic: false,
    pelletCount: 1,
    viewModelColor: 0x2c3238,
    barrelLength: 0.3,
    kind: 'ranged',
    burstCount: 3,
  },
  rifle: {
    id: 'rifle',
    name: 'VR-4 Fieldhand',
    description: 'Feeds all day without complaint. Hence the name.',
    damage: 15,
    fireRate: 10,
    magazineSize: 30,
    reloadTime: 2.0,
    spreadRadians: 0.02,
    recoilKick: 0.01,
    adsFov: 45,
    adsSpreadMultiplier: 0.5,
    hasScope: false,
    automatic: true,
    pelletCount: 1,
    viewModelColor: 0x3a3a2a,
    barrelLength: 0.4,
    kind: 'ranged',
  },
  shotgun: {
    id: 'shotgun',
    name: 'Hedgerow 12',
    description: 'Eight opinions, delivered all at once, at conversational range.',
    // Per user request ("shotgun is not great") - bumped from 10/pellet (80 max/shot, never a
    // guaranteed kill even at point-blank with all 8 pellets landing) to 13 (104 max/shot, now
    // capable of a 1-shot kill at true point-blank range only, where the tight spreadRadians
    // still lands most/all pellets - anything beyond conversational range still only lands a
    // fraction of them, keeping it situational rather than a universally better rifle).
    damage: 13,
    fireRate: 1.2,
    magazineSize: 6,
    // Cut from 2.6 (previously the slowest reload in the whole roster, slower than even the
    // sniper's 2.4) to 1.8 - the low magazine size (6) and short effective range already keep this
    // weapon situational, so the old reload time was compounding two downsides at once rather than
    // meaningfully balancing anything.
    reloadTime: 1.8,
    spreadRadians: 0.08,
    recoilKick: 0.04,
    adsFov: 60,
    adsSpreadMultiplier: 0.7,
    hasScope: false,
    automatic: false,
    pelletCount: 8,
    viewModelColor: 0x4a3018,
    barrelLength: 0.5,
    kind: 'ranged',
  },
  sniper: {
    id: 'sniper',
    name: 'Marchand Longview',
    description: 'For settling arguments from a different postcode.',
    damage: 90,
    fireRate: 0.8,
    magazineSize: 5,
    reloadTime: 2.4,
    spreadRadians: 0.02,
    recoilKick: 0.05,
    adsFov: 15,
    adsSpreadMultiplier: 0.02,
    hasScope: true,
    automatic: false,
    pelletCount: 1,
    viewModelColor: 0x14301a,
    barrelLength: 0.6,
    kind: 'ranged',
  },
  knife: {
    id: 'knife',
    name: 'Bicknell Trench Knife',
    description: 'The argument you make once every other argument has run out of ammo.',
    damage: 45,
    fireRate: 1.8,
    magazineSize: Infinity,
    reloadTime: 0,
    spreadRadians: 0.12,
    recoilKick: 0.008,
    adsFov: CAMERA_FOV,
    adsSpreadMultiplier: 1,
    hasScope: false,
    automatic: false,
    pelletCount: 3,
    viewModelColor: 0x4a4238,
    barrelLength: 0.05,
    kind: 'melee',
    range: 2.2,
  },
  /** Goose Toss mode's loadout (see core/gameModes.ts) - players fight purely by throwing geese,
   * so this exists only to satisfy WeaponManager's "at least one weapon" requirement without
   * actually being usable: damage 0, negligible range, harmless if 'fire' ever reaches it (in
   * practice it never does - Game.ts's Goose Toss handling consumes 'fire' itself before
   * WeaponManager sees it, see updateGooseToss). No view model - see viewModel.ts's
   * createProceduralMeleeViewModel special-casing this id to an empty group. */
  unarmed: {
    id: 'unarmed',
    name: 'Empty-Handed',
    description: 'No weapons here - just you, your arm, and a lot of geese.',
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
    viewModelColor: 0x000000,
    barrelLength: 0,
    kind: 'melee',
    range: 0.01,
  },
  /** Reward for landing the killing hit on the bonus golden goose (see entities/BonusGooseManager.ts)
   * - granted instantly via WeaponManager.grantBonusWeapon, never a starting/pickable loadout entry
   * in FIXED_LOADOUTS. Fires a real ballistic projectile (isProjectile, see WeaponManager.fireShot)
   * rather than instant hitscan - `damage` itself is unused (the projectile's explosion damage
   * comes from GOOSE_LAUNCHER_EXPLOSION_MAX_DAMAGE in config.ts instead, same split Goose Toss's
   * thrown geese already use). Exactly 4 shots, disableReload - once empty, WeaponManager reverts
   * to whatever was equipped before automatically. */
  gooseLauncher: {
    id: 'gooseLauncher',
    name: 'Goose Launcher',
    description: 'Four honks. Zero mercy.',
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
    viewModelColor: 0xd4af37,
    barrelLength: 0.6,
    kind: 'ranged',
    isProjectile: true,
  },
};
