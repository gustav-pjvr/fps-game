export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;
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
  },
};
