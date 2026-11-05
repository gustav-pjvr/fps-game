import { isIP } from 'node:net';
import { ACCESS_CODE_MAX_LENGTH } from '../src/network/serverEnvelope.ts';
import { AccessCodes, parseAccessCodes } from './access.ts';
import { isLogLevel, LOG_LEVELS, type LogLevel } from './log.ts';

/**
 * The relay's settings, read once from environment variables at start (docs/server-relay-design.md,
 * section 8.2, step 6: /etc/hng-relay.env in production). Anything malformed stops the start with a
 * message naming the variable; no message ever repeats an access code.
 */

export interface ServerConfig {
  /** HNG_ACCESS_CODES, required: kept only as digests (access.ts). */
  readonly access: AccessCodes;
  /** HNG_ALLOWED_ORIGINS: exact origins, or `scheme://*.domain` for any one subdomain label. */
  readonly allowedOrigins: readonly string[];
  readonly port: number;
  readonly host: string;
  readonly maxRooms: number;
  readonly maxPlayersPerRoom: number;
  readonly logLevel: LogLevel;
}

/** The Pages site and its preview deployments (`<hash>.hunter-n-goose.pages.dev`). */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = ['https://hunter-n-goose.pages.dev', 'https://*.hunter-n-goose.pages.dev'];
export const DEFAULT_PORT = 8080;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_MAX_ROOMS = 50;
export const DEFAULT_MAX_PLAYERS_PER_ROOM = 4;
/** Upper bounds that only turn away typos; the registry clamps capacity to the protocol's slots. */
const MAX_ROOMS_CEILING = 100_000;
const MAX_PLAYERS_CEILING = 255;

export class ConfigError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

const ORIGIN_PATTERN = /^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(:[0-9]{1,5})?$/;
const SUBDOMAIN_LABEL = /^[a-z0-9-]+$/;

function readInteger(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new ConfigError(`${name} must be a whole number from ${min} to ${max}, got "${raw}"`);
  return value;
}

/** Split and check HNG_ALLOWED_ORIGINS; unset means the defaults. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_ALLOWED_ORIGINS];
  const origins = raw.split(',').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0);
  for (const origin of origins) {
    if (!ORIGIN_PATTERN.test(origin)) throw new ConfigError(`HNG_ALLOWED_ORIGINS: "${origin}" is not an origin like https://example.com or https://*.example.com (no path, no trailing slash)`);
  }
  if (origins.length === 0) throw new ConfigError('HNG_ALLOWED_ORIGINS lists no origin');
  return origins;
}

/** Whether a browser's Origin header is allowed. A missing Origin is refused: every browser sends
 * one on a WebSocket upgrade. `https://*.example.com` matches exactly one label in front of the
 * domain (a Pages preview), never the bare domain or a deeper name. */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) return false;
  const candidate = origin.trim().toLowerCase();
  for (const entry of allowed) {
    if (entry === candidate) return true;
    const star = entry.indexOf('://*.');
    if (star < 0) continue;
    const prefix = entry.slice(0, star + 3);
    const suffix = entry.slice(star + 4);
    if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) continue;
    const label = candidate.slice(prefix.length, candidate.length - suffix.length);
    if (label.length > 0 && SUBDOMAIN_LABEL.test(label)) return true;
  }
  return false;
}

export function loadConfig(env: Env): ServerConfig {
  const codes = parseAccessCodes(env.HNG_ACCESS_CODES);
  if (codes.length === 0) throw new ConfigError('HNG_ACCESS_CODES is required: one or more access codes, comma separated (docs/server-relay-design.md, section 5.3)');
  if (codes.some((code) => code.length > ACCESS_CODE_MAX_LENGTH)) throw new ConfigError(`HNG_ACCESS_CODES: every code must be at most ${ACCESS_CODE_MAX_LENGTH} characters, or no client could send it`);

  const host = env.HNG_HOST?.trim() || DEFAULT_HOST;
  if (host !== 'localhost' && isIP(host) === 0) throw new ConfigError(`HNG_HOST must be an IP address or localhost, got "${host}"`);

  const logLevel = env.HNG_LOG_LEVEL?.trim().toLowerCase() || 'info';
  if (!isLogLevel(logLevel)) throw new ConfigError(`HNG_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`);

  return {
    access: new AccessCodes(codes),
    allowedOrigins: parseAllowedOrigins(env.HNG_ALLOWED_ORIGINS),
    port: readInteger(env, 'HNG_PORT', DEFAULT_PORT, 1, 65_535),
    host,
    maxRooms: readInteger(env, 'HNG_MAX_ROOMS', DEFAULT_MAX_ROOMS, 1, MAX_ROOMS_CEILING),
    maxPlayersPerRoom: readInteger(env, 'HNG_MAX_PLAYERS_PER_ROOM', DEFAULT_MAX_PLAYERS_PER_ROOM, 2, MAX_PLAYERS_CEILING),
    logLevel,
  };
}
