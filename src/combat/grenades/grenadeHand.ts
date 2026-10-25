import { GRENADE_FUSE, GRENADE_KINDS, GRENADE_MAX_COUNT, GRENADE_START_COUNT, type GrenadeKind } from './grenadeTuning.ts';

/**
 * The grenades a player carries and the one in their hand (docs/grenades.md). Pure bookkeeping:
 * GrenadeSystem feeds in which grenade keys are held each tick and acts on the events that come back.
 *
 * Press and hold a grenade key to pull the pin and cook it (the fuse starts then); release to throw
 * it with whatever fuse is left. A tap is a press and a release a tick apart, so it throws at once.
 * Holding past the fuse detonates it in the hand. A grenade is only spent when it leaves the hand
 * (thrown or gone off); a cook cancelled by death or a pause gives it back.
 */

export type HandEvent =
  | { readonly type: 'cook'; readonly kind: GrenadeKind }
  | { readonly type: 'throw'; readonly kind: GrenadeKind; readonly fuseLeft: number }
  | { readonly type: 'inHand'; readonly kind: GrenadeKind };

export class GrenadeHand {
  private readonly counts: Record<GrenadeKind, number> = { frag: 0, flash: 0 };
  private cooking: { kind: GrenadeKind; elapsed: number } | null = null;
  /** Keys held when they could not start a cook (none left, a reload, a knife swing, a grenade
   * that just went off in the hand): they must be released before they start one. */
  private readonly latched = new Set<GrenadeKind>();

  /** `enabled` false (a mode without grenades, see gameModes.ts grenadesEnabled): never carries any. */
  constructor(private readonly enabled: boolean) {
    this.reset();
  }

  /** Spawn, respawn and match reset: back to GRENADE_START_COUNT of each, nothing in the hand. */
  reset(): void {
    for (const kind of GRENADE_KINDS) this.counts[kind] = this.enabled ? GRENADE_START_COUNT : 0;
    this.cooking = null;
    this.latched.clear();
  }

  count(kind: GrenadeKind): number {
    return this.counts[kind];
  }

  /** Tops up `kind` by `amount`, to at most GRENADE_MAX_COUNT (pickups). Returns how many were added. */
  add(kind: GrenadeKind, amount: number): number {
    if (!this.enabled || !(amount > 0)) return 0;
    const before = this.counts[kind];
    this.counts[kind] = Math.min(GRENADE_MAX_COUNT, before + Math.floor(amount));
    return this.counts[kind] - before;
  }

  /** Takes one of `kind` out of the carry without cooking it (a scripted throw). False when none. */
  take(kind: GrenadeKind): boolean {
    if (this.counts[kind] <= 0) return false;
    this.counts[kind] -= 1;
    return true;
  }

  get cookingKind(): GrenadeKind | null {
    return this.cooking?.kind ?? null;
  }

  /** Seconds since the pin was pulled, 0 when nothing is cooking. */
  get cookElapsed(): number {
    return this.cooking?.elapsed ?? 0;
  }

  /** Fuse seconds left on the grenade in hand, or null when nothing is cooking. */
  get fuseLeft(): number | null {
    return this.cooking ? Math.max(0, GRENADE_FUSE[this.cooking.kind] - this.cooking.elapsed) : null;
  }

  /** Drops the cook without spending the grenade (death, pause, a frozen player). */
  cancel(): void {
    this.cooking = null;
  }

  /** One tick. `held` says which grenade keys are down (or were pressed since the last tick);
   * `canStart` is false while a reload or a knife swing refuses a throw. */
  update(dt: number, held: Readonly<Record<GrenadeKind, boolean>>, canStart: boolean): HandEvent[] {
    for (const kind of GRENADE_KINDS) if (!held[kind]) this.latched.delete(kind);
    const events: HandEvent[] = [];
    if (this.cooking) {
      const { kind } = this.cooking;
      this.cooking.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
      const fuseLeft = GRENADE_FUSE[kind] - this.cooking.elapsed;
      if (fuseLeft <= 0) {
        this.cooking = null;
        this.counts[kind] = Math.max(0, this.counts[kind] - 1);
        if (held[kind]) this.latched.add(kind);
        events.push({ type: 'inHand', kind });
      } else if (!held[kind]) {
        this.cooking = null;
        this.counts[kind] = Math.max(0, this.counts[kind] - 1);
        events.push({ type: 'throw', kind, fuseLeft });
      }
      return events;
    }
    for (const kind of GRENADE_KINDS) {
      if (!held[kind] || this.latched.has(kind)) continue;
      if (!canStart || this.counts[kind] <= 0) {
        this.latched.add(kind);
        continue;
      }
      this.cooking = { kind, elapsed: 0 };
      events.push({ type: 'cook', kind });
      break;
    }
    return events;
  }
}
