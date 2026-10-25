import { GRENADE_FUSE, GRENADE_MAX_COUNT, GRENADE_START_COUNT, type GrenadeKind } from './grenadeTuning.ts';

/**
 * The grenades a player carries and the one in their hand (docs/grenades.md). Pure bookkeeping:
 * GrenadeSystem feeds in whether the grenade key is held each tick and acts on the events that come
 * back. The player carries one kind only, the loadout's choice, fixed for the match, with one count.
 *
 * Press and hold the grenade key to pull the pin and cook it (the fuse starts then); release to throw
 * it with whatever fuse is left. A tap is a press and a release a tick apart, so it throws at once.
 * Holding past the fuse detonates it in the hand. A grenade is only spent when it leaves the hand
 * (thrown or gone off); a cook cancelled by death or a pause gives it back.
 */

export type HandEvent =
  | { readonly type: 'cook'; readonly kind: GrenadeKind }
  | { readonly type: 'throw'; readonly kind: GrenadeKind; readonly fuseLeft: number }
  | { readonly type: 'inHand'; readonly kind: GrenadeKind };

export class GrenadeHand {
  private carried = 0;
  private cooking: { elapsed: number } | null = null;
  /** The key was held when it could not start a cook (none left, a reload, a knife swing, a grenade
   * that just went off in the hand): it must be released before it starts one. */
  private latched = false;

  /** `kind` is the loadout's grenade. `enabled` false (a mode without grenades, see gameModes.ts
   * grenadesEnabled): never carries any. */
  constructor(
    readonly kind: GrenadeKind,
    private readonly enabled: boolean,
  ) {
    this.reset();
  }

  /** Spawn, respawn and match reset: back to GRENADE_START_COUNT, nothing in the hand. */
  reset(): void {
    this.carried = this.enabled ? GRENADE_START_COUNT : 0;
    this.cooking = null;
    this.latched = false;
  }

  get count(): number {
    return this.carried;
  }

  /** Tops up the carry by `amount`, to at most GRENADE_MAX_COUNT (pickups). Returns how many were added. */
  add(amount: number): number {
    if (!this.enabled || !(amount > 0)) return 0;
    const before = this.carried;
    this.carried = Math.min(GRENADE_MAX_COUNT, before + Math.floor(amount));
    return this.carried - before;
  }

  /** Takes one out of the carry without cooking it (a scripted throw). False when none. */
  take(): boolean {
    if (this.carried <= 0) return false;
    this.carried -= 1;
    return true;
  }

  /** The kind in the hand, or null when nothing is cooking. */
  get cookingKind(): GrenadeKind | null {
    return this.cooking ? this.kind : null;
  }

  /** Seconds since the pin was pulled, 0 when nothing is cooking. */
  get cookElapsed(): number {
    return this.cooking?.elapsed ?? 0;
  }

  /** Fuse seconds left on the grenade in hand, or null when nothing is cooking. */
  get fuseLeft(): number | null {
    return this.cooking ? Math.max(0, GRENADE_FUSE[this.kind] - this.cooking.elapsed) : null;
  }

  /** Drops the cook without spending the grenade (death, pause, a frozen player). */
  cancel(): void {
    this.cooking = null;
  }

  /** One tick. `held` says whether the grenade key is down (or was pressed since the last tick);
   * `canStart` is false while a reload or a knife swing refuses a throw. */
  update(dt: number, held: boolean, canStart: boolean): HandEvent[] {
    if (!held) this.latched = false;
    const events: HandEvent[] = [];
    const kind = this.kind;
    if (this.cooking) {
      this.cooking.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
      const fuseLeft = GRENADE_FUSE[kind] - this.cooking.elapsed;
      if (fuseLeft <= 0) {
        this.cooking = null;
        this.carried = Math.max(0, this.carried - 1);
        if (held) this.latched = true;
        events.push({ type: 'inHand', kind });
      } else if (!held) {
        this.cooking = null;
        this.carried = Math.max(0, this.carried - 1);
        events.push({ type: 'throw', kind, fuseLeft });
      }
      return events;
    }
    if (!held || this.latched) return events;
    if (!canStart || this.carried <= 0) {
      this.latched = true;
      return events;
    }
    this.cooking = { elapsed: 0 };
    events.push({ type: 'cook', kind });
    return events;
  }
}
