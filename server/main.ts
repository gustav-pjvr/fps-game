import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { GAME_VERSION } from '../src/core/version.ts';
import { HOST_FRAME_MAX_BYTES } from '../src/network/serverEnvelope.ts';
import { clientIp, ipGroup } from './clientIp.ts';
import { ConfigError, isOriginAllowed, loadConfig, type ServerConfig } from './config.ts';
import { ACCESS_FAILURE_POLICY, AccessFailureLimiter, ConnectionCounter, MAX_CONNECTIONS_PER_IP, type AccessFailurePolicy } from './limits.ts';
import { createLogger, type Logger } from './log.ts';
import { Member } from './Member.ts';
import { RoomRegistry } from './RoomRegistry.ts';

/**
 * The relay process (docs/server-relay-design.md, sections 5 and 7): an http server on
 * HNG_HOST:HNG_PORT (Caddy terminates TLS in front of it) that answers `GET /healthz` and upgrades
 * `/ws` to a WebSocket after checking the Origin and the per-IP connection count. Each socket is a
 * Member; rooms live in the RoomRegistry. Run with `node server/main.ts`; tests call startRelay.
 */

export interface RelayOptions {
  clock?: () => number;
  /** The first frame must be a hello within this (section 5.2: 5 s, close 4003). */
  helloDeadlineMs?: number;
  /** A protocol ping this often; a socket with no pong for heartbeatTimeoutMs is ended (section 5.5). */
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxConnectionsPerIp?: number;
  failurePolicy?: AccessFailurePolicy;
  /** Where log lines go; stdout by default. */
  logSink?: (line: string) => void;
}

export interface Relay {
  readonly port: number;
  readonly registry: RoomRegistry;
  readonly log: Logger;
  /** Every open socket (tests). */
  connectionCount(): number;
  /** roomClosed `shutdown` to every room, 1001 to every other socket, then stop listening. */
  shutdown(): Promise<void>;
}

export const HELLO_DEADLINE_MS = 5000;
export const HEARTBEAT_INTERVAL_MS = 5000;
export const HEARTBEAT_TIMEOUT_MS = 15_000;
/** How long a shutdown waits for sockets to finish their close handshake before cutting them. */
const SHUTDOWN_GRACE_MS = 2000;
const FAILURE_SWEEP_MS = 60_000;

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' };

/** Refuse an upgrade with a bare http status and drop the connection. */
function refuseUpgrade(socket: Duplex, status: number): void {
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

const pathOf = (url: string | undefined): string | null => {
  try {
    return new URL(url ?? '/', 'http://relay.invalid').pathname;
  } catch {
    return null;
  }
};

export async function startRelay(config: ServerConfig, options: RelayOptions = {}): Promise<Relay> {
  const clock = options.clock ?? Date.now;
  const log = createLogger(config.logLevel, options.logSink, clock);
  const startedAt = clock();
  const registry = new RoomRegistry(
    { maxRooms: config.maxRooms, maxPlayersPerRoom: config.maxPlayersPerRoom },
    {
      clock,
      log: (event, fields) => (event === 'rateLimited' || event === 'slowConsumer' ? log.warn(event, fields) : log.info(event, fields)),
    },
  );
  const connections = new ConnectionCounter(options.maxConnectionsPerIp ?? MAX_CONNECTIONS_PER_IP);
  const failures = new AccessFailureLimiter(options.failurePolicy ?? ACCESS_FAILURE_POLICY);
  const members = new Set<Member>();
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  let shuttingDown: Promise<void> | null = null;

  // maxPayload is the host's cap; Member holds everyone else to the guest cap. No compression: it
  // would cost CPU per frame and open the door to decompression bombs.
  const wss = new WebSocketServer({ noServer: true, maxPayload: HOST_FRAME_MAX_BYTES, perMessageDeflate: false, clientTracking: false });

  const memberContext = {
    registry,
    access: config.access,
    failures,
    log,
    clock,
    helloDeadlineMs: options.helloDeadlineMs ?? HELLO_DEADLINE_MS,
    heartbeatTimeoutMs,
    onEnded: (member: Member) => {
      members.delete(member);
    },
  };

  const health = (request: IncomingMessage, response: ServerResponse): void => {
    if ((request.method === 'GET' || request.method === 'HEAD') && pathOf(request.url) === '/healthz') {
      const body = JSON.stringify({ ok: shuttingDown === null, version: GAME_VERSION, uptimeS: Math.floor((clock() - startedAt) / 1000), rooms: registry.roomCount(), members: registry.memberCount() });
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  };

  const server = createServer(health);

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => {
      // A reset during the upgrade is the client's business; ws handles errors once it owns the socket.
    });
    if (shuttingDown !== null) return refuseUpgrade(socket, 503);
    if (pathOf(request.url) !== '/ws') return refuseUpgrade(socket, 404);
    const ip = clientIp(request.socket.remoteAddress, request.headers['x-forwarded-for']);
    if (ip === null) {
      log.warn('upgradeRefused', { reason: 'badForwardedFor' });
      return refuseUpgrade(socket, 400);
    }
    const ipKey = ipGroup(ip);
    if (!isOriginAllowed(request.headers.origin, config.allowedOrigins)) {
      log.info('upgradeRefused', { ip: ipKey, reason: 'origin', origin: request.headers.origin ?? null });
      return refuseUpgrade(socket, 403);
    }
    if (!connections.acquire(ipKey)) {
      log.warn('upgradeRefused', { ip: ipKey, reason: 'perIpLimit' });
      return refuseUpgrade(socket, 429);
    }
    // Released exactly once, when the TCP connection is gone, whether or not ws accepted it.
    socket.once('close', () => connections.release(ipKey));
    // ws calls setNoDelay() itself (lib/websocket.js, setSocket, ws 8.22.0); set here as well so a
    // future ws or a proxy in between cannot leave Nagle's algorithm delaying snapshots.
    (socket as Socket).setNoDelay?.(true);
    wss.handleUpgrade(request, socket, head, (ws) => {
      if (shuttingDown !== null) {
        ws.terminate();
        return;
      }
      const member = new Member(ws, ipKey, memberContext);
      members.add(member);
      log.info('connect', { ip: ipKey });
    });
  });

  const heartbeat = setInterval(() => {
    const now = clock();
    for (const member of Array.from(members)) member.heartbeat(now);
  }, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
  const failureSweep = setInterval(() => failures.sweep(clock()), FAILURE_SWEEP_MS);
  failureSweep.unref();

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(config.port, config.host, () => {
      server.off('error', fail);
      done();
    });
  });
  server.on('error', (error) => log.error('serverError', { error: error.message }));
  registry.start({ setInterval: (callback, ms) => setInterval(callback, ms), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) });

  const port = (server.address() as AddressInfo).port;
  log.info('listening', {
    host: config.host,
    port,
    version: GAME_VERSION,
    maxRooms: config.maxRooms,
    capacity: registry.capacityFor(config.maxPlayersPerRoom),
    origins: config.allowedOrigins.join(' '),
    codeCount: config.access.count,
  });

  const shutdown = (): Promise<void> => {
    if (shuttingDown !== null) return shuttingDown;
    shuttingDown = (async () => {
      log.info('shutdown', { rooms: registry.roomCount(), connections: members.size });
      clearInterval(heartbeat);
      clearInterval(failureSweep);
      registry.stop();
      registry.closeAll('shutdown');
      for (const member of Array.from(members)) member.shutdown();
      const closed = new Promise<void>((done) => server.close(() => done()));
      // Wall time, not the injected clock: a test clock that stands still must not hang a shutdown.
      const deadline = Date.now() + SHUTDOWN_GRACE_MS;
      while (members.size > 0 && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
      for (const member of Array.from(members)) member.terminate();
      server.closeAllConnections();
      await closed;
    })();
    return shuttingDown;
  };

  return { port, registry, log, connectionCount: () => members.size, shutdown };
}

async function main(): Promise<void> {
  let config: ServerConfig;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`hng-relay: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
  const relay = await startRelay(config);
  const stop = (signal: string): void => {
    relay.log.info('signal', { signal });
    relay.shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`hng-relay: failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
