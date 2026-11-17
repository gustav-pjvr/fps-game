import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { SERVER_CLOSE } from '../src/network/serverEnvelope.ts';
import { AccessCodes } from './access.ts';
import { AccessFailureLimiter, JOIN_FAILURE_POLICY } from './limits.ts';
import { createLogger } from './log.ts';
import { Member, SLOW_CONSUMER_CUT_MS, type MemberContext } from './Member.ts';
import { RoomRegistry } from './RoomRegistry.ts';

/**
 * The shell's close of a slow consumer (docs/server-relay-design.md, section 7.4), on a fake ws
 * socket and fake timers: the 4009 close frame is queued for the client, which treats it as final,
 * and the connection is cut shortly after, so a backlog of up to slowCloseBytes never waits for the
 * heartbeat (15 s) or ws's close timeout (30 s). Every other close keeps the plain close handshake.
 * Real sockets are in main.test.ts.
 */

class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  readonly closes: [number, string][] = [];
  terminated = 0;
  readonly send = vi.fn();
  readonly ping = vi.fn();

  close(code: number, reason: string): void {
    this.closes.push([code, reason]);
    this.readyState = 2;
  }

  terminate(): void {
    this.terminated++;
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', 1006, Buffer.alloc(0));
  }
}

let ws: FakeWs;
let member: Member;

beforeEach(() => {
  vi.useFakeTimers();
  ws = new FakeWs();
  const ctx: MemberContext = {
    registry: new RoomRegistry({ maxRooms: 50, maxPlayersPerRoom: 4 }, { clock: Date.now }),
    access: new AccessCodes(['member-test-access-code']),
    failures: new AccessFailureLimiter(),
    joinFailures: new AccessFailureLimiter(JOIN_FAILURE_POLICY),
    log: createLogger('error', () => {}),
    clock: Date.now,
    helloDeadlineMs: 5000,
    heartbeatTimeoutMs: 15_000,
    probeTimeoutMs: 2000,
    slowConsumerCutMs: SLOW_CONSUMER_CUT_MS,
    onEnded: () => {},
  };
  member = new Member(ws as unknown as WebSocket, '198.51.100.1', ctx);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Member: a slow consumer is cut, not left to linger', () => {
  it('sends the 4009 close, then terminates the socket after SLOW_CONSUMER_CUT_MS', () => {
    expect(SLOW_CONSUMER_CUT_MS).toBeLessThanOrEqual(1000);
    member.close(SERVER_CLOSE.slowConsumer, 'slow consumer');
    expect(ws.closes).toEqual([[SERVER_CLOSE.slowConsumer, 'slow consumer']]);
    vi.advanceTimersByTime(SLOW_CONSUMER_CUT_MS - 1);
    expect(ws.terminated).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ws.terminated).toBe(1);
  });

  it('does not cut a socket whose close handshake finished in time', () => {
    member.close(SERVER_CLOSE.slowConsumer, 'slow consumer');
    ws.readyState = 3;
    ws.emit('close', SERVER_CLOSE.slowConsumer, Buffer.alloc(0));
    vi.advanceTimersByTime(60_000);
    expect(ws.terminated).toBe(0);
  });

  it('keeps the plain close handshake for every other close', () => {
    member.close(SERVER_CLOSE.rateLimited, 'rate limited');
    vi.advanceTimersByTime(60_000);
    expect(ws.closes).toEqual([[SERVER_CLOSE.rateLimited, 'rate limited']]);
    expect(ws.terminated).toBe(0);
  });
});
