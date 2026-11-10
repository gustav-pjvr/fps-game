import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FULL, GROUPS, groupsForFiles, playwrightRuns } from './e2eGroups.mjs';

describe('e2e spec selection', () => {
  it('docs, reference files and unit tests run no e2e spec', () => {
    const selection = groupsForFiles(['docs/visual-overhaul.md', 'reference/characters/measure-hitbox.mjs', 'src/combat/Tracers.test.ts', 'README.md']);
    expect(selection).toEqual({ groups: [], specs: [] });
    expect(playwrightRuns(selection)).toEqual([]);
  });

  it('an enemy change runs the AI specs and the quick smoke tests', () => {
    const selection = groupsForFiles(['src/entities/enemies/Enemy.ts']);
    expect(selection.groups).toEqual(['ai', 'quick']);
    expect(playwrightRuns(selection)).toEqual([
      { files: ['e2e/director.spec.ts', 'e2e/enemy-ai.spec.ts'] },
      { files: ['e2e/smoke.spec.ts'], grep: '@quick' },
    ]);
  });

  it('the shared hitboxes run the AI and multiplayer specs', () => {
    expect(groupsForFiles(['src/entities/characterHitbox.ts']).groups).toEqual(['ai', 'mp', 'quick']);
  });

  it('network code runs only the multiplayer specs', () => {
    expect(groupsForFiles(['src/network/fastChannel.ts', 'src/entities/RemotePlayer.ts']).groups).toEqual(['mp']);
  });

  it('the 3 to 4 player network files also run the four-player spec; other network files do not', () => {
    expect(groupsForFiles(['src/network/GuestMesh.ts']).groups).toEqual(['mp', 'mp4']);
    expect(groupsForFiles(['src/network/PeerConnection.ts']).groups).toEqual(['mp', 'mp4']);
    expect(groupsForFiles(['src/network/fastChannel.ts']).groups).toEqual(['mp']);
    expect(playwrightRuns({ groups: ['mp4'], specs: [] })).toEqual([{ files: ['e2e/multiplayer-four.spec.ts'] }]);
    expect(GROUPS.quick.files).not.toContain('e2e/multiplayer-four.spec.ts');
  });

  it('what every spec shares runs the full suite, without perf', () => {
    for (const shared of ['e2e/helpers.ts', 'playwright.config.ts', 'package.json']) {
      expect(groupsForFiles([shared]).groups).toEqual([...FULL].sort());
    }
  });

  it('grenade code runs the grenades spec, alongside the area it lives in', () => {
    expect(groupsForFiles(['src/combat/grenades/GrenadeSystem.ts']).groups).toEqual(['core', 'grenades']);
    // A weapon model or a skin reruns the aim-point screenshots as well as the core weapon tests.
    expect(groupsForFiles(['src/weapons/models/guns/rifle.ts']).groups).toEqual(['core', 'skins']);
    expect(groupsForFiles(['src/ui/menu/SkinsScreen.ts']).groups).toEqual(['quick', 'skins', 'ui']);
    expect(groupsForFiles(['src/entities/heldWeapon.ts']).groups).toEqual(['mp']);
    expect(groupsForFiles(['src/ui/flashOverlay.ts']).groups).toEqual(['grenades', 'quick', 'ui']);
    expect(playwrightRuns({ groups: ['grenades'], specs: [] })).toEqual([{ files: ['e2e/grenades.spec.ts'] }]);
  });

  it('a changed spec runs itself, once', () => {
    expect(groupsForFiles(['e2e/mission.spec.ts'])).toEqual({ groups: [], specs: ['e2e/mission.spec.ts'] });
    // Already inside a chosen group: not listed twice.
    expect(groupsForFiles(['e2e/enemy-ai.spec.ts', 'src/entities/enemies/Enemy.ts']).specs).toEqual([]);
  });

  it('an unnamed src file falls back to the full smoke spec, which covers the quick tests', () => {
    const selection = groupsForFiles(['src/utils/rng.ts']);
    expect(selection.groups).toEqual(['core']);
    expect(playwrightRuns(selection)).toEqual([{ files: ['e2e/smoke.spec.ts'] }]);
  });

  it('a render change runs only the quick tests; perf is never chosen by a change', () => {
    expect(groupsForFiles(['src/render/PostStack.ts']).groups).toEqual(['quick']);
    const everything = groupsForFiles(['e2e/helpers.ts', 'src/render/look.ts', 'src/core/Game.ts']);
    expect(everything.groups).not.toContain('perf');
  });

  it('every spec file in e2e/ belongs to a group', () => {
    const grouped = new Set(Object.values(GROUPS).flatMap((group) => group.files));
    const specs = readdirSync('e2e').filter((name) => name.endsWith('.spec.ts')).map((name) => `e2e/${name}`);
    expect(specs.filter((spec) => !grouped.has(spec))).toEqual([]);
  });
});
