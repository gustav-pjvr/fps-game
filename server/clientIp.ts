import { isIP } from 'node:net';

/**
 * Who a connection comes from, for the per-IP limits (docs/server-relay-design.md, section 7.4).
 * In production Caddy proxies from 127.0.0.1 and sets X-Forwarded-For; anywhere else that header is
 * the client's own word and is ignored. IPv6 clients are grouped by their /64, the block one
 * household or one server is normally given, so rotating addresses inside it gains nothing.
 */

const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1']);

/** The client's address: the socket's peer, or, only when that peer is the local proxy, the last
 * X-Forwarded-For entry (the one the proxy itself appended). Null when the proxy's header is not an
 * IP address, so a broken proxy setup refuses connections instead of lumping everyone together. */
export function clientIp(remoteAddress: string | undefined, forwardedFor: string | string[] | undefined): string | null {
  if (remoteAddress === undefined || remoteAddress === '') return null;
  if (!LOOPBACK.has(remoteAddress) || forwardedFor === undefined) return remoteAddress;
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const entries = header.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const last = entries[entries.length - 1];
  if (last === undefined) return remoteAddress;
  return isIP(last) === 0 ? null : last;
}

/** Eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address.toLowerCase();
  const tail: number[] = [];
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    tail.push((a << 8) | b, (c << 8) | d);
    // What is left ends in ':' before the dotted tail; keep it only when it is part of a '::'.
    text = text.slice(0, v4.index);
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }
  const parse = (part: string): number[] => (part === '' ? [] : part.split(':').map((group) => parseInt(group, 16)));
  const [head = '', rest] = text.split('::') as [string, string | undefined];
  const front = parse(head);
  const back = rest === undefined ? [] : parse(rest);
  const missing = 8 - tail.length - front.length - back.length;
  if (missing < 0 || (rest === undefined && missing !== 0)) return null;
  const groups = [...front, ...Array<number>(missing).fill(0), ...back, ...tail];
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

/** The key the per-IP limits count by: an IPv4 address as is (also when written IPv4-mapped), an
 * IPv6 address as its /64 prefix. */
export function ipGroup(ip: string): string {
  const bare = ip.split('%')[0] ?? ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (mapped?.[1] !== undefined && isIP(mapped[1]) === 4) return mapped[1];
  if (isIP(bare) === 4) return bare;
  const groups = ipv6Groups(bare);
  if (groups === null) return bare;
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}

/** The wider key failed attempts are also counted by: an IPv6 address's /48 (a site, which can hand
 * out 65,536 /64s, so stepping through them gains nothing). Null for IPv4, whose key is already the
 * single address. */
export function ipWideGroup(ip: string): string | null {
  const bare = ip.split('%')[0] ?? ip;
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(bare) || isIP(bare) !== 6) return null;
  const groups = ipv6Groups(bare);
  if (groups === null) return null;
  return `${groups.slice(0, 3).map((group) => group.toString(16)).join(':')}::/48`;
}

/** Whether an http request reached the relay straight from this machine, not through Caddy: the peer
 * is 127.0.0.1 and no proxy header is present (Caddy always sets X-Forwarded-For). Only such a
 * request sees the full /healthz (deploy.sh and status.sh use it over SSH). */
export function isDirectLocalRequest(remoteAddress: string | undefined, headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
  if (remoteAddress === undefined || !LOOPBACK.has(remoteAddress)) return false;
  return headers['x-forwarded-for'] === undefined && headers['x-forwarded-proto'] === undefined && headers.forwarded === undefined && headers.via === undefined;
}
