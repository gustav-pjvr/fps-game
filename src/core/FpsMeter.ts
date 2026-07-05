const SAMPLE_WINDOW = 120;

export interface FrameStats {
  fps: number;
  avgMs: number;
  /** 95th-percentile frame time over the sample window - catches occasional spikes an average
   * would smooth away (a dense town or a burst of enemy raycasts showing up as a stutter, not a
   * shift in the average). */
  p95Ms: number;
}

/** Rolling window of real per-frame wall-clock time (not the fixed physics timestep) - see
 * Game.render, the one place this actually gets sampled once per displayed frame. */
export class FpsMeter {
  private readonly samples: number[] = [];

  recordFrame(frameTimeMs: number): void {
    this.samples.push(frameTimeMs);
    if (this.samples.length > SAMPLE_WINDOW) this.samples.shift();
  }

  getStats(): FrameStats {
    if (this.samples.length === 0) return { fps: 0, avgMs: 0, p95Ms: 0 };

    const avgMs = this.samples.reduce((sum, ms) => sum + ms, 0) / this.samples.length;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    const p95Ms = sorted[p95Index]!;

    return { fps: avgMs > 0 ? 1000 / avgMs : 0, avgMs, p95Ms };
  }
}
