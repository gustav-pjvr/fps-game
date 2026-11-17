/** Cloudflare Pages Function: an anonymous crash and freeze report beacon. Client side,
 * src/core/errorReporter.ts batches up to 10 reports (uncaught errors, unhandled rejections, freezes
 * of more than a second, WebGL context loss) and POSTs them here with `keepalive` / `sendBeacon`, so
 * the owner can learn the game broke on someone's machine without a screenshot.
 *
 * Same contract as telemetry.ts: strict parsing, storage only if the KV namespace MATCH_TELEMETRY is
 * bound (the same namespace, under the key prefix `error:`), and always an empty 204 - a malformed,
 * oversized or unstorable request is simply dropped, never a 4xx or a throw the page could surface.
 *
 * Anonymous by construction: a report carries no username, room code or player id, and the browser is
 * a short family and major version (the client derives it, the raw user agent never gets here). Only
 * what Cloudflare already logs at the edge for every request exists beyond that, and nothing of it is
 * stored by this function. Each record expires on its own after 30 days. */

/** Structurally typed, like telemetry.ts: no @cloudflare/workers-types here. */
interface KVNamespaceLike {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env {
  MATCH_TELEMETRY?: KVNamespaceLike;
}

type ReportKind = 'error' | 'rejection' | 'freeze' | 'webgl';

interface ErrorReport {
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

const KINDS: readonly string[] = ['error', 'rejection', 'freeze', 'webgl'];
const MAX_REPORTS = 10;
const MAX_BODY_BYTES = 16 * 1024;
const MESSAGE_MAX = 300;
const STACK_MAX = 2000;
const VERSION_MAX = 32;
const WHERE_MAX = 40;
const GRAPHICS_MAX = 16;
const UA_MAX = 40;
const FREEZE_MS_MAX = 60000;
const TTL_SECONDS = 30 * 24 * 60 * 60;

/** A required short string: present, non-empty and within its limit, else null (the report is dropped). */
function shortString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

/** One report, or null when it is malformed. Over-long message and stack are cut rather than failing
 * the report (an error worth knowing about is not worth losing for a long text); every other field is
 * strict. Anything else in the object is ignored. */
function parseReport(value: unknown): ErrorReport | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { kind, message, stack } = record;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
  if (typeof message !== 'string' || message.length === 0) return null;
  const version = shortString(record.version, VERSION_MAX);
  const where = shortString(record.where, WHERE_MAX);
  const graphics = shortString(record.graphics, GRAPHICS_MAX);
  const ua = shortString(record.ua, UA_MAX);
  if (!version || !where || !graphics || !ua) return null;
  const report: ErrorReport = { kind: kind as ReportKind, message: message.slice(0, MESSAGE_MAX), version, where, graphics, ua };
  if (typeof stack === 'string' && stack.length > 0) report.stack = stack.slice(0, STACK_MAX);
  if (kind === 'freeze') {
    const { freezeMs } = record;
    if (typeof freezeMs !== 'number' || !Number.isFinite(freezeMs)) return null;
    report.freezeMs = Math.min(FREEZE_MS_MAX, Math.max(0, Math.round(freezeMs)));
  }
  return report;
}

/** The reports of a batch: a bare array or `{ reports: [...] }`, first 10 only, bad ones dropped one by one. */
function parseBatch(body: unknown): ErrorReport[] {
  const list = Array.isArray(body) ? body : (body as { reports?: unknown } | null)?.reports;
  if (!Array.isArray(list)) return [];
  const reports: ErrorReport[] = [];
  for (const item of list.slice(0, MAX_REPORTS)) {
    const report = parseReport(item);
    if (report) reports.push(report);
  }
  return reports;
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  try {
    const declared = Number(context.request.headers.get('content-length'));
    if (!(declared > MAX_BODY_BYTES)) {
      const text = await context.request.text();
      // The declared length can be absent or a lie, so the real size is checked too.
      if (new TextEncoder().encode(text).length <= MAX_BODY_BYTES) {
        const reports = parseBatch(JSON.parse(text) as unknown);
        const kv = context.env.MATCH_TELEMETRY;
        if (kv && reports.length > 0) {
          // One key per report, each written on its own: a failing write loses that report only.
          await Promise.allSettled(
            reports.map((report) => kv.put(`error:${Date.now()}:${crypto.randomUUID()}`, JSON.stringify(report), { expirationTtl: TTL_SECONDS })),
          );
        }
      }
    }
  } catch {
    // Bad JSON, an unreadable body or anything else: swallow it. The reporter is fire-and-forget on a
    // page that may be crashing or closing; this endpoint must never add noise of its own.
  }
  return new Response(null, { status: 204 });
};
