import { describe, expect, it } from 'vitest';
import peerConnectionSource from './PeerConnection.ts?raw';
import { towerDoorId } from '../world/houses/valleyHouseIds.ts';
import { HELLO_TOKEN_MAX_LENGTH, HELLO_USERNAME_MAX_LENGTH, isNetworkMessage, WORLD_WIRE_MAX_ENTRIES, type NetworkMessage, type WelcomeMessage } from './protocol.ts';
import {
  ACCESS_CODE_MAX_LENGTH,
  clampReportedRtt,
  encodeClientFrame,
  encodeGameFrame,
  encodeServerFrame,
  HOST_FRAME_MAX_BYTES,
  parseClientFrame,
  QUALITY_RTT_MAX_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SERVER_BUILD_MAX_LENGTH,
  SERVER_FRAME_MAX_BYTES,
  SERVER_PROTOCOL_VERSION,
} from './serverEnvelope.ts';

const parse = (value: unknown) => parseClientFrame(JSON.stringify(value));
const welcome = (slot: 0 | 1 | 2 | 3): WelcomeMessage => ({ type: 'welcome', yourSlot: slot, isRejoin: false, hostUsername: 'Host', roster: [{ slot: 0, username: 'Host' }] });
const snapshot: NetworkMessage = { type: 'playerSnapshot', senderSlot: 1, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100, t: 1 };
const bytes = (text: string): number => new TextEncoder().encode(text).length;

describe('serverEnvelope: constants', () => {
  it('is protocol version 1 with a 64 KiB guest frame cap and a 128 KiB host frame cap', () => {
    expect(SERVER_PROTOCOL_VERSION).toBe(1);
    expect(SERVER_FRAME_MAX_BYTES).toBe(65_536);
    expect(HOST_FRAME_MAX_BYTES).toBe(131_072);
  });

  it('uses the same room code alphabet and length as generateRoomCode', () => {
    expect(peerConnectionSource).toContain(`const CODE_ALPHABET = '${ROOM_CODE_ALPHABET}';`);
    expect(peerConnectionSource).toContain(`const CODE_LENGTH = ${ROOM_CODE_LENGTH};`);
  });
});

describe('parseClientFrame: valid frames', () => {
  it('accepts each client op in its exact shape', () => {
    const ops = [
      { op: 'hello', proto: 1, build: '4.7.0', access: 'secret', features: ['facility'] },
      { op: 'hello', proto: 2, build: '', access: 'secret' },
      { op: 'create', username: 'Alice', maxPlayers: 4 },
      { op: 'join', code: 'ABCDEF', username: 'Bob', rejoinToken: null },
      { op: 'join', code: 'abc', username: 'Bob', rejoinToken: 'tok', features: [] },
      { op: 'joinAnswer', slot: 1, welcome: welcome(1) },
      { op: 'joinAnswer', slot: 3, reject: 'outdated' },
      { op: 'kick', slot: 2 },
      { op: 'ping', n: 0, t: 12.5, rtt: null },
      { op: 'ping', n: 3, t: 12.5, rtt: 40 },
      { op: 'leave' },
      { op: 'resume', sessionToken: 'abcDEF012_-'.repeat(2), lastSeq: 0 },
      { op: 'resume', sessionToken: 'Z'.repeat(22), lastSeq: 1536 },
      { op: 'ack', seq: 0 },
      { op: 'ack', seq: 64 },
    ];
    for (const op of ops) expect(parse(op)).toEqual(op);
  });

  it('accepts a game frame, with or without a slot in to', () => {
    expect(parse({ m: snapshot })).toEqual({ m: snapshot });
    expect(parse({ m: snapshot, to: 3 })).toEqual({ m: snapshot, to: 3 });
    expect(parse({ m: snapshot, to: 0 })).toEqual({ m: snapshot, to: 0 });
  });
});

describe('parseClientFrame: refusals', () => {
  it('refuses malformed JSON, non-objects, empty and oversize text', () => {
    for (const text of ['', '{', 'not json', '[]', '[{"op":"leave"}]', '42', 'null', '"leave"', 'true']) expect(parseClientFrame(text)).toBeNull();
    expect(parseClientFrame(undefined)).toBeNull();
    expect(parseClientFrame(42)).toBeNull();
    const oversize = JSON.stringify({ m: { ...snapshot, pad: 'x'.repeat(SERVER_FRAME_MAX_BYTES) } });
    expect(parseClientFrame(oversize)).toBeNull();
    // The host's own limit is passed in; past it the host is refused too.
    expect(parseClientFrame(oversize, HOST_FRAME_MAX_BYTES)).not.toBeNull();
    expect(parseClientFrame(JSON.stringify({ m: { ...snapshot, pad: 'x'.repeat(HOST_FRAME_MAX_BYTES) } }), HOST_FRAME_MAX_BYTES)).toBeNull();
  });

  it('refuses an unknown op, a frame with both op and m, and extra fields', () => {
    expect(parse({ op: 'nuke' })).toBeNull();
    expect(parse({ op: 'ready', proto: 1, serverTime: 0 })).toBeNull(); // a server op
    expect(parse({ op: 'leave', m: snapshot })).toBeNull();
    expect(parse({ op: 'leave', extra: 1 })).toBeNull();
    expect(parse({ op: 'kick', slot: 1, also: 2 })).toBeNull();
    expect(parse({ m: snapshot, from: 1 })).toBeNull();
    expect(parse({ f: 0, m: snapshot })).toBeNull();
    expect(parse({})).toBeNull();
  });

  it('refuses wrong field types', () => {
    const bad = [
      { op: 'hello', proto: '1', build: '', access: 'a' },
      { op: 'hello', proto: 1.5, build: '', access: 'a' },
      { op: 'hello', proto: -1, build: '', access: 'a' },
      { op: 'hello', proto: 1, build: 4, access: 'a' },
      { op: 'hello', proto: 1, build: '', access: 7 },
      { op: 'hello', proto: 1, build: '', access: '' },
      { op: 'hello', proto: 1, build: '', access: 'a', features: 'facility' },
      { op: 'hello', proto: 1, build: '', access: 'a', features: [1] },
      { op: 'create', username: 5, maxPlayers: 4 },
      { op: 'create', username: 'a', maxPlayers: '4' },
      { op: 'create', username: 'a', maxPlayers: 0 },
      { op: 'create', username: 'a', maxPlayers: 2.5 },
      { op: 'create', username: 'a', maxPlayers: 256 },
      { op: 'create', username: 'a' },
      { op: 'join', code: 1, username: 'a', rejoinToken: null },
      { op: 'join', code: '', username: 'a', rejoinToken: null },
      { op: 'join', code: 'ABCDEF', username: 'a' },
      { op: 'join', code: 'ABCDEF', username: 'a', rejoinToken: 5 },
      { op: 'join', code: 'ABCDEF', username: 'a', rejoinToken: '' },
      { op: 'join', code: 'ABCDEF', username: null, rejoinToken: null },
      { op: 'kick', slot: '1' },
      { op: 'ping', n: -1, t: 0, rtt: null },
      { op: 'ping', n: 1.5, t: 0, rtt: null },
      { op: 'ping', n: 1, t: 'now', rtt: null },
      { op: 'ping', n: 1, t: 0, rtt: '40' },
      { op: 'ping', n: 1, t: 0 },
      // A session token is exactly 22 base64url characters (section 5.6).
      { op: 'resume', sessionToken: 'Z'.repeat(21), lastSeq: 0 },
      { op: 'resume', sessionToken: 'Z'.repeat(23), lastSeq: 0 },
      { op: 'resume', sessionToken: 'Z'.repeat(21) + '=', lastSeq: 0 },
      { op: 'resume', sessionToken: 'Z'.repeat(21) + '+', lastSeq: 0 },
      { op: 'resume', sessionToken: null, lastSeq: 0 },
      { op: 'resume', sessionToken: 'Z'.repeat(22), lastSeq: -1 },
      { op: 'resume', sessionToken: 'Z'.repeat(22), lastSeq: 1.5 },
      { op: 'resume', sessionToken: 'Z'.repeat(22) },
      { op: 'resume', sessionToken: 'Z'.repeat(22), lastSeq: 0, slot: 1 },
      { op: 'ack', seq: -1 },
      { op: 'ack', seq: '3' },
      { op: 'ack' },
    ];
    for (const frame of bad) expect(parse(frame), JSON.stringify(frame)).toBeNull();
  });

  it('refuses strings over their limits', () => {
    const long = (n: number) => 'x'.repeat(n);
    expect(parse({ op: 'create', username: long(HELLO_USERNAME_MAX_LENGTH + 1), maxPlayers: 4 })).toBeNull();
    expect(parse({ op: 'create', username: long(HELLO_USERNAME_MAX_LENGTH), maxPlayers: 4 })).not.toBeNull();
    expect(parse({ op: 'join', code: 'ABCDEF', username: 'a', rejoinToken: long(HELLO_TOKEN_MAX_LENGTH + 1) })).toBeNull();
    expect(parse({ op: 'join', code: long(17), username: 'a', rejoinToken: null })).toBeNull();
    expect(parse({ op: 'hello', proto: 1, build: long(SERVER_BUILD_MAX_LENGTH + 1), access: 'a' })).toBeNull();
    expect(parse({ op: 'hello', proto: 1, build: '', access: long(ACCESS_CODE_MAX_LENGTH + 1) })).toBeNull();
    expect(parse({ op: 'hello', proto: 1, build: '', access: long(ACCESS_CODE_MAX_LENGTH) })).not.toBeNull();
    expect(parse({ op: 'join', code: 'ABCDEF', username: 'a', rejoinToken: null, features: [long(33)] })).toBeNull();
    expect(parse({ op: 'join', code: 'ABCDEF', username: 'a', rejoinToken: null, features: Array(17).fill('f') })).toBeNull();
  });

  it('refuses a joinAnswer that is not for a guest slot, names another slot, or is both or neither', () => {
    expect(parse({ op: 'joinAnswer', slot: 0, welcome: welcome(0) })).toBeNull();
    expect(parse({ op: 'joinAnswer', slot: 4, reject: 'full' })).toBeNull();
    expect(parse({ op: 'joinAnswer', slot: 1, welcome: welcome(2) })).toBeNull();
    expect(parse({ op: 'joinAnswer', slot: 1, welcome: { ...welcome(1), type: 'roomFull' } })).toBeNull();
    expect(parse({ op: 'joinAnswer', slot: 1, welcome: { ...welcome(1), roster: 'none' } })).toBeNull();
    expect(parse({ op: 'joinAnswer', slot: 1, welcome: welcome(1), reject: 'full' })).toBeNull();
    expect(parse({ op: 'joinAnswer', slot: 1 })).toBeNull();
    expect(parse({ op: 'joinAnswer', slot: 1, reject: 'busy' })).toBeNull();
    expect(parse({ op: 'kick', slot: 0 })).toBeNull();
    expect(parse({ op: 'kick', slot: 4 })).toBeNull();
  });

  it('refuses a game frame whose m fails isNetworkMessage or whose to is not a slot', () => {
    expect(parse({ m: { type: 'notAType' } })).toBeNull();
    expect(parse({ m: { ...snapshot, senderSlot: 7 } })).toBeNull();
    expect(parse({ m: { ...snapshot, x: 1e9 } })).toBeNull();
    expect(parse({ m: 'playerSnapshot' })).toBeNull();
    expect(parse({ m: null })).toBeNull();
    for (const to of [4, -1, 1.5, '1', null, true]) expect(parse({ m: snapshot, to }), String(to)).toBeNull();
  });
});

describe('serverEnvelope: helpers and encoders', () => {
  it('clamps a reported rtt to 0 to 5000 whole milliseconds', () => {
    expect(clampReportedRtt(null)).toBeNull();
    expect(clampReportedRtt(Number.NaN)).toBeNull();
    expect(clampReportedRtt(-4)).toBe(0);
    expect(clampReportedRtt(41.6)).toBe(42);
    expect(clampReportedRtt(1e9)).toBe(QUALITY_RTT_MAX_MS);
  });

  it('encodes server frames as JSON, stamping f on game frames', () => {
    expect(JSON.parse(encodeGameFrame(2, snapshot))).toEqual({ f: 2, m: snapshot });
    expect(encodeServerFrame({ op: 'admitted', slot: 1 })).toBe('{"op":"admitted","slot":1}');
    expect(parseClientFrame(encodeClientFrame({ m: snapshot, to: 1 }))).toEqual({ m: snapshot, to: 1 });
  });
});

describe('serverEnvelope: the largest legal mid-match welcome fits in one host frame', () => {
  const name = 'W'.repeat(HELLO_USERNAME_MAX_LENGTH);
  const peerId = '01234567-89ab-cdef-0123-456789abcdef';
  // The largest id the Valley door wire carries: the last watch tower door, ten digits.
  const largestDoorId = towerDoorId(3);
  const bigWelcome = (worldObjects: { doors: string; breakers: string; valleyDoors?: number[] }, deadLamps: number[]): WelcomeMessage => ({
    type: 'welcome',
    yourSlot: 3,
    isRejoin: true,
    hostUsername: name,
    roster: [0, 1, 2, 3].map((slot) => ({ slot: slot as 0 | 1 | 2 | 3, username: name, peerId })),
    activeMatch: {
      seed: 4_294_967_295,
      killLimit: 999,
      gooseDifficulty: 'extreme',
      gameMode: 'oneShotOneKill',
      weather: 'night',
      map: 'facility',
      scoreboard: [0, 1, 2, 3].map((slot) => ({ slot: slot as 0 | 1 | 2 | 3, score: Number.MAX_SAFE_INTEGER })),
      spawnPoint: { x: -1234.5678901234567, z: 9876.543210987654 },
      deadLamps,
      worldObjects,
    },
  });
  const frameBytes = (message: WelcomeMessage) => Math.max(bytes(encodeGameFrame(3, message)), bytes(encodeClientFrame({ op: 'joinAnswer', slot: 3, welcome: message })));
  const full = Array(WORLD_WIRE_MAX_ENTRIES).fill(largestDoorId) as number[];

  it('every list at its bound (4096-character door and breaker strings, 4096 ten-digit valleyDoors and deadLamps) fits the host frame', () => {
    expect(largestDoorId).toBeGreaterThanOrEqual(1e9);
    expect(Number.isSafeInteger(largestDoorId)).toBe(true);
    const message = bigWelcome({ doors: '1'.repeat(WORLD_WIRE_MAX_ENTRIES), breakers: '0'.repeat(WORLD_WIRE_MAX_ENTRIES), valleyDoors: full }, full);
    expect(isNetworkMessage(message)).toBe(true);
    // Above the guest cap, which is why the host gets its own.
    expect(frameBytes(message)).toBeGreaterThan(SERVER_FRAME_MAX_BYTES);
    expect(frameBytes(message)).toBeLessThanOrEqual(HOST_FRAME_MAX_BYTES);
    const answer = encodeClientFrame({ op: 'joinAnswer', slot: 3, welcome: message });
    expect(parseClientFrame(answer, HOST_FRAME_MAX_BYTES)).not.toBeNull();
    expect(parseClientFrame(answer)).toBeNull();
  });

  it('a welcome over a bound is not legal: 4097 deadLamps, 4097 valleyDoors, a 4097-character door string, a bad lamp id', () => {
    const doors = { doors: '', breakers: '' };
    expect(isNetworkMessage(bigWelcome(doors, [...full, 1]))).toBe(false);
    expect(isNetworkMessage(bigWelcome({ ...doors, valleyDoors: [...full, 1] }, []))).toBe(false);
    expect(isNetworkMessage(bigWelcome({ doors: '1'.repeat(WORLD_WIRE_MAX_ENTRIES + 1), breakers: '' }, []))).toBe(false);
    expect(isNetworkMessage(bigWelcome(doors, [-1]))).toBe(false);
    expect(isNetworkMessage(bigWelcome(doors, [1.5]))).toBe(false);
    expect(isNetworkMessage(bigWelcome({ doors: 'x', breakers: '' }, []))).toBe(false);
    // Missing lists are still fine (older builds, a lobby welcome).
    const { deadLamps: _lamps, worldObjects: _objects, ...bare } = bigWelcome(doors, []).activeMatch ?? {};
    expect(isNetworkMessage({ ...bigWelcome(doors, []), activeMatch: bare })).toBe(true);
    expect(isNetworkMessage(welcome(1))).toBe(true);
  });
});
