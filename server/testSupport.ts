import { HOST_SLOT, type NetworkMessage, type PlayerSlot, type WelcomeMessage } from '../src/network/protocol.ts';
import { encodeClientFrame, type ClientFrame, type NumberedServerFrame, type ServerFrame, type ServerOp } from '../src/network/serverEnvelope.ts';
import type { MemberSocket, ResumeRefusal, RoomMembership } from './Room.ts';
import { RoomRegistry, type RegistryConfig, type RegistryOptions } from './RoomRegistry.ts';

/** Shared fakes for the relay core's unit tests: a recording MemberSocket, a registry on a manual
 * clock with predictable session tokens, and helpers that walk a guest through join and admission.
 * Not a test file itself. */

/** Every send and close across all fake sockets, in order, so a test can check cross-socket order. */
export const wireLog: string[] = [];

export class FakeSocket implements MemberSocket {
  readonly name: string;
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  bufferedAmount = 0;
  throwOnSend = false;
  /** How often the room asked this socket to prove it is alive (a resume came for its member). */
  probes = 0;

  constructor(name: string) {
    this.name = name;
  }

  send(text: string): void {
    if (this.throwOnSend) throw new Error('socket gone');
    this.sent.push(text);
    wireLog.push(`${this.name}:${text}`);
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = { code, reason };
    wireLog.push(`${this.name}:close:${code}`);
  }

  probe(): void {
    this.probes++;
  }

  /** Every frame as sent, the sequence number `s` of a reliable frame included (section 5.6). */
  numbered(): NumberedServerFrame[] {
    return this.sent.map((text) => JSON.parse(text) as NumberedServerFrame);
  }

  /** Every frame without its sequence number, as the game reads it; numbered() keeps it. */
  frames(): ServerFrame[] {
    return this.numbered().map((frame) => {
      const { s: _seq, ...rest } = frame;
      return rest as ServerFrame;
    });
  }

  ops<K extends ServerOp['op']>(op: K): Extract<ServerOp, { op: K }>[] {
    return this.frames().filter((frame): frame is Extract<ServerOp, { op: K }> => 'op' in frame && frame.op === op);
  }

  games(): { f: PlayerSlot; m: NetworkMessage }[] {
    return this.frames().filter((frame): frame is { f: PlayerSlot; m: NetworkMessage } => 'm' in frame);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export interface Harness {
  registry: RoomRegistry;
  now(): number;
  advance(ms: number): void;
  /** Advance in whole seconds, ticking the registry after each one, as start() would. */
  runSeconds(seconds: number): void;
}

export function makeHarness(config: Partial<RegistryConfig> = {}, options: Partial<RegistryOptions> = {}): Harness {
  let now = 1_000_000;
  let draws = 0;
  let tokens = 0;
  const registry = new RoomRegistry(
    { maxRooms: 50, maxPlayersPerRoom: 4, ...config },
    { clock: () => now, randomInt: (max) => (draws++ * 7) % max, sessionToken: () => sessionTokenFor(++tokens), ...options },
  );
  return {
    registry,
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    runSeconds: (seconds) => {
      for (let i = 0; i < seconds; i++) {
        now += 1000;
        registry.tick();
      }
    },
  };
}

export const send = (membership: RoomMembership, frame: ClientFrame | Record<string, unknown>): void => membership.receive(encodeClientFrame(frame as ClientFrame));

/** A predictable 22-character session token, in the base64url alphabet resume accepts. */
export const sessionTokenFor = (n: number): string => String(n).padStart(22, 'T');

export interface HostedRoom {
  code: string;
  host: FakeSocket;
  hostMember: RoomMembership;
  /** The session token its `ready` would have carried. */
  token: string;
}

export function createRoom(harness: Harness, maxPlayers = 4, username = 'Host'): HostedRoom {
  const host = new FakeSocket('host');
  const token = harness.registry.newSessionToken();
  const hostMember = harness.registry.create(host, { op: 'create', username, maxPlayers }, token);
  if (!hostMember) throw new Error('create refused: ' + host.sent.join());
  const created = host.ops('created')[0];
  if (!created) throw new Error('no created op');
  return { code: created.code, host, hostMember, token };
}

export function welcomeFor(slot: PlayerSlot, isRejoin = false): WelcomeMessage {
  return { type: 'welcome', yourSlot: slot, isRejoin, hostUsername: 'Host', roster: [{ slot: HOST_SLOT, username: 'Host' }, { slot, username: `Guest${slot}` }] };
}

export interface JoinedGuest {
  socket: FakeSocket;
  member: RoomMembership;
  slot: PlayerSlot;
  token: string;
}

/** Join without an answer: the guest is pending. */
export function requestJoin(harness: Harness, room: HostedRoom, name: string, rejoinToken: string | null = null): JoinedGuest {
  const socket = new FakeSocket(name);
  const token = harness.registry.newSessionToken();
  const member = harness.registry.join(socket, { op: 'join', code: room.code, username: name, rejoinToken, features: ['facility'] }, token);
  if (!member) throw new Error('join refused: ' + socket.sent.join());
  return { socket, member, slot: member.slot, token };
}

/** Join and admit with a well-formed welcome. */
export function joinGuest(harness: Harness, room: HostedRoom, name: string, rejoinToken: string | null = null): JoinedGuest {
  const guest = requestJoin(harness, room, name, rejoinToken);
  send(room.hostMember, { op: 'joinAnswer', slot: guest.slot, welcome: welcomeFor(guest.slot, rejoinToken !== null) });
  return guest;
}

export function snapshot(senderSlot: PlayerSlot): NetworkMessage {
  return { type: 'playerSnapshot', senderSlot, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100, t: 10 };
}

export function fireEvent(senderSlot: PlayerSlot): NetworkMessage {
  return { type: 'fireEvent', senderSlot, originX: 0, originY: 1, originZ: 0, endX: 5, endY: 1, endZ: 5, weaponId: 'rifle', t: 11 };
}

/** A resume on a fresh socket (the shell's part, the hello and the close codes, is in main.test.ts). */
export function resumeOn(harness: Harness, name: string, token: string, lastSeq: number): { socket: FakeSocket; result: RoomMembership | ResumeRefusal } {
  const socket = new FakeSocket(name);
  return { socket, result: harness.registry.resume(socket, { op: 'resume', sessionToken: token, lastSeq }) };
}
