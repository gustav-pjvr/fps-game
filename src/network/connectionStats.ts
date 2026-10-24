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

/** What the HUD shows and how far ahead each opponent is predicted (RemotePlayer.setLeadSeconds),
 * from one round of measurements. Only direct links can be measured: a guest measures the host,
 * the host measures every guest. */
export interface ConnectionSummary {
  /** Guest: its link to the host. Host: its slowest guest, and relay if any guest is relayed. */
  readonly shown: ConnectionQuality;
  /** Seconds of network delay to make up for each opponent, by slot. */
  readonly leadSeconds: ReadonlyMap<number, number>;
}

export function summarizeConnection(
  role: 'host' | 'guest',
  hostSlot: number,
  measured: ReadonlyMap<number, ConnectionQuality>,
  opponentSlots: Iterable<number>,
): ConnectionSummary {
  const leadSeconds = new Map<number, number>();
  if (role === 'guest') {
    const host = measured.get(hostSlot) ?? UNKNOWN_QUALITY;
    const oneWay = host.rttMs === null ? 0 : host.rttMs / 2000;
    // Another guest's updates cross two links, theirs to the host and the host's to here; with only
    // this side measured, assume theirs is about the same.
    for (const slot of opponentSlots) leadSeconds.set(slot, slot === hostSlot ? oneWay : oneWay * 2);
    return { shown: host, leadSeconds };
  }
  let worst: number | null = null;
  let relayed = false;
  let anyRoute = false;
  for (const slot of opponentSlots) {
    const quality = measured.get(slot) ?? UNKNOWN_QUALITY;
    leadSeconds.set(slot, quality.rttMs === null ? 0 : quality.rttMs / 2000);
    if (quality.rttMs !== null) worst = Math.max(worst ?? 0, quality.rttMs);
    if (quality.route !== null) anyRoute = true;
    if (quality.route === 'relay') relayed = true;
  }
  return { shown: { rttMs: worst, route: relayed ? 'relay' : anyRoute ? 'direct' : null }, leadSeconds };
}

/** The HUD line: "Ping 42 ms", "Ping 120 ms, relay", or "Ping --" before the first measurement. */
export function formatConnection(quality: ConnectionQuality): string {
  const ping = quality.rttMs === null ? 'Ping --' : `Ping ${quality.rttMs} ms`;
  return quality.route === 'relay' ? `${ping}, relay` : ping;
}
