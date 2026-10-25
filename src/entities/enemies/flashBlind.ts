import { ENEMY_FLASH_FIRE_INTERVAL } from '../../core/config.ts';

/**
 * An enemy blinded by a flash grenade (grenades, docs/grenades.md): for the scaled time it sees
 * nothing and, if it had a target before the flash, fires a wide shot every ENEMY_FLASH_FIRE_INTERVAL
 * at where it last saw the player. EnemyBrain owns one and acts on what update() returns. Pure.
 */
export class FlashBlindState {
  private remaining = 0;
  private fireTimer = 0;
  private firesBack = false;

  get active(): boolean {
    return this.remaining > 0;
  }

  get secondsLeft(): number {
    return this.remaining;
  }

  /** Blinded for `seconds`; a second flash keeps the longer. `firesBack`: it had a target (it was
   * alert, fighting or searching), so it shoots blind at the last-seen spot. */
  blind(seconds: number, firesBack: boolean): void {
    if (!(seconds > 0)) return;
    if (!this.active) this.fireTimer = ENEMY_FLASH_FIRE_INTERVAL;
    this.remaining = Math.max(this.remaining, seconds);
    this.firesBack = this.firesBack || firesBack;
  }

  /** One tick; true when a wide shot is due. `canFire` is false while staggered or for an enemy
   * without a gun; the shot timer waits. */
  update(dt: number, canFire: boolean): boolean {
    if (!this.active) return false;
    this.remaining = Math.max(0, this.remaining - Math.max(0, dt));
    if (!this.active) {
      this.firesBack = false;
      return false;
    }
    if (!canFire || !this.firesBack) return false;
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return false;
    this.fireTimer = ENEMY_FLASH_FIRE_INTERVAL;
    return true;
  }

  reset(): void {
    this.remaining = 0;
    this.fireTimer = 0;
    this.firesBack = false;
  }
}
