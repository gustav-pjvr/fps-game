import { describe, expect, it, vi } from 'vitest';
import { ROOM_CODE_ALPHABET } from '../src/network/serverEnvelope.ts';
import { MAX_ROOMS_PER_IP } from './limits.ts';
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

describe('RoomRegistry: rooms per IP', () => {
  const create = (harness: ReturnType<typeof makeHarness>, ip: string) => {
    const socket = new FakeSocket('host', ip);
    return { socket, member: harness.registry.create(socket, { op: 'create', username: 'h', maxPlayers: 4 }) };
  };

  it('lets one IP key hold 3 open rooms; the next create is refused busy, another IP still gets one', () => {
    expect(MAX_ROOMS_PER_IP).toBe(3);
    const harness = makeHarness();
    const first = create(harness, '198.51.100.1');
    for (let i = 0; i < 2; i++) expect(create(harness, '198.51.100.1').member).not.toBeNull();
    const fourth = create(harness, '198.51.100.1');
    expect(fourth.member).toBeNull();
    expect(fourth.socket.ops('rejected')).toEqual([{ op: 'rejected', reason: 'busy' }]);
    expect(create(harness, '198.51.100.2').member).not.toBeNull();
    expect(harness.registry.roomCount()).toBe(4);
    // A room that closes gives its place back.
    first.member?.disconnected(false);
    expect(harness.registry.roomCount()).toBe(3);
    expect(create(harness, '198.51.100.1').member).not.toBeNull();
    expect(create(harness, '198.51.100.1').member).toBeNull();
  });

  it('caps rooms per IPv6 /48 as well: one person holding a /48 cannot take more rooms through other /64s', () => {
    const harness = makeHarness();
    const createFrom = (key: string, wide: string | null) => {
      const socket = new FakeSocket('host', key, wide);
      return { socket, member: harness.registry.create(socket, { op: 'create', username: 'h', maxPlayers: 4 }) };
    };
    const opened = [1, 2, 3].map((i) => createFrom(`2001:db8:1:${i}::/64`, '2001:db8:1::/48'));
    for (const room of opened) expect(room.member).not.toBeNull();
    const fourth = createFrom('2001:db8:1:9::/64', '2001:db8:1::/48');
    expect(fourth.member).toBeNull();
    expect(fourth.socket.ops('rejected')).toEqual([{ op: 'rejected', reason: 'busy' }]);
    // Another /48 is not affected, and a closed room gives its place back to the /48.
    expect(createFrom('2001:db8:2:1::/64', '2001:db8:2::/48').member).not.toBeNull();
    opened[0]!.member?.disconnected(false);
    expect(createFrom('2001:db8:1:9::/64', '2001:db8:1::/48').member).not.toBeNull();
  });

  it('isOpen is true only for a room that is open now', () => {
    const harness = makeHarness();
    const room = createRoom(harness);
    expect(harness.registry.isOpen(room.code)).toBe(true);
    expect(harness.registry.isOpen('ZZZZZZ')).toBe(false);
    room.hostMember.disconnected(false);
    expect(harness.registry.isOpen(room.code)).toBe(false);
  });
});
