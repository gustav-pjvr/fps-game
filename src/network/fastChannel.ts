import { isNetworkMessage, type NetworkMessage } from './protocol.ts';

/**
 * A second data channel beside PeerJS's reliable one, for messages where only the newest copy
 * matters. PeerJS's channel is ordered and reliable, so one lost packet holds back every message
 * behind it until it is resent (a full round trip or more): on Wi-Fi that showed as other players
 * stuttering and then rushing forward. This channel never resends and never waits, so a lost
 * position update is simply replaced by the next one.
 *
 * It rides the same RTCPeerConnection as PeerJS's channel (no second connection setup, no second
 * relay allocation). It is `negotiated` with a fixed id on both sides: an in-band channel would fire
 * the connection's `ondatachannel`, which PeerJS owns and would take over as its own channel.
 */

/** Only these message types may use the fast channel: each is a periodic full state where a newer
 * copy replaces an older one, and the receiver drops copies older than the last it applied (see
 * MatchMessageRouter's playerSnapshot case). Everything else stays on the reliable channel. */
export const FAST_MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set(['playerSnapshot']);

/** Fixed SCTP stream id, the same on both ends. PeerJS's own channel takes an automatic id (0 or 1);
 * this stays well clear of it and under Chrome's 1024-stream limit. */
export const FAST_CHANNEL_ID = 100;

/** How often to probe until the other side answers, and for how long. A browser on an older build
 * of the game never opens this channel, so messages sent into it would vanish; nothing goes on it
 * until the other side has proved it is listening. Twenty probes is ten seconds, after which the
 * reliable channel simply carries everything, as before. */
export const FAST_PROBE_INTERVAL_MS = 500;
export const FAST_MAX_PROBES = 20;

/** Above this much unsent data the link is congested; sending more would only queue stale
 * positions, so the message goes on the reliable channel's path instead (which also queues, but
 * that is where it went before this channel existed). */
const MAX_BUFFERED_BYTES = 64 * 1024;

interface FastProbe {
  readonly fastProbe: true;
  /** Whether the sender has already heard from this side. A probe with `heard: false` gets an
   * answer; one with `heard: true` does not, so two confirmed sides never ping-pong. */
  readonly heard: boolean;
}

/** The part of RTCDataChannel this class uses, so the tests can drive it with a fake. */
export interface FastChannelTransport {
  readonly readyState: RTCDataChannelState;
  readonly bufferedAmount: number;
  onopen: ((this: RTCDataChannel, ev: Event) => unknown) | null;
  onmessage: ((this: RTCDataChannel, ev: MessageEvent) => unknown) | null;
  send(data: string): void;
  close(): void;
}

export interface FastChannelTimers {
  setInterval(handler: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

const browserTimers: FastChannelTimers = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (id) => clearInterval(id),
};

export class FastChannel {
  private heard = false;
  private probesSent = 0;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly transport: FastChannelTransport,
    private readonly onMessage: (message: NetworkMessage) => void,
    private readonly timers: FastChannelTimers = browserTimers,
  ) {
    transport.onmessage = (event) => this.receive(event.data);
    if (transport.readyState === 'open') this.startProbing();
    else transport.onopen = () => this.startProbing();
  }

  /** Opens the fast channel on `peerConnection`, or returns null where the browser refuses (the
   * caller then keeps using the reliable channel for everything). */
  static open(peerConnection: RTCPeerConnection, onMessage: (message: NetworkMessage) => void): FastChannel | null {
    try {
      const channel = peerConnection.createDataChannel('fast', { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
      return new FastChannel(channel, onMessage);
    } catch {
      return null;
    }
  }

  /** True once the other side has answered, so messages sent now will be read. */
  get ready(): boolean {
    return this.heard && !this.closed && this.transport.readyState === 'open';
  }

  /** Sends `message` if the channel is ready and not congested. Returns false when it did not, so
   * the caller sends it on the reliable channel instead. */
  trySend(message: NetworkMessage): boolean {
    if (!this.ready || this.transport.bufferedAmount > MAX_BUFFERED_BYTES) return false;
    try {
      this.transport.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopProbing();
    this.transport.onmessage = null;
    this.transport.onopen = null;
    this.transport.close();
  }

  private startProbing(): void {
    if (this.closed || this.heard || this.probeTimer !== null) return;
    this.sendProbe();
    this.probeTimer = this.timers.setInterval(() => {
      if (this.heard || this.probesSent >= FAST_MAX_PROBES) this.stopProbing();
      else this.sendProbe();
    }, FAST_PROBE_INTERVAL_MS);
  }

  private stopProbing(): void {
    if (this.probeTimer === null) return;
    this.timers.clearInterval(this.probeTimer);
    this.probeTimer = null;
  }

  private sendProbe(): void {
    if (this.closed || this.transport.readyState !== 'open') return;
    this.probesSent++;
    const probe: FastProbe = { fastProbe: true, heard: this.heard };
    try {
      this.transport.send(JSON.stringify(probe));
    } catch {
      // A send that throws here means the channel is closing; the reliable channel carries on.
    }
  }

  private receive(data: unknown): void {
    if (this.closed || typeof data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;

    // Anything well formed from the other side proves it is listening.
    if ('fastProbe' in parsed) {
      this.heard = true;
      this.stopProbing();
      if (!(parsed as FastProbe).heard) this.sendProbe();
      return;
    }
    if (!isNetworkMessage(parsed) || !FAST_MESSAGE_TYPES.has(parsed.type)) return;
    this.heard = true;
    this.stopProbing();
    this.onMessage(parsed);
  }
}
