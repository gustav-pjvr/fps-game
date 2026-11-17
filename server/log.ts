/**
 * The relay's log (docs/server-relay-design.md, section 7.3): one JSON object per line on stdout,
 * which systemd hands to journald. Callers pass an event name and a few flat fields; the logger
 * never takes a frame or a payload, refuses keys that would carry one or a secret (their value is
 * replaced by "[redacted]") and cuts every string short, so a stray payload cannot ride along in a
 * field. Nothing in the relay passes the access code here.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogValue = string | number | boolean | null;
export type LogFields = Readonly<Record<string, LogValue>>;

export interface Logger {
  readonly level: LogLevel;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Longest string a field keeps; the rest is cut and marked. */
export const LOG_STRING_MAX = 120;

/** Field names that would carry a payload or a secret; their values never reach the log. */
const REDACTED_KEYS = new Set(['access', 'accesscode', 'accesscodes', 'secret', 'password', 'token', 'rejointoken', 'm', 'payload', 'frame', 'text', 'data', 'welcome', 'body']);
const RESERVED_KEYS = new Set(['t', 'level', 'event']);

export const isLogLevel = (value: string): value is LogLevel => (LOG_LEVELS as readonly string[]).includes(value);

function clean(key: string, value: LogValue): LogValue {
  if (REDACTED_KEYS.has(key.toLowerCase())) return '[redacted]';
  if (typeof value === 'string' && value.length > LOG_STRING_MAX) return `${value.slice(0, LOG_STRING_MAX)}...`;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

/** One log line as text (exported for tests). */
export function formatLine(level: LogLevel, event: string, fields: LogFields, now: number): string {
  const line: Record<string, LogValue> = { t: new Date(now).toISOString(), level, event: clean('event', event) };
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    line[key] = clean(key, value);
  }
  return JSON.stringify(line);
}

export function createLogger(level: LogLevel, sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`), clock: () => number = Date.now): Logger {
  const threshold = LOG_LEVELS.indexOf(level);
  const write = (at: LogLevel, event: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(at) < threshold) return;
    try {
      sink(formatLine(at, event, fields, clock()));
    } catch {
      // A log that cannot be written must never take the relay down.
    }
  };
  return {
    level,
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
