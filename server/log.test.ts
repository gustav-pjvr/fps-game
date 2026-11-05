import { describe, expect, it } from 'vitest';
import { createLogger, formatLine, LOG_STRING_MAX } from './log.ts';

const capture = (level: 'debug' | 'info' | 'warn' | 'error' = 'debug') => {
  const lines: string[] = [];
  const log = createLogger(level, (line) => lines.push(line), () => Date.UTC(2026, 10, 5, 12, 0, 0));
  return { lines, log, parsed: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
};

describe('log: JSON lines', () => {
  it('writes one JSON object per call: time, level, event, then the fields', () => {
    const { lines, log, parsed } = capture();
    log.info('roomOpen', { code: 'ABCDEF', capacity: 4, ok: true, slot: null });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(parsed()[0]).toEqual({ t: '2026-11-05T12:00:00.000Z', level: 'info', event: 'roomOpen', code: 'ABCDEF', capacity: 4, ok: true, slot: null });
  });

  it('drops lines below the configured level', () => {
    const { log, parsed } = capture('warn');
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(parsed().map((line) => line.event)).toEqual(['c', 'd']);
  });

  it('a field cannot overwrite the time, level or event', () => {
    expect(JSON.parse(formatLine('info', 'x', { t: 'forged', level: 'error', event: 'forged', a: 1 }, 0))).toEqual({ t: '1970-01-01T00:00:00.000Z', level: 'info', event: 'x', a: 1 });
  });

  it('a sink that throws never throws into the relay', () => {
    const log = createLogger('info', () => {
      throw new Error('disk full');
    });
    expect(() => log.error('x')).not.toThrow();
  });
});

describe('log: never payloads or the access code', () => {
  it('redacts keys that would carry a secret or a payload, whatever their case', () => {
    const { log, parsed } = capture();
    log.warn('handshake', { access: 'hunter2', accessCode: 'hunter2', ACCESSCODES: 'hunter2', token: 't', rejoinToken: 't', m: '{"type":"playerSnapshot"}', payload: 'p', frame: 'f', text: 'x', data: 'd', welcome: 'w', body: 'b', ip: '203.0.113.9' });
    const line = parsed()[0] ?? {};
    expect(JSON.stringify(line)).not.toContain('hunter2');
    expect(JSON.stringify(line)).not.toContain('playerSnapshot');
    for (const key of ['access', 'accessCode', 'ACCESSCODES', 'token', 'rejoinToken', 'm', 'payload', 'frame', 'text', 'data', 'welcome', 'body']) expect(line[key]).toBe('[redacted]');
    expect(line.ip).toBe('203.0.113.9');
  });

  it('cuts long strings, so a payload cannot ride along in an ordinary field', () => {
    const { log, parsed } = capture();
    const payload = `{"m":${'x'.repeat(5000)}}`;
    log.info('upgradeRefused', { origin: payload, event2: 'y' });
    const origin = parsed()[0]?.origin as string;
    expect(origin.length).toBe(LOG_STRING_MAX + 3);
    expect(origin.endsWith('...')).toBe(true);
  });

  it('keeps only flat values: objects and non-finite numbers do not get through', () => {
    const fields = { nested: { m: 'secret' }, n: Number.NaN, inf: Number.POSITIVE_INFINITY } as unknown as Record<string, string>;
    const line = JSON.parse(formatLine('info', 'x', fields, 0)) as Record<string, unknown>;
    expect(line).not.toHaveProperty('nested');
    expect(line.n).toBeNull();
    expect(line.inf).toBeNull();
  });
});
