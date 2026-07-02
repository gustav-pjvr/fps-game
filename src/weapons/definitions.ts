export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;
  /** Damage per pellet - for pelletCount 1 this is just "damage per shot". */
  readonly damage: number;
  readonly fireRate: number;
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
  /** Rays fired per trigger pull, each independently spread within spreadRadians (shotgun-style). */
  readonly pelletCount: number;
  /** Placeholder view-model look, until real .glb models exist. */
  readonly viewModelColor: number;
  readonly barrelLength: number;
}

export const WEAPON_DEFINITIONS: Record<string, WeaponDefinition> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
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
  },
  rifle: {
    id: 'rifle',
    name: 'Assault Rifle',
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
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
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
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper Rifle',
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
  },
};
