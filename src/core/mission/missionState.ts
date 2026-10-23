import type { WaveBias } from '../../entities/enemies/director/pacingDirector.ts';

/** Within this many metres of an uplink tower's centre, ground or platform, `E` starts its upload. */
export const UPLINK_START_RADIUS = 9;
/** The upload only advances while the player stays this close; farther out it pauses. */
export const UPLINK_HOLD_RADIUS = 14;
/** Seconds of upload to bring one uplink online. */
export const UPLINK_DURATION = 40;
/** A wave is called in every this many seconds of upload (at 10, 20 and 30), not at completion. */
export const UPLINK_WAVE_INTERVAL = 10;
export const UPLINK_WAVE_SIZE = 2;
const UPLINK_WAVE_BIASES: readonly WaveBias[] = ['mixed', 'rusher', 'sniper'];
/** The extraction ring around the fourth tower's base, the time to stand in it, and its send-off. */
export const EXTRACTION_RADIUS = 6;
export const EXTRACTION_HOLD = 3;
export const EXTRACTION_WAVE_SIZE = 3;

export const UPLINK_COUNT = 3;
const UPLINK_LABELS = ['A', 'B', 'C'] as const;

export interface MissionPoint {
  readonly x: number;
  readonly z: number;
}

export type UplinkStatus = 'pending' | 'uploading' | 'online';

export interface UplinkView {
  readonly label: string;
  readonly x: number;
  readonly z: number;
  readonly status: UplinkStatus;
  /** 0 to 1. */
  readonly progress: number;
}

export type MissionPhase = 'uplinks' | 'extract' | 'won' | 'lost';

export type MissionEvent =
  | { readonly kind: 'waveRequested'; readonly count: number; readonly bias: WaveBias }
  | { readonly kind: 'uploadStarted'; readonly label: string }
  | { readonly kind: 'uplinkOnline'; readonly label: string; readonly online: number; readonly total: number }
  | { readonly kind: 'extractionOpen' }
  | { readonly kind: 'won' }
  | { readonly kind: 'lost' };

export interface MissionInput {
  readonly dt: number;
  readonly player: MissionPoint;
  readonly interactPressed: boolean;
  readonly playerDead: boolean;
}

/** What the HUD shows this frame (docs/visual-overhaul.md, "Mission mode: Uplink"). */
export interface MissionView {
  readonly phase: MissionPhase;
  readonly uplinks: readonly UplinkView[];
  readonly extraction: MissionPoint;
  readonly online: number;
  /** The uplink being uploaded, if any, and whether the player is close enough for it to advance. */
  readonly active: { readonly label: string; readonly progress: number; readonly paused: boolean } | null;
  /** The interaction prompt, when the player stands at an uplink `E` would start or resume. */
  readonly prompt: string | null;
  /** 0 to 1 while the player stands in the open extraction ring. */
  readonly extractionProgress: number;
  readonly elapsed: number;
}

interface Uplink {
  readonly label: string;
  readonly x: number;
  readonly z: number;
  status: UplinkStatus;
  seconds: number;
  wavesSent: number;
}

/**
 * The Uplink mission (docs/visual-overhaul.md, phase 4) as a pure state machine, unit tested like
 * the pacing director: signals in (time, the player's position, the interact key, death), events out
 * (waves to send, uplinks coming online, extraction opening, the result). Game owns the visuals and
 * the spawning; nothing here touches three.js, physics or the DOM.
 *
 * Of the map's four watch towers, the three nearest the spawn are the uplinks, labelled A, B and C
 * nearest first, and the fourth is the extraction point. The player may take the uplinks in any
 * order. Only one uploads at a time: pressing `E` at another switches to it, and each keeps the
 * progress it has.
 */
export class MissionState {
  private readonly uplinks: Uplink[];
  readonly extraction: MissionPoint;
  private phase: MissionPhase = 'uplinks';
  private activeIndex: number | null = null;
  private extractionSeconds = 0;
  private elapsed = 0;

  constructor(towers: readonly MissionPoint[], spawn: MissionPoint) {
    if (towers.length < UPLINK_COUNT + 1) throw new Error(`The Uplink mission needs ${UPLINK_COUNT + 1} towers, got ${towers.length}`);
    const byDistance = [...towers].sort((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z));
    this.uplinks = byDistance.slice(0, UPLINK_COUNT).map((tower, index) => ({
      label: UPLINK_LABELS[index]!,
      x: tower.x,
      z: tower.z,
      status: 'pending',
      seconds: 0,
      wavesSent: 0,
    }));
    const extraction = byDistance[UPLINK_COUNT]!;
    this.extraction = { x: extraction.x, z: extraction.z };
  }

  update(input: MissionInput): MissionEvent[] {
    if (this.phase === 'won' || this.phase === 'lost') return [];
    const events: MissionEvent[] = [];
    if (input.playerDead) {
      this.phase = 'lost';
      this.activeIndex = null;
      events.push({ kind: 'lost' });
      return events;
    }
    const dt = Math.max(0, input.dt);
    this.elapsed += dt;

    if (this.phase === 'uplinks') {
      if (input.interactPressed) {
        const near = this.startableUplinkAt(input.player);
        if (near !== null && near !== this.activeIndex) {
          if (this.activeIndex !== null) this.uplinks[this.activeIndex]!.status = 'pending';
          this.activeIndex = near;
          const uplink = this.uplinks[near]!;
          uplink.status = 'uploading';
          events.push({ kind: 'uploadStarted', label: uplink.label });
        }
      }
      const active = this.activeIndex === null ? null : this.uplinks[this.activeIndex]!;
      if (active && distance(active, input.player) <= UPLINK_HOLD_RADIUS) {
        active.seconds = Math.min(UPLINK_DURATION, active.seconds + dt);
        while (active.wavesSent < Math.floor(active.seconds / UPLINK_WAVE_INTERVAL) && (active.wavesSent + 1) * UPLINK_WAVE_INTERVAL < UPLINK_DURATION) {
          events.push({ kind: 'waveRequested', count: UPLINK_WAVE_SIZE, bias: UPLINK_WAVE_BIASES[active.wavesSent % UPLINK_WAVE_BIASES.length]! });
          active.wavesSent++;
        }
        if (active.seconds >= UPLINK_DURATION) {
          active.status = 'online';
          this.activeIndex = null;
          const online = this.onlineCount();
          events.push({ kind: 'uplinkOnline', label: active.label, online, total: UPLINK_COUNT });
          if (online === UPLINK_COUNT) {
            this.phase = 'extract';
            events.push({ kind: 'extractionOpen' });
            events.push({ kind: 'waveRequested', count: EXTRACTION_WAVE_SIZE, bias: 'mixed' });
          }
        }
      }
      return events;
    }

    // Extraction: stand in the ring; stepping out resets the count, so the last seconds are a stand.
    if (distance(this.extraction, input.player) <= EXTRACTION_RADIUS) {
      this.extractionSeconds += dt;
      if (this.extractionSeconds >= EXTRACTION_HOLD) {
        this.phase = 'won';
        events.push({ kind: 'won' });
      }
    } else {
      this.extractionSeconds = 0;
    }
    return events;
  }

  view(player: MissionPoint): MissionView {
    const active = this.activeIndex === null ? null : this.uplinks[this.activeIndex]!;
    let prompt: string | null = null;
    if (this.phase === 'uplinks') {
      const near = this.startableUplinkAt(player);
      if (near !== null && near !== this.activeIndex) {
        prompt = this.uplinks[near]!.seconds > 0 ? 'RESUME UPLINK' : 'START UPLINK';
      }
    }
    return {
      phase: this.phase,
      uplinks: this.uplinks.map((u) => ({ label: u.label, x: u.x, z: u.z, status: u.status, progress: u.seconds / UPLINK_DURATION })),
      extraction: this.extraction,
      online: this.onlineCount(),
      active: active
        ? { label: active.label, progress: active.seconds / UPLINK_DURATION, paused: distance(active, player) > UPLINK_HOLD_RADIUS }
        : null,
      prompt,
      extractionProgress: this.phase === 'extract' || this.phase === 'won' ? Math.min(1, this.extractionSeconds / EXTRACTION_HOLD) : 0,
      elapsed: this.elapsed,
    };
  }

  private startableUplinkAt(player: MissionPoint): number | null {
    let best: number | null = null;
    let bestDistance = UPLINK_START_RADIUS;
    this.uplinks.forEach((uplink, index) => {
      if (uplink.status === 'online') return;
      const d = distance(uplink, player);
      if (d <= bestDistance) {
        best = index;
        bestDistance = d;
      }
    });
    return best;
  }

  private onlineCount(): number {
    return this.uplinks.filter((u) => u.status === 'online').length;
  }
}

function distance(a: MissionPoint, b: MissionPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
