/**
 * What the enemies say and show (enemy AI v2, step 5 - docs/enemy-ai-v2.md). F.E.A.R.'s lesson:
 * players read AI as smart when it tells them what it is doing. Enemies emit intent events as they
 * act (spotted the player, going to flank, lost them, lining up a long shot, knocked off balance);
 * this decides which of them the player actually gets.
 *
 * Voiced callouts are rationed so a squad sounds like a squad, not a chorus: at most one per tick,
 * the most urgent kind first, from the speaker nearest the player, and each kind no more often than
 * `kindCooldown` with at least `globalCooldown` between any two. A callout beyond `audibleRange` is
 * dropped. Visual cues (the long-shot glint, a stagger) are gameplay warnings, so they are never
 * rationed: every one is passed on.
 *
 * Pure: no audio or scene - Game turns the result into sound and sprites.
 */

export type IntentKind = 'spotted' | 'flanking' | 'lostThem' | 'glint' | 'staggered';

export interface IntentEvent {
  readonly kind: IntentKind;
  readonly enemyId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where enemies send intent events (the squad's CalloutDirector). */
export interface IntentSink {
  emit(event: IntentEvent): void;
}

export interface CalloutOptions {
  readonly kindCooldown: number;
  readonly globalCooldown: number;
  readonly audibleRange: number;
}

export interface CalloutFlush {
  /** The one callout to voice this tick, if any. */
  readonly voiced: IntentEvent | null;
  /** Every visual cue emitted since the last flush. */
  readonly cues: readonly IntentEvent[];
}

/** Voiced kinds, most urgent first. */
const VOICED_PRIORITY: readonly IntentKind[] = ['spotted', 'flanking', 'lostThem'];
const VISUAL_KINDS: ReadonlySet<IntentKind> = new Set(['glint', 'staggered']);

export class CalloutDirector implements IntentSink {
  private pending: IntentEvent[] = [];
  private readonly lastVoicedAt = new Map<IntentKind, number>();
  private lastAnyVoicedAt = Number.NEGATIVE_INFINITY;
  private readonly voicedCounts = new Map<IntentKind, number>();
  private readonly cueCounts = new Map<IntentKind, number>();

  constructor(private readonly options: CalloutOptions) {}

  emit(event: IntentEvent): void {
    this.pending.push(event);
  }

  /** Call once per tick: returns what to play and show, and clears the queue. */
  flush(now: number, listener: { readonly x: number; readonly z: number }): CalloutFlush {
    const events = this.pending;
    this.pending = [];

    const cues = events.filter((event) => VISUAL_KINDS.has(event.kind));
    for (const cue of cues) this.cueCounts.set(cue.kind, (this.cueCounts.get(cue.kind) ?? 0) + 1);

    let voiced: IntentEvent | null = null;
    if (now - this.lastAnyVoicedAt >= this.options.globalCooldown) {
      for (const kind of VOICED_PRIORITY) {
        if (now - (this.lastVoicedAt.get(kind) ?? Number.NEGATIVE_INFINITY) < this.options.kindCooldown) continue;
        const speaker = events
          .filter((event) => event.kind === kind)
          .map((event) => ({ event, distance: Math.hypot(event.x - listener.x, event.z - listener.z) }))
          .filter((entry) => entry.distance <= this.options.audibleRange)
          .sort((a, b) => a.distance - b.distance || a.event.enemyId - b.event.enemyId)[0];
        if (!speaker) continue;
        voiced = speaker.event;
        this.lastVoicedAt.set(kind, now);
        this.lastAnyVoicedAt = now;
        this.voicedCounts.set(kind, (this.voicedCounts.get(kind) ?? 0) + 1);
        break;
      }
    }
    return { voiced, cues };
  }

  /** Debug: how many of each kind have been voiced or shown so far. */
  counts(): Record<IntentKind, number> {
    const counts: Record<IntentKind, number> = { spotted: 0, flanking: 0, lostThem: 0, glint: 0, staggered: 0 };
    for (const [kind, count] of this.voicedCounts) counts[kind] += count;
    for (const [kind, count] of this.cueCounts) counts[kind] += count;
    return counts;
  }

  reset(): void {
    this.pending = [];
    this.lastVoicedAt.clear();
    this.lastAnyVoicedAt = Number.NEGATIVE_INFINITY;
  }
}
