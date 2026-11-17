import { beforeEach, describe, expect, it } from 'vitest';
import { HOST_SLOT, type NetworkMessage } from '../src/network/protocol.ts';
import { ROOM_CODE_ALPHABET, SERVER_CLOSE } from '../src/network/serverEnvelope.ts';
import { DEFAULT_ROOM_TIMING } from './Room.ts';
import { TOMBSTONE_MS } from './RoomRegistry.ts';
import { createRoom, FakeSocket, fireEvent, joinGuest, makeHarness, requestJoin, send, snapshot, welcomeFor, wireLog, type Harness, type HostedRoom } from './testSupport.ts';

let h: Harness;
let room: HostedRoom;

beforeEach(() => {
  wireLog.length = 0;
  h = makeHarness();
  room = createRoom(h);
});

const roomOf = (harness: Harness, code: string) => {
  const found = harness.registry.roomByCode(code);
  if (!found) throw new Error('room gone');
  return found;
};

describe('Room: create', () => {
  it('answers created with a code in the room code format and puts the host in slot 0', () => {
    expect(room.host.ops('created')).toEqual([{ op: 'created', code: room.code, slot: 0 }]);
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect([...room.code].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
    expect(room.hostMember.slot).toBe(HOST_SLOT);
    expect(roomOf(h, room.code).liveSlots()).toEqual([0]);
  });
});

describe('Room: join and admission', () => {
  it('makes a joining guest pending and asks the host, telling the guest nothing yet', () => {
    const guest = requestJoin(h, room, 'Bob', 'tok-bob');
    expect(guest.slot).toBe(1);
    expect(room.host.ops('joinRequest')).toEqual([
      { op: 'joinRequest', slot: 1, outcome: 'joined', username: 'Bob', rejoinToken: 'tok-bob', features: ['facility'], peerId: 'srv-1-1' },
    ]);
    expect(guest.socket.sent).toEqual([]);
    expect(roomOf(h, room.code).pendingSlots()).toEqual([1]);
  });

  it('delivers the welcome as a game frame from slot 0 before it tells the host admitted', () => {
    const guest = requestJoin(h, room, 'Bob');
    wireLog.length = 0;
    send(room.hostMember, { op: 'joinAnswer', slot: 1, welcome: welcomeFor(1) });
    expect(guest.socket.games()).toEqual([{ f: 0, m: welcomeFor(1) }]);
    expect(wireLog[0]?.startsWith('Bob:')).toBe(true);
    // The host's second reliable frame, after the joinRequest (section 5.6).
    expect(wireLog[1]).toBe('host:' + JSON.stringify({ s: 2, op: 'admitted', slot: 1 }));
    expect(roomOf(h, room.code).liveSlots()).toEqual([0, 1]);
    // CreateRoomScreen's onConnected broadcast must reach the new guest.
    send(room.hostMember, { m: { type: 'lobbyReadyUpdate', readySlots: [0] } });
    expect(guest.socket.games().at(-1)).toEqual({ f: 0, m: { type: 'lobbyReadyUpdate', readySlots: [0] } });
  });

  it('refuses a welcome whose yourSlot is not the assigned slot, or that fails isNetworkMessage', () => {
    const guest = requestJoin(h, room, 'Bob');
    send(room.hostMember, { op: 'joinAnswer', slot: 1, welcome: welcomeFor(2) });
    send(room.hostMember, { op: 'joinAnswer', slot: 1, welcome: { ...welcomeFor(1), type: 'nope' } });
    send(room.hostMember, { op: 'joinAnswer', slot: 1, welcome: { ...welcomeFor(1), isRejoin: 'yes' } });
    expect(guest.socket.sent).toEqual([]);
    expect(roomOf(h, room.code).pendingSlots()).toEqual([1]);
    expect(roomOf(h, room.code).dropCount('malformed')).toBe(3);
  });

  it('ignores a joinAnswer for a slot nobody is waiting on', () => {
    send(room.hostMember, { op: 'joinAnswer', slot: 2, welcome: welcomeFor(2) });
    expect(roomOf(h, room.code).dropCount('unknownSlot')).toBe(1);
    expect(room.host.ops('admitted')).toEqual([]);
  });

  it('answers notFound for an unknown code and closes the socket', () => {
    const socket = new FakeSocket('lost');
    expect(h.registry.join(socket, { op: 'join', code: 'ZZZZZZ', username: 'x', rejoinToken: null })).toBeNull();
    expect(socket.ops('rejected')).toEqual([{ op: 'rejected', reason: 'notFound' }]);
    expect(socket.closed?.code).toBe(SERVER_CLOSE.normal);
  });
});

describe('Room: capacity from config', () => {
  it.each([3, 4])('with HNG_MAX_PLAYERS_PER_ROOM %i admits that many players and refuses the next as full', (maxPlayersPerRoom) => {
    const harness = makeHarness({ maxPlayersPerRoom });
    const hosted = createRoom(harness, 4);
    expect(roomOf(harness, hosted.code).capacity).toBe(maxPlayersPerRoom);
    for (let i = 1; i < maxPlayersPerRoom; i++) expect(joinGuest(harness, hosted, `G${i}`).slot).toBe(i);
    const extra = new FakeSocket('extra');
    expect(harness.registry.join(extra, { op: 'join', code: hosted.code, username: 'extra', rejoinToken: null })).toBeNull();
    expect(extra.ops('rejected')).toEqual([{ op: 'rejected', reason: 'full' }]);
    expect(extra.closed?.code).toBe(SERVER_CLOSE.normal);
  });

  it('takes the smaller of the requested size and the config', () => {
    const harness = makeHarness({ maxPlayersPerRoom: 4 });
    expect(roomOf(harness, createRoom(harness, 2).code).capacity).toBe(2);
    expect(roomOf(harness, createRoom(harness, 200).code).capacity).toBe(4);
    expect(makeHarness({ maxPlayersPerRoom: 16 }).registry.capacityFor(16)).toBe(4);
  });
});

describe('Room: rejection and the answer timeout', () => {
  it('passes the host reject to the guest, closes it and frees the slot (host told expired)', () => {
    const guest = requestJoin(h, room, 'Bob');
    send(room.hostMember, { op: 'joinAnswer', slot: 1, reject: 'outdated' });
    expect(guest.socket.ops('rejected')).toEqual([{ op: 'rejected', reason: 'outdated' }]);
    expect(guest.socket.closed?.code).toBe(SERVER_CLOSE.normal);
    expect(room.host.ops('expired')).toEqual([{ op: 'expired', slot: 1 }]);
    expect(roomOf(h, room.code).memberCount()).toBe(1);
    expect(requestJoin(h, room, 'Cara').slot).toBe(1);
  });

  it('a full reject from the host is passed on as full', () => {
    const guest = requestJoin(h, room, 'Bob');
    send(room.hostMember, { op: 'joinAnswer', slot: 1, reject: 'full' });
    expect(guest.socket.ops('rejected')).toEqual([{ op: 'rejected', reason: 'full' }]);
  });

  it('releases the slot with busy when the host does not answer within 30 s', () => {
    const guest = requestJoin(h, room, 'Bob');
    h.runSeconds(29);
    expect(guest.socket.ops('rejected')).toEqual([]);
    h.runSeconds(1);
    expect(guest.socket.ops('rejected')).toEqual([{ op: 'rejected', reason: 'busy' }]);
    expect(guest.socket.closed?.code).toBe(SERVER_CLOSE.normal);
    expect(room.host.ops('expired')).toEqual([{ op: 'expired', slot: 1 }]);
    // A late answer for the released slot does nothing.
    send(room.hostMember, { op: 'joinAnswer', slot: 1, welcome: welcomeFor(1) });
    expect(guest.socket.games()).toEqual([]);
    expect(requestJoin(h, room, 'Cara').slot).toBe(1);
  });

  it('a pending guest that disconnects frees its slot and the host is told', () => {
    const guest = requestJoin(h, room, 'Bob');
    guest.member.disconnected();
    expect(room.host.ops('expired')).toEqual([{ op: 'expired', slot: 1 }]);
    expect(roomOf(h, room.code).memberCount()).toBe(1);
  });
});

describe('Room: token takeover', () => {
  it('closes the old member with 4011 once the new one is admitted, and ignores its later close', () => {
    const old = joinGuest(h, room, 'Bob', 'tok-bob');
    const fresh = requestJoin(h, room, 'Bob', 'tok-bob');
    expect(fresh.slot).toBe(1);
    expect(room.host.ops('joinRequest').at(-1)).toMatchObject({ slot: 1, outcome: 'rejoined' });
    // Until the answer the old socket still holds the slot.
    expect(old.socket.closed).toBeNull();
    send(room.hostMember, { m: snapshot(0) });
    expect(old.socket.games().at(-1)?.m.type).toBe('playerSnapshot');
    expect(fresh.socket.games()).toEqual([]);

    send(room.hostMember, { op: 'joinAnswer', slot: 1, welcome: welcomeFor(1, true) });
    expect(old.socket.closed?.code).toBe(SERVER_CLOSE.replaced);
    room.host.clear();
    old.member.disconnected();
    old.member.receive(JSON.stringify({ m: snapshot(1) }));
    expect(room.host.sent).toEqual([]);
    expect(roomOf(h, room.code).liveSlots()).toEqual([0, 1]);
    send(fresh.member, { m: snapshot(1) });
    expect(room.host.games()).toEqual([{ f: 1, m: snapshot(1) }]);
  });

  it('leaves the old member in place when the host turns the takeover away', () => {
    const old = joinGuest(h, room, 'Bob', 'tok-bob');
    const fresh = requestJoin(h, room, 'Bob', 'tok-bob');
    room.host.clear();
    send(room.hostMember, { op: 'joinAnswer', slot: 1, reject: 'outdated' });
    expect(fresh.socket.closed?.code).toBe(SERVER_CLOSE.normal);
    expect(old.socket.closed).toBeNull();
    expect(room.host.sent).toEqual([]);
    expect(roomOf(h, room.code).liveSlots()).toEqual([0, 1]);
  });

  it('a second join with the same token replaces the first while both wait', () => {
    const first = requestJoin(h, room, 'Bob', 'tok-bob');
    const second = requestJoin(h, room, 'Bob', 'tok-bob');
    expect(first.socket.closed?.code).toBe(SERVER_CLOSE.replaced);
    send(room.hostMember, { op: 'joinAnswer', slot: 1, welcome: welcomeFor(1) });
    expect(second.socket.games().length).toBe(1);
    expect(first.socket.games()).toEqual([]);
  });
});

describe('Room: reservation and expiry', () => {
  it('reserves a dropped guest slot for 90 s, lets the token back in, then expires it', () => {
    const harness = makeHarness({ maxPlayersPerRoom: 2 });
    const hosted = createRoom(harness);
    const bob = joinGuest(harness, hosted, 'Bob', 'tok-bob');
    bob.member.disconnected();
    expect(hosted.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 1 }]);

    // A stranger finds the room full while the slot is reserved.
    const stranger = new FakeSocket('stranger');
    expect(harness.registry.join(stranger, { op: 'join', code: hosted.code, username: 'S', rejoinToken: null })).toBeNull();
    expect(stranger.ops('rejected')[0]?.reason).toBe('full');

    harness.runSeconds(60);
    const back = requestJoin(harness, hosted, 'Bob', 'tok-bob');
    expect(back.slot).toBe(1);
    expect(hosted.host.ops('joinRequest').at(-1)?.outcome).toBe('rejoined');
    back.member.disconnected();
    expect(hosted.host.ops('memberLeft').length).toBe(2);

    harness.runSeconds(89);
    expect(hosted.host.ops('expired')).toEqual([]);
    harness.runSeconds(1);
    expect(hosted.host.ops('expired')).toEqual([{ op: 'expired', slot: 1 }]);
    expect(requestJoin(harness, hosted, 'Cara').slot).toBe(1);
  });

  it('a timed-out rejoin puts the slot back to a reservation (host told memberLeft)', () => {
    const bob = joinGuest(h, room, 'Bob', 'tok-bob');
    bob.member.disconnected();
    room.host.clear();
    requestJoin(h, room, 'Bob', 'tok-bob');
    h.runSeconds(30);
    expect(room.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 1 }]);
    expect(room.host.ops('expired')).toEqual([]);
    h.runSeconds(DEFAULT_ROOM_TIMING.graceMs / 1000);
    expect(room.host.ops('expired')).toEqual([{ op: 'expired', slot: 1 }]);
  });
});

describe('Room: kick and leave', () => {
  it('kick closes the guest with 4010, keeps its slot reserved and tells the host memberLeft', () => {
    const bob = joinGuest(h, room, 'Bob', 'tok-bob');
    send(room.hostMember, { op: 'kick', slot: 1 });
    expect(bob.socket.closed?.code).toBe(SERVER_CLOSE.kicked);
    expect(room.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 1 }]);
    bob.member.disconnected();
    expect(room.host.ops('memberLeft').length).toBe(1);
    expect(requestJoin(h, room, 'Bob', 'tok-bob').slot).toBe(1);
    expect(room.host.ops('joinRequest').at(-1)?.outcome).toBe('rejoined');
  });

  it('a kick for a slot with no live guest does nothing', () => {
    const pending = requestJoin(h, room, 'Bob');
    send(room.hostMember, { op: 'kick', slot: 1 });
    send(room.hostMember, { op: 'kick', slot: 3 });
    expect(pending.socket.closed).toBeNull();
    expect(roomOf(h, room.code).dropCount('unknownSlot')).toBe(2);
  });

  it('leave closes the socket normally and tells the host', () => {
    const bob = joinGuest(h, room, 'Bob');
    send(bob.member, { op: 'leave' });
    expect(bob.socket.closed?.code).toBe(SERVER_CLOSE.normal);
    expect(room.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 1 }]);
  });
});

describe('Room: host leaves, cleanup, limits', () => {
  it('closes the room when the host leaves: roomClosed hostLeft to every guest, then 4004', () => {
    const bob = joinGuest(h, room, 'Bob');
    const cara = requestJoin(h, room, 'Cara');
    wireLog.length = 0;
    room.hostMember.disconnected();
    for (const guest of [bob, cara]) {
      expect(guest.socket.ops('roomClosed')).toEqual([{ op: 'roomClosed', reason: 'hostLeft' }]);
      expect(guest.socket.closed?.code).toBe(SERVER_CLOSE.roomClosed);
      const sentAt = wireLog.indexOf(`${guest.socket.name}:${JSON.stringify({ op: 'roomClosed', reason: 'hostLeft' })}`);
      expect(sentAt).toBeGreaterThanOrEqual(0);
      expect(wireLog.indexOf(`${guest.socket.name}:close:4004`)).toBeGreaterThan(sentAt);
    }
    expect(h.registry.roomCount()).toBe(0);
    // Later frames and closes from the guests are ignored.
    bob.member.disconnected();
    send(bob.member, { m: snapshot(1) });
  });

  it('an empty room closes at once and its code is tombstoned for 10 minutes', () => {
    room.hostMember.disconnected();
    expect(h.registry.roomCount()).toBe(0);
    expect(h.registry.isTombstoned(room.code)).toBe(true);
    const late = new FakeSocket('late');
    expect(h.registry.join(late, { op: 'join', code: room.code, username: 'late', rejoinToken: null })).toBeNull();
    expect(late.ops('rejected')[0]?.reason).toBe('notFound');
    h.advance(TOMBSTONE_MS);
    h.registry.tick();
    expect(h.registry.isTombstoned(room.code)).toBe(false);
  });

  it('a host alone with no match for 2 h is closed idle; a match start or a guest keeps it open', () => {
    h.runSeconds(2 * 3600 - 1);
    expect(h.registry.roomCount()).toBe(1);
    h.runSeconds(1);
    expect(room.host.ops('roomClosed')).toEqual([{ op: 'roomClosed', reason: 'idle' }]);
    expect(room.host.closed?.code).toBe(SERVER_CLOSE.roomClosed);

    const second = createRoom(h);
    h.runSeconds(3600);
    send(second.hostMember, { m: { type: 'matchStart', seed: 1, killLimit: 10, gooseDifficulty: 'normal', gameMode: 'default', weather: 'day', spawns: [], roster: [] } });
    h.runSeconds(2 * 3600 - 1);
    expect(h.registry.roomByCode(second.code)).toBeDefined();
    h.runSeconds(1);
    expect(h.registry.roomByCode(second.code)).toBeUndefined();

    const third = createRoom(h);
    joinGuest(h, third, 'Bob');
    h.runSeconds(3 * 3600);
    expect(h.registry.roomByCode(third.code)).toBeDefined();
  });

  it('closes any room older than 12 h as expired', () => {
    const bob = joinGuest(h, room, 'Bob');
    h.runSeconds(12 * 3600);
    expect(bob.socket.ops('roomClosed')).toEqual([{ op: 'roomClosed', reason: 'expired' }]);
    expect(h.registry.roomCount()).toBe(0);
  });

  it('refuses a create above HNG_MAX_ROOMS with busy', () => {
    const harness = makeHarness({ maxRooms: 2 });
    createRoom(harness);
    createRoom(harness);
    const third = new FakeSocket('third');
    expect(harness.registry.create(third, { op: 'create', username: 'x', maxPlayers: 4 })).toBeNull();
    expect(third.ops('rejected')).toEqual([{ op: 'rejected', reason: 'busy' }]);
    expect(third.closed?.code).toBe(SERVER_CLOSE.normal);
  });

  it('closeAll sends roomClosed shutdown to everyone', () => {
    const bob = joinGuest(h, room, 'Bob');
    h.registry.closeAll();
    expect(room.host.ops('roomClosed')).toEqual([{ op: 'roomClosed', reason: 'shutdown' }]);
    expect(bob.socket.ops('roomClosed')).toEqual([{ op: 'roomClosed', reason: 'shutdown' }]);
    expect(h.registry.roomCount()).toBe(0);
  });
});

describe('Room: pending members', () => {
  it('a pending member receives no game frames and its own game frames are dropped', () => {
    const bob = joinGuest(h, room, 'Bob');
    const cara = requestJoin(h, room, 'Cara');
    send(room.hostMember, { m: { type: 'lobbyReadyUpdate', readySlots: [0] } });
    send(bob.member, { m: snapshot(1) });
    send(room.hostMember, { m: { type: 'pickupState', available: '1' }, to: 2 });
    h.runSeconds(2);
    expect(cara.socket.games()).toEqual([]);
    expect(cara.socket.ops('quality')).toEqual([]);

    room.host.clear();
    bob.socket.clear();
    send(cara.member, { m: snapshot(2) });
    send(cara.member, { m: { type: 'playerReady', slot: 2, ready: true } });
    expect(room.host.games()).toEqual([]);
    expect(bob.socket.games()).toEqual([]);
    expect(roomOf(h, room.code).dropCount('pending')).toBe(2);
  });

  it('a pending member still gets pongs, so a slow host answer does not look like a lost server', () => {
    const cara = requestJoin(h, room, 'Cara');
    send(cara.member, { op: 'ping', n: 7, t: 123.5, rtt: null });
    expect(cara.socket.ops('pong')).toEqual([{ op: 'pong', n: 7, t: 123.5 }]);
  });
});

describe('Room: routing and sender checks', () => {
  let bob: ReturnType<typeof joinGuest>;
  let cara: ReturnType<typeof joinGuest>;
  beforeEach(() => {
    bob = joinGuest(h, room, 'Bob');
    cara = joinGuest(h, room, 'Cara');
    for (const s of [room.host, bob.socket, cara.socket]) s.clear();
  });

  it('relays class R to every other live member, host included, stamped with the sender', () => {
    send(bob.member, { m: snapshot(1) });
    expect(room.host.games()).toEqual([{ f: 1, m: snapshot(1) }]);
    expect(cara.socket.games()).toEqual([{ f: 1, m: snapshot(1) }]);
    expect(bob.socket.games()).toEqual([]);
  });

  it('sends class H to the host only, with the true sender in f', () => {
    const hit: NetworkMessage = { type: 'bonusGooseHitEvent', senderSlot: 2, id: 'bonus-1' };
    send(cara.member, { m: hit });
    expect(room.host.games()).toEqual([{ f: 2, m: hit }]);
    expect(bob.socket.games()).toEqual([]);
    send(cara.member, { m: { type: 'pickupClaim', id: 3 } });
    expect(room.host.games().at(-1)).toEqual({ f: 2, m: { type: 'pickupClaim', id: 3 } });
  });

  it('sends class B from the host to every live guest, or to one with to', () => {
    send(room.hostMember, { m: { type: 'pickupTaken', id: 1, slot: 2, respawnIn: 30 } });
    expect(bob.socket.games().length).toBe(1);
    expect(cara.socket.games().length).toBe(1);
    expect(room.host.games()).toEqual([]);
    send(room.hostMember, { m: { type: 'pickupState', available: '101' }, to: 2 });
    expect(cara.socket.games().at(-1)).toEqual({ f: 0, m: { type: 'pickupState', available: '101' } });
    expect(bob.socket.games().length).toBe(1);
  });

  it('a guest cannot send a host-authored type', () => {
    send(bob.member, { m: { type: 'matchEnded', winnerSlot: 1, scoreboard: [] } });
    send(bob.member, { m: { type: 'gooseSnapshot', id: 'g', x: 0, y: 0, z: 0, yaw: 0 } });
    send(bob.member, { m: { type: 'playerLeft', slot: 2 } });
    expect(room.host.games()).toEqual([]);
    expect(cara.socket.games()).toEqual([]);
    expect(roomOf(h, room.code).dropCount('notAllowed')).toBe(3);
  });

  it('a guest cannot spoof another senderSlot, a self slot or a victim', () => {
    send(bob.member, { m: snapshot(2) });
    send(bob.member, { m: snapshot(0) });
    send(bob.member, { m: { type: 'playerReady', slot: 2, ready: true } });
    send(bob.member, { m: { type: 'playerDied', senderSlot: 1, victimSlot: 2, killerSlot: 1 } });
    expect(room.host.games()).toEqual([]);
    expect(cara.socket.games()).toEqual([]);
    expect(roomOf(h, room.code).dropCount('notAllowed')).toBe(4);
  });

  it('a guest cannot use to', () => {
    send(bob.member, { m: snapshot(1), to: 2 });
    send(bob.member, { m: { type: 'pickupClaim', id: 1 }, to: 0 });
    expect(room.host.games()).toEqual([]);
    expect(cara.socket.games()).toEqual([]);
    expect(roomOf(h, room.code).dropCount('badTarget')).toBe(2);
  });

  it('the host may target only a live admitted guest, and only with a host broadcast', () => {
    const dana = requestJoin(h, room, 'Dana');
    send(room.hostMember, { m: { type: 'pickupState', available: '1' }, to: dana.slot });
    send(room.hostMember, { m: { type: 'pickupState', available: '1' }, to: 0 });
    send(room.hostMember, { m: snapshot(0), to: 1 });
    expect(dana.socket.games()).toEqual([]);
    expect(room.host.games()).toEqual([]);
    expect(bob.socket.games()).toEqual([]);
    expect(roomOf(h, room.code).dropCount('badTarget')).toBe(3);
  });

  it('a guest cannot send kick or joinAnswer', () => {
    const dana = requestJoin(h, room, 'Dana');
    send(bob.member, { op: 'kick', slot: 2 });
    send(bob.member, { op: 'joinAnswer', slot: dana.slot, welcome: welcomeFor(dana.slot) });
    send(bob.member, { op: 'joinAnswer', slot: dana.slot, reject: 'full' });
    expect(cara.socket.closed).toBeNull();
    expect(dana.socket.sent).toEqual([]);
    expect(roomOf(h, room.code).pendingSlots()).toEqual([dana.slot]);
    expect(roomOf(h, room.code).dropCount('hostOnlyOp')).toBe(3);
  });

  it('drops server-handled and mesh types inside a game frame', () => {
    send(bob.member, { m: { type: 'hello', username: 'x', rejoinToken: null } });
    send(room.hostMember, { m: welcomeFor(1) });
    send(bob.member, { m: { type: 'meshHello', slot: 1, roomCode: room.code } });
    send(bob.member, { m: { type: 'meshStatus', senderSlot: 1, linked: [] } });
    expect([room.host, bob.socket, cara.socket].every((s) => s.games().length === 0)).toBe(true);
    expect(roomOf(h, room.code).dropCount('unroutable')).toBe(4);
  });

  it('drops malformed frames and room-level ops sent inside a room', () => {
    bob.member.receive('{not json');
    bob.member.receive(JSON.stringify({ m: { type: 'playerSnapshot', senderSlot: 9 } }));
    send(bob.member, { op: 'create', username: 'x', maxPlayers: 4 });
    expect(roomOf(h, room.code).dropCount('malformed')).toBe(2);
    expect(roomOf(h, room.code).dropCount('unexpectedOp')).toBe(1);
  });

  it('survives a message JSON cannot re-encode and a socket that throws on send', () => {
    const deep = '['.repeat(30_000) + ']'.repeat(30_000);
    const text = `{"m":{"type":"footstepEvent","senderSlot":1,"x":0,"y":0,"z":0,"extra":${deep}}}`;
    expect(() => bob.member.receive(text)).not.toThrow();
    cara.socket.throwOnSend = true;
    expect(() => send(bob.member, { m: snapshot(1) })).not.toThrow();
    expect(room.host.games().at(-1)).toEqual({ f: 1, m: snapshot(1) });
  });
});

describe('Room: rate limits', () => {
  it('drops a guest frame over the burst and counts it', () => {
    const bob = joinGuest(h, room, 'Bob');
    room.host.clear();
    for (let i = 0; i < 301; i++) send(bob.member, { m: snapshot(1) });
    expect(room.host.games().length).toBe(300);
    expect(roomOf(h, room.code).dropCount('rate')).toBe(1);
    expect(bob.socket.closed).toBeNull();
  });

  it('closes a guest over its rate for 10 s in a row with 4008, and the host is told', () => {
    const bob = joinGuest(h, room, 'Bob');
    for (let second = 0; second < 11 && !bob.socket.closed; second++) {
      for (let i = 0; i < 300; i++) send(bob.member, { m: snapshot(1) });
      h.advance(1000);
    }
    send(bob.member, { m: snapshot(1) });
    expect(bob.socket.closed?.code).toBe(SERVER_CLOSE.rateLimited);
    expect(room.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 1 }]);
  });

  it('gives the host the larger host rate', () => {
    const bob = joinGuest(h, room, 'Bob');
    bob.socket.clear();
    h.advance(10_000); // refill after the joinAnswer
    for (let i = 0; i < 1600; i++) send(room.hostMember, { m: { type: 'gooseSnapshot', id: 'g', x: 0, y: 0, z: 0, yaw: 0 } });
    expect(bob.socket.games().length).toBe(1600);
    send(room.hostMember, { m: { type: 'gooseSnapshot', id: 'g', x: 0, y: 0, z: 0, yaw: 0 } });
    expect(bob.socket.games().length).toBe(1600);
  });
});

describe('Room: slow consumers', () => {
  it('skips snapshots to a member above 64 KiB buffered but keeps reliable frames', () => {
    const bob = joinGuest(h, room, 'Bob');
    const cara = joinGuest(h, room, 'Cara');
    cara.socket.clear();
    cara.socket.bufferedAmount = 64 * 1024 + 1;
    send(bob.member, { m: snapshot(1) });
    send(bob.member, { m: fireEvent(1) });
    expect(cara.socket.games().map((g) => g.m.type)).toEqual(['fireEvent']);
    expect(roomOf(h, room.code).dropCount('snapshotSkipped')).toBe(1);
  });

  it('closes a member above 4 MiB buffered with 4009; a slow host closes the room', () => {
    const bob = joinGuest(h, room, 'Bob');
    const cara = joinGuest(h, room, 'Cara');
    cara.socket.bufferedAmount = 4 * 1024 * 1024 + 1;
    send(bob.member, { m: fireEvent(1) });
    expect(cara.socket.closed?.code).toBe(SERVER_CLOSE.slowConsumer);
    expect(room.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 2 }]);

    room.host.bufferedAmount = 4 * 1024 * 1024 + 1;
    send(bob.member, { m: fireEvent(1) });
    expect(room.host.closed?.code).toBe(SERVER_CLOSE.slowConsumer);
    expect(bob.socket.ops('roomClosed')).toEqual([{ op: 'roomClosed', reason: 'hostLeft' }]);
    expect(h.registry.roomCount()).toBe(0);
  });
});

describe('Room: quality', () => {
  it('broadcasts every live member clamped rtt every 2 s', () => {
    const bob = joinGuest(h, room, 'Bob');
    const cara = joinGuest(h, room, 'Cara');
    requestJoin(h, room, 'Dana');
    send(room.hostMember, { op: 'ping', n: 1, t: 5, rtt: 12.4 });
    send(bob.member, { op: 'ping', n: 1, t: 5, rtt: 99_999 });
    send(cara.member, { op: 'ping', n: 1, t: 5, rtt: -3 });
    h.runSeconds(1);
    expect(bob.socket.ops('quality')).toEqual([]);
    h.runSeconds(1);
    const expected = { op: 'quality', members: [{ slot: 0, rttMs: 12 }, { slot: 1, rttMs: 5000 }, { slot: 2, rttMs: 0 }] };
    for (const s of [room.host, bob.socket, cara.socket]) expect(s.ops('quality')).toEqual([expected]);
  });
});
