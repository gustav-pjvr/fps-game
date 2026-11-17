/** Anonymous crash and freeze reporter: when the game breaks or hangs on a player's machine, the owner
 * hears about it without a screenshot. Installed once from main.ts at app start; reports go to
 * functions/api/errors.ts (see its header for the storage side and the 30 day expiry).
 *
 * What it listens to: uncaught errors and unhandled rejections on the window, WebGL context loss on
 * any canvas still in the page (a capture listener on the document, so the lobby's and the match's
 * canvases are both covered and this file imports no game modules), and freezes: a gap of more than
 * a second between two animation frames while the page stayed visible throughout.
 *
 * What it never sends: a username, a room code, localStorage contents, or the raw user agent (only a
 * browser family and major version), and URLs in messages and stacks lose their query string and
 * fragment (see scrub). It reads the game's `where` and graphics preset through a getter it is
 * handed, nothing more.
 *
 * Limits: the same kind and message is reported once per page session, at most 20 reports per
 * session, sent in batches of up to 10 at most every 10 s, and on `pagehide` with sendBeacon (falling
 * back to a keepalive fetch). It never throws, never logs, and does nothing at all in a dev build. */

export type ReportKind = 'error' | 'rejection' | 'freeze' | 'webgl';

export interface ErrorReport {
  kind: ReportKind;
  message: string;
  stack?: string;
  version: string;
  where: string;
  graphics: string;
  /** Freeze reports only. */
  freezeMs?: number;
  ua: string;
}

export interface ReporterGameState {
  /** 'menu' | 'solo' | 'multiplayer'. */
  where: string;
  /** The graphics quality preset name. */
  graphics: string;
}

/** The slice of the browser the reporter touches, so tests can inject all of it. Handlers are typed
 * loosely on purpose: real events are narrower than the structural minimum a fake provides. */
export interface ReporterEnv {
  win: {
    addEventListener(type: string, handler: (event: any) => void): void;
    removeEventListener(type: string, handler: (event: any) => void): void;
    requestAnimationFrame(callback: () => void): number;
    cancelAnimationFrame(handle: number): void;
  };
  doc: {
    visibilityState: string;
    addEventListener(type: string, handler: (event: any) => void, capture?: boolean): void;
    removeEventListener(type: string, handler: (event: any) => void, capture?: boolean): void;
  };
  now(): number;
  fetch(url: string, init: { method: string; body: string; keepalive: boolean; headers: Record<string, string> }): Promise<unknown>;
  /** navigator.sendBeacon, or null when unavailable. */
  sendBeacon: ((url: string, body: Blob) => boolean) | null;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  userAgent: string;
}

export interface ReporterOptions {
  getState: () => ReporterGameState;
  version: string;
  /** True in a dev build: the reporter installs nothing. */
  dev: boolean;
  endpoint?: string;
  env?: ReporterEnv;
}

export interface ErrorReporter {
  /** Queues a report (subject to dedupe and the session cap). Used by the listeners; exposed for tests. */
  report(kind: ReportKind, message: string, stack?: string, freezeMs?: number): void;
  /** Sends what is queued now, in batches. */
  flush(): void;
  dispose(): void;
}

const ENDPOINT = '/api/errors';
const MAX_REPORTS_PER_SESSION = 20;
const MAX_BATCH = 10;
/** Stay under the endpoint's 16 KB body limit (it rejects a bigger body whole). */
const MAX_BODY_BYTES = 15000;
const SEND_INTERVAL_MS = 10000;
/** The first report of a burst waits this long, so a cascade of errors goes out as one batch. */
const FIRST_SEND_DELAY_MS = 2000;
const FREEZE_THRESHOLD_MS = 1000;
const MESSAGE_MAX = 300;
const STACK_MAX = 2000;

const NOOP_REPORTER: ErrorReporter = { report: () => {}, flush: () => {}, dispose: () => {} };

/** Drops the query string and fragment of every URL-like token: absolute URLs, and bare script paths
 * as they appear in stack frames. A room code or token riding in either is gone before it is sent.
 * The lookahead keeps a stack frame's trailing `:line:column`, which follows the query. */
export function scrub(text: string): string {
  return text
    .replace(/((?:https?|wss?|blob|file):\/\/[^\s?#)'"]*)[?#][^\s)'"]*?(?=(?::\d+){0,2}(?:[\s)'"]|$))/gi, '$1')
    .replace(/(\.(?:m?js|ts|css|html|json|wasm))[?#][^\s)'"]*?(?=(?::\d+){0,2}(?:[\s)'"]|$))/gi, '$1');
}

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** A browser family and major version only ("Chrome 142"), never the raw user agent. */
export function browserFamily(userAgent: string): string {
  const patterns: [string, RegExp][] = [
    ['Edge', /\bEdg(?:e|A|iOS)?\/(\d+)/],
    ['Opera', /\bOPR\/(\d+)/],
    ['Firefox', /\b(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /\b(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /\bVersion\/(\d+)[^]*\bSafari\//],
  ];
  for (const [name, pattern] of patterns) {
    const match = pattern.exec(userAgent);
    if (match) return `${name} ${match[1]}`;
  }
  return 'Other';
}

function byteLength(text: string): number {
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length * 3;
}

function describeError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.name && value.name !== 'Error' ? `${value.name}: ${value.message}` : value.message, stack: value.stack };
  }
  if (typeof value === 'string') return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: 'Unserializable value' };
  }
}

function browserEnv(): ReporterEnv {
  return {
    win: window,
    doc: document,
    now: () => performance.now(),
    fetch: (url, init) => fetch(url, init),
    sendBeacon: typeof navigator.sendBeacon === 'function' ? (url, body) => navigator.sendBeacon(url, body) : null,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    userAgent: navigator.userAgent,
  };
}

export function installErrorReporter(options: ReporterOptions): ErrorReporter {
  if (options.dev) return NOOP_REPORTER;
  try {
    return install(options, options.env ?? browserEnv());
  } catch {
    return NOOP_REPORTER;
  }
}

function install(options: ReporterOptions, env: ReporterEnv): ErrorReporter {
  const endpoint = options.endpoint ?? ENDPOINT;
  const ua = browserFamily(env.userAgent);
  const seen = new Set<string>();
  const queue: ErrorReport[] = [];
  let accepted = 0;
  let lastSendAt: number | null = null;
  let timer: unknown = null;
  let disposed = false;

  const report: ErrorReporter['report'] = (kind, message, stack, freezeMs) => {
    try {
      if (disposed || accepted >= MAX_REPORTS_PER_SESSION) return;
      const cleanMessage = cut(scrub(message), MESSAGE_MAX);
      if (cleanMessage.length === 0) return;
      const key = `${kind}\n${cleanMessage}`;
      if (seen.has(key)) return;
      seen.add(key);
      accepted++;
      let where = 'unknown';
      let graphics = 'unknown';
      try {
        const state = options.getState();
        where = cut(String(state.where), 40);
        graphics = cut(String(state.graphics), 16);
      } catch {
        // A broken getter must not cost the report.
      }
      const entry: ErrorReport = { kind, message: cleanMessage, version: cut(options.version, 32), where, graphics, ua };
      if (stack) entry.stack = cut(scrub(stack), STACK_MAX);
      if (kind === 'freeze' && freezeMs !== undefined) entry.freezeMs = Math.min(60000, Math.max(0, Math.round(freezeMs)));
      queue.push(entry);
      schedule();
    } catch {
      // Never throws.
    }
  };

  /** The next batch that fits the body limit, taken off the queue. */
  const takeBatch = (): ErrorReport[] => {
    const batch: ErrorReport[] = [];
    while (queue.length > 0 && batch.length < MAX_BATCH) {
      const next = queue[0] as ErrorReport;
      if (batch.length > 0 && byteLength(JSON.stringify([...batch, next])) > MAX_BODY_BYTES) break;
      batch.push(next);
      queue.shift();
    }
    return batch;
  };

  const send = (final: boolean): void => {
    const batch = takeBatch();
    if (batch.length === 0) return;
    lastSendAt = env.now();
    const body = JSON.stringify(batch);
    try {
      if (final && env.sendBeacon && env.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) return;
      void env.fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    } catch {
      // A failed send is dropped, not retried: the reporter must stay quiet.
    }
  };

  function schedule(): void {
    if (timer !== null || queue.length === 0 || disposed) return;
    const delay = lastSendAt === null ? FIRST_SEND_DELAY_MS : Math.max(0, lastSendAt + SEND_INTERVAL_MS - env.now());
    timer = env.setTimeout(() => {
      timer = null;
      send(false);
      schedule();
    }, delay);
  }

  const flush = (final = false): void => {
    if (timer !== null) {
      env.clearTimeout(timer);
      timer = null;
    }
    while (queue.length > 0) send(final);
  };

  const onError = (event: { message?: unknown; error?: unknown; filename?: unknown; lineno?: unknown; colno?: unknown }): void => {
    try {
      if (event.error !== undefined && event.error !== null) {
        const { message, stack } = describeError(event.error);
        report('error', message, stack);
      } else {
        const where = typeof event.filename === 'string' && event.filename ? `${event.filename}:${String(event.lineno)}:${String(event.colno)}` : undefined;
        report('error', typeof event.message === 'string' ? event.message : 'Unknown error', where ? `at ${where}` : undefined);
      }
    } catch {
      // Never throws.
    }
  };
  const onRejection = (event: { reason?: unknown }): void => {
    try {
      const { message, stack } = describeError(event.reason);
      report('rejection', message, stack);
    } catch {
      // Never throws.
    }
  };
  const onContextLost = (event: { target?: { isConnected?: boolean } | null }): void => {
    // Renderer.dispose loses its context on purpose, then removes the canvas; the event arrives after
    // the removal, so only a canvas still in the page is a real loss.
    if (event.target && event.target.isConnected === false) return;
    report('webgl', 'WebGL context lost');
  };
  const onPageHide = (): void => {
    try {
      flush(true);
    } catch {
      // Never throws.
    }
  };

  // Freeze detection: a gap between frames longer than the threshold, with the page visible at both
  // ends. A tab going hidden clears the last frame, so coming back is never mistaken for a freeze.
  let lastFrameAt: number | null = null;
  let rafHandle = 0;
  const onVisibility = (): void => {
    if (env.doc.visibilityState !== 'visible') lastFrameAt = null;
  };
  const onFrame = (): void => {
    try {
      const now = env.now();
      const visible = env.doc.visibilityState === 'visible';
      if (visible && lastFrameAt !== null && now - lastFrameAt > FREEZE_THRESHOLD_MS) {
        report('freeze', 'Main thread freeze', undefined, now - lastFrameAt);
      }
      lastFrameAt = visible ? now : null;
    } catch {
      // Never throws.
    }
    if (!disposed) rafHandle = env.win.requestAnimationFrame(onFrame);
  };

  env.win.addEventListener('error', onError);
  env.win.addEventListener('unhandledrejection', onRejection);
  env.win.addEventListener('pagehide', onPageHide);
  env.doc.addEventListener('webglcontextlost', onContextLost, true);
  env.doc.addEventListener('visibilitychange', onVisibility);
  rafHandle = env.win.requestAnimationFrame(onFrame);

  return {
    report,
    flush: () => flush(false),
    dispose: () => {
      disposed = true;
      if (timer !== null) env.clearTimeout(timer);
      timer = null;
      env.win.removeEventListener('error', onError);
      env.win.removeEventListener('unhandledrejection', onRejection);
      env.win.removeEventListener('pagehide', onPageHide);
      env.doc.removeEventListener('webglcontextlost', onContextLost, true);
      env.doc.removeEventListener('visibilitychange', onVisibility);
      env.win.cancelAnimationFrame(rafHandle);
    },
  };
}
