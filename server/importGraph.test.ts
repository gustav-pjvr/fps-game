import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The relay must never pull in Three.js, Rapier, PeerJS or the DOM (docs/server-relay-design.md,
 * section 3.3). This walks the static runtime imports from server/main.ts, the process entry, and
 * fails on any file outside the allowlist, on any bare import other than `ws` and node:*, and on any
 * dynamic import.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Shared files the server may run (section 3.3). Server files themselves: server/<name>.ts, not tests. */
const SHARED_ALLOWLIST = new Set([
  'src/network/protocol.ts',
  'src/network/senderAuthority.ts',
  'src/network/routing.ts',
  'src/network/serverEnvelope.ts',
  'src/network/HostRoster.ts',
  'src/core/config.ts',
  'src/core/version.ts',
  'src/combat/grenades/grenadeTuning.ts',
]);

/** The one package the relay may import (section 7.2). */
const ALLOWED_PACKAGES = new Set(['ws']);

const isAllowed = (file: string): boolean => SHARED_ALLOWLIST.has(file) || (/^server\/[A-Za-z0-9]+\.ts$/.test(file) && !file.endsWith('.test.ts') && file !== 'server/testSupport.ts');

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Runtime module specifiers of one source file: `import ... from`, `export ... from`, side-effect
 * imports. `import type` and `export type` are erased and skipped. Dynamic imports are reported. */
export function runtimeImports(source: string): { specifiers: string[]; dynamic: boolean } {
  const code = stripComments(source);
  const specifiers: string[] = [];
  const statement = /(?:^|[;\n])\s*(import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(statement)) {
    const clause = (match[2] ?? '').trim();
    if (/^type[\s{*]/.test(clause)) continue;
    specifiers.push(match[3] ?? '');
  }
  for (const match of code.matchAll(/(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)) specifiers.push(match[1] ?? '');
  return { specifiers, dynamic: /\bimport\s*\(/.test(code) };
}

function walk(entries: string[]): { files: Set<string>; problems: string[] } {
  const files = new Set<string>();
  const problems: string[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (!isAllowed(file)) problems.push(`not allowed: ${file}`);
    const source = readFileSync(resolve(repoRoot, file), 'utf8');
    const { specifiers, dynamic } = runtimeImports(source);
    if (dynamic) problems.push(`dynamic import in ${file}`);
    if (/\bwindow\.|\bdocument\.|\bimport\.meta\b/.test(stripComments(source)) && !file.startsWith('server/')) problems.push(`browser global in ${file}`);
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) {
        queue.push(relative(repoRoot, resolve(repoRoot, dirname(file), specifier)).replaceAll('\\', '/'));
      } else if (!specifier.startsWith('node:') && !ALLOWED_PACKAGES.has(specifier)) {
        problems.push(`bare import '${specifier}' in ${file}`);
      }
    }
  }
  return { files, problems };
}

describe('server import graph', () => {
  it('reaches only the section 3.3 allowlist from server/main.ts', () => {
    const { files, problems } = walk(['server/main.ts']);
    expect(problems).toEqual([]);
    // The walk really followed the graph through the shell and down to the shared leaves.
    for (const file of [
      'server/Member.ts',
      'server/config.ts',
      'server/log.ts',
      'server/clientIp.ts',
      'server/access.ts',
      'server/Room.ts',
      'server/RoomRegistry.ts',
      'server/limits.ts',
      'src/network/protocol.ts',
      'src/network/HostRoster.ts',
      'src/network/routing.ts',
      'src/network/senderAuthority.ts',
      'src/network/serverEnvelope.ts',
      'src/core/config.ts',
      'src/core/version.ts',
      'src/combat/grenades/grenadeTuning.ts',
    ]) {
      expect(files).toContain(file);
    }
    expect(files).not.toContain('src/core/gameModes.ts');
  });

  it('every server source file is reached from main.ts (none can dodge the walk)', () => {
    const { files } = walk(['server/main.ts']);
    const sources = readdirSync(resolve(repoRoot, 'server')).filter((name) => /^[A-Za-z0-9]+\.ts$/.test(name) && !name.endsWith('.test.ts') && name !== 'testSupport.ts');
    for (const name of sources) expect(files).toContain(`server/${name}`);
  });

  it('reads import statements the way the type stripper runs them', () => {
    const sample = [
      "import type { A } from './typeOnly.ts';",
      "import { b, type C } from './mixed.ts';",
      "export type { D } from './reexportType.ts';",
      "export { e } from './reexport.ts';",
      "import * as f from 'three';",
      "import './sideEffect.ts';",
      "// import { g } from './commented.ts';",
      '/* import { h } from "./blockCommented.ts"; */',
      "import {\n  i,\n  j,\n} from 'node:crypto';",
    ].join('\n');
    expect(runtimeImports(sample)).toEqual({ specifiers: ['./mixed.ts', './reexport.ts', 'three', 'node:crypto', './sideEffect.ts'], dynamic: false });
    expect(runtimeImports("const m = await import('./late.ts');").dynamic).toBe(true);
  });

  it('flags a file outside the allowlist and a bare package', () => {
    expect(isAllowed('src/network/PeerConnection.ts')).toBe(false);
    expect(isAllowed('src/network/MatchMessageRouter.ts')).toBe(false);
    expect(isAllowed('server/Room.test.ts')).toBe(false);
    expect(isAllowed('server/deploy/thing.ts')).toBe(false);
    expect(isAllowed('server/Room.ts')).toBe(true);
    expect(walk(['server/testSupport.ts']).problems).toContain('not allowed: server/testSupport.ts');
  });

  it('allows the ws package and node built-ins, and nothing else bare', () => {
    expect(ALLOWED_PACKAGES).toEqual(new Set(['ws']));
    expect(runtimeImports(["import { WebSocketServer } from 'ws';", "import type { RawData } from 'ws';"].join('\n')).specifiers).toEqual(['ws']);
  });
});
