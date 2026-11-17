import { beforeEach, describe, expect, it } from 'vitest';
import { HOST_SLOT, type NetworkMessage, type PlayerSlot } from '../src/network/protocol.ts';
import { SERVER_CLOSE, SERVER_FRAME_MAX_BYTES } from '../src/network/serverEnvelope.ts';
import { DEFAULT_ROOM_TIMING, type Room, type RoomMembership } from './Room.ts';
import {
  createRoom,
  FakeSocket,
  fireEvent,
  joinGuest,
  makeHarness,
  requestJoin,
  resumeOn,
  send,
  sessionTokenFor,
  snapshot,
  welcomeFor,
  type Harness,
  type HostedRoom,
  type JoinedGuest,
} from './testSupport.ts';

/**
 * Resume in the relay core (docs/server-relay-design.md, section 5.6): numbering and keeping
 * reliable frames, the away state and its 30 s window for a guest and for the host, replay order,
 * acknowledgement pruning, the buffer bounds, and every token rule (wrong, stale, reused, racing,
 * not away). The shell's part (the hello, close codes, failure counting, probing a real socket) is
 * in main.test.ts; the client's in src/network/ServerTransport.test.ts.
 */

let h: Harness;
let room: HostedRoom;
let bob: JoinedGuest;

const roomOf = (harness: Harness, code: string): Room => {
  const found = harness.registry.roomByCode(code);
  if (!found) throw new Error('room gone');
  return found;
};

/** A reliable game frame from the host whose `t` tells it apart. */
const shot = (t: number, from: PlayerSlot = HOST_SLOT): NetworkMessage => ({ ...fireEvent(from), t }) as NetworkMessage;
const gooseSnapshot = (id: string): NetworkMessage => ({ type: 'gooseSnapshot', id, x: 1, y: 0, z: 2 }) as NetworkMessage;
const seqs = (socket: FakeSocket): (number | undefined)[] => socket.numbered().map((frame) => frame.s);

/** The resume worked: the membership on the new socket. */
function resumed(result: RoomMembership | string): RoomMembership {
  if (typeof result === 'string') throw new Error(`resume refused: ${result}`);
  return result;
}

beforeEach(() => {
  h = makeHarness();
  room = createRoom(h);
  bob = joinGuest(h, room, 'Bob', 'tok-bob');
});

describe('resume: numbering (section 5.6)', () => {
  it('numbers each member\'s reliable frames from 1, and never superseded state, pong or quality', () => {
    // Bob's welcome is his first reliable frame; the host's joinRequest and admitted are its first two.
    expect(bob.socket.numbered()[0]).toMatchObject({ s: 1, f: 0, m: { type: 'welcome' } });
    expect(room.host.numbered().filter((frame) => 'op' in frame && frame.op !== 'created').map((frame) => frame.s)).toEqual([1, 2]);
    bob.socket.clear();
    send(room.hostMember, { m: shot(1) });
    send(room.hostMember, { m: snapshot(0) });
    send(room.hostMember, { m: gooseSnapshot('g1') });
    send(room.hostMember, { m: { type: 'hordeGooseSnapshot', id: 'h1', x: 0, y: 0, z: 0 } });
    send(room.hostMember, { m: shot(2) });
    send(bob.member, { op: 'ping', n: 1, t: 5, rtt: null });
    h.runSeconds(2);
    expect(bob.socket.numbered().map((frame) => ('m' in frame ? frame.m.type : frame.op))).toEqual(['fireEvent', 'playerSnapshot', 'gooseSnapshot', 'hordeGooseSnapshot', 'fireEvent', 'pong', 'quality']);
    expect(seqs(bob.socket)).toEqual([2, undefined, undefined, undefined, 3, undefined, undefined]);
    // Another member counts on its own.
    const cara = joinGuest(h, room, 'Cara');
    expect(seqs(cara.socket)).toEqual([1]);
  });
});

describe('resume: away and replay', () => {
  it('an abnormal close makes a live guest away: the others are told, its frames are kept, superseded state is not', () => {
    const cara = joinGuest(h, room, 'Cara');
    room.host.clear();
    bob.member.disconnected(true);
    expect(room.host.ops('away')).toEqual([{ op: 'away', slot: 1 }]);
    expect(cara.socket.ops('away')).toEqual([{ op: 'away', slot: 1 }]);
    expect(room.host.ops('memberLeft')).toEqual([]);
    expect(roomOf(h, room.code).awaySlots()).toEqual([1]);
    expect(roomOf(h, room.code).liveSlots()).toEqual([0, 1, 2]);

    const sentBefore = bob.socket.sent.length;
    send(room.hostMember, { m: shot(1) });
    send(room.hostMember, { m: snapshot(0) });
    send(cara.member, { m: snapshot(2) });
    send(cara.member, { m: shot(2, 2) });
    // Nothing reaches the dropped socket; the two shots wait beside the welcome (never acknowledged).
    expect(bob.socket.sent.length).toBe(sentBefore);
    expect(roomOf(h, room.code).keptFrames(1)).toBe(3);
  });

  it('a resume replays the kept frames after lastSeq in order, after `resumed` with a new token, and the others hear back', () => {
    const cara = joinGuest(h, room, 'Cara');
    bob.member.disconnected(true);
    send(room.hostMember, { m: shot(1) });
    send(room.hostMember, { m: snapshot(0) });
    send(cara.member, { m: shot(2, 2) });
    send(room.hostMember, { m: { type: 'lobbyReadyUpdate', readySlots: [0] } });
    room.host.clear();
    cara.socket.clear();

    // Bob processed his welcome (1) before the drop.
    const { socket, result } = resumeOn(h, 'Bob again', bob.token, 1);
    const membership = resumed(result);
    expect(membership.slot).toBe(1);
    const frames = socket.numbered();
    expect(frames[0]).toEqual({ op: 'resumed', sessionToken: expect.any(String) });
    expect((frames[0] as { sessionToken: string }).sessionToken).not.toBe(bob.token);
    expect(frames.slice(1)).toEqual([
      { s: 2, f: 0, m: shot(1) },
      { s: 3, f: 2, m: shot(2, 2) },
      { s: 4, f: 0, m: { type: 'lobbyReadyUpdate', readySlots: [0] } },
    ]);
    expect(room.host.ops('back')).toEqual([{ op: 'back', slot: 1 }]);
    expect(cara.socket.ops('back')).toEqual([{ op: 'back', slot: 1 }]);
    expect(roomOf(h, room.code).awaySlots()).toEqual([]);

    // Same slot, same room, numbering carries on; the old socket's late frames are ignored.
    send(room.hostMember, { m: shot(3) });
    expect(socket.numbered().at(-1)).toEqual({ s: 5, f: 0, m: shot(3) });
    send(bob.member, { m: shot(9, 1) });
    expect(room.host.games()).toEqual([]);
    send(membership, { m: shot(4, 1) });
    expect(room.host.games()).toEqual([{ f: 1, m: shot(4, 1) }]);
    bob.member.disconnected(true);
    expect(roomOf(h, room.code).awaySlots()).toEqual([]);
  });

  it('a resume at the newest frame replays nothing', () => {
    bob.member.disconnected(true);
    const { socket, result } = resumeOn(h, 'Bob again', bob.token, 1);
    resumed(result);
    expect(socket.ops('resumed')).toHaveLength(1);
    expect(socket.games()).toEqual([]);
  });
});

describe('resume: acknowledgements and the buffer bounds', () => {
  it('ack drops the acknowledged prefix; an ack beyond the last frame sent is counted and changes nothing', () => {
    for (let t = 1; t <= 5; t++) send(room.hostMember, { m: shot(t) });
    const core = roomOf(h, room.code);
    expect(core.keptFrames(1)).toBe(6);
    send(bob.member, { op: 'ack', seq: 4 });
    expect(core.keptFrames(1)).toBe(2);
    send(bob.member, { op: 'ack', seq: 99 });
    expect(core.dropCount('badAck')).toBe(1);
    send(bob.member, { op: 'ack', seq: 2 });
    expect(core.keptFrames(1)).toBe(2);
  });

  it('a resume from before the acknowledged frames, or beyond the last frame sent, is refused and ends the member', () => {
    for (let t = 1; t <= 5; t++) send(room.hostMember, { m: shot(t) });
    send(bob.member, { op: 'ack', seq: 4 });
    bob.member.disconnected(true);
    room.host.clear();
    expect(resumeOn(h, 'Bob again', bob.token, 3).result).toBe('refused');
    expect(room.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 1 }]);
    // Gone for good: the token no longer finds anyone.
    expect(resumeOn(h, 'Bob third', bob.token, 6).result).toBe('unknown');

    const cara = joinGuest(h, room, 'Cara');
    cara.member.disconnected(true);
    expect(resumeOn(h, 'Cara again', cara.token, 2).result).toBe('refused');
  });

  it('overflowing the frame bound while away ends the window: the host hears memberLeft', () => {
    const harness = makeHarness({}, { limits: { resumeBufferFrames: 4 } });
    const hosted = createRoom(harness);
    const guest = joinGuest(harness, hosted, 'Bob');
    guest.member.disconnected(true);
    for (let t = 1; t <= 3; t++) send(hosted.hostMember, { m: shot(t) });
    expect(hosted.host.ops('memberLeft')).toEqual([]);
    expect(roomOf(harness, hosted.code).keptFrames(1)).toBe(4);
    send(hosted.hostMember, { m: shot(4) });
    expect(hosted.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 1 }]);
    expect(roomOf(harness, hosted.code).liveSlots()).toEqual([0]);
    expect(resumeOn(harness, 'Bob again', guest.token, 1).result).toBe('unknown');
  });

  it('overflowing the byte bound while away ends the window too', () => {
    const harness = makeHarness({}, { limits: { resumeBufferBytes: 1000 } });
    const hosted = createRoom(harness);
    const guest = joinGuest(harness, hosted, 'Bob');
    guest.member.disconnected(true);
    let sent = 0;
    while (hosted.host.ops('memberLeft').length === 0 && sent < 50) {
      send(hosted.hostMember, { m: shot(++sent) });
    }
    // Each numbered shot is about 140 characters: the window ended well before 50.
    expect(sent).toBeLessThan(10);
    expect(hosted.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 1 }]);
  });

  it('a live member that never acknowledges keeps only the newest frames, and cannot resume from before them', () => {
    const harness = makeHarness({}, { limits: { resumeBufferFrames: 4 } });
    const hosted = createRoom(harness);
    const guest = joinGuest(harness, hosted, 'Bob');
    for (let t = 1; t <= 10; t++) send(hosted.hostMember, { m: shot(t) });
    // Still live and still served: only what is kept for a resume is bounded.
    expect(guest.socket.games()).toHaveLength(11);
    expect(roomOf(harness, hosted.code).keptFrames(1)).toBe(4);
    guest.member.disconnected(true);
    expect(resumeOn(harness, 'Bob again', guest.token, 1).result).toBe('refused');
    const late = joinGuest(harness, hosted, 'Cara');
    for (let t = 1; t <= 10; t++) send(hosted.hostMember, { m: shot(t) });
    late.member.disconnected(true);
    // From the oldest frame still kept it can.
    resumed(resumeOn(harness, 'Cara again', late.token, 7).result);
  });
});

describe('resume: the 30 s window', () => {
  it('a guest away for 30 s leaves as before: memberLeft at 30 s, then the 90 s reservation', () => {
    bob.member.disconnected(true);
    room.host.clear();
    h.runSeconds(29);
    expect(room.host.ops('memberLeft')).toEqual([]);
    h.runSeconds(1);
    expect(room.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: 1 }]);
    expect(resumeOn(h, 'Bob late', bob.token, 1).result).toBe('unknown');
    // The rejoin reservation follows, as for any guest that left.
    const back = requestJoin(h, room, 'Bob', 'tok-bob');
    expect(room.host.ops('joinRequest').at(-1)).toMatchObject({ slot: 1, outcome: 'rejoined' });
    back.member.disconnected();
    h.runSeconds(DEFAULT_ROOM_TIMING.graceMs / 1000);
    expect(room.host.ops('expired')).toEqual([{ op: 'expired', slot: 1 }]);
  });

  it('the host away keeps the room open: guests hear away 0, play on among themselves, and frames for the host are kept', () => {
    const cara = joinGuest(h, room, 'Cara');
    room.hostMember.disconnected(true);
    expect(h.registry.roomCount()).toBe(1);
    expect(bob.socket.ops('away')).toEqual([{ op: 'away', slot: 0 }]);
    expect(cara.socket.ops('away')).toEqual([{ op: 'away', slot: 0 }]);
    send(bob.member, { m: shot(1, 1) });
    send(bob.member, { m: { type: 'playerReady', slot: 1, ready: true } });
    expect(cara.socket.games().at(-1)).toEqual({ f: 1, m: shot(1, 1) });
    // joinRequest, admitted (Bob); joinRequest, admitted (Cara); the shot; playerReady.
    expect(roomOf(h, room.code).keptFrames(HOST_SLOT)).toBe(6);
  });

  it('the host away for 30 s closes the room: roomClosed hostLeft to every guest, then 4004', () => {
    room.hostMember.disconnected(true);
    h.runSeconds(29);
    expect(bob.socket.ops('roomClosed')).toEqual([]);
    h.runSeconds(1);
    expect(bob.socket.ops('roomClosed')).toEqual([{ op: 'roomClosed', reason: 'hostLeft' }]);
    expect(bob.socket.closed?.code).toBe(SERVER_CLOSE.roomClosed);
    expect(h.registry.roomCount()).toBe(0);
    expect(resumeOn(h, 'host late', room.token, 2).result).toBe('unknown');
  });

  it('the host resuming in time gets the guests\' frames and acts as host again; the guests hear back', () => {
    room.hostMember.disconnected(true);
    send(bob.member, { m: shot(7, 1) });
    const cara = requestJoin(h, room, 'Cara');
    const { socket, result } = resumeOn(h, 'host again', room.token, 2);
    const host = resumed(result);
    expect(host.slot).toBe(HOST_SLOT);
    expect(socket.numbered().slice(1)).toEqual([
      { s: 3, f: 1, m: shot(7, 1) },
      { s: 4, op: 'joinRequest', slot: 2, outcome: 'joined', username: 'Cara', rejoinToken: null, features: ['facility'], peerId: 'srv-2-2' },
    ]);
    expect(bob.socket.ops('back')).toEqual([{ op: 'back', slot: 0 }]);
    // Still the host: it can admit, and its host-only ops are accepted.
    send(host, { op: 'joinAnswer', slot: 2, welcome: welcomeFor(2) });
    expect(cara.socket.games()).toEqual([{ f: 0, m: welcomeFor(2) }]);
    send(host, { op: 'kick', slot: 2 });
    expect(cara.socket.closed?.code).toBe(SERVER_CLOSE.kicked);
  });
});

describe('resume: tokens', () => {
  it('a wrong token finds no one, and the away member stays away', () => {
    bob.member.disconnected(true);
    expect(resumeOn(h, 'stranger', sessionTokenFor(999), 1).result).toBe('unknown');
    expect(resumeOn(h, 'stranger', room.token.slice(0, 21) + 'X', 1).result).toBe('unknown');
    expect(roomOf(h, room.code).awaySlots()).toEqual([1]);
  });

  it('a token is good for one resume: the old one is stale after it, even while the member is connected, and the new one works next time', () => {
    bob.member.disconnected(true);
    const first = resumeOn(h, 'Bob 2', bob.token, 1);
    const firstMember = resumed(first.result);
    const next = first.socket.ops('resumed')[0]!.sessionToken;
    // Reused while connected: unknown, not notAway (a stale token learns nothing and probes nothing).
    expect(resumeOn(h, 'thief', bob.token, 1).result).toBe('unknown');
    expect(first.socket.probes).toBe(0);
    firstMember.disconnected(true);
    expect(resumeOn(h, 'thief', bob.token, 1).result).toBe('unknown');
    resumed(resumeOn(h, 'Bob 3', next, 1).result);
  });

  it('two resumes racing for one slot: the first wins, the second is refused and gets nothing', () => {
    bob.member.disconnected(true);
    const first = resumeOn(h, 'first', bob.token, 1);
    const second = resumeOn(h, 'second', bob.token, 1);
    resumed(first.result);
    expect(second.result).toBe('unknown');
    expect(second.socket.sent).toEqual([]);
    send(room.hostMember, { m: shot(1) });
    expect(first.socket.games().at(-1)?.m).toEqual(shot(1));
    expect(second.socket.sent).toEqual([]);
  });

  it('a resume for a member that is not away is refused notAway: its socket is probed and nothing changes', () => {
    const { socket, result } = resumeOn(h, 'early', bob.token, 1);
    expect(result).toBe('notAway');
    expect(bob.socket.probes).toBe(1);
    expect(socket.sent).toEqual([]);
    send(room.hostMember, { m: shot(1) });
    expect(bob.socket.games().at(-1)?.m).toEqual(shot(1));
    // The token still works once the member really is away.
    bob.member.disconnected(true);
    resumed(resumeOn(h, 'Bob again', bob.token, 1).result);
  });

  it('tokens match only at full length, and never a pending member or one in another room', () => {
    bob.member.disconnected(true);
    const core = roomOf(h, room.code);
    expect(core.resume(new FakeSocket('short'), Buffer.from(bob.token.slice(0, 21), 'utf8'), 1)).toBeNull();
    expect(core.resume(new FakeSocket('long'), Buffer.from(bob.token + 'T', 'utf8'), 1)).toBeNull();
    // A pending member is not admitted yet: there is nothing to resume, connected or not.
    const pending = requestJoin(h, room, 'Cara');
    expect(resumeOn(h, 'Cara again', pending.token, 0).result).toBe('unknown');
    expect(pending.socket.probes).toBe(0);
    pending.member.disconnected(true);
    expect(resumeOn(h, 'Cara again', pending.token, 0).result).toBe('unknown');
    const other = createRoom(h);
    expect(other.code).not.toBe(room.code);
    expect(roomOf(h, other.code).resume(new FakeSocket('x'), Buffer.from(bob.token, 'utf8'), 1)).toBeNull();
  });
});

describe('resume: what never makes a member away', () => {
  it('leave, a kick, a takeover by rejoin and a close the client chose end the member as before', () => {
    send(bob.member, { op: 'leave' });
    expect(resumeOn(h, 'Bob again', bob.token, 1).result).toBe('unknown');

    const cara = joinGuest(h, room, 'Cara');
    send(room.hostMember, { op: 'kick', slot: cara.slot });
    cara.member.disconnected(true);
    expect(resumeOn(h, 'Cara again', cara.token, 1).result).toBe('unknown');

    const dan = joinGuest(h, room, 'Dan', 'tok-dan');
    const danAgain = requestJoin(h, room, 'Dan', 'tok-dan');
    send(room.hostMember, { op: 'joinAnswer', slot: dan.slot, welcome: welcomeFor(dan.slot, true) });
    expect(dan.socket.closed?.code).toBe(SERVER_CLOSE.replaced);
    dan.member.disconnected(true);
    expect(resumeOn(h, 'Dan old', dan.token, 1).result).toBe('unknown');

    room.host.clear();
    danAgain.member.disconnected(false);
    expect(room.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: dan.slot }]);
    expect(room.host.ops('away')).toEqual([]);
    expect(resumeOn(h, 'Dan new', danAgain.token, 1).result).toBe('unknown');
  });

  it('a member with no session token leaves on an abnormal close, as before resume', () => {
    const eve = new FakeSocket('Eve');
    const member = h.registry.join(eve, { op: 'join', code: room.code, username: 'Eve', rejoinToken: null });
    if (!member) throw new Error('join refused');
    send(room.hostMember, { op: 'joinAnswer', slot: member.slot, welcome: welcomeFor(member.slot) });
    room.host.clear();
    member.disconnected(true);
    expect(room.host.ops('memberLeft')).toEqual([{ op: 'memberLeft', slot: member.slot }]);
    expect(room.host.ops('away')).toEqual([]);
  });

  it('an away member taken over by a rejoin is back for the others, and its token is dead', () => {
    const cara = joinGuest(h, room, 'Cara');
    bob.member.disconnected(true);
    cara.socket.clear();
    const again = requestJoin(h, room, 'Bob', 'tok-bob');
    send(room.hostMember, { op: 'joinAnswer', slot: again.slot, welcome: welcomeFor(again.slot, true) });
    expect(cara.socket.ops('back')).toEqual([{ op: 'back', slot: 1 }]);
    expect(roomOf(h, room.code).awaySlots()).toEqual([]);
    expect(resumeOn(h, 'Bob old', bob.token, 1).result).toBe('unknown');
  });
});

describe('resume: a resumed member keeps its limits', () => {
  it('its rate limiter carries over, and the guest frame cap still applies', () => {
    for (let i = 0; i < 300; i++) send(bob.member, { m: snapshot(1) });
    const core = roomOf(h, room.code);
    expect(core.dropCount('rate')).toBe(0);
    bob.member.disconnected(true);
    const member = resumed(resumeOn(h, 'Bob again', bob.token, 1).result);
    send(member, { m: snapshot(1) });
    expect(core.dropCount('rate')).toBe(1);

    h.advance(10_000);
    const big = JSON.stringify({ m: { ...snapshot(1), pad: 'x'.repeat(SERVER_FRAME_MAX_BYTES) } });
    member.receive(big);
    expect(core.dropCount('malformed')).toBe(1);
  });

  it('a resumed host keeps the host frame cap', () => {
    room.hostMember.disconnected(true);
    const host = resumed(resumeOn(h, 'host again', room.token, 2).result);
    const big = JSON.stringify({ m: { ...shot(1), pad: 'x'.repeat(SERVER_FRAME_MAX_BYTES) } });
    bob.socket.clear();
    host.receive(big);
    expect(roomOf(h, room.code).dropCount('malformed')).toBe(0);
    expect(bob.socket.games()).toHaveLength(1);
  });
});
