import { describe, expect, it } from 'vitest';
import { onRequestPost } from '../../functions/api/errors.ts';

interface Put {
  key: string;
  value: Record<string, unknown>;
  options: { expirationTtl?: number } | undefined;
}

/** Posts `body` through the real Pages Function with a fake KV and returns what was stored. */
async function post(body: unknown, rawBody?: string): Promise<{ status: number; puts: Put[]; stored: Record<string, unknown>[] }> {
  const puts: Put[] = [];
  const env = {
    MATCH_TELEMETRY: {
      put: async (key: string, value: string, options?: { expirationTtl?: number }) => void puts.push({ key, value: JSON.parse(value) as Record<string, unknown>, options }),
    },
  };
  const request = new Request('https://example.test/api/errors', { method: 'POST', body: rawBody ?? JSON.stringify(body) });
  const response = await onRequestPost({ request, env });
  return { status: response.status, puts, stored: puts.map((p) => p.value) };
}

const BASE = { kind: 'error', message: 'TypeError: x is undefined', stack: 'at a (https://h.test/a.js:1:2)', version: '5.1.0', where: 'solo', graphics: 'high', ua: 'Chrome 142' };

describe('errors function', () => {
  it('stores a well-formed batch, one key per report, under the error: prefix with a 30 day TTL', async () => {
    const freeze = { kind: 'freeze', message: 'Main thread freeze', version: '5.1.0', where: 'menu', graphics: 'low', ua: 'Firefox 130', freezeMs: 2400 };
    const { status, puts } = await post([BASE, freeze]);
    expect(status).toBe(204);
    expect(puts.map((p) => p.value)).toEqual([BASE, freeze]);
    for (const put of puts) {
      expect(put.key).toMatch(/^error:\d+:[0-9a-f-]{36}$/);
      expect(put.options).toEqual({ expirationTtl: 30 * 24 * 60 * 60 });
    }
    expect(new Set(puts.map((p) => p.key)).size).toBe(2);
  });

  it('also accepts the batch as { reports: [...] }', async () => {
    expect((await post({ reports: [BASE] })).stored).toEqual([BASE]);
  });

  it('keeps only the first 10 reports of a longer batch', async () => {
    const { stored } = await post(Array.from({ length: 14 }, (_, i) => ({ ...BASE, message: `m${i}` })));
    expect(stored.map((r) => r.message)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`));
  });

  it('cuts an over-long message and stack to their limits', async () => {
    const { stored } = await post([{ ...BASE, message: 'm'.repeat(500), stack: 's'.repeat(5000) }]);
    expect((stored[0]?.message as string).length).toBe(300);
    expect((stored[0]?.stack as string).length).toBe(2000);
  });

  it('drops a malformed report on its own without failing the rest of the batch', async () => {
    const good = { ...BASE, message: 'good' };
    const { status, stored } = await post([
      good,
      { ...BASE, kind: 'crash' },
      { ...BASE, message: '' },
      { ...BASE, version: 'v'.repeat(33) },
      { ...BASE, where: 'w'.repeat(41) },
      { ...BASE, graphics: 'g'.repeat(17) },
      { ...BASE, ua: 'u'.repeat(41) },
      { ...BASE, ua: undefined },
      { kind: 'freeze', message: 'f', version: '1', where: 'solo', graphics: 'low', ua: 'Chrome 1' },
      { kind: 'freeze', message: 'f', version: '1', where: 'solo', graphics: 'low', ua: 'Chrome 1', freezeMs: 'long' },
    ]);
    expect(status).toBe(204);
    expect(stored).toEqual([good]);
    // Entries that are not even objects, and a good report after them.
    expect((await post([null, 'text', 42, [], good])).stored).toEqual([good]);
  });

  it('clamps freezeMs to 0..60000 and ignores it on other kinds', async () => {
    const freeze = { kind: 'freeze', message: 'f', version: '1', where: 'solo', graphics: 'low', ua: 'Chrome 1' };
    const { stored } = await post([{ ...freeze, freezeMs: 9e9 }, { ...freeze, freezeMs: -5 }, { ...BASE, freezeMs: 300 }]);
    expect(stored.map((r) => r.freezeMs)).toEqual([60000, 0, undefined]);
  });

  it('ignores any field outside the schema, so nothing identifying can be stored', async () => {
    const { stored } = await post([{ ...BASE, username: 'someone', roomCode: 'ABCD', rawUserAgent: 'Mozilla/5.0 ...' }]);
    expect(stored).toEqual([BASE]);
  });

  it('rejects a body over 16 KB whole (nothing stored), judged by its real size in bytes', async () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ ...BASE, message: `m${i}`, stack: 's'.repeat(2000) }));
    expect(JSON.stringify(big).length).toBeGreaterThan(16 * 1024);
    expect(await post(big)).toMatchObject({ status: 204, stored: [] });
    // A body of exactly the limit is still read, one byte more is not.
    const json = JSON.stringify([BASE]);
    expect((await post(null, json + ' '.repeat(16 * 1024 - json.length))).stored).toHaveLength(1);
    expect((await post(null, json + ' '.repeat(16 * 1024 - json.length + 1))).stored).toHaveLength(0);
  });

  it('answers 204 and stores nothing for a body that is not JSON or not a batch', async () => {
    expect(await post(null, 'not json')).toMatchObject({ status: 204, stored: [] });
    expect(await post({ kind: 'error' })).toMatchObject({ status: 204, stored: [] });
    expect(await post(null, '')).toMatchObject({ status: 204, stored: [] });
    expect(await post([])).toMatchObject({ status: 204, stored: [] });
  });

  it('answers 204 when KV is not bound or throws, and one failing write loses only that report', async () => {
    const request = () => new Request('https://example.test/api/errors', { method: 'POST', body: JSON.stringify([BASE]) });
    expect((await onRequestPost({ request: request(), env: {} })).status).toBe(204);
    const failing = { MATCH_TELEMETRY: { put: async () => { throw new Error('kv down'); } } };
    expect((await onRequestPost({ request: request(), env: failing })).status).toBe(204);

    const stored: string[] = [];
    let calls = 0;
    const flaky = {
      MATCH_TELEMETRY: {
        put: async (_key: string, value: string) => {
          if (calls++ === 0) throw new Error('first write fails');
          stored.push(value);
        },
      },
    };
    const two = new Request('https://example.test/api/errors', { method: 'POST', body: JSON.stringify([BASE, { ...BASE, message: 'second' }]) });
    expect((await onRequestPost({ request: two, env: flaky })).status).toBe(204);
    expect(stored).toHaveLength(1);
  });
});
