import type * as THREE from 'three';

// Extrapolate past the newest sample for at most this long, then hold: a short gap is hidden, a long
// one never sends the avatar sprinting off along a stale heading.
export const MAX_EXTRAPOLATION_MS = 100;
// Holding longer than this past the newest sample means the buffer ran dry: one render stall.
export const STALL_HOLD_MS = 100;
// Treat implausible horizontal speeds as teleports instead of interpolating across the map.
export const MAX_PREDICT_SPEED = 20;
// Below this a fast jump is a small correction, not a teleport worth snapping for.
export const TELEPORT_MIN_DISTANCE = 2;
// The render delay stays inside this band: under 50 ms any jitter runs the buffer dry, over 150 ms
// the avatar lags too far behind what the shooter sees.
export const MIN_DELAY_MS = 50;
export const MAX_DELAY_MS = 150;
// Added to the p90 inter-arrival gap so the buffer usually holds a sample past the render time.
export const DELAY_MARGIN_MS = 20;
// The delay moves toward its target by at most this many ms per ms of real time, so the render clock
// runs 5% fast or slow at worst and nobody sees a speed-up.
const DELAY_SLEW = 0.05;
const INITIAL_DELAY_MS = 100;
// The sender-to-local offset follows its minimum at this fraction of the sender time elapsed.
const OFFSET_SLEW = 0.05;
const DELAY_GAP_PERCENTILE = 0.9;
// Arrival gaps above this are a death or a stall, not jitter the delay could ever cover.
const MAX_GAP_SAMPLE_MS = 1000;
const GAP_WINDOW = 32;
const OFFSET_WINDOW = 90;
const BUFFER_SIZE = 16;
// Speed from two samples this far apart or further says nothing about current movement.
const MAX_VELOCITY_SPAN_MS = 250;
// Under 5 ms apart (a browser with a coarse clock, see createSendClock) says nothing about speed.
const MIN_VELOCITY_SPAN_MS = 5;

interface Sample {
  x: number;
  y: number;
  z: number;
  /** Local time this sample belongs to: sender time mapped through the offset estimate. */
  t: number;
  sentAtMs: number | undefined;
  receivedAtMs: number;
}

/** Draws a remote player from a short buffer of timestamped snapshots, a little in the past, so it
 * can interpolate between two real samples instead of guessing ahead of the latest one. The delay
 * adapts to how unevenly snapshots arrive. Past the newest sample it extrapolates briefly, then holds. */
export class RemoteMotion {
  private samples: Sample[] = [];
  /** receivedAt minus sentAt of recent samples; the minimum is the least-delayed path, so jitter
   * (always positive) does not move the sender-to-local mapping. */
  private offsets: number[] = [];
  /** The offset actually used to map sender time to local time (see trackOffset). */
  private offsetMs: number | undefined;
  private offsetSentAtMs: number | undefined;
  private gaps: number[] = [];
  private delayMs = INITIAL_DELAY_MS;
  private targetDelayMs = INITIAL_DELAY_MS;
  private lastPredictMs: number | undefined;
  private stopped = false;
  private holding = false;
  private stalls = 0;

  constructor(private x: number, private y: number, private z: number) {}

  /** Returns true when the sample jumped further than anyone can run (a respawn whose message has
   * not arrived yet): the caller snaps there instead of sliding across the map. The buffer is then
   * cleared and starts again from this sample. A sample older than the newest one is dropped. */
  push(x: number, y: number, z: number, sentAtMs: number | undefined, receivedAtMs: number): boolean {
    const newest = this.samples[this.samples.length - 1];
    if (newest) {
      const outOfOrder = typeof sentAtMs === 'number' && typeof newest.sentAtMs === 'number'
        ? sentAtMs <= newest.sentAtMs
        : receivedAtMs < newest.receivedAtMs;
      if (outOfOrder) return false;
    }

    if (typeof sentAtMs === 'number') this.trackOffset(sentAtMs, receivedAtMs);
    const t = typeof sentAtMs === 'number' && this.offsetMs !== undefined ? sentAtMs + this.offsetMs : receivedAtMs;
    const sample: Sample = { x, y, z, t, sentAtMs, receivedAtMs };

    let teleported = false;
    if (newest) {
      if (t <= newest.t) return false;
      const dtMs = typeof sentAtMs === 'number' && typeof newest.sentAtMs === 'number'
        ? sentAtMs - newest.sentAtMs
        : receivedAtMs - newest.receivedAtMs;
      const distance = Math.hypot(x - newest.x, z - newest.z);
      teleported = distance > TELEPORT_MIN_DISTANCE && distance / Math.max(dtMs / 1000, 0.001) > MAX_PREDICT_SPEED;
      const gap = receivedAtMs - newest.receivedAtMs;
      if (gap >= 0 && gap <= MAX_GAP_SAMPLE_MS) {
        this.gaps.push(gap);
        if (this.gaps.length > GAP_WINDOW) this.gaps.shift();
        this.targetDelayMs = this.computeTargetDelay();
      }
    }

    if (teleported) this.samples = [];
    this.samples.push(sample);
    if (this.samples.length > BUFFER_SIZE) this.samples.shift();
    this.x = x;
    this.y = y;
    this.z = z;
    this.stopped = false;
    this.holding = false;
    return teleported;
  }

  /** Stops drawing anything but the last real position (a player who just died stays where they fell). */
  stop(): void {
    this.stopped = true;
    this.holding = false;
  }

  reset(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.samples = [];
    this.stopped = false;
    this.holding = false;
  }

  /** How many times rendering had to hold because the buffer ran dry for over STALL_HOLD_MS. */
  get renderStalls(): number {
    return this.stalls;
  }

  /** The current render delay in ms (for tests and diagnostics). */
  get delay(): number {
    return this.delayMs;
  }

  /** Where to draw the player at local time `nowMs`: the buffer interpolated at `nowMs - delay`. */
  predict(nowMs: number, out: THREE.Vector3): THREE.Vector3 {
    this.slewDelay(nowMs);
    const newest = this.samples[this.samples.length - 1];
    const oldest = this.samples[0];
    if (!newest || !oldest) return out.set(this.x, this.y, this.z);
    if (this.stopped) return out.set(newest.x, newest.y, newest.z);

    const renderAt = nowMs - this.delayMs;
    if (renderAt <= oldest.t) return out.set(oldest.x, oldest.y, oldest.z);

    if (renderAt <= newest.t) {
      this.holding = false;
      for (let i = this.samples.length - 1; i > 0; i--) {
        const b = this.samples[i];
        const a = this.samples[i - 1];
        if (a && b && renderAt >= a.t) {
          const f = (renderAt - a.t) / (b.t - a.t);
          return out.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
        }
      }
      return out.set(oldest.x, oldest.y, oldest.z);
    }

    const pastMs = renderAt - newest.t;
    if (pastMs > STALL_HOLD_MS && !this.holding) {
      this.holding = true;
      this.stalls++;
    }
    const lead = Math.min(pastMs, MAX_EXTRAPOLATION_MS) / 1000;
    const previous = this.samples[this.samples.length - 2];
    let vx = 0;
    let vz = 0;
    if (previous) {
      const spanMs = newest.t - previous.t;
      if (spanMs >= MIN_VELOCITY_SPAN_MS && spanMs <= MAX_VELOCITY_SPAN_MS) {
        vx = (newest.x - previous.x) / (spanMs / 1000);
        vz = (newest.z - previous.z) / (spanMs / 1000);
        if (Math.hypot(vx, vz) > MAX_PREDICT_SPEED) {
          vx = 0;
          vz = 0;
        }
      }
    }
    // Height is never extrapolated: a jump or a fall is not predictable from two samples.
    return out.set(newest.x + vx * lead, newest.y, newest.z + vz * lead);
  }

  /** Follows the minimum of the recent receivedAt - sentAt, but only by OFFSET_SLEW of the sender time
   * elapsed per sample, so a new minimum never bunches sample times together (which would read as a
   * speed burst) and sample times stay strictly increasing. */
  private trackOffset(sentAtMs: number, receivedAtMs: number): void {
    this.offsets.push(receivedAtMs - sentAtMs);
    if (this.offsets.length > OFFSET_WINDOW) this.offsets.shift();
    const minOffset = Math.min(...this.offsets);
    const lastSent = this.offsetSentAtMs;
    this.offsetSentAtMs = sentAtMs;
    if (this.offsetMs === undefined || lastSent === undefined) {
      this.offsetMs = minOffset;
      return;
    }
    const step = Math.max(0, sentAtMs - lastSent) * OFFSET_SLEW;
    if (this.offsetMs < minOffset) this.offsetMs = Math.min(minOffset, this.offsetMs + step);
    else this.offsetMs = Math.max(minOffset, this.offsetMs - step);
  }

  /** About the p90 of recent arrival gaps plus a margin, inside MIN..MAX_DELAY_MS. */
  private computeTargetDelay(): number {
    const sorted = [...this.gaps].sort((a, b) => a - b);
    const p90 = sorted[Math.min(sorted.length - 1, Math.ceil(DELAY_GAP_PERCENTILE * sorted.length) - 1)] ?? MIN_DELAY_MS;
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, p90 + DELAY_MARGIN_MS));
  }

  /** Moves the delay toward its target by at most DELAY_SLEW of the real time since the last call. */
  private slewDelay(nowMs: number): void {
    const last = this.lastPredictMs;
    this.lastPredictMs = nowMs;
    if (last === undefined) return;
    const step = Math.max(0, Math.min(nowMs - last, 100)) * DELAY_SLEW;
    if (this.delayMs < this.targetDelayMs) this.delayMs = Math.min(this.targetDelayMs, this.delayMs + step);
    else this.delayMs = Math.max(this.targetDelayMs, this.delayMs - step);
  }
}
