// Reads the anonymous telemetry out of the MATCH_TELEMETRY KV namespace and prints a summary:
// matches by mode and version, multiplayer connection quality, and errors grouped by kind, message
// and version. Run by the owner (needs a wrangler login):
//   node scripts/telemetry-report.mjs [--days 7] [--namespace-id <id>]
// The namespace id comes from --namespace-id or the env var MATCH_TELEMETRY_NAMESPACE_ID; it is not
// kept in the repository. Works when either kind of record (match: or error:) is absent.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const USAGE = `Usage: node scripts/telemetry-report.mjs [--days N] [--namespace-id ID]

Summarises match telemetry (key prefix "match:") and error reports (key prefix "error:") stored in
the MATCH_TELEMETRY KV namespace, using "npx wrangler kv key list/get --remote" (log in with wrangler first).

Options:
  --days N            only records from the last N days (default 7)
  --namespace-id ID   the KV namespace id (or set MATCH_TELEMETRY_NAMESPACE_ID)
  --help              show this text`;

const CONCURRENCY = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseArgs(argv, env = process.env) {
  const options = { days: 7, namespaceId: env.MATCH_TELEMETRY_NAMESPACE_ID ?? '', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--days') options.days = Number(argv[++i]);
    else if (arg === '--namespace-id') options.namespaceId = argv[++i] ?? '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.days) || options.days <= 0) throw new Error('--days needs a positive number');
  return options;
}

/** Runs `npx wrangler ...` and resolves with its stdout. Arguments are validated by the caller (a
 * hex namespace id, a key made of letters, digits, colons and dashes), since Windows needs a shell
 * to run npx. */
function wrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(['npx', 'wrangler', ...args].join(' '), { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`wrangler exited with ${code}: ${err.trim()}`))));
  });
}

async function listKeys(namespaceId, prefix) {
  const out = await wrangler(['kv', 'key', 'list', '--namespace-id', namespaceId, '--remote', '--prefix', prefix]);
  const start = out.indexOf('[');
  const parsed = start >= 0 ? JSON.parse(out.slice(start)) : [];
  return parsed.map((entry) => entry.name).filter((name) => typeof name === 'string' && /^[A-Za-z0-9:_-]+$/.test(name));
}

async function getValue(namespaceId, key) {
  try {
    return JSON.parse(await wrangler(['kv', 'key', 'get', key, '--namespace-id', namespaceId, '--remote']));
  } catch {
    return null;
  }
}

/** Keys look like `<prefix>:<epoch ms>:<uuid>`; keep the ones newer than the cutoff. */
export function keysSince(keys, cutoffMs) {
  return keys.filter((key) => Number(key.split(':')[1]) >= cutoffMs);
}

async function fetchAll(namespaceId, keys) {
  const records = [];
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const record = await getValue(namespaceId, keys[next++]);
      if (record && typeof record === 'object') records.push(record);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker));
  return records;
}

export function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = nums.length >> 1;
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

const fmt = (value) => (value === null ? '-' : String(Math.round(value * 10) / 10));

function table(rows, header) {
  const all = [header, ...rows];
  const widths = header.map((_, col) => Math.max(...all.map((row) => String(row[col]).length)));
  return all.map((row) => '  ' + row.map((cell, col) => String(cell).padEnd(widths[col])).join('  ').trimEnd()).join('\n');
}

export function summariseMatches(matches) {
  if (matches.length === 0) return 'Matches: none in this period.';
  const groups = new Map();
  for (const m of matches) {
    const key = `${m.mode}\u0000${m.version}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const rows = [...groups].map(([key, count]) => [...key.split('\u0000'), count]).sort((a, b) => b[2] - a[2]);
  const lines = [`Matches: ${matches.length}`, table(rows, ['mode', 'version', 'count'])];

  const multiplayer = matches.filter((m) => m.players !== undefined || m.transport !== undefined || m.pingP50 !== undefined);
  if (multiplayer.length > 0) {
    const fields = ['pingP50', 'pingP95', 'snapshotGapP95', 'stallsPerMin', 'renderStallsPerMin'];
    const row = (label, set) => [label, set.length, ...fields.map((f) => fmt(median(set.map((m) => m[f]))))];
    const byVersion = new Map();
    for (const m of multiplayer) byVersion.set(m.version, [...(byVersion.get(m.version) ?? []), m]);
    const rows2 = [row('all', multiplayer), ...[...byVersion].sort().map(([version, set]) => row(version, set))];
    lines.push('', `Multiplayer quality (medians, ${multiplayer.length} matches):`, table(rows2, ['version', 'matches', ...fields]));
  }
  return lines.join('\n');
}

export function summariseErrors(errors) {
  if (errors.length === 0) return 'Errors: none in this period.';
  const groups = new Map();
  for (const e of errors) {
    const key = [e.kind, e.message, e.version].join('\u0000');
    const group = groups.get(key) ?? { count: 0, freezeMs: [], sample: e };
    group.count++;
    if (typeof e.freezeMs === 'number') group.freezeMs.push(e.freezeMs);
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count);
  const lines = [`Errors: ${errors.length} reports in ${sorted.length} groups`];
  for (const g of sorted) {
    const { kind, message, version, where, graphics, ua, stack } = g.sample;
    const freeze = g.freezeMs.length > 0 ? `, median freeze ${fmt(median(g.freezeMs))} ms` : '';
    lines.push('', `  ${String(g.count).padStart(4)} x [${kind}] ${message}`, `         v${version}, e.g. ${where} / ${graphics} / ${ua}${freeze}`);
    if (stack) lines.push(`         ${String(stack).split('\n').slice(0, 2).join(' | ').slice(0, 200)}`);
  }
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!/^[0-9a-f]{32}$/i.test(options.namespaceId)) {
    throw new Error('Give the KV namespace id with --namespace-id or MATCH_TELEMETRY_NAMESPACE_ID (32 hex characters).');
  }
  const cutoff = Date.now() - options.days * DAY_MS;
  const [matchKeys, errorKeys] = await Promise.all([listKeys(options.namespaceId, 'match:'), listKeys(options.namespaceId, 'error:')]);
  const [matches, errors] = await Promise.all([
    fetchAll(options.namespaceId, keysSince(matchKeys, cutoff)),
    fetchAll(options.namespaceId, keysSince(errorKeys, cutoff)),
  ]);
  console.log(`Telemetry, last ${options.days} day(s)\n`);
  console.log(summariseMatches(matches));
  console.log('');
  console.log(summariseErrors(errors));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
