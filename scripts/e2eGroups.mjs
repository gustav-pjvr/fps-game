// Which Playwright specs a change needs (docs/testing.md). The full e2e suite takes over an hour on
// a laptop with software rendering, so a change runs only the groups its files can affect; the full
// suite is for a release, a merge to master, or a change to what every spec shares.

/** Spec files by group. `quick` is the four `@quick` smoke tests, not a file of its own. */
export const GROUPS = {
  quick: { files: ['e2e/smoke.spec.ts'], grep: '@quick' },
  core: { files: ['e2e/smoke.spec.ts'] },
  ai: { files: ['e2e/enemy-ai.spec.ts', 'e2e/director.spec.ts'] },
  mission: { files: ['e2e/mission.spec.ts'] },
  ui: { files: ['e2e/ui-qa.spec.ts'] },
  world: { files: ['e2e/world-bounds.spec.ts'] },
  // The indoor map (docs/facility-map.md), solo and two-player, and the modes on it.
  facility: { files: ['e2e/facility.spec.ts', 'e2e/multiplayer-facility.spec.ts', 'e2e/facility-modes.spec.ts'] },
  mp: {
    files: [
      'e2e/multiplayer.spec.ts',
      'e2e/multiplayer-match.spec.ts',
      'e2e/multiplayer-combat.spec.ts',
      'e2e/multiplayer-moving-target.spec.ts',
      'e2e/multiplayer-matchend.spec.ts',
      'e2e/multiplayer-pause-damage.spec.ts',
    ],
  },
  // Measurements, not pass or fail on behaviour: never picked by a change, only asked for by name.
  perf: { files: ['e2e/perf-log.spec.ts', 'e2e/performance-check.spec.ts'] },
};

/** Every group a full run covers (everything but perf). */
export const FULL = ['core', 'ai', 'mission', 'ui', 'world', 'facility', 'mp'];

/**
 * Path rules, checked in order; every matching rule adds its groups, except that a `stop` rule
 * ends the search for that file. 'FULL' means every group in FULL. A src file no rule names gets
 * the fallback.
 */
export const RULES = [
  // Nothing a browser runs.
  { match: /^(docs|reference)\/|\.md$|^\.gitignore$|^LICENSE/i, groups: [], stop: true },
  { match: /^src\/.*\.test\.ts$|^scripts\/.*\.test\.mjs$/, groups: [], stop: true },
  // What every spec shares.
  { match: /^e2e\/(helpers\.ts|global\.d\.ts)$|^playwright\.config\.ts$|^vite\.config\.ts$|^package(-lock)?\.json$|^tsconfig\.json$/, groups: ['FULL'], stop: true },
  // The rules themselves: prove the runner still starts.
  { match: /^scripts\/(e2e|e2eGroups)\.mjs$/, groups: ['quick'], stop: true },
  // A spec that changed runs itself (handled by name in groupsForFiles).
  { match: /^e2e\/.+\.spec\.ts$/, groups: [], stop: true },

  // Game areas.
  { match: /^src\/world\/facility\/|^src\/render\/Flashlight\.ts$|^src\/ui\/(minimap|facilityMapLayer)\.ts$/, groups: ['facility'] },
  { match: /^src\/entities\/characterHitbox\.ts$|^public\/assets\/models\/characters\//, groups: ['quick', 'ai', 'mp'] },
  { match: /^src\/entities\/(enemies\/|EntityManager\.ts$|Target\.ts$)/, groups: ['quick', 'ai'] },
  { match: /^src\/(network|lobby)\/|^src\/entities\/RemotePlayer\.ts$|^src\/core\/(multiplayer\w*|modeControllers\/.*|gameModes)\.ts$|^src\/ui\/menu\/(CreateRoomScreen|JoinRoomScreen|MultiplayerMenu)\.ts$|^src\/ui\/matchEndScreen\.ts$/, groups: ['mp'] },
  { match: /^src\/core\/mission\/|^src\/world\/UplinkBeacons\.ts$|^src\/ui\/(worldMarkers|deathScreen)\.ts$/, groups: ['mission'] },
  { match: /^src\/ui\/|^index\.html$/, groups: ['quick', 'ui'] },
  { match: /^src\/world\//, groups: ['quick', 'world'] },
  { match: /^src\/(weapons|combat|input)\/|^src\/entities\/Player\.ts$/, groups: ['core'] },
  { match: /^src\/core\/(Game|gameDebugApi)\.ts$/, groups: ['core', 'mission', 'facility'] },
  { match: /^src\/core\/App\.ts$/, groups: ['core', 'ui', 'mp'] },
  { match: /^src\/core\/config\.ts$/, groups: ['core', 'ai'] },
  { match: /^src\/(render|audio|settings)\/|^public\//, groups: ['quick'] },
];

/** For src files no rule above names. */
export const FALLBACK = ['quick', 'core'];

/** The groups and extra spec files a list of changed paths needs (paths relative to the repo,
 * forward slashes). A group that a fuller group already covers is dropped (quick under core). */
export function groupsForFiles(paths) {
  const groups = new Set();
  const specs = new Set();
  for (const raw of paths) {
    const path = raw.replace(/\\/g, '/');
    if (/^e2e\/.+\.spec\.ts$/.test(path)) specs.add(path);
    let matched = false;
    for (const rule of RULES) {
      if (!rule.match.test(path)) continue;
      matched = true;
      for (const group of rule.groups) {
        if (group === 'FULL') FULL.forEach((g) => groups.add(g));
        else groups.add(group);
      }
      if (rule.stop) break;
    }
    if (!matched && path.startsWith('src/')) FALLBACK.forEach((g) => groups.add(g));
  }
  if (groups.has('core')) groups.delete('quick');
  // A changed spec already inside a chosen group needs no separate run.
  for (const group of groups) {
    if (GROUPS[group].grep) continue;
    for (const file of GROUPS[group].files) specs.delete(file);
  }
  return { groups: [...groups].sort(), specs: [...specs].sort() };
}

/** The Playwright runs for a selection: one for whole files, one for the `@quick` tests if needed. */
export function playwrightRuns({ groups, specs }) {
  const files = new Set(specs);
  let quick = false;
  for (const group of groups) {
    if (GROUPS[group].grep) quick = true;
    else GROUPS[group].files.forEach((file) => files.add(file));
  }
  const runs = [];
  if (files.size > 0) runs.push({ files: [...files].sort() });
  if (quick && !files.has('e2e/smoke.spec.ts')) runs.push({ files: GROUPS.quick.files, grep: GROUPS.quick.grep });
  return runs;
}
