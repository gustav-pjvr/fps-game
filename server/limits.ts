/**
 * Rate and abuse limits for the relay (docs/server-relay-design.md, section 7.4). Pure and
 * socket-free; every method takes the time in milliseconds from an injected clock, so tests are
 * deterministic.
 */

/** A token bucket: `ratePerSecond` tokens refill continuously up to `burst`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly ratePerSecond: number;
  private readonly burst: number;

  constructor(ratePerSecond: number, burst: number, now: number) {
    this.ratePerSecond = ratePerSecond;
    this.burst = burst;
    this.tokens = burst;
    this.last = now;
  }

  private refill(now: number): void {
    if (now > this.last) {
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSecond);
      this.last = now;
    }
  }

  /** Whether `cost` tokens are available now, without taking them. */
  canTake(cost: number, now: number): boolean {
    this.refill(now);
    return this.tokens >= cost;
  }

  take(cost: number, now: number): boolean {
    if (!this.canTake(cost, now)) return false;
    this.tokens -= cost;
    return true;
  }
}

export interface RateLimit {
  framesPerSecond: number;
  frameBurst: number;
  bytesPerSecond: number;
  byteBurst: number;
}

/** Section 7.4: guest 150 frames/s (burst 300) and 64 KB/s; host 800 frames/s (burst 1600) and
 * 512 KB/s. Byte bursts are two seconds' worth, so one largest frame (64 KiB) always fits a host. */
export const GUEST_RATE_LIMIT: RateLimit = { framesPerSecond: 150, frameBurst: 300, bytesPerSecond: 64 * 1024, byteBurst: 128 * 1024 };
export const HOST_RATE_LIMIT: RateLimit = { framesPerSecond: 800, frameBurst: 1600, bytesPerSecond: 512 * 1024, byteBurst: 1024 * 1024 };

/** Seconds in a row a member may stay over its rate before it is closed (4008). */
export const RATE_OVER_CLOSE_SECONDS = 10;

export type RateVerdict = 'ok' | 'drop' | 'close';

/**
 * Frames and bytes per member. A frame over either bucket is dropped and counted. Time is cut into
 * whole seconds from the limiter's start; a second with any drop is "over", and once
 * RATE_OVER_CLOSE_SECONDS completed seconds in a row were over, the next frame gets 'close'. A
 * steady flood at twice the rate still lets some frames through as tokens refill, so "a dropped
 * frame in each second" rather than "nothing got through" is what counts.
 */
export class MemberRateLimiter {
  private readonly frames: TokenBucket;
  private readonly bytes: TokenBucket;
  private windowStart: number;
  private windowDropped = false;
  private overSeconds = 0;
  dropped = 0;

  constructor(limit: RateLimit, now: number) {
    this.frames = new TokenBucket(limit.framesPerSecond, limit.frameBurst, now);
    this.bytes = new TokenBucket(limit.bytesPerSecond, limit.byteBurst, now);
    this.windowStart = now;
  }

  private advance(now: number): void {
    const elapsed = Math.floor((now - this.windowStart) / 1000);
    if (elapsed <= 0) return;
    // The window that just ended counts as over only if it saw a drop; any whole quiet second
    // after it breaks the run.
    this.overSeconds = this.windowDropped && elapsed === 1 ? this.overSeconds + 1 : 0;
    this.windowStart += elapsed * 1000;
    this.windowDropped = false;
  }

  check(byteLength: number, now: number): RateVerdict {
    this.advance(now);
    if (this.overSeconds >= RATE_OVER_CLOSE_SECONDS) return 'close';
    if (this.frames.canTake(1, now) && this.bytes.canTake(byteLength, now)) {
      this.frames.take(1, now);
      this.bytes.take(byteLength, now);
      return 'ok';
    }
    this.windowDropped = true;
    this.dropped += 1;
    return 'drop';
  }
}

/** Open sockets per client IP (section 7.4: 8, a household behind one address). */
export const MAX_CONNECTIONS_PER_IP = 8;

export class ConnectionCounter {
  private readonly counts = new Map<string, number>();
  private readonly maxPerIp: number;

  constructor(maxPerIp: number = MAX_CONNECTIONS_PER_IP) {
    this.maxPerIp = maxPerIp;
  }

  /** Count a new socket from `ip`; false (and nothing counted) when that IP is at its limit. */
  acquire(ip: string): boolean {
    const count = this.counts.get(ip) ?? 0;
    if (count >= this.maxPerIp) return false;
    this.counts.set(ip, count + 1);
    return true;
  }

  release(ip: string): void {
    const count = this.counts.get(ip);
    if (count === undefined) return;
    if (count <= 1) this.counts.delete(ip);
    else this.counts.set(ip, count - 1);
  }

  countFor(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }

  trackedIps(): number {
    return this.counts.size;
  }
}

export interface AccessFailurePolicy {
  maxFailures: number;
  windowMs: number;
  blockMs: number;
  /** Most IPs tracked at once; when full after a sweep, an unknown IP counts as blocked. */
  maxTrackedIps: number;
}

/** Section 5.3: 5 failures a minute, then a 10 minute block. */
export const ACCESS_FAILURE_POLICY: AccessFailurePolicy = { maxFailures: 5, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 50_000 };

interface FailureState {
  failures: number[];
  blockedUntil: number;
}

/** Failed access codes per IP. The shell asks isBlocked before it even compares a code, so a
 * blocked IP learns nothing from guessing. */
export class AccessFailureLimiter {
  private readonly states = new Map<string, FailureState>();
  private readonly policy: AccessFailurePolicy;

  constructor(policy: AccessFailurePolicy = ACCESS_FAILURE_POLICY) {
    this.policy = policy;
  }

  isBlocked(ip: string, now: number): boolean {
    const state = this.states.get(ip);
    if (state) return now < state.blockedUntil;
    // An attacker spreading guesses over many addresses must not grow the map without bound.
    if (this.states.size >= this.policy.maxTrackedIps) {
      this.sweep(now);
      return this.states.size >= this.policy.maxTrackedIps;
    }
    return false;
  }

  recordFailure(ip: string, now: number): void {
    let state = this.states.get(ip);
    if (!state) {
      if (this.states.size >= this.policy.maxTrackedIps) this.sweep(now);
      if (this.states.size >= this.policy.maxTrackedIps) return;
      state = { failures: [], blockedUntil: 0 };
      this.states.set(ip, state);
    }
    state.failures = state.failures.filter((at) => now - at < this.policy.windowMs);
    state.failures.push(now);
    if (state.failures.length >= this.policy.maxFailures) {
      state.blockedUntil = now + this.policy.blockMs;
      state.failures = [];
    }
  }

  /** A right code clears the IP's failures (never a live block: the shell checks isBlocked first). */
  recordSuccess(ip: string, now: number): void {
    const state = this.states.get(ip);
    if (state && now >= state.blockedUntil) this.states.delete(ip);
  }

  /** Forget IPs with no live block and no failure inside the window. */
  sweep(now: number): void {
    for (const [ip, state] of this.states) {
      if (now >= state.blockedUntil && state.failures.every((at) => now - at >= this.policy.windowMs)) this.states.delete(ip);
    }
  }

  trackedIps(): number {
    return this.states.size;
  }
}
