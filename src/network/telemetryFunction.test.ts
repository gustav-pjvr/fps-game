import { describe, expect, it } from 'vitest';
import { onRequestPost } from '../../functions/api/telemetry.ts';

/** Posts `body` through the real Pages Function with a fake KV and returns what was stored. */
async function post(body: unknown, rawBody?: string): Promise<{ status: number; stored: Record<string, unknown>[] }> {
  const stored: string[] = [];
  const env = { MATCH_TELEMETRY: { put: async (_key: string, value: string) => void stored.push(value) } };
  const request = new Request('https://example.test/api/telemetry', { method: 'POST', body: rawBody ?? JSON.stringify(body) });
  const response = await onRequestPost({ request, env });
  return { status: response.status, stored: stored.map((s) => JSON.parse(s) as Record<string, unknown>) };
}

const BASE = { mode: 'default', waveOrKills: 7, durationMs: 120000, version: '4.7.0' };

describe('telemetry function', () => {
  it('stores today\'s four fields for a solo body, unchanged', async () => {
    const { status, stored } = await post(BASE);
    expect(status).toBe(204);
    expect(stored).toEqual([BASE]);
  });

  it('stores the optional connection fields when well-formed', async () => {
    const full = { ...BASE, transport: 'p2p', players: 3, pingP50: 42, pingP95: 118, snapshotGapP95: 96, stallsPerMin: 1.5, joinMs: 830 };
    expect((await post(full)).stored).toEqual([full]);
  });

  it('clamps numbers to 0..60000 and players to 1..16', async () => {
    const { stored } = await post({ ...BASE, players: 99, pingP50: -4, pingP95: 1e9, snapshotGapP95: 70000, stallsPerMin: -1, joinMs: 61000 });
    expect(stored[0]).toMatchObject({ players: 16, pingP50: 0, pingP95: 60000, snapshotGapP95: 60000, stallsPerMin: 0, joinMs: 60000 });
    expect((await post({ ...BASE, players: 0 })).stored[0]?.players).toBe(1);
  });

  it('drops a malformed optional field on its own without losing the record', async () => {
    const { stored } = await post({ ...BASE, transport: 'x'.repeat(17), players: 'three', pingP50: '40', pingP95: null, snapshotGapP95: Number.POSITIVE_INFINITY, stallsPerMin: 2, joinMs: {} });
    expect(stored).toEqual([{ ...BASE, stallsPerMin: 2 }]);
    expect((await post({ ...BASE, transport: '' })).stored).toEqual([BASE]);
    expect((await post({ ...BASE, transport: 'server' })).stored[0]?.transport).toBe('server');
  });

  it('ignores any other field', async () => {
    const { stored } = await post({ ...BASE, username: 'someone', roomCode: 'ABCD', pingSamples: 50 });
    expect(stored).toEqual([BASE]);
  });

  it('still stores nothing, and still answers 204, when a required field is wrong or the body is not JSON', async () => {
    expect(await post({ ...BASE, durationMs: 'long', pingP50: 40 })).toEqual({ status: 204, stored: [] });
    expect(await post({ ...BASE, mode: '' })).toEqual({ status: 204, stored: [] });
    expect(await post(null, 'not json')).toEqual({ status: 204, stored: [] });
  });

  it('answers 204 when KV throws or is not bound', async () => {
    const request = new Request('https://example.test/api/telemetry', { method: 'POST', body: JSON.stringify(BASE) });
    const failing = { MATCH_TELEMETRY: { put: async () => { throw new Error('kv down'); } } };
    expect((await onRequestPost({ request, env: failing })).status).toBe(204);
    const unbound = new Request('https://example.test/api/telemetry', { method: 'POST', body: JSON.stringify(BASE) });
    expect((await onRequestPost({ request: unbound, env: {} })).status).toBe(204);
  });
});
