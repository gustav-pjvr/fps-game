import type { DirectorOptions, DirectorPhase, DirectorSignals, PacingDirector, WaveBias } from './pacingDirector.ts';

/** Showdown (docs/showdown.md): the pacing director's endless build-up, peak and breather turned
 * into a run with an arc. Five acts, each one cycle of the director with a larger cap and a
 * harder mix; a supply drop in each breather; a finale squad led by a Warden when the fifth act
 * peaks; a score whose multiplier grows while the fight stays hot. Pure: Game feeds it what
 * happened this tick and acts on the events it returns. */

/** What one act changes in the director's numbers. */
export interface ShowdownAct {
  readonly maxAlive: number;
  readonly waveSize: number;
  /** Seconds between waves during the act's build-up. */
  readonly waveInterval: number;
  readonly rusherWaveShare: number;
  readonly sniperWaveShare: number;
  /** Seconds the breather after this act lasts (the director rolls between the two). */
  readonly relaxMin: number;
  readonly relaxMax: number;
}

export const SHOWDOWN_ACTS: readonly ShowdownAct[] = [
  { maxAlive: 6, waveSize: 2, waveInterval: 9, rusherWaveShare: 0.1, sniperWaveShare: 0.1, relaxMin: 14, relaxMax: 18 },
  { maxAlive: 8, waveSize: 3, waveInterval: 8, rusherWaveShare: 0.2, sniperWaveShare: 0.15, relaxMin: 14, relaxMax: 18 },
  { maxAlive: 10, waveSize: 3, waveInterval: 7, rusherWaveShare: 0.25, sniperWaveShare: 0.2, relaxMin: 16, relaxMax: 20 },
  { maxAlive: 12, waveSize: 4, waveInterval: 7, rusherWaveShare: 0.3, sniperWaveShare: 0.2, relaxMin: 16, relaxMax: 20 },
  { maxAlive: 14, waveSize: 4, waveInterval: 6, rusherWaveShare: 0.3, sniperWaveShare: 0.25, relaxMin: 16, relaxMax: 20 },
];

export const SHOWDOWN_RULES = {
  /** A build-up that lasts this long peaks on its own: an act always ends (s). */
  maxBuildUp: 110,
  /** The finale: enemies that come with the Warden for one player, and for each player more. */
  finaleEscorts: 4,
  finaleEscortsPerExtraPlayer: 2,
  /** Each further player adds this share to an act's cap and wave size. */
  capPerExtraPlayer: 0.35,
  /** Score: a kill, an act survived (times its number), the finale won. */
  killScore: 100,
  actBonus: 500,
  winBonus: 2500,
  /** The multiplier rises one step for every `heatSeconds` the intensity stays at or over
   * `hotIntensity`, falls one for every `coolSeconds` at or under `coldIntensity`, and is at most `maxMultiplier`. */
  hotIntensity: 0.45,
  coldIntensity: 0.12,
  heatSeconds: 8,
  coolSeconds: 10,
  maxMultiplier: 5,
  /** Solo: deaths the run survives (the player is put back; the multiplier starts again). */
  redeploys: 2,
} as const;

export interface ShowdownSignals extends DirectorSignals {
  /** Every enemy the players killed this tick, near or far: the score. */
  readonly kills: number;
}

export type ShowdownStage = 'act' | 'breather' | 'finale' | 'won' | 'lost';

export type ShowdownEvent =
  | { readonly kind: 'spawnWave'; readonly count: number; readonly bias: WaveBias }
  | { readonly kind: 'actStarted'; readonly act: number }
  | { readonly kind: 'actCleared'; readonly act: number; readonly bonus: number }
  | { readonly kind: 'finaleStarted'; readonly escorts: number }
  | { readonly kind: 'multiplier'; readonly value: number }
  | { readonly kind: 'won'; readonly bonus: number };

export interface ShowdownView {
  readonly act: number;
  readonly totalActs: number;
  readonly stage: ShowdownStage;
  readonly phase: DirectorPhase;
  readonly intensity: number;
  readonly score: number;
  readonly multiplier: number;
  /** How far the multiplier's next step has got, 0 to 1 (0 at the cap). */
  readonly heat: number;
  readonly bestMultiplier: number;
  readonly kills: number;
  readonly redeploysLeft: number;
}

/** An act's numbers for a squad of `players`, on top of the director's base options. */
export function showdownOptions(base: DirectorOptions, act: number, players: number): DirectorOptions {
  const spec = SHOWDOWN_ACTS[Math.max(0, Math.min(SHOWDOWN_ACTS.length - 1, act - 1))]!;
  const scale = 1 + SHOWDOWN_RULES.capPerExtraPlayer * (Math.max(1, Math.min(4, players)) - 1);
  return {
    ...base,
    maxAlive: Math.round(spec.maxAlive * scale),
    waveSize: Math.round(spec.waveSize * scale),
    waveInterval: spec.waveInterval,
    rusherWaveShare: spec.rusherWaveShare,
    sniperWaveShare: spec.sniperWaveShare,
    relaxMin: spec.relaxMin,
    relaxMax: spec.relaxMax,
  };
}

export class ShowdownState {
  private actNumber = 1;
  private stageValue: ShowdownStage = 'act';
  private lastPhase: DirectorPhase;
  /** Whether this act has reached its peak: only then does its breather clear it (the director
   * also relaxes while every player is underground, which clears nothing). */
  private peaked = false;
  private buildUpSeconds = 0;
  private finalePlaced = false;
  private scoreValue = 0;
  private multiplierValue = 1;
  private best = 1;
  private heat = 0;
  private cool = 0;
  private killCount = 0;
  private redeploys: number = SHOWDOWN_RULES.redeploys;

  constructor(
    private readonly director: PacingDirector,
    private readonly base: DirectorOptions,
    /** How many players are in the run now: an act is sized for it when it starts. */
    private readonly players: () => number = () => 1,
  ) {
    this.lastPhase = director.phase;
    director.retune(showdownOptions(base, 1, players()));
  }

  get stage(): ShowdownStage {
    return this.stageValue;
  }

  get act(): number {
    return this.actNumber;
  }

  get over(): boolean {
    return this.stageValue === 'won' || this.stageValue === 'lost';
  }

  view(): ShowdownView {
    return {
      act: this.actNumber,
      totalActs: SHOWDOWN_ACTS.length,
      stage: this.stageValue,
      phase: this.director.phase,
      intensity: this.director.intensity,
      score: this.scoreValue,
      multiplier: this.multiplierValue,
      heat: this.multiplierValue >= SHOWDOWN_RULES.maxMultiplier ? 0 : this.heat / SHOWDOWN_RULES.heatSeconds,
      bestMultiplier: this.best,
      kills: this.killCount,
      redeploysLeft: this.redeploys,
    };
  }

  /** One tick. Returns what Game must do or say, in order. */
  update(signals: ShowdownSignals): ShowdownEvent[] {
    if (this.over) return [];
    const events: ShowdownEvent[] = [];
    this.killCount += signals.kills;
    this.scoreValue += signals.kills * SHOWDOWN_RULES.killScore * this.multiplierValue;

    if (this.stageValue === 'finale') {
      // No more waves: the finale squad is the last of them. Won once it is placed and all gone.
      if (this.finalePlaced && signals.aliveEnemies === 0) {
        this.stageValue = 'won';
        this.scoreValue += SHOWDOWN_RULES.winBonus;
        events.push({ kind: 'won', bonus: SHOWDOWN_RULES.winBonus });
      }
      return events;
    }

    const command = this.director.update(signals);
    if (command.kind === 'spawnWave') events.push(command);
    this.trackMultiplier(signals.dt, events);

    if (this.director.phase === 'buildUp') {
      this.buildUpSeconds += signals.dt;
      if (this.buildUpSeconds >= SHOWDOWN_RULES.maxBuildUp) this.director.forcePeak();
    }
    // Read after the forced peak, so that peak counts as this act's.
    const phase = this.director.phase;
    if (phase !== this.lastPhase) this.phaseChanged(this.lastPhase, phase, events);
    this.lastPhase = phase;
    return events;
  }

  private phaseChanged(from: DirectorPhase, to: DirectorPhase, events: ShowdownEvent[]): void {
    if (to === 'peak') this.peaked = true;
    const last = this.actNumber >= SHOWDOWN_ACTS.length;
    if (last && this.peaked && (to === 'fade' || to === 'relax')) {
      // The last act has no breather: its peak brings the finale.
      this.stageValue = 'finale';
      this.finalePlaced = false;
      const escorts = SHOWDOWN_RULES.finaleEscorts + SHOWDOWN_RULES.finaleEscortsPerExtraPlayer * (Math.max(1, Math.min(4, this.players())) - 1);
      events.push({ kind: 'finaleStarted', escorts });
      return;
    }
    if (to === 'relax' && this.peaked) {
      this.stageValue = 'breather';
      const bonus = SHOWDOWN_RULES.actBonus * this.actNumber;
      this.scoreValue += bonus;
      events.push({ kind: 'actCleared', act: this.actNumber, bonus });
    } else if (from === 'relax' && to === 'buildUp' && this.stageValue === 'breather') {
      this.actNumber++;
      this.stageValue = 'act';
      this.peaked = false;
      this.buildUpSeconds = 0;
      this.director.retune(showdownOptions(this.base, this.actNumber, this.players()));
      events.push({ kind: 'actStarted', act: this.actNumber });
    }
  }

  private trackMultiplier(dt: number, events: ShowdownEvent[]): void {
    const intensity = this.director.intensity;
    if (intensity >= SHOWDOWN_RULES.hotIntensity) {
      this.cool = 0;
      if (this.multiplierValue < SHOWDOWN_RULES.maxMultiplier) {
        this.heat += dt;
        if (this.heat >= SHOWDOWN_RULES.heatSeconds) {
          this.heat = 0;
          this.setMultiplier(this.multiplierValue + 1, events);
        }
      }
    } else if (intensity <= SHOWDOWN_RULES.coldIntensity && this.multiplierValue > 1) {
      this.cool += dt;
      if (this.cool >= SHOWDOWN_RULES.coolSeconds) {
        this.cool = 0;
        this.heat = 0;
        this.setMultiplier(this.multiplierValue - 1, events);
      }
    }
  }

  private setMultiplier(value: number, events: ShowdownEvent[] | null): void {
    this.multiplierValue = value;
    this.best = Math.max(this.best, value);
    events?.push({ kind: 'multiplier', value });
  }

  /** Game placed a wave: how many enemies it really put down. */
  confirmSpawned(count: number): void {
    this.director.confirmSpawned(count);
  }

  /** Game placed the finale squad (the Warden and its escorts). */
  confirmFinalePlaced(): void {
    this.finalePlaced = true;
  }

  /** The player fell. With a redeploy left the run goes on and the multiplier starts again;
   * with none it is lost. Returns which. */
  playerFell(): 'redeploy' | 'lost' {
    if (this.over) return 'lost';
    this.heat = 0;
    this.cool = 0;
    this.setMultiplier(1, null);
    if (this.redeploys > 0) {
      this.redeploys--;
      return 'redeploy';
    }
    this.stageValue = 'lost';
    return 'lost';
  }

  /** A grade for the end screen, from how far the run got and how hot it was kept. */
  grade(): 'S' | 'A' | 'B' | 'C' {
    if (this.stageValue !== 'won') return this.actNumber >= 4 ? 'B' : 'C';
    if (this.redeploys === SHOWDOWN_RULES.redeploys && this.best >= 4) return 'S';
    return this.redeploys > 0 ? 'A' : 'B';
  }
}
