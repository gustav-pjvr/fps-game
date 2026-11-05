/** Cloudflare Pages Function: a tiny, privacy-light match-end telemetry beacon (docs/CODE_REVIEW.md's
 * Phase 8 roadmap). Client side, Game.ts fires a fire-and-forget `fetch('/api/telemetry', ...,
 * { keepalive: true })` once per match end (see Game.ts's sendMatchTelemetry) - this endpoint's own
 * job is just to accept that payload and, if a KV namespace happens to be bound, persist it; not to
 * validate/reject aggressively (a malformed or missing payload just gets skipped, never a 4xx that
 * could show up as a console error on a page the player is already leaving) and never to block or
 * throw back to the caller.
 *
 * Payload is deliberately minimal, matching the roadmap item's own stated scope: game mode, wave
 * reached (Goose Horde) or kill count (every other mode) - collapsed into one `waveOrKills` number
 * since a given match is always exactly one or the other, never both - match duration, and app
 * version, plus (multiplayer only) a few optional connection-quality numbers, see TelemetryPayload.
 * No player-identifying info at all (no username, no rejoin token, no room code) - only
 * whatever IP-level logging Cloudflare itself already does by default at the edge, same as every
 * other request this app makes.
 *
 * Storage is opt-in and additive, mirroring turn-credentials.ts's own "absent config -> harmless
 * no-op" shape: bind a KV namespace named MATCH_TELEMETRY in the Cloudflare Pages dashboard
 * (Settings -> Functions -> KV namespace bindings) to actually persist anything; with no binding,
 * every POST here still returns success and simply doesn't store the payload anywhere. This is
 * genuinely minimal by design (per the roadmap item) - not a real analytics pipeline, no
 * aggregation/dashboard/query surface, just a landing spot for raw data points if/when a namespace
 * is ever bound. */

/** Structurally typed rather than importing the real `KVNamespace` type (this repo has no
 * @cloudflare/workers-types dependency, and `functions/` isn't part of this project's own tsc
 * project - see tsconfig.json's `include` - so there's no ambient global to reach for) - only the
 * one method this file actually calls. */
interface KVNamespaceLike {
  put(key: string, value: string): Promise<void>;
}

interface Env {
  MATCH_TELEMETRY?: KVNamespaceLike;
}

interface TelemetryPayload {
  mode: string;
  waveOrKills: number;
  durationMs: number;
  version: string;
  /** Optional connection-quality baseline (multiplayer matches only; see src/network/matchTelemetry.ts).
   * Each is stored only when it arrives well-formed; a bad one is dropped on its own, never failing
   * the four required fields above. */
  transport?: string;
  players?: number;
  pingP50?: number;
  pingP95?: number;
  snapshotGapP95?: number;
  stallsPerMin?: number;
  joinMs?: number;
}

/** The optional numeric fields, and the ceiling each is clamped to (floor is always 0). */
const OPTIONAL_NUMBER_FIELDS = ['pingP50', 'pingP95', 'snapshotGapP95', 'stallsPerMin', 'joinMs'] as const;
const OPTIONAL_NUMBER_MAX = 60000;
const PLAYERS_MAX = 16;

/** Narrow the parsed JSON body down to the fields this endpoint actually stores - anything else in
 * the request body is silently ignored, and any of the four required fields being the wrong shape
 * fails the whole payload (better to store nothing than a half-garbage record). The optional
 * connection-quality fields are looser: a missing or malformed one is simply left out. */
function parsePayload(value: unknown): TelemetryPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { mode, waveOrKills, durationMs, version } = record;
  if (typeof mode !== 'string' || mode.length === 0 || mode.length > 32) return null;
  if (typeof waveOrKills !== 'number' || !Number.isFinite(waveOrKills)) return null;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return null;
  if (typeof version !== 'string' || version.length === 0 || version.length > 32) return null;
  const payload: TelemetryPayload = { mode, waveOrKills, durationMs, version };

  const { transport, players } = record;
  if (typeof transport === 'string' && transport.length > 0 && transport.length <= 16) payload.transport = transport;
  if (typeof players === 'number' && Number.isFinite(players)) {
    payload.players = Math.min(PLAYERS_MAX, Math.max(1, Math.round(players)));
  }
  for (const field of OPTIONAL_NUMBER_FIELDS) {
    const raw = record[field];
    if (typeof raw === 'number' && Number.isFinite(raw)) payload[field] = Math.min(OPTIONAL_NUMBER_MAX, Math.max(0, raw));
  }
  return payload;
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  try {
    const body: unknown = await context.request.json();
    const payload = parsePayload(body);
    // A malformed payload isn't worth failing the request over - the caller is fire-and-forget and
    // never looks at the response (see Game.ts's sendMatchTelemetry), so there's nothing to gain
    // from a 4xx here beyond noise in the client's network tab as it's navigating away anyway.
    if (payload && context.env.MATCH_TELEMETRY) {
      const key = `match:${Date.now()}:${crypto.randomUUID()}`;
      // Best-effort - KV being unavailable/erroring must never surface to the caller (see the
      // outer catch below), same "additive, never a hard dependency" shape as turn-credentials.ts.
      await context.env.MATCH_TELEMETRY.put(key, JSON.stringify(payload));
    }
  } catch {
    // Bad JSON, KV write failure, or anything else - swallow it. This endpoint has no user-facing
    // failure mode; the beacon firing (or not) must never affect the match-end screen it's called
    // alongside.
  }
  return new Response(null, { status: 204 });
};
