import { describe, expect, it } from 'vitest';
import {
  AccessFailureLimiter,
  ConnectionCounter,
  GUEST_RATE_LIMIT,
  HOST_RATE_LIMIT,
  JOIN_FAILURE_POLICY,
  MAX_CONNECTIONS_PER_IP,
  MemberRateLimiter,
  RATE_OVER_CLOSE_SECONDS,
  TokenBucket,
} from './limits.ts';

describe('TokenBucket', () => {
  it('allows the burst, then refills at the rate', () => {
    const bucket = new TokenBucket(10, 20, 0);
    for (let i = 0; i < 20; i++) expect(bucket.take(1, 0)).toBe(true);
    expect(bucket.take(1, 0)).toBe(false);
    expect(bucket.take(1, 99)).toBe(false);
    expect(bucket.take(1, 100)).toBe(true);
    expect(bucket.take(1, 100_000)).toBe(true);
    for (let i = 0; i < 19; i++) expect(bucket.take(1, 100_000)).toBe(true);
    expect(bucket.take(1, 100_000)).toBe(false);
  });

  it('ignores a clock that steps backwards', () => {
    const bucket = new TokenBucket(10, 1, 1000);
    expect(bucket.take(1, 1000)).toBe(true);
    expect(bucket.take(1, 0)).toBe(false);
  });
});

describe('MemberRateLimiter', () => {
  it('uses the section 7.4 values', () => {
    expect(GUEST_RATE_LIMIT).toMatchObject({ framesPerSecond: 150, frameBurst: 300, bytesPerSecond: 65_536 });
    expect(HOST_RATE_LIMIT).toMatchObject({ framesPerSecond: 800, frameBurst: 1600, bytesPerSecond: 524_288 });
    expect(RATE_OVER_CLOSE_SECONDS).toBe(10);
  });

  it('drops the frame after the burst and counts it', () => {
    const limiter = new MemberRateLimiter(GUEST_RATE_LIMIT, 0);
    for (let i = 0; i < 300; i++) expect(limiter.check(200, 0)).toBe('ok');
    expect(limiter.check(200, 0)).toBe('drop');
    expect(limiter.dropped).toBe(1);
  });

  it('never drops a member at its sustained rate', () => {
    const limiter = new MemberRateLimiter(GUEST_RATE_LIMIT, 0);
    for (let ms = 0; ms < 60_000; ms += 10) {
      // 150 frames a second: three every 20 ms.
      if (ms % 20 === 0) for (let i = 0; i < 3; i++) expect(limiter.check(200, ms)).toBe('ok');
    }
    expect(limiter.dropped).toBe(0);
  });

  it('drops frames over the byte rate even when frames are few', () => {
    const limiter = new MemberRateLimiter(GUEST_RATE_LIMIT, 0);
    expect(limiter.check(60_000, 0)).toBe('ok');
    expect(limiter.check(60_000, 0)).toBe('ok');
    expect(limiter.check(60_000, 0)).toBe('drop');
  });

  it('closes after 10 seconds in a row over the rate, even when some frames get through', () => {
    const limiter = new MemberRateLimiter(GUEST_RATE_LIMIT, 0);
    const verdicts: string[] = [];
    // Twice the sustained rate: 300 frames a second, spread out, so refills let half through.
    for (let ms = 0; ms <= 12_000 && !verdicts.includes('close'); ms += 10) {
      for (let i = 0; i < 3; i++) verdicts.push(limiter.check(200, ms));
    }
    expect(verdicts).toContain('ok');
    expect(verdicts).toContain('drop');
    const closeAt = verdicts.indexOf('close');
    // The first drop comes after the 300-frame burst (one second at this rate), then 10 over seconds.
    expect(closeAt).toBeGreaterThan(10 * 300);
    expect(closeAt).toBeLessThan(12 * 300);
  });

  it('a quiet second breaks the run', () => {
    const limiter = new MemberRateLimiter({ framesPerSecond: 1, frameBurst: 1, bytesPerSecond: 1e9, byteBurst: 1e9 }, 0);
    let now = 0;
    const overSecond = () => {
      limiter.check(1, now);
      limiter.check(1, now); // over
      now += 1000;
    };
    for (let i = 0; i < 9; i++) overSecond();
    now += 1000; // a whole second with no frame at all
    for (let i = 0; i < 9; i++) overSecond();
    expect(limiter.check(1, now)).not.toBe('close');
    overSecond();
    expect(limiter.check(1, now)).toBe('close');
  });
});

describe('ConnectionCounter', () => {
  it('allows 8 sockets per IP and frees one on release', () => {
    const counter = new ConnectionCounter();
    expect(MAX_CONNECTIONS_PER_IP).toBe(8);
    for (let i = 0; i < 8; i++) expect(counter.acquire('1.2.3.4')).toBe(true);
    expect(counter.acquire('1.2.3.4')).toBe(false);
    expect(counter.acquire('5.6.7.8')).toBe(true);
    counter.release('1.2.3.4');
    expect(counter.acquire('1.2.3.4')).toBe(true);
    expect(counter.countFor('1.2.3.4')).toBe(8);
  });

  it('forgets an IP at zero and ignores an unknown release', () => {
    const counter = new ConnectionCounter(2);
    counter.acquire('a');
    counter.release('a');
    counter.release('a');
    counter.release('never');
    expect(counter.trackedIps()).toBe(0);
    expect(counter.countFor('a')).toBe(0);
  });
});

describe('AccessFailureLimiter', () => {
  it('blocks an IP for 10 minutes after 5 failures in a minute', () => {
    const limiter = new AccessFailureLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure('ip', i * 1000);
    expect(limiter.isBlocked('ip', 4000)).toBe(false);
    limiter.recordFailure('ip', 59_000);
    expect(limiter.isBlocked('ip', 59_000)).toBe(true);
    expect(limiter.isBlocked('ip', 59_000 + 599_999)).toBe(true);
    expect(limiter.isBlocked('ip', 59_000 + 600_000)).toBe(false);
    expect(limiter.isBlocked('other', 59_000)).toBe(false);
  });

  it('does not block failures spread wider than a minute', () => {
    const limiter = new AccessFailureLimiter();
    for (let i = 0; i < 20; i++) limiter.recordFailure('ip', i * 15_001);
    expect(limiter.isBlocked('ip', 20 * 15_001)).toBe(false);
  });

  it('a right code clears earlier failures but never lifts a live block', () => {
    const limiter = new AccessFailureLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure('ip', 0);
    limiter.recordSuccess('ip', 0);
    limiter.recordFailure('ip', 0);
    expect(limiter.isBlocked('ip', 0)).toBe(false);
    for (let i = 0; i < 5; i++) limiter.recordFailure('blocked', 0);
    limiter.recordSuccess('blocked', 1);
    expect(limiter.isBlocked('blocked', 1)).toBe(true);
  });

  it('sweeps stale IPs and stays bounded when flooded from many addresses', () => {
    const limiter = new AccessFailureLimiter({ maxFailures: 5, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 3 });
    for (const ip of ['a', 'b', 'c', 'd']) limiter.recordFailure(ip, 0);
    expect(limiter.trackedIps()).toBe(3);
    // Once the window passes, the sweep frees room again.
    limiter.sweep(60_000);
    expect(limiter.trackedIps()).toBe(0);
  });

  it('when full it forgets the key that failed longest ago and never refuses an unknown key', () => {
    const limiter = new AccessFailureLimiter({ maxFailures: 3, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 3 });
    for (const ip of ['a', 'b', 'c']) limiter.recordFailure(ip, 0);
    // a fails again, so b is now the one that failed longest ago.
    limiter.recordFailure('a', 1);
    for (const ip of ['new-1', 'new-2', 'new-3']) expect(limiter.isBlocked(ip, 2)).toBe(false);
    limiter.recordFailure('d', 2);
    expect(limiter.trackedIps()).toBe(3);
    // b was forgotten; a kept its two failures and blocks on the third.
    limiter.recordFailure('a', 3);
    expect(limiter.isBlocked('a', 3)).toBe(true);
    limiter.recordFailure('b', 3);
    limiter.recordFailure('b', 3);
    expect(limiter.isBlocked('b', 3)).toBe(false);
  });

  it('keeps every live block while a flood of new addresses fills the table', () => {
    const limiter = new AccessFailureLimiter({ maxFailures: 2, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 100 });
    for (const ip of ['x', 'y']) {
      limiter.recordFailure(ip, 0);
      limiter.recordFailure(ip, 0);
    }
    for (let i = 0; i < 10_000; i++) limiter.recordFailure(`flood-${i}`, 1000);
    expect(limiter.isBlocked('x', 1000)).toBe(true);
    expect(limiter.isBlocked('y', 1000)).toBe(true);
    expect(limiter.isBlocked('someone-new', 1000)).toBe(false);
    // At most the counting table plus the blocked table.
    expect(limiter.trackedIps()).toBeLessThanOrEqual(200);
    expect(limiter.isBlocked('x', 600_000)).toBe(false);
  });

  it('a check on a full table does not walk the whole table', () => {
    // The old limiter swept all 50,000 entries on every check while full: 50,000 checks took minutes.
    const limiter = new AccessFailureLimiter();
    for (let i = 0; i < 50_000; i++) limiter.recordFailure(`ip-${i}`, 0);
    const started = performance.now();
    for (let i = 0; i < 50_000; i++) {
      expect(limiter.isBlocked(`other-${i}`, 1000)).toBe(false);
      limiter.recordFailure(`other-${i}`, 1000);
    }
    expect(performance.now() - started).toBeLessThan(5000);
    expect(limiter.trackedIps()).toBe(50_000);
  });

  it('joins with an unknown room code are allowed 20 a minute, then blocked for 10 minutes', () => {
    expect(JOIN_FAILURE_POLICY).toMatchObject({ maxFailures: 20, windowMs: 60_000, blockMs: 600_000 });
    const limiter = new AccessFailureLimiter(JOIN_FAILURE_POLICY);
    for (let i = 0; i < 19; i++) limiter.recordFailure('ip#join', i * 1000);
    expect(limiter.isBlocked('ip#join', 19_000)).toBe(false);
    limiter.recordFailure('ip#join', 19_000);
    expect(limiter.isBlocked('ip#join', 19_000)).toBe(true);
    expect(limiter.isBlocked('ip', 19_000)).toBe(false);
  });
});
