/** How a data channel's traffic travels: straight between the two browsers, or through the TURN
 * relay (functions/api/turn-credentials.ts), which adds a hop and is used only when a network
 * blocks the direct path. */
export type ConnectionRoute = 'direct' | 'relay';

export interface ConnectionQuality {
  /** Round trip in milliseconds over the pair of addresses the connection actually uses, measured
   * by the browser's own connectivity checks. Null until the first measurement. */
  readonly rttMs: number | null;
  readonly route: ConnectionRoute | null;
}

export const UNKNOWN_QUALITY: ConnectionQuality = { rttMs: null, route: null };

type StatsEntry = Record<string, unknown> & { type?: string; id?: string };

/** Reads round trip and route from an RTCPeerConnection.getStats() report. Chrome and Safari name
 * the pair in use on the `transport` entry; Firefox marks it `selected` on the pair itself; the
 * nominated, succeeded pair is the fallback for both. */
export function readConnectionQuality(report: Pick<RTCStatsReport, 'forEach' | 'get'>): ConnectionQuality {
  let pair: StatsEntry | undefined;
  let fallback: StatsEntry | undefined;
  report.forEach((value: StatsEntry) => {
    if (value.type === 'transport' && typeof value.selectedCandidatePairId === 'string') {
      pair ??= report.get(value.selectedCandidatePairId) as StatsEntry | undefined;
    } else if (value.type === 'candidate-pair') {
      if (value.selected === true) pair ??= value;
      else if (value.nominated === true && value.state === 'succeeded') fallback ??= value;
    }
  });
  pair ??= fallback;
  if (!pair) return UNKNOWN_QUALITY;

  const rtt = pair.currentRoundTripTime;
  const local = typeof pair.localCandidateId === 'string' ? (report.get(pair.localCandidateId) as StatsEntry | undefined) : undefined;
  const remote = typeof pair.remoteCandidateId === 'string' ? (report.get(pair.remoteCandidateId) as StatsEntry | undefined) : undefined;
  const route: ConnectionRoute | null =
    local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : local || remote ? 'direct' : null;
  return { rttMs: typeof rtt === 'number' ? Math.round(rtt * 1000) : null, route };
}

/** A guest's round trip to another guest it has no direct link to: its own link to the host plus
 * the host's measured link to that guest (LinkQualityMessage), unknown until both are known. Their
 * updates cross both links, so the sum is what they actually travel. */
export function combineRelayedQuality(hostLink: ConnectionQuality, hostToGuest: { rttMs: number | null; relay: boolean }): ConnectionQuality {
  const rttMs = hostLink.rttMs !== null && hostToGuest.rttMs !== null ? hostLink.rttMs + hostToGuest.rttMs : null;
  const route: ConnectionRoute | null = hostLink.route === 'relay' || hostToGuest.relay ? 'relay' : hostLink.route;
  return { rttMs, route };
}

/** What the HUD shows and how far ahead each opponent is predicted (RemotePlayer.setLeadSeconds),
 * from one round of measurements (PeerConnection.connectionQuality: one entry per opponent, over
 * the path their snapshots actually take). */
export interface ConnectionSummary {
  /** Each opponent's round trip, by slot; unknown where nothing was measured yet. */
  readonly perOpponent: ReadonlyMap<number, ConnectionQuality>;
  /** Seconds of network delay to make up for each opponent, by slot: half their round trip. */
  readonly leadSeconds: ReadonlyMap<number, number>;
}

export function summarizeConnection(measured: ReadonlyMap<number, ConnectionQuality>, opponentSlots: Iterable<number>): ConnectionSummary {
  const perOpponent = new Map<number, ConnectionQuality>();
  const leadSeconds = new Map<number, number>();
  for (const slot of opponentSlots) {
    const quality = measured.get(slot) ?? UNKNOWN_QUALITY;
    perOpponent.set(slot, quality);
    leadSeconds.set(slot, quality.rttMs === null ? 0 : quality.rttMs / 2000);
  }
  return { perOpponent, leadSeconds };
}

/** The HUD line: "Ping 42 ms", "Ping 120 ms, relay", or "Ping --" before the first measurement. */
export function formatConnection(quality: ConnectionQuality): string {
  const ping = quality.rttMs === null ? 'Ping --' : `Ping ${quality.rttMs} ms`;
  return quality.route === 'relay' ? `${ping}, relay` : ping;
}

/** The HUD line with several opponents, one round trip each: "Ping Ann 42 ms, Bob 61 ms relay,
 * Cat --". With one opponent it is formatConnection's line, as in a two-player match. */
export function formatOpponentPings(entries: readonly { name: string; quality: ConnectionQuality }[]): string {
  if (entries.length === 0) return formatConnection(UNKNOWN_QUALITY);
  if (entries.length === 1) return formatConnection(entries[0]!.quality);
  const parts = entries.map(({ name, quality }) => {
    const ping = quality.rttMs === null ? `${name} --` : `${name} ${quality.rttMs} ms`;
    return quality.route === 'relay' ? `${ping} relay` : ping;
  });
  return `Ping ${parts.join(', ')}`;
}
