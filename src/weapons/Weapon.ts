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

  /** 0 at the start of a reload, 1 when it completes - drives the view-model reload cue. */
  get reloadProgress(): number {
    if (!this.reloading) return 0;
    return 1 - Math.max(0, this.reloadTimeRemaining) / this.definition.reloadTime;
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

  /** Returns whether a reload actually began (false if already reloading or magazine already full). */
  startReload(): boolean {
    if (this.reloading || this.ammoInMagazine === this.definition.magazineSize) return false;
    this.reloading = true;
    this.reloadTimeRemaining = this.definition.reloadTime;
    return true;
  }

  /** Instant full refill, cancelling any in-progress reload - for the practice-reset feature, not gameplay. */
  refillAmmo(): void {
    this.ammoInMagazine = this.definition.magazineSize;
    this.reloading = false;
    this.reloadTimeRemaining = 0;
    this.cooldown = 0;
  }
}
