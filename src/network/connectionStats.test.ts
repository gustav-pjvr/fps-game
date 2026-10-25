import { describe, expect, it } from 'vitest';
import { combineRelayedQuality, formatConnection, formatOpponentPings, readConnectionQuality, summarizeConnection } from './connectionStats.ts';

function report(entries: Record<string, unknown>[]): Pick<RTCStatsReport, 'forEach' | 'get'> {
  const map = new Map(entries.map((entry) => [entry.id as string, entry]));
  return {
    forEach: (callback: (value: unknown, key: string, parent: RTCStatsReport) => void) => map.forEach((value, key) => callback(value, key, map as unknown as RTCStatsReport)),
    get: (id: string) => map.get(id),
  };
}

const local = (id: string, candidateType: string) => ({ id, type: 'local-candidate', candidateType });
const remote = (id: string, candidateType: string) => ({ id, type: 'remote-candidate', candidateType });

describe('readConnectionQuality', () => {
  it('reads the pair the transport names (Chrome, Safari), ignoring other pairs', () => {
    const quality = readConnectionQuality(
      report([
        { id: 'T1', type: 'transport', selectedCandidatePairId: 'P2' },
        { id: 'P1', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.3, localCandidateId: 'L2', remoteCandidateId: 'R1' },
        { id: 'P2', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.0424, localCandidateId: 'L1', remoteCandidateId: 'R1' },
        local('L1', 'srflx'),
        local('L2', 'relay'),
        remote('R1', 'host'),
      ]),
    );
    expect(quality).toEqual({ rttMs: 42, route: 'direct' });
  });

  it('reports a relay when either end of the pair is a relay candidate', () => {
    const quality = readConnectionQuality(
      report([
        { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
        { id: 'P1', type: 'candidate-pair', currentRoundTripTime: 0.11, localCandidateId: 'L1', remoteCandidateId: 'R1' },
        local('L1', 'host'),
        remote('R1', 'relay'),
      ]),
    );
    expect(quality).toEqual({ rttMs: 110, route: 'relay' });
  });

  it("uses Firefox's selected flag, then a nominated succeeded pair", () => {
    expect(
      readConnectionQuality(report([{ id: 'P1', type: 'candidate-pair', selected: true, currentRoundTripTime: 0.02, localCandidateId: 'L1' }, local('L1', 'host')])),
    ).toEqual({ rttMs: 20, route: 'direct' });
    expect(
      readConnectionQuality(report([{ id: 'P1', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L1' }, local('L1', 'relay')])),
    ).toEqual({ rttMs: null, route: 'relay' });
  });

  it('is unknown before any pair is chosen', () => {
    expect(readConnectionQuality(report([{ id: 'P1', type: 'candidate-pair', state: 'in-progress' }]))).toEqual({ rttMs: null, route: null });
  });
});

describe('summarizeConnection', () => {
  it('gives every opponent its own round trip and half of it as lead', () => {
    const summary = summarizeConnection(
      new Map([
        [1, { rttMs: 30, route: 'direct' as const }],
        [2, { rttMs: 140, route: 'relay' as const }],
      ]),
      [1, 2],
    );
    expect(summary.perOpponent.get(1)).toEqual({ rttMs: 30, route: 'direct' });
    expect(summary.perOpponent.get(2)).toEqual({ rttMs: 140, route: 'relay' });
    expect(summary.leadSeconds.get(1)).toBeCloseTo(0.015);
    expect(summary.leadSeconds.get(2)).toBeCloseTo(0.07);
  });

  it('an opponent with no measurement yet is unknown with no lead, and unlisted slots are left out', () => {
    const summary = summarizeConnection(new Map([[5, { rttMs: 50, route: 'direct' as const }]]), [0, 3]);
    expect(summary.perOpponent.get(3)).toEqual({ rttMs: null, route: null });
    expect(summary.leadSeconds.get(3)).toBe(0);
    expect([...summary.perOpponent.keys()]).toEqual([0, 3]);
  });

  it('formats the HUD line', () => {
    expect(formatConnection({ rttMs: 42, route: 'direct' })).toBe('Ping 42 ms');
    expect(formatConnection({ rttMs: 120, route: 'relay' })).toBe('Ping 120 ms, relay');
    expect(formatConnection({ rttMs: null, route: null })).toBe('Ping --');
  });
});

describe('combineRelayedQuality', () => {
  it('adds the guest link to the host and the host link to the other guest', () => {
    expect(combineRelayedQuality({ rttMs: 30, route: 'direct' }, { rttMs: 45, relay: false })).toEqual({ rttMs: 75, route: 'direct' });
  });

  it('is unknown until both halves are known', () => {
    expect(combineRelayedQuality({ rttMs: null, route: 'direct' }, { rttMs: 45, relay: false }).rttMs).toBeNull();
    expect(combineRelayedQuality({ rttMs: 30, route: 'direct' }, { rttMs: null, relay: false }).rttMs).toBeNull();
  });

  it('is a relay when either half goes through a relay', () => {
    expect(combineRelayedQuality({ rttMs: 30, route: 'relay' }, { rttMs: 45, relay: false }).route).toBe('relay');
    expect(combineRelayedQuality({ rttMs: 30, route: 'direct' }, { rttMs: 45, relay: true }).route).toBe('relay');
  });

  it('keeps an unmeasured route unmeasured when nothing is a relay', () => {
    expect(combineRelayedQuality({ rttMs: null, route: null }, { rttMs: null, relay: false })).toEqual({ rttMs: null, route: null });
  });
});

describe('formatOpponentPings', () => {
  it('shows the plain ping line before any opponent is known', () => {
    expect(formatOpponentPings([])).toBe('Ping --');
  });

  it('shows one opponent as the two-player line', () => {
    expect(formatOpponentPings([{ name: 'Ann', quality: { rttMs: 42, route: 'direct' } }])).toBe('Ping 42 ms');
    expect(formatOpponentPings([{ name: 'Ann', quality: { rttMs: 120, route: 'relay' } }])).toBe('Ping 120 ms, relay');
  });

  it('names each opponent with its own round trip, marking relays and unmeasured ones', () => {
    expect(
      formatOpponentPings([
        { name: 'Ann', quality: { rttMs: 42, route: 'direct' } },
        { name: 'Bob', quality: { rttMs: 61, route: 'relay' } },
        { name: 'Cat', quality: { rttMs: null, route: null } },
      ]),
    ).toBe('Ping Ann 42 ms, Bob 61 ms relay, Cat --');
  });
});
