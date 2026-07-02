export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;
  readonly damage: number;
  readonly fireRate: number;
  readonly magazineSize: number;
  readonly reloadTime: number;
  readonly spreadRadians: number;
  readonly recoilKick: number;
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
  },
};
