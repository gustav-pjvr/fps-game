/**
 * Enemy AI v2 step 6 (docs/enemy-ai-v2.md): the pacing director behind the opt-in Director solo
 * mode. It follows Left 4 Dead's cycle. Build-up sends small waves until the fight gets hot, peak
 * holds that for a few seconds, fade waits for the player to get clear, and relax gives a long
 * breather before the next build-up.
 *
 * "Hot" is an intensity from 0 to 1 that rises with the damage the player takes and the enemies
 * they kill close by, and drains only while nothing is chasing them. So a player who is still
 * fighting is never handed a breather, and a player who got away is never hit again at once.
 *
 * Pure: signals in, one command out per tick, every setting a constructor option and the only
 * randomness an injected seeded stream (peak and relax lengths, and each wave's make-up).
 */

export type DirectorPhase = 'buildUp' | 'peak' | 'fade' | 'relax';

/** What kind of enemies a wave brings: any mix, all Rush Jobs, or a Ridge Walker. */
export type WaveBias = 'mixed' | 'rusher' | 'sniper';

export interface DirectorSignals {
  readonly dt: number;
  /** Health the player lost this tick. */
  readonly damageTaken: number;
  /** Enemies the player killed this tick within the director's kill radius. */
  readonly nearbyKills: number;
  /** Enemies chasing the player right now. */
  readonly engagedEnemies: number;
  readonly aliveEnemies: number;
}

export type DirectorCommand = { readonly kind: 'spawnWave'; readonly count: number; readonly bias: WaveBias } | { readonly kind: 'none' };

export interface DirectorOptions {
  readonly intensityPerDamage: number;
  readonly intensityPerKill: number;
  /** Intensity drained per second, only while no enemy is chasing the player. */
  readonly decayPerSecond: number;
  /** Intensity at which build-up turns to peak. */
  readonly peakThreshold: number;
  /** Peak lasts a random time between these, in seconds. */
  readonly peakMin: number;
  readonly peakMax: number;
  /** Fade ends once intensity drops below this. */
  readonly fadeExit: number;
  /** Relax lasts a random time between these, in seconds. */
  readonly relaxMin: number;
  readonly relaxMax: number;
  /** Never more enemies alive than this. */
  readonly maxAlive: number;
  readonly waveSize: number;
  /** Seconds between waves during build-up. */
  readonly waveInterval: number;
  /** Seconds before trying again when a wave found nowhere to spawn. */
  readonly retryDelay: number;
  /** Share of waves that are all Rush Jobs, and share that bring a Ridge Walker; the rest mix. */
  readonly rusherWaveShare: number;
  readonly sniperWaveShare: number;
}

const NONE: DirectorCommand = { kind: 'none' };

export class PacingDirector {
  private intensityValue = 0;
  private phaseValue: DirectorPhase = 'buildUp';
  private phaseElapsedValue = 0;
  /** How long the current peak or relax lasts, rolled on entry. */
  private phaseLength = 0;
  private waveTimer: number;
  private spawned = 0;

  constructor(
    private readonly options: DirectorOptions,
    private readonly rng: () => number,
  ) {
    this.waveTimer = options.waveInterval;
  }

  get intensity(): number {
    return this.intensityValue;
  }

  get phase(): DirectorPhase {
    return this.phaseValue;
  }

  get phaseElapsed(): number {
    return this.phaseElapsedValue;
  }

  /** Enemies actually placed by this director's waves (see confirmSpawned). */
  get totalSpawned(): number {
    return this.spawned;
  }

  update(signals: DirectorSignals): DirectorCommand {
    const options = this.options;
    // Drain first, then add this tick's damage and kills, so what just happened counts in full. The
    // other way round, a hit that reached the peak exactly (50 HP, capped at 1) was drained below it
    // in the same tick whenever nothing was chasing, and the peak never came (checkpoint E).
    if (signals.engagedEnemies === 0) this.intensityValue = Math.max(0, this.intensityValue - options.decayPerSecond * signals.dt);
    this.intensityValue = Math.min(
      1,
      this.intensityValue + signals.damageTaken * options.intensityPerDamage + signals.nearbyKills * options.intensityPerKill,
    );
    this.phaseElapsedValue += signals.dt;

    switch (this.phaseValue) {
      case 'buildUp':
        if (this.intensityValue >= options.peakThreshold) {
          this.enter('peak', this.roll(options.peakMin, options.peakMax));
          return NONE;
        }
        return this.nextWave(signals);
      case 'peak':
        if (this.phaseElapsedValue >= this.phaseLength) this.enter('fade', 0);
        return NONE;
      case 'fade':
        if (this.intensityValue < options.fadeExit) this.enter('relax', this.roll(options.relaxMin, options.relaxMax));
        return NONE;
      case 'relax':
        if (this.phaseElapsedValue >= this.phaseLength) {
          this.enter('buildUp', 0);
          // The breather is over: the next build-up opens with a wave straight away.
          this.waveTimer = 0;
        }
        return NONE;
    }
  }

  /** Game reports how many enemies a wave actually placed. None (nowhere hidden to put them) means
   * the wave is retried soon instead of a whole interval later. */
  confirmSpawned(count: number): void {
    this.spawned += count;
    if (count === 0) this.waveTimer = Math.min(this.waveTimer, this.options.retryDelay);
  }

  /** Back to the start of a match (practice reset). */
  reset(): void {
    this.intensityValue = 0;
    this.enter('buildUp', 0);
    this.waveTimer = this.options.waveInterval;
    this.spawned = 0;
  }

  private nextWave(signals: DirectorSignals): DirectorCommand {
    this.waveTimer -= signals.dt;
    if (this.waveTimer > 0) return NONE;
    const room = this.options.maxAlive - signals.aliveEnemies;
    // At the cap the timer stays run down, so the wave comes as soon as there is room.
    if (room <= 0) return NONE;
    this.waveTimer = this.options.waveInterval;
    return { kind: 'spawnWave', count: Math.min(this.options.waveSize, room), bias: this.rollBias() };
  }

  private enter(phase: DirectorPhase, length: number): void {
    this.phaseValue = phase;
    this.phaseElapsedValue = 0;
    this.phaseLength = length;
  }

  private roll(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  private rollBias(): WaveBias {
    const roll = this.rng();
    if (roll < this.options.rusherWaveShare) return 'rusher';
    if (roll < this.options.rusherWaveShare + this.options.sniperWaveShare) return 'sniper';
    return 'mixed';
  }
}
