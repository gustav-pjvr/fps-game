import { describe, expect, it, vi } from 'vitest';
import { ROOM_CODE_ALPHABET } from '../src/network/serverEnvelope.ts';
import { CODE_ATTEMPTS, RoomRegistry, TICK_INTERVAL_MS, TOMBSTONE_MS } from './RoomRegistry.ts';
import { createRoom, FakeSocket, makeHarness } from './testSupport.ts';

/** randomInt that spells the given codes in turn, one character per draw. */
const spelling = (...codes: string[]) => {
  const chars = codes.join('');
  let i = 0;
  return (max: number) => {
    expect(max).toBe(ROOM_CODE_ALPHABET.length);
    return ROOM_CODE_ALPHABET.indexOf(chars[i++ % chars.length] ?? 'A');
  };
};

describe('RoomRegistry: codes', () => {
  it('draws codes from crypto.randomInt by default, in the room code format', () => {
    const registry = new RoomRegistry({ maxRooms: 50, maxPlayersPerRoom: 4 }, { clock: () => 0 });
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const socket = new FakeSocket('h');
      registry.create(socket, { op: 'create', username: 'h', maxPlayers: 4 });
      codes.add(socket.ops('created')[0]?.code ?? '');
    }
    for (const code of codes) expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    expect(codes.size).toBe(20);
  });

  it('retries a code that clashes with a live room', () => {
    const harness = makeHarness({}, { randomInt: spelling('AAAAAA', 'AAAAAA', 'BBBBBB') });
    expect(createRoom(harness).code).toBe('AAAAAA');
    expect(createRoom(harness).code).toBe('BBBBBB');
  });

  it('does not hand out a tombstoned code until its 10 minutes are up', () => {
    const harness = makeHarness({}, { randomInt: spelling('AAAAAA', 'AAAAAA', 'CCCCCC', 'AAAAAA') });
    const first = createRoom(harness);
    first.hostMember.disconnected();
    expect(createRoom(harness).code).toBe('CCCCCC');
    harness.advance(TOMBSTONE_MS);
    expect(createRoom(harness).code).toBe('AAAAAA');
  });

  it(`gives up with busy after ${CODE_ATTEMPTS} clashing draws`, () => {
    const harness = makeHarness({}, { randomInt: spelling('AAAAAA') });
    createRoom(harness);
    const socket = new FakeSocket('h2');
    expect(harness.registry.create(socket, { op: 'create', username: 'h', maxPlayers: 4 })).toBeNull();
    expect(socket.ops('rejected')).toEqual([{ op: 'rejected', reason: 'busy' }]);
  });
});

describe('RoomRegistry: timers and counts', () => {
  it('ticks every room once a second through the injected timers, and stops', () => {
    const timers = { setInterval: vi.fn(() => 'handle'), clearInterval: vi.fn() };
    const harness = makeHarness();
    const tick = vi.spyOn(harness.registry, 'tick');
    harness.registry.start(timers);
    harness.registry.start(timers);
    expect(timers.setInterval).toHaveBeenCalledTimes(1);
    expect(timers.setInterval).toHaveBeenCalledWith(expect.any(Function), TICK_INTERVAL_MS);
    const firstCall = timers.setInterval.mock.calls[0] as unknown as [() => void, number];
    firstCall[0]();
    expect(tick).toHaveBeenCalledTimes(1);
    harness.registry.stop();
    expect(timers.clearInterval).toHaveBeenCalledWith('handle');
  });

  it('counts rooms and members', () => {
    const harness = makeHarness();
    createRoom(harness);
    createRoom(harness);
    expect(harness.registry.roomCount()).toBe(2);
    expect(harness.registry.memberCount()).toBe(2);
  });
});
