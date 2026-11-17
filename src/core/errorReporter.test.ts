import { describe, expect, it } from 'vitest';
import { browserFamily, installErrorReporter, scrub, type ErrorReport, type ReporterEnv } from './errorReporter.ts';

type Handler = (event: any) => void;

/** A fake browser: a manual clock, timers, a rAF queue, listener maps and recorded sends. */
function makeEnv(userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36') {
  let nowMs = 1000;
  const winHandlers = new Map<string, Handler[]>();
  const docHandlers = new Map<string, Handler[]>();
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let nextTimer = 1;
  let frame: (() => void) | null = null;
  const fetched: { url: string; reports: ErrorReport[]; keepalive: boolean }[] = [];
  const beaconed: { url: string; body: Blob }[] = [];
  const doc = { visibilityState: 'visible' };
  const add = (map: Map<string, Handler[]>) => (type: string, handler: Handler) => void map.set(type, [...(map.get(type) ?? []), handler]);
  const remove = (map: Map<string, Handler[]>) => (type: string, handler: Handler) => void map.set(type, (map.get(type) ?? []).filter((h) => h !== handler));
  const env: ReporterEnv & { sendBeacon: ((url: string, body: Blob) => boolean) | null } = {
    win: {
      addEventListener: add(winHandlers),
      removeEventListener: remove(winHandlers),
      requestAnimationFrame: (cb) => {
        frame = cb;
        return 1;
      },
      cancelAnimationFrame: () => {
        frame = null;
      },
    },
    doc: Object.assign(doc, { addEventListener: add(docHandlers), removeEventListener: remove(docHandlers) }),
    now: () => nowMs,
    fetch: async (url, init) => {
      fetched.push({ url, reports: JSON.parse(init.body) as ErrorReport[], keepalive: init.keepalive });
      return {};
    },
    sendBeacon: (url, body) => {
      beaconed.push({ url, body });
      return true;
    },
    setTimeout: (fn, ms) => {
      timers.push({ id: nextTimer, at: nowMs + ms, fn });
      return nextTimer++;
    },
    clearTimeout: (handle) => {
      const i = timers.findIndex((t) => t.id === handle);
      if (i >= 0) timers.splice(i, 1);
    },
    userAgent,
  };
  return {
    env,
    doc,
    fetched,
    beaconed,
    /** Moves the clock and runs the timers that came due. */
    advance(ms: number) {
      nowMs += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at <= nowMs) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
    },
    /** Runs the pending animation frame callback, as the browser would at the current clock. */
    frame() {
      const cb = frame;
      frame = null;
      cb?.();
    },
    fire(type: string, event: unknown = {}, target: 'win' | 'doc' = 'win') {
      for (const h of (target === 'win' ? winHandlers : docHandlers).get(type) ?? []) h(event);
    },
    timerCount: () => timers.length,
  };
}

function setup(overrides: { dev?: boolean; userAgent?: string } = {}) {
  const fake = makeEnv(overrides.userAgent);
  const reporter = installErrorReporter({
    getState: () => ({ where: 'solo', graphics: 'high' }),
    version: '5.1.0',
    dev: overrides.dev ?? false,
    env: fake.env,
  });
  return { ...fake, reporter };
}

describe('scrub', () => {
  it('drops query strings and fragments from URLs in messages and stacks', () => {
    expect(scrub('Failed to load https://h.test/assets/a.js?room=ABCD&token=zzz#frag now')).toBe('Failed to load https://h.test/assets/a.js now');
    expect(scrub('at f (https://h.test/a.js?v=1:10:5)')).toBe('at f (https://h.test/a.js:10:5)');
    expect(scrub('wss://relay.test/room?code=XYZ')).toBe('wss://relay.test/room');
    expect(scrub('/assets/chunk-1.mjs?t=9 failed')).toBe('/assets/chunk-1.mjs failed');
  });

  it('leaves text without a URL alone', () => {
    expect(scrub('TypeError: x is not a function')).toBe('TypeError: x is not a function');
  });
});

describe('browserFamily', () => {
  it('keeps a family and major version only', () => {
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/142.0.7444.60 Safari/537.36')).toBe('Chrome 142');
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36 Edg/141.0.2535.1')).toBe('Edge 141');
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox 130');
    expect(browserFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15')).toBe('Safari 17');
    expect(browserFamily('curl/8.0')).toBe('Other');
  });
});

describe('errorReporter', () => {
  it('reports an uncaught error with the scrubbed message and stack, the game state and the browser family', () => {
    const t = setup();
    const error = new TypeError('bad thing at https://h.test/x.js?room=ABCD');
    error.stack = 'TypeError: bad thing\n    at run (https://h.test/assets/main.js?v=3#x:1:2)';
    t.fire('error', { error, message: 'ignored' });
    t.reporter.flush();
    expect(t.fetched).toHaveLength(1);
    expect(t.fetched[0]?.reports[0]).toEqual({
      kind: 'error',
      message: 'TypeError: bad thing at https://h.test/x.js',
      stack: 'TypeError: bad thing\n    at run (https://h.test/assets/main.js:1:2)',
      version: '5.1.0',
      where: 'solo',
      graphics: 'high',
      ua: 'Chrome 142',
    });
    expect(JSON.stringify(t.fetched)).not.toContain('Mozilla');
  });

  it('reports a bare error event (no error object) and an unhandled rejection of a non-Error', () => {
    const t = setup();
    t.fire('error', { message: 'Script error.', filename: 'https://cdn.test/a.js?k=1', lineno: 3, colno: 4 });
    t.fire('unhandledrejection', { reason: 'plain string' });
    t.fire('unhandledrejection', { reason: { code: 7 } });
    t.reporter.flush();
    const reports = t.fetched[0]?.reports ?? [];
    expect(reports.map((r) => [r.kind, r.message])).toEqual([
      ['error', 'Script error.'],
      ['rejection', 'plain string'],
      ['rejection', '{"code":7}'],
    ]);
    expect(reports[0]?.stack).toBe('at https://cdn.test/a.js:3:4');
  });

  it('counts the same kind and message once per session', () => {
    const t = setup();
    for (let i = 0; i < 5; i++) t.fire('error', { error: new Error('same') });
    t.fire('unhandledrejection', { reason: new Error('same') });
    t.fire('error', { error: new Error('other') });
    t.reporter.flush();
    expect(t.fetched[0]?.reports.map((r) => `${r.kind}:${r.message}`)).toEqual(['error:same', 'rejection:same', 'error:other']);
  });

  it('stops at 20 reports per session', () => {
    const t = setup();
    for (let i = 0; i < 45; i++) t.fire('error', { error: new Error(`e${i}`) });
    t.reporter.flush();
    const sent = t.fetched.flatMap((f) => f.reports);
    expect(sent).toHaveLength(20);
    expect(t.fetched.map((f) => f.reports.length)).toEqual([10, 10]);
  });

  it('batches: the first report waits, a burst goes out as one request, later sends are 10 s apart', () => {
    const t = setup();
    t.fire('error', { error: new Error('a') });
    t.fire('error', { error: new Error('b') });
    expect(t.fetched).toHaveLength(0);
    t.advance(2000);
    expect(t.fetched).toHaveLength(1);
    expect(t.fetched[0]?.reports).toHaveLength(2);
    expect(t.fetched[0]?.keepalive).toBe(true);
    expect(t.fetched[0]?.url).toBe('/api/errors');

    t.advance(500);
    t.fire('error', { error: new Error('c') });
    t.advance(9000);
    expect(t.fetched).toHaveLength(1);
    t.advance(500);
    expect(t.fetched).toHaveLength(2);
    expect(t.fetched[1]?.reports.map((r) => r.message)).toEqual(['c']);
  });

  it('sends what is queued on pagehide with sendBeacon, falling back to a keepalive fetch', () => {
    const t = setup();
    t.fire('error', { error: new Error('last words') });
    t.fire('pagehide');
    expect(t.beaconed).toHaveLength(1);
    expect(t.beaconed[0]?.url).toBe('/api/errors');
    expect(t.fetched).toHaveLength(0);
    expect(t.timerCount()).toBe(0);

    const noBeacon = setup();
    noBeacon.env.sendBeacon = null;
    noBeacon.fire('error', { error: new Error('last words') });
    noBeacon.fire('pagehide');
    expect(noBeacon.fetched).toHaveLength(1);
    expect(noBeacon.fetched[0]?.keepalive).toBe(true);
  });

  it('keeps every request under the 16 KB body limit', () => {
    const t = setup();
    for (let i = 0; i < 10; i++) {
      const error = new Error(`${i}${'m'.repeat(400)}`);
      error.stack = 's'.repeat(5000);
      t.fire('error', { error });
    }
    t.reporter.flush();
    expect(t.fetched.length).toBeGreaterThan(1);
    expect(t.fetched.flatMap((f) => f.reports)).toHaveLength(10);
    for (const f of t.fetched) {
      expect(JSON.stringify(f.reports).length).toBeLessThanOrEqual(15000);
      for (const r of f.reports) {
        expect(r.message.length).toBeLessThanOrEqual(300);
        expect(r.stack?.length).toBeLessThanOrEqual(2000);
      }
    }
  });

  it('reports a WebGL context loss on a canvas that is still in the page, not one already removed', () => {
    const t = setup();
    t.fire('webglcontextlost', { target: { isConnected: false } }, 'doc');
    expect(t.timerCount()).toBe(0);
    t.fire('webglcontextlost', { target: { isConnected: true } }, 'doc');
    t.reporter.flush();
    expect(t.fetched[0]?.reports.map((r) => [r.kind, r.message])).toEqual([['webgl', 'WebGL context lost']]);
  });

  describe('freeze detection', () => {
    it('reports a gap of more than 1000 ms between frames with freezeMs', () => {
      const t = setup();
      t.frame();
      t.advance(16);
      t.frame();
      t.advance(1000);
      t.frame();
      expect(t.timerCount()).toBe(0);
      t.advance(1500);
      t.frame();
      t.reporter.flush();
      expect(t.fetched[0]?.reports).toEqual([
        { kind: 'freeze', message: 'Main thread freeze', version: '5.1.0', where: 'solo', graphics: 'high', ua: 'Chrome 142', freezeMs: 1500 },
      ]);
    });

    it('does not report when the page was hidden in between', () => {
      const t = setup();
      t.frame();
      t.doc.visibilityState = 'hidden';
      t.fire('visibilitychange', {}, 'doc');
      t.advance(30000);
      t.doc.visibilityState = 'visible';
      t.fire('visibilitychange', {}, 'doc');
      t.advance(16);
      t.frame();
      t.advance(16);
      t.frame();
      t.reporter.flush();
      expect(t.fetched).toHaveLength(0);
    });

    it('does not report a frame that lands while the page is hidden, nor the one after it', () => {
      const t = setup();
      t.frame();
      t.doc.visibilityState = 'hidden';
      t.advance(5000);
      t.frame();
      t.doc.visibilityState = 'visible';
      t.advance(16);
      t.frame();
      t.reporter.flush();
      expect(t.fetched).toHaveLength(0);
    });

    it('clamps an enormous freeze to 60000 ms', () => {
      const t = setup();
      t.frame();
      t.advance(10 * 60 * 1000);
      t.frame();
      t.reporter.flush();
      expect(t.fetched[0]?.reports[0]?.freezeMs).toBe(60000);
    });
  });

  it('never throws, even when the state getter does', () => {
    const fake = makeEnv();
    const reporter = installErrorReporter({
      getState: () => {
        throw new Error('getter broke');
      },
      version: '5.1.0',
      dev: false,
      env: fake.env,
    });
    expect(() => fake.fire('error', { error: new Error('x') })).not.toThrow();
    reporter.flush();
    expect(fake.fetched[0]?.reports[0]).toMatchObject({ where: 'unknown', graphics: 'unknown' });
  });

  it('survives a failing fetch and a throwing sendBeacon', async () => {
    const t = setup();
    t.env.fetch = () => Promise.reject(new Error('offline'));
    t.fire('error', { error: new Error('x') });
    expect(() => t.reporter.flush()).not.toThrow();
    t.env.sendBeacon = () => {
      throw new Error('no beacon');
    };
    t.fire('error', { error: new Error('y') });
    expect(() => t.fire('pagehide')).not.toThrow();
    await Promise.resolve();
  });

  it('does nothing in a dev build: no listeners, no frame loop, nothing sent', () => {
    const t = setup({ dev: true });
    t.fire('error', { error: new Error('dev') });
    t.fire('webglcontextlost', { target: { isConnected: true } }, 'doc');
    t.frame();
    t.advance(5000);
    t.frame();
    t.reporter.report('error', 'direct');
    t.reporter.flush();
    t.fire('pagehide');
    expect(t.fetched).toHaveLength(0);
    expect(t.beaconed).toHaveLength(0);
    expect(t.timerCount()).toBe(0);
  });

  it('removes its listeners and loop on dispose', () => {
    const t = setup();
    t.reporter.dispose();
    t.fire('error', { error: new Error('after') });
    t.advance(5000);
    t.reporter.flush();
    expect(t.fetched).toHaveLength(0);
  });
});
