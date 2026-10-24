import { describe, expect, it } from 'vitest';
import { formatConnection, readConnectionQuality, summarizeConnection } from './connectionStats.ts';

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
  it('a guest shows its link to the host and doubles the lead for other guests', () => {
    const summary = summarizeConnection('guest', 0, new Map([[0, { rttMs: 80, route: 'direct' as const }]]), [0, 2]);
    expect(summary.shown).toEqual({ rttMs: 80, route: 'direct' });
    expect(summary.leadSeconds.get(0)).toBeCloseTo(0.04);
    expect(summary.leadSeconds.get(2)).toBeCloseTo(0.08);
  });

  it('the host shows its slowest guest and flags a relay', () => {
    const summary = summarizeConnection(
      'host',
      0,
      new Map([
        [1, { rttMs: 30, route: 'direct' as const }],
        [2, { rttMs: 140, route: 'relay' as const }],
      ]),
      [1, 2, 3],
    );
    expect(summary.shown).toEqual({ rttMs: 140, route: 'relay' });
    expect(summary.leadSeconds.get(1)).toBeCloseTo(0.015);
    expect(summary.leadSeconds.get(3)).toBe(0);
  });

  it('formats the HUD line', () => {
    expect(formatConnection({ rttMs: 42, route: 'direct' })).toBe('Ping 42 ms');
    expect(formatConnection({ rttMs: 120, route: 'relay' })).toBe('Ping 120 ms, relay');
    expect(formatConnection({ rttMs: null, route: null })).toBe('Ping --');
  });
});
