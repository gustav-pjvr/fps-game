import { describe, expect, it } from 'vitest';
import { FAST_MAX_PROBES, FastChannel, type FastChannelTimers, type FastChannelTransport } from './fastChannel.ts';
import type { NetworkMessage } from './protocol.ts';

// Two fake channels wired back to back, with a manual clock for the probe timer. `drop` loses
// whatever is sent while it is set, the way an unreliable channel can.

class FakeTransport implements FastChannelTransport {
  readyState: RTCDataChannelState = 'connecting';
  bufferedAmount = 0;
  onopen: FastChannelTransport['onopen'] = null;
  onmessage: FastChannelTransport['onmessage'] = null;
  peer: FakeTransport | null = null;
  drop = false;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
    if (!this.drop && this.peer?.readyState === 'open') this.peer.onmessage?.call({} as RTCDataChannel, { data } as MessageEvent);
  }

  close(): void {
    this.readyState = 'closed';
  }

  open(): void {
    this.readyState = 'open';
    this.onopen?.call({} as RTCDataChannel, new Event('open'));
  }
}

class ManualTimers implements FastChannelTimers {
  private handlers = new Map<number, () => void>();
  private next = 1;
  setInterval(handler: () => void): ReturnType<typeof setInterval> {
    const id = this.next++;
    this.handlers.set(id, handler);
    return id as unknown as ReturnType<typeof setInterval>;
  }
  clearInterval(id: ReturnType<typeof setInterval>): void {
    this.handlers.delete(id as unknown as number);
  }
  tick(times = 1): void {
    for (let i = 0; i < times; i++) for (const handler of [...this.handlers.values()]) handler();
  }
  get active(): number {
    return this.handlers.size;
  }
}

const snapshot: NetworkMessage = { type: 'playerSnapshot', senderSlot: 1, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100 };

function pair() {
  const a = new FakeTransport();
  const b = new FakeTransport();
  a.peer = b;
  b.peer = a;
  const timers = new ManualTimers();
  const receivedA: NetworkMessage[] = [];
  const receivedB: NetworkMessage[] = [];
  const fastA = new FastChannel(a, (m) => receivedA.push(m), timers);
  const fastB = new FastChannel(b, (m) => receivedB.push(m), timers);
  return { a, b, timers, fastA, fastB, receivedA, receivedB };
}

describe('FastChannel', () => {
  it('sends nothing until the other side has answered a probe, then carries snapshots both ways', () => {
    const { a, b, fastA, fastB, receivedA, receivedB } = pair();
    expect(fastA.trySend(snapshot)).toBe(false);
    a.open();
    // A probed into a channel B has not opened yet: still unconfirmed.
    expect(fastA.ready).toBe(false);
    b.open();
    expect(fastA.ready).toBe(true);
    expect(fastB.ready).toBe(true);
    expect(fastA.trySend(snapshot)).toBe(true);
    expect(fastB.trySend(snapshot)).toBe(true);
    expect(receivedB).toEqual([snapshot]);
    expect(receivedA).toEqual([snapshot]);
  });

  it('keeps probing through lost packets and stops once heard', () => {
    const { a, b, timers, fastA } = pair();
    a.drop = true;
    b.drop = true;
    a.open();
    b.open();
    timers.tick(3);
    expect(fastA.ready).toBe(false);
    a.drop = false;
    b.drop = false;
    timers.tick();
    expect(fastA.ready).toBe(true);
    expect(timers.active).toBe(0);
  });

  it('two confirmed sides do not keep answering each other', () => {
    const { a, b } = pair();
    a.open();
    b.open();
    const total = a.sent.length + b.sent.length;
    expect(total).toBeLessThanOrEqual(3);
  });

  it('gives up after FAST_MAX_PROBES when the other side never listens (an older build)', () => {
    const a = new FakeTransport();
    const timers = new ManualTimers();
    const fast = new FastChannel(a, () => {}, timers);
    a.open();
    timers.tick(FAST_MAX_PROBES + 5);
    expect(a.sent.length).toBe(FAST_MAX_PROBES);
    expect(timers.active).toBe(0);
    expect(fast.trySend(snapshot)).toBe(false);
  });

  it('ignores reliable-only message types and malformed data arriving on it', () => {
    const { a, b, receivedB } = pair();
    a.open();
    b.open();
    a.send(JSON.stringify({ type: 'damageEvent', senderSlot: 1, targetSlot: 0, amount: 999 }));
    a.send('not json');
    a.send(JSON.stringify({ type: 'nonsense' }));
    expect(receivedB).toEqual([]);
  });

  it('refuses to send while congested or after close', () => {
    const { a, b, fastA } = pair();
    a.open();
    b.open();
    a.bufferedAmount = 1_000_000;
    expect(fastA.trySend(snapshot)).toBe(false);
    a.bufferedAmount = 0;
    fastA.close();
    expect(fastA.trySend(snapshot)).toBe(false);
  });
});
