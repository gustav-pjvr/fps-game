import { describe, expect, it, vi } from 'vitest';
import {
  GuestMesh,
  MESH_HEARTBEAT_MS,
  MESH_MAX_DIAL_ATTEMPTS,
  MESH_OPEN_TIMEOUT_MS,
  MESH_RETRY_BASE_MS,
  MESH_RETRY_MAX_MS,
  type MeshClock,
  type MeshConnection,
  type MeshFastChannel,
} from './GuestMesh.ts';
import type { NetworkMessage, PlayerSlot, RosterEntry } from './protocol.ts';

const ROOM = 'ABCDEF';

/** A clock the test advances by hand; timers fire in due order, intervals repeat. */
class FakeClock implements MeshClock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { due: number; handler: () => void; every: number | null }>();

  now(): number {
    return this.time;
  }
  setTimeout(handler: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { due: this.time + ms, handler, every: null });
    return id;
  }
  clearTimeout(id: unknown): void {
    this.timers.delete(id as number);
  }
  setInterval(handler: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { due: this.time + ms, handler, every: ms });
    return id;
  }
  clearInterval(id: unknown): void {
    this.timers.delete(id as number);
  }
  pendingTimers(): number {
    return this.timers.size;
  }
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextDue = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.due < nextDue) {
          nextDue = timer.due;
          nextId = id;
        }
      }
      if (nextId === null || nextDue > end) break;
      const timer = this.timers.get(nextId)!;
      this.time = nextDue;
      if (timer.every === null) this.timers.delete(nextId);
      else timer.due += timer.every;
      timer.handler();
    }
    this.time = end;
  }
}

/** A DataConnection stand-in: records what is sent, and lets the test open, feed and close it. */
class FakeConnection implements MeshConnection {
  open = false;
  closed = false;
  readonly sent: NetworkMessage[] = [];
  private openHandlers: (() => void)[] = [];
  private dataHandlers: ((data: unknown) => void)[] = [];
  private closeHandlers: (() => void)[] = [];

  constructor(readonly peer: string) {}

  send(message: NetworkMessage): void {
    this.sent.push(message);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    for (const handler of [...this.closeHandlers]) handler();
  }
  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }
  onData(handler: (data: unknown) => void): void {
    this.dataHandlers.push(handler);
  }
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  /** The remote end finished connecting. */
  doOpen(): void {
    this.open = true;
    for (const handler of [...this.openHandlers]) handler();
  }
  receive(data: unknown): void {
    for (const handler of [...this.dataHandlers]) handler(data);
  }
  helloCount(): number {
    return this.sent.filter((message) => message.type === 'meshHello').length;
  }
}

/** An inbound connection: already open when its first message arrives. */
function openIncoming(peer: string): FakeConnection {
  const connection = new FakeConnection(peer);
  connection.open = true;
  return connection;
}

function hello(slot: PlayerSlot, roomCode = ROOM): NetworkMessage {
  return { type: 'meshHello', slot, roomCode };
}

function roster(...entries: [PlayerSlot, string | undefined][]): RosterEntry[] {
  return entries.map(([slot, peerId]) => (peerId === undefined ? { slot, username: `P${slot}` } : { slot, username: `P${slot}`, peerId }));
}

function makeMesh(ownSlot: PlayerSlot) {
  const clock = new FakeClock();
  const dialed: FakeConnection[] = [];
  const fast: { trySend: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
  const onMessage = vi.fn<(message: NetworkMessage, slot: PlayerSlot) => void>();
  const onLinkedChange = vi.fn<(linked: PlayerSlot[]) => void>();
  const dial = vi.fn((peerId: string) => {
    const connection = new FakeConnection(peerId);
    dialed.push(connection);
    return connection;
  });
  const mesh = new GuestMesh({
    ownSlot,
    roomCode: ROOM,
    dial,
    openFastChannel: () => {
      const channel = { trySend: vi.fn(() => false), close: vi.fn() };
      fast.push(channel);
      return channel as MeshFastChannel;
    },
    onMessage,
    onLinkedChange,
    clock,
  });
  return { mesh, clock, dial, dialed, fast, onMessage, onLinkedChange };
}

/** A live, greeted link to `slot` on a mesh whose own slot is lower (this side dialled). */
function liveDialedLink(slot: PlayerSlot, peerId: string) {
  const harness = makeMesh(1);
  harness.mesh.setRoster(roster([0, 'host'], [slot, peerId]));
  const connection = harness.dialed[0]!;
  connection.doOpen();
  connection.receive(hello(slot));
  return { ...harness, connection };
}

describe('GuestMesh dialling', () => {
  it('the lower slot dials the higher one, never the other way, and skips the host and peerless entries', () => {
    const low = makeMesh(1);
    low.mesh.setRoster(roster([0, 'host'], [1, 'p1'], [2, 'p2'], [3, undefined]));
    expect(low.dial.mock.calls.map(([peerId]) => peerId)).toEqual(['p2']);

    const high = makeMesh(3);
    high.mesh.setRoster(roster([0, 'host'], [1, 'p1'], [2, 'p2'], [3, 'p3']));
    expect(high.dial).not.toHaveBeenCalled();

    const middle = makeMesh(2);
    middle.mesh.setRoster(roster([1, 'p1'], [3, 'p3']));
    expect(middle.dial.mock.calls.map(([peerId]) => peerId)).toEqual(['p3']);
  });

  it('says hello with its own slot and the room code once the dialled link opens, and is linked after the reply', () => {
    const { mesh, dialed, onLinkedChange } = makeMesh(1);
    mesh.setRoster(roster([2, 'p2']));
    const connection = dialed[0]!;
    expect(connection.sent).toEqual([]); // not open yet
    connection.doOpen();
    expect(connection.sent).toEqual([hello(1)]);
    expect(mesh.linkedSlots()).toEqual([]);

    connection.receive(hello(2));
    expect(mesh.linkedSlots()).toEqual([2]);
    expect(onLinkedChange).toHaveBeenLastCalledWith([2]);
  });

  it('a reply naming another room or another slot ends the link', () => {
    const wrongRoom = makeMesh(1);
    wrongRoom.mesh.setRoster(roster([2, 'p2']));
    wrongRoom.dialed[0]!.doOpen();
    wrongRoom.dialed[0]!.receive(hello(2, 'ZZZZZZ'));
    expect(wrongRoom.dialed[0]!.closed).toBe(true);
    expect(wrongRoom.mesh.linkedSlots()).toEqual([]);

    const wrongSlot = makeMesh(1);
    wrongSlot.mesh.setRoster(roster([2, 'p2']));
    wrongSlot.dialed[0]!.doOpen();
    wrongSlot.dialed[0]!.receive(hello(3));
    expect(wrongSlot.dialed[0]!.closed).toBe(true);
  });

  it('retries a dial that throws with a growing delay, at most five times, then leaves it alone', () => {
    const { mesh, clock, dial } = makeMesh(1);
    dial.mockImplementation(() => {
      throw new Error('no route');
    });
    mesh.setRoster(roster([2, 'p2']));
    expect(dial).toHaveBeenCalledTimes(1);

    // Delays: 2 s, 4 s, 8 s, 16 s (the cap), so attempts land at 2, 6, 14 and 30 s.
    clock.advance(MESH_RETRY_BASE_MS - 1);
    expect(dial).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(dial).toHaveBeenCalledTimes(2);
    clock.advance(MESH_RETRY_BASE_MS * 2);
    expect(dial).toHaveBeenCalledTimes(3);
    clock.advance(MESH_RETRY_BASE_MS * 4);
    expect(dial).toHaveBeenCalledTimes(4);
    clock.advance(MESH_RETRY_MAX_MS - 1);
    expect(dial).toHaveBeenCalledTimes(4);
    clock.advance(1);
    expect(dial).toHaveBeenCalledTimes(MESH_MAX_DIAL_ATTEMPTS);

    clock.advance(10 * MESH_RETRY_MAX_MS);
    expect(dial).toHaveBeenCalledTimes(MESH_MAX_DIAL_ATTEMPTS);
    // The roster saying the same thing again does not restart it.
    mesh.setRoster(roster([2, 'p2']));
    expect(dial).toHaveBeenCalledTimes(MESH_MAX_DIAL_ATTEMPTS);
    // A rejoin's new PeerJS id does.
    mesh.setRoster(roster([2, 'p2-new']));
    expect(dial).toHaveBeenCalledTimes(MESH_MAX_DIAL_ATTEMPTS + 1);
    expect(dial).toHaveBeenLastCalledWith('p2-new');
  });

  it('closes a dialled link that never exchanges hellos and dials again after the base delay', () => {
    const { mesh, clock, dial, dialed } = makeMesh(1);
    mesh.setRoster(roster([2, 'p2']));
    dialed[0]!.doOpen(); // opens, but the other side never answers
    clock.advance(MESH_OPEN_TIMEOUT_MS);
    expect(dialed[0]!.closed).toBe(true);
    expect(dial).toHaveBeenCalledTimes(1);
    clock.advance(MESH_RETRY_BASE_MS);
    expect(dial).toHaveBeenCalledTimes(2);
  });

  it('a link that worked gets the full set of retries again after it drops', () => {
    const { mesh, clock, dial, dialed, connection } = liveDialedLink(2, 'p2');
    expect(mesh.linkedSlots()).toEqual([2]);
    connection.close();
    expect(mesh.linkedSlots()).toEqual([]);
    clock.advance(MESH_RETRY_BASE_MS);
    expect(dial).toHaveBeenCalledTimes(2);
    expect(dialed[1]!.peer).toBe('p2');
  });

  it('dialFailed (the peer is not on the broker) ends an unanswered dial and retries it later', () => {
    const { mesh, clock, dial, dialed } = makeMesh(1);
    mesh.setRoster(roster([2, 'p2']));
    mesh.dialFailed('p2');
    expect(dialed[0]!.closed).toBe(true);
    clock.advance(MESH_RETRY_BASE_MS);
    expect(dial).toHaveBeenCalledTimes(2);
  });
});

describe('GuestMesh answering', () => {
  /** Own slot 3 with slots 1 and 2 in the room: both dial this guest. */
  function answerer() {
    const harness = makeMesh(3);
    harness.mesh.setRoster(roster([0, 'host'], [1, 'p1'], [2, 'p2'], [3, 'p3']));
    return harness;
  }

  it('accepts a hello from a lower slot whose roster peer id matches, answers it, and is linked', () => {
    const { mesh, onLinkedChange } = answerer();
    const incoming = openIncoming('p2');
    mesh.accept(incoming);
    incoming.receive(hello(2));
    expect(incoming.closed).toBe(false);
    expect(incoming.sent).toEqual([hello(3)]);
    expect(mesh.linkedSlots()).toEqual([2]);
    expect(onLinkedChange).toHaveBeenLastCalledWith([2]);
  });

  it.each([
    ['another room', 'p2', hello(2, 'ZZZZZZ')],
    ['a slot not lower than its own', 'p3', hello(3)],
    ['the host slot', 'p0', hello(0)],
    ['a slot that is not in the roster', 'p1', hello(1)],
    ['a peer id that is not the roster player on that slot', 'stranger', hello(2)],
    ['something that is not a hello', 'p2', { type: 'playerSnapshot' }],
    ['garbage', 'p2', 'hello'],
  ])('closes a connection whose first message is %s', (_label, peer, first) => {
    const { mesh } = makeMesh(3);
    // Slot 1 is deliberately missing from this roster for the "not in the roster" case.
    mesh.setRoster(roster([0, 'host'], [2, 'p2'], [3, 'p3']));
    const incoming = openIncoming(peer);
    mesh.accept(incoming);
    incoming.receive(first);
    expect(incoming.closed).toBe(true);
    expect(mesh.linkedSlots()).toEqual([]);
  });

  it('accepts a hello from a roster player whose peer id is not known yet', () => {
    const { mesh } = makeMesh(3);
    mesh.setRoster(roster([2, undefined]));
    const incoming = openIncoming('whoever');
    mesh.accept(incoming);
    incoming.receive(hello(2));
    expect(mesh.linkedSlots()).toEqual([2]);
  });

  it('closes a connection that stays silent past the open timeout', () => {
    const { mesh, clock } = answerer();
    const incoming = openIncoming('p2');
    mesh.accept(incoming);
    clock.advance(MESH_OPEN_TIMEOUT_MS - 1);
    expect(incoming.closed).toBe(false);
    clock.advance(1);
    expect(incoming.closed).toBe(true);
  });

  it('a second link on the same slot replaces the first', () => {
    const { mesh } = answerer();
    const first = openIncoming('p2');
    mesh.accept(first);
    first.receive(hello(2));
    const second = openIncoming('p2');
    mesh.accept(second);
    second.receive(hello(2));
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(mesh.linkedSlots()).toEqual([2]);
  });

  it("a rejoin's new PeerJS id replaces the link: the old one closes and the new connection takes the slot", () => {
    const { mesh, onLinkedChange } = answerer();
    const old = openIncoming('p2');
    mesh.accept(old);
    old.receive(hello(2));
    expect(mesh.linkedSlots()).toEqual([2]);

    mesh.addPlayer(2, 'p2-rejoined');
    expect(old.closed).toBe(true);
    expect(mesh.linkedSlots()).toEqual([]);
    expect(onLinkedChange).toHaveBeenLastCalledWith([]);

    // The old id can no longer open a link; the new one can.
    const stale = openIncoming('p2');
    mesh.accept(stale);
    stale.receive(hello(2));
    expect(stale.closed).toBe(true);
    const fresh = openIncoming('p2-rejoined');
    mesh.accept(fresh);
    fresh.receive(hello(2));
    expect(fresh.closed).toBe(false);
    expect(mesh.linkedSlots()).toEqual([2]);
  });

  it('the dialling side redials a rejoined player under its new id', () => {
    const { mesh, dial, dialed, connection } = liveDialedLink(2, 'p2');
    mesh.addPlayer(2, 'p2-rejoined');
    expect(connection.closed).toBe(true);
    expect(mesh.linkedSlots()).toEqual([]);
    expect(dial).toHaveBeenLastCalledWith('p2-rejoined');
    expect(dialed).toHaveLength(2);
  });

  it('a player who left loses the link and is not redialled', () => {
    const { mesh, clock, dial, connection } = liveDialedLink(2, 'p2');
    mesh.removePlayer(2);
    expect(connection.closed).toBe(true);
    expect(mesh.linkedSlots()).toEqual([]);
    clock.advance(10 * MESH_RETRY_MAX_MS);
    expect(dial).toHaveBeenCalledTimes(1);
  });
});

describe('GuestMesh heartbeat', () => {
  it('repeats hello on every live link each heartbeat', () => {
    const { clock, connection } = liveDialedLink(2, 'p2');
    const before = connection.helloCount();
    clock.advance(MESH_HEARTBEAT_MS);
    expect(connection.helloCount()).toBe(before + 1);
    clock.advance(MESH_HEARTBEAT_MS * 2);
    expect(connection.helloCount()).toBe(before + 3);
  });

  it('stays linked while hellos keep arriving', () => {
    const { mesh, clock, connection, onLinkedChange } = liveDialedLink(2, 'p2');
    onLinkedChange.mockClear();
    for (let i = 0; i < 10; i++) {
      clock.advance(MESH_HEARTBEAT_MS);
      connection.receive(hello(2));
    }
    expect(mesh.linkedSlots()).toEqual([2]);
    expect(onLinkedChange).not.toHaveBeenCalled();
  });

  it('reports the link down after 3 s of silence, and up again when hellos resume', () => {
    const { mesh, clock, connection, onLinkedChange } = liveDialedLink(2, 'p2');
    onLinkedChange.mockClear();
    clock.advance(3000);
    expect(mesh.linkedSlots()).toEqual([2]); // exactly 3 s is still live
    clock.advance(MESH_HEARTBEAT_MS);
    expect(mesh.linkedSlots()).toEqual([]);
    expect(onLinkedChange).toHaveBeenLastCalledWith([]);
    expect(connection.closed).toBe(false); // reported down, not yet closed

    connection.receive(hello(2));
    clock.advance(MESH_HEARTBEAT_MS);
    expect(mesh.linkedSlots()).toEqual([2]);
    expect(onLinkedChange).toHaveBeenLastCalledWith([2]);
  });

  it('closes a link that stays silent for the open timeout and redials', () => {
    const { mesh, clock, dial, connection } = liveDialedLink(2, 'p2');
    clock.advance(MESH_OPEN_TIMEOUT_MS + MESH_HEARTBEAT_MS);
    expect(connection.closed).toBe(true);
    expect(mesh.linkedSlots()).toEqual([]);
    clock.advance(MESH_RETRY_BASE_MS);
    expect(dial).toHaveBeenCalledTimes(2);
  });
});

describe('GuestMesh messages', () => {
  const snapshot = (senderSlot: PlayerSlot, t?: number) =>
    ({ type: 'playerSnapshot', senderSlot, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, ...(t === undefined ? {} : { t }) }) as NetworkMessage;

  it('sends only direct message types, on live links', () => {
    const { mesh, connection } = liveDialedLink(2, 'p2');
    const baseline = connection.sent.length;
    mesh.send({ type: 'damageEvent', senderSlot: 1, targetSlot: 2, amount: 5 } as NetworkMessage);
    mesh.send({ type: 'playerDied', senderSlot: 1, victimSlot: 1, killerSlot: 2 } as NetworkMessage);
    expect(connection.sent).toHaveLength(baseline);
    mesh.send(snapshot(1));
    mesh.send({ type: 'fireEvent', senderSlot: 1 } as unknown as NetworkMessage);
    expect(connection.sent.slice(baseline).map((message) => message.type)).toEqual(['playerSnapshot', 'fireEvent']);
  });

  it('a clocked snapshot takes the fast channel when it accepts it', () => {
    const { mesh, connection, fast } = liveDialedLink(2, 'p2');
    const baseline = connection.sent.length;
    fast[0]!.trySend.mockReturnValue(true);
    mesh.send(snapshot(1, 7));
    expect(fast[0]!.trySend).toHaveBeenCalledTimes(1);
    expect(connection.sent).toHaveLength(baseline);
    fast[0]!.trySend.mockReturnValue(false);
    mesh.send(snapshot(1, 8));
    expect(connection.sent).toHaveLength(baseline + 1);
    // No stamp, no fast channel.
    mesh.send(snapshot(1));
    expect(fast[0]!.trySend).toHaveBeenCalledTimes(2);
  });

  it('does not send on a link that is not live', () => {
    const { mesh, dialed } = makeMesh(1);
    mesh.setRoster(roster([2, 'p2']));
    dialed[0]!.doOpen();
    const baseline = dialed[0]!.sent.length;
    mesh.send(snapshot(1)); // greeted yet? no
    expect(dialed[0]!.sent).toHaveLength(baseline);
  });

  it('passes on a direct message that names the link own slot as sender, and drops the rest', () => {
    const { connection, onMessage } = liveDialedLink(2, 'p2');
    connection.receive(snapshot(2));
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'playerSnapshot', senderSlot: 2 }), 2);

    connection.receive(snapshot(3)); // claims to be another guest
    connection.receive({ type: 'damageEvent', senderSlot: 2, targetSlot: 1, amount: 1 }); // not a direct type
    connection.receive('junk');
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('drops a direct message that arrives before the link has been greeted', () => {
    const { mesh, dialed, onMessage } = makeMesh(1);
    mesh.setRoster(roster([2, 'p2']));
    dialed[0]!.doOpen();
    dialed[0]!.receive(snapshot(2));
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('GuestMesh dispose', () => {
  it('closes every link and pending connection and stops its timers', () => {
    const { mesh, clock, dial, connection } = liveDialedLink(2, 'p2');
    const pending = openIncoming('p3');
    mesh.accept(pending);
    mesh.dispose();
    expect(connection.closed).toBe(true);
    expect(pending.closed).toBe(true);
    expect(mesh.linkedSlots()).toEqual([]);
    expect(clock.pendingTimers()).toBe(0);
    clock.advance(10 * MESH_RETRY_MAX_MS);
    expect(dial).toHaveBeenCalledTimes(1);
    const late = openIncoming('p4');
    mesh.accept(late);
    expect(late.closed).toBe(true);
  });
});
