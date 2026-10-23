// Runs the Playwright specs a change needs, not the whole suite (docs/testing.md).
//   node scripts/e2e.mjs                 specs for files changed since the pushed branch (default)
//   node scripts/e2e.mjs changed --base master   ...or since another ref
//   node scripts/e2e.mjs quick           the four @quick smoke tests
//   node scripts/e2e.mjs ai mp           named groups (see scripts/e2eGroups.mjs)
//   node scripts/e2e.mjs full            everything but perf
// Add --dry to print the plan without running it. Extra Playwright flags go after `--`.
import { execFileSync, spawnSync } from 'node:child_process';
import { FULL, GROUPS, groupsForFiles, playwrightRuns } from './e2eGroups.mjs';

const argv = process.argv.slice(2);
const passThrough = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : [];
const args = argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv;
const dry = args.includes('--dry');
let base = null;
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i] ?? null;
  else if (!args[i].startsWith('--')) words.push(args[i]);
}
const mode = words[0] ?? 'changed';

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8' }).split('\n').map((line) => line.trim()).filter(Boolean);
}

function changedFiles() {
  let ref = base;
  if (!ref) {
    try {
      ref = git('rev-parse', '--abbrev-ref', '@{upstream}')[0];
    } catch {
      ref = 'master';
    }
  }
  // Against the working tree, so uncommitted edits count, plus files git does not track yet.
  return { ref, files: [...new Set([...git('diff', '--name-only', ref), ...git('ls-files', '--others', '--exclude-standard')])] };
}

let selection;
if (mode === 'changed') {
  const { ref, files } = changedFiles();
  selection = groupsForFiles(files);
  console.log(`Changed since ${ref}: ${files.length} file(s).`);
} else if (mode === 'full') {
  selection = { groups: FULL, specs: [] };
} else {
  const unknown = words.filter((word) => !(word in GROUPS));
  if (unknown.length > 0) {
    console.error(`Unknown group(s): ${unknown.join(', ')}. Groups: ${Object.keys(GROUPS).join(', ')}, or changed, full.`);
    process.exit(2);
  }
  selection = { groups: words, specs: [] };
}

const runs = playwrightRuns(selection);
console.log(`Groups: ${selection.groups.join(', ') || 'none'}${selection.specs.length ? `; changed specs: ${selection.specs.join(', ')}` : ''}.`);
if (runs.length === 0) {
  console.log('No e2e spec covers these changes; the unit tests are enough.');
  process.exit(0);
}
let failed = false;
for (const [index, run] of runs.entries()) {
  // Each Playwright run clears its output folder first, so with two runs the second wiped the
  // first one's failure traces (2026-10-23): give each its own.
  const output = runs.length > 1 ? ['--output', `test-results/run-${index + 1}`] : [];
  const playwrightArgs = ['playwright', 'test', ...run.files, ...(run.grep ? ['--grep', run.grep] : []), ...output, ...passThrough];
  console.log(`> npx ${playwrightArgs.join(' ')}`);
  if (dry) continue;
  const result = spawnSync('npx', playwrightArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
