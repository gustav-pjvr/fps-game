import type { WeaponDefinition } from './definitions.ts';

export class Weapon {
  private ammoInMagazine: number;
  private cooldown = 0;
  private reloading = false;
  private reloadTimeRemaining = 0;

  constructor(readonly definition: WeaponDefinition) {
    this.ammoInMagazine = definition.magazineSize;
  }

  get ammo(): number {
    return this.ammoInMagazine;
  }

  get isReloading(): boolean {
    return this.reloading;
  }

  update(dt: number): void {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
    }
    if (this.reloading) {
      this.reloadTimeRemaining -= dt;
      if (this.reloadTimeRemaining <= 0) {
        this.reloading = false;
        this.ammoInMagazine = this.definition.magazineSize;
      }
    }
  }

  tryFire(): boolean {
    if (this.reloading || this.cooldown > 0 || this.ammoInMagazine <= 0) return false;
    this.ammoInMagazine--;
    this.cooldown = 1 / this.definition.fireRate;
    return true;
  }

  startReload(): void {
    if (this.reloading || this.ammoInMagazine === this.definition.magazineSize) return;
    this.reloading = true;
    this.reloadTimeRemaining = this.definition.reloadTime;
  }
}
