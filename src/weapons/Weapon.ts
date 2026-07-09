import type { WeaponDefinition } from './definitions.ts';

export class Weapon {
  private ammoInMagazine: number;
  private cooldown = 0;
  private reloading = false;
  private reloadTimeRemaining = 0;
  /** null = unlimited reloads (every mode except Goose Horde multiplayer - the existing behavior,
   * unchanged). When set, a reload draws from this pool instead of refilling for free - see
   * update()/startReload() below and config.ts's HORDE_STARTING_RESERVE_MAGAZINES comment. */
  private reserveAmmo: number | null;
  private readonly startingReserveAmmo: number | null;

  /** `damageOverride`, if present, wins over `definition.damage` for every shot this weapon fires -
   * how a per-match game mode (see core/gameModes.ts) guarantees a 1-hit kill for a specific
   * weapon (e.g. Sniper Duel's sniper, 1 Shot 1 Kill's pistol) without mutating the shared,
   * `readonly`-typed `WEAPON_DEFINITIONS` object those match modes don't otherwise touch. */
  constructor(
    readonly definition: WeaponDefinition,
    readonly damageOverride?: number,
    /** Goose Horde multiplayer only - see reserveAmmo's own comment. Omitted/undefined everywhere
     * else, matching the existing unlimited-reload behavior exactly. */
    initialReserveAmmo?: number,
  ) {
    this.ammoInMagazine = definition.magazineSize;
    this.reserveAmmo = initialReserveAmmo ?? null;
    this.startingReserveAmmo = initialReserveAmmo ?? null;
  }

  /** What `WeaponManager.firePellet` should actually apply per hit - the override if this weapon
   * has one, otherwise the definition's own base damage. */
  get effectiveDamage(): number {
    return this.damageOverride ?? this.definition.damage;
  }

  get ammo(): number {
    return this.ammoInMagazine;
  }

  /** null = unlimited (every mode except Goose Horde multiplayer) - see the field's own comment. */
  get reserve(): number | null {
    return this.reserveAmmo;
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
        if (this.reserveAmmo === null) {
          this.ammoInMagazine = this.definition.magazineSize;
        } else {
          const needed = this.definition.magazineSize - this.ammoInMagazine;
          const drawn = Math.min(needed, this.reserveAmmo);
          this.ammoInMagazine += drawn;
          this.reserveAmmo -= drawn;
        }
      }
    }
  }

  tryFire(): boolean {
    if (this.reloading || this.cooldown > 0 || this.ammoInMagazine <= 0) return false;
    this.ammoInMagazine--;
    this.cooldown = 1 / this.definition.fireRate;
    return true;
  }

  /** Returns whether a reload actually began (false if already reloading, magazine already full,
   * the weapon has disableReload set - see WeaponDefinition.disableReload - or (Goose Horde
   * multiplayer only) the reserve is already empty, since a reload with nothing to draw from would
   * just be a no-op reload animation). */
  startReload(): boolean {
    if (this.definition.disableReload || this.reloading || this.ammoInMagazine === this.definition.magazineSize) return false;
    if (this.reserveAmmo !== null && this.reserveAmmo <= 0) return false;
    this.reloading = true;
    this.reloadTimeRemaining = this.definition.reloadTime;
    return true;
  }

  /** Goose Horde multiplayer only: an ammo-drop pickup grants this weapon back some reserve ammo -
   * a no-op (not an error) for every other weapon, whose reserve stays permanently null/unlimited. */
  addReserveAmmo(amount: number): void {
    if (this.reserveAmmo === null) return;
    this.reserveAmmo += amount;
  }

  /** Instant full refill, cancelling any in-progress reload - for the practice-reset feature, not
   * gameplay. Also tops the reserve back up to full (Goose Horde multiplayer only) rather than
   * leaving it partially drained after a practice reset, matching "a clean slate" for every other
   * stat this touches. */
  refillAmmo(): void {
    this.ammoInMagazine = this.definition.magazineSize;
    this.reloading = false;
    this.reloadTimeRemaining = 0;
    this.cooldown = 0;
    this.reserveAmmo = this.startingReserveAmmo;
  }
}
