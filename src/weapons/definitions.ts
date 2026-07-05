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
    damage: 10,
    fireRate: 1.2,
    magazineSize: 6,
    reloadTime: 2.6,
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
};
