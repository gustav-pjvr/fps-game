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

/** Rooms one client IP may hold open at once (its creates), so one person cannot take every room. */
export const MAX_ROOMS_PER_IP = 3;

export interface AccessFailurePolicy {
  maxFailures: number;
  windowMs: number;
  blockMs: number;
  /** Most keys kept at once, in the counting table and again in the blocked table. A full table
   * forgets its oldest entry; an unknown key is never refused for want of room. */
  maxTrackedIps: number;
}

/** Section 5.3: 5 failures a minute, then a 10 minute block. */
export const ACCESS_FAILURE_POLICY: AccessFailurePolicy = { maxFailures: 5, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 50_000 };

/** Joins with a room code that names no open room (section 4.2): 20 a minute, then a 10 minute block
 * of joins, so room codes cannot be walked. A real player mistypes a code a few times, not 20. */
export const JOIN_FAILURE_POLICY: AccessFailurePolicy = { maxFailures: 20, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 50_000 };

/**
 * Failed attempts per key (an IP group, or one with a suffix such as `#resume`). The shell asks
 * isBlocked before it compares anything, so a blocked key learns nothing from guessing.
 *
 * Memory stays bounded without ever refusing an unknown key. Keys still counting live in one table in
 * the order they last failed; when it is full the one that failed longest ago is forgotten. Blocked
 * keys live in a second table in the order they were blocked, which is the order their blocks end
 * (blockMs is fixed), so a flood of new keys never pushes a live block out; only when that table is
 * full as well does the block nearest its end go early. Stale entries are pruned from the front of
 * each table on every call, stopping at the first live one: a few steps at a time, never a walk over
 * the whole table.
 */
export class AccessFailureLimiter {
  /** Failure times inside the window, per key, least recently failed first. */
  private readonly counting = new Map<string, number[]>();
  /** When each block ends, per key, soonest first. */
  private readonly blocked = new Map<string, number>();
  private readonly policy: AccessFailurePolicy;

  constructor(policy: AccessFailurePolicy = ACCESS_FAILURE_POLICY) {
    this.policy = policy;
  }

  isBlocked(key: string, now: number): boolean {
    this.sweep(now);
    const until = this.blocked.get(key);
    return until !== undefined && now < until;
  }

  recordFailure(key: string, now: number): void {
    if (this.isBlocked(key, now)) return;
    const failures = (this.counting.get(key) ?? []).filter((at) => now - at < this.policy.windowMs);
    // Taken out and put back at the end: the most recently failed key.
    this.counting.delete(key);
    failures.push(now);
    if (failures.length >= this.policy.maxFailures) {
      this.blocked.delete(key);
      if (this.blocked.size >= this.policy.maxTrackedIps) this.dropOldest(this.blocked);
      this.blocked.set(key, now + this.policy.blockMs);
      return;
    }
    if (this.counting.size >= this.policy.maxTrackedIps) this.dropOldest(this.counting);
    this.counting.set(key, failures);
  }

  /** A right code clears the key's failures (never a live block: the shell checks isBlocked first). */
  recordSuccess(key: string, now: number): void {
    if (!this.isBlocked(key, now)) this.counting.delete(key);
  }

  /** Forget ended blocks and keys with no failure inside the window, from the front of each table
   * up to the first entry that is still live (both tables are kept in time order). */
  sweep(now: number): void {
    for (const [key, until] of this.blocked) {
      if (now < until) break;
      this.blocked.delete(key);
    }
    for (const [key, failures] of this.counting) {
      const last = failures[failures.length - 1] ?? Number.NEGATIVE_INFINITY;
      if (now - last < this.policy.windowMs) break;
      this.counting.delete(key);
    }
  }

  trackedIps(): number {
    return this.counting.size + this.blocked.size;
  }

  private dropOldest(table: Map<string, unknown>): void {
    const oldest = table.keys().next();
    if (!oldest.done) table.delete(oldest.value);
  }
}
