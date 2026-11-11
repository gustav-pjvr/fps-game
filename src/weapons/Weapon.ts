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

  /** `cooldown` is the wait before the next shot; a blade passes the attack's own (its two attacks
   * recover at different speeds), a gun uses its fire rate. */
  tryFire(cooldown = 1 / this.definition.fireRate): boolean {
    if (this.reloading || this.cooldown > 0 || this.ammoInMagazine <= 0) return false;
    this.ammoInMagazine--;
    this.cooldown = cooldown;
    return true;
  }

  /** Fires the 2nd/3rd round of an already-committed burst (see WeaponDefinition.burstCount and
   * WeaponManager's burst handling) - deliberately does NOT check or touch `cooldown`. `tryFire()`'s
   * cooldown gates the interval between *bursts* (set once, by the burst's opening shot); reusing
   * it here would block every follow-up round, since WEAPON_BURST_SHOT_INTERVAL_SECONDS (the pacing
   * *within* a burst) is always much shorter than 1/fireRate - confirmed the actual bug behind the
   * MP5 firing exactly one round instead of three. */
  consumeBurstRound(): boolean {
    if (this.reloading || this.ammoInMagazine <= 0) return false;
    this.ammoInMagazine--;
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

  /** Whether an ammo box (pickups) would give this weapon anything. The knife, the empty hands and
   * the Goose Launcher reward never take one. A weapon with a reserve takes magazines until the
   * reserve holds `maxReserveMagazines` of them; a weapon with unlimited reloads (reserve null) has
   * nothing to stock, so the box tops up its magazine instead, unless a reload is already doing that. */
  ammoPickupWouldGive(maxReserveMagazines: number): boolean {
    const size = this.definition.magazineSize;
    if (this.definition.kind === 'melee' || this.definition.disableReload || !Number.isFinite(size)) return false;
    if (this.reserveAmmo === null) return !this.reloading && this.ammoInMagazine < size;
    return this.reserveAmmo < size * maxReserveMagazines;
  }

  /** Ammo box: `magazines` magazines into the reserve (never past `maxReserveMagazines`), or the
   * magazine topped up when reloads are unlimited. Returns whether anything was given. */
  grantAmmoPickup(magazines: number, maxReserveMagazines: number): boolean {
    if (!this.ammoPickupWouldGive(maxReserveMagazines)) return false;
    const size = this.definition.magazineSize;
    if (this.reserveAmmo === null) {
      this.ammoInMagazine = size;
    } else {
      this.reserveAmmo = Math.min(this.reserveAmmo + size * magazines, size * maxReserveMagazines);
    }
    return true;
  }

  /** Instant full refill, cancelling any in-progress reload - for the practice-reset feature and
   * every respawn (WeaponManager.resetAllAmmo), not gameplay. Also tops the reserve back up to full
   * (Goose Horde multiplayer only) rather than leaving it partially drained after a practice reset,
   * matching "a clean slate" for every other stat this touches. A disableReload weapon (the Goose
   * Launcher reward, see WeaponDefinition.disableReload) is skipped: it's a limited-shot bonus, not
   * part of the loadout, so dying or resetting while holding it used to hand out 4 fresh shots. It
   * now keeps whatever it had left, and WeaponManager's empty-magazine auto-revert still swaps the
   * original weapon back once those are spent. */
  refillAmmo(): void {
    if (this.definition.disableReload) return;
    this.restock();
  }

  /** The unconditional refill behind refillAmmo(), disableReload weapons included. Only for
   * WeaponManager.grantBonusWeapon re-granting the bonus weapon the player is already holding,
   * where a fresh magazine is exactly the point of the reward. */
  restock(): void {
    this.ammoInMagazine = this.definition.magazineSize;
    this.reloading = false;
    this.reloadTimeRemaining = 0;
    this.cooldown = 0;
    this.reserveAmmo = this.startingReserveAmmo;
  }
}
