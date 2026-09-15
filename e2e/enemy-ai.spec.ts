import { expect, test, type Page } from '@playwright/test';
import { equipPistol, lockPointer, waitForGameTime } from './helpers.ts';

/**
 * Enemy AI v2 behaviour checks (docs/enemy-ai-v2.md) - NOT part of the smoke suite; run explicitly:
 *
 *   npx playwright test e2e/enemy-ai.spec.ts
 *
 * Every assertion is a state or position fact read through window.__gameDebug and waited for in
 * GAME time (waitForGameTime), because the sandbox renders at 2 to 4 frames a second. The player is
 * made invulnerable so a fight never ends in a death screen, which freezes the simulation.
 *
 * Step 1 (checkpoint A): the awareness meter, the view cone, hearing by weapon, and a sighting
 * being shared with nearby comrades.
 */

type EnemyRecord = NonNullable<Awaited<ReturnType<typeof readEnemies>>>[number];

async function readEnemies(page: Page) {
  return page.evaluate(() => window.__gameDebug?.getLiveEnemyDebug() ?? []);
}

async function startSoloMatch(page: Page, enemyCount: number): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const counts = page.locator('input[type="number"]:visible');
  await counts.nth(0).fill(String(enemyCount));
  await counts.nth(1).fill('0');
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 60000 });
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(true));
}

/** Polls an enemy (by its index in the live entity list) until `predicate` holds or `gameSeconds`
 * of game time pass. Returns the matching record, or null. */
async function waitForEnemy(
  page: Page,
  index: number,
  predicate: (enemy: EnemyRecord) => boolean,
  gameSeconds: number,
): Promise<EnemyRecord | null> {
  const step = 0.25;
  for (let waited = 0; waited <= gameSeconds; waited += step) {
    const enemy = (await readEnemies(page)).find((record) => record.index === index);
    if (enemy && predicate(enemy)) return enemy;
    await waitForGameTime(page, step);
  }
  return null;
}

/** Puts the player `distance` metres along the enemy's facing (negative = behind it). */
async function standRelativeToFacing(page: Page, enemy: EnemyRecord, distance: number): Promise<void> {
  const x = enemy.x + Math.sin(enemy.yaw) * distance;
  const z = enemy.z + Math.cos(enemy.yaw) * distance;
  await page.evaluate(({ x, y, z }) => window.__gameDebug?.teleport(x, y, z), { x, y: enemy.y + 1, z });
}

async function playerPosition(page: Page): Promise<{ x: number; y: number; z: number }> {
  const position = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  if (!position) throw new Error('no player position');
  return position;
}

/** Fires the current weapon straight up, so every enemy in earshot hears it and nothing is hit.
 * Takes pointer lock first: a long run (the tower search) can lose it, and the game ignores the
 * mouse while unlocked. */
async function fireIntoAir(page: Page): Promise<void> {
  await lockPointer(page);
  const player = await playerPosition(page);
  await page.evaluate(({ x, y, z }) => window.__gameDebug?.lookAt(x, y + 100, z), player);
  const ammoBefore = await page.evaluate(() => window.__gameDebug?.getAmmo() ?? 0);
  await page.mouse.down();
  await waitForGameTime(page, 0.3);
  await page.mouse.up();
  await waitForGameTime(page, 0.2);
  const ammoAfter = await page.evaluate(() => window.__gameDebug?.getAmmo() ?? 0);
  // Changed, not lower: in the slow sandbox the button can stay down long enough to empty the
  // magazine and auto-reload, which leaves more rounds than before (a checkpoint C run saw 12 -> 30).
  expect(ammoAfter, 'the shot must actually fire').not.toBe(ammoBefore);
}

test('an enemy facing the player fills its awareness and engages', async ({ page }) => {
  test.setTimeout(180000);
  await startSoloMatch(page, 1);
  await waitForGameTime(page, 1);

  // Stand in front of a walking enemy, the way a player would walk into its view. Retried a few
  // times because a tree or a patrol turn can legitimately block one attempt.
  let engaged: EnemyRecord | null = null;
  for (let attempt = 0; attempt < 4 && !engaged; attempt++) {
    const [enemy] = await readEnemies(page);
    if (!enemy) throw new Error('expected one live enemy');
    await standRelativeToFacing(page, enemy, 6);
    engaged = await waitForEnemy(page, enemy.index, (record) => record.state === 'chase', 4);
  }
  expect(engaged, 'the enemy should reach chase').not.toBeNull();
  expect(engaged!.awareness).toBe(1);

  const squad = await page.evaluate(() => window.__gameDebug?.getSquadDebug());
  expect(squad?.belief?.source).toBe('seen');
});

test('a player standing behind an enemy stays unnoticed', async ({ page }) => {
  // Twelve attempts, most voided by patrol turns in a bad run, need more than the 180 s that six
  // did: at checkpoint E the doubled attempts ran out of it. The check itself is in game seconds.
  test.setTimeout(360000);
  await startSoloMatch(page, 1);
  // Open ground: the enemy goes to the clearing around the player's spawn, where there are no trees
  // for its whiskers to swerve round, so its heading holds; the player waits 40 m away. Among trees
  // the heading can swing 80 degrees in a tick and no attempt counts (checkpoint C's first run).
  const spawn = await playerPosition(page);
  await page.evaluate(({ x, y, z }) => window.__gameDebug?.teleport(x + 40, y + 1, z), spawn);
  await page.evaluate(({ x, z }) => window.__gameDebug?.placeEnemy(0, x, z), spawn);
  await waitForGameTime(page, 1);

  // Only attempts where the enemy kept its heading count: a patrol that turns round mid-check is
  // allowed to notice the player. Twelve attempts, not six: at checkpoint E all six caught the
  // patrol mid-turn, so each attempt's largest turn is reported if none counts.
  let checked = false;
  const turnsInDegrees: number[] = [];
  for (let attempt = 0; attempt < 12 && !checked; attempt++) {
    const [enemy] = await readEnemies(page);
    if (!enemy) throw new Error('expected one live enemy');
    await standRelativeToFacing(page, enemy, -8);
    let maxAwareness = 0;
    let maxTurn = 0;
    for (let sample = 0; sample < 5; sample++) {
      await waitForGameTime(page, 0.25);
      const now = (await readEnemies(page)).find((record) => record.index === enemy.index);
      if (!now) break;
      maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(now.yaw - enemy.yaw), Math.cos(now.yaw - enemy.yaw))));
      maxAwareness = Math.max(maxAwareness, now.awareness);
    }
    turnsInDegrees.push(Math.round((maxTurn * 180) / Math.PI));
    if (maxTurn > Math.PI / 3) continue;
    checked = true;
    expect(maxAwareness).toBe(0);
  }
  expect(checked, `at least one attempt with the enemy keeping its heading (largest turn per attempt, degrees: ${turnsInDegrees.join(', ')})`).toBe(true);
});

test('a sighting is shared with a comrade too far away to see the player', async ({ page }) => {
  test.setTimeout(180000);
  await startSoloMatch(page, 2);
  await waitForGameTime(page, 1);

  let watcherEngaged = false;
  for (let attempt = 0; attempt < 4 && !watcherEngaged; attempt++) {
    const enemies = await readEnemies(page);
    const watcher = enemies[0];
    const comrade = enemies[1];
    if (!watcher || !comrade) throw new Error('expected two live enemies');
    // Stage the comrade BEFORE the player steps into the watcher's view: the watcher can spot the
    // player and share it within a single debug round trip in this sandbox, so checking the
    // comrade afterwards races the feature itself. The comrade goes 26 m from where the player will
    // stand, on the far side from the watcher: beyond every archetype's detection range (at most
    // 20 m), inside the 30 m sharing radius.
    const standX = watcher.x + Math.sin(watcher.yaw) * 6;
    const standZ = watcher.z + Math.cos(watcher.yaw) * 6;
    await page.evaluate(
      ({ index, x, z }) => window.__gameDebug?.placeEnemy(index, x, z),
      { index: comrade.index, x: standX + Math.sin(watcher.yaw) * 26, z: standZ + Math.cos(watcher.yaw) * 26 },
    );
    const beforeSighting = (await readEnemies(page)).find((record) => record.index === comrade.index);
    expect(beforeSighting?.state, 'nothing has alerted the comrade yet').toBe('idle');

    await standRelativeToFacing(page, watcher, 6);
    watcherEngaged = (await waitForEnemy(page, watcher.index, (record) => record.state === 'chase', 4)) !== null;
    if (!watcherEngaged) continue;

    const joined = await waitForEnemy(page, comrade.index, (record) => record.state === 'search' || record.state === 'chase', 3);
    expect(joined, 'the far comrade should come to search').not.toBeNull();
  }
  expect(watcherEngaged, 'the watcher should spot the player in one of the attempts').toBe(true);
});

test('the coordinator never lets more than two shoot at once and sends one round the side', async ({ page }) => {
  test.setTimeout(360000);
  // A flank needs a second enemy with a gun waiting for a shooter token. Rush Jobs (30 percent of
  // spawns) are melee-only, so about 3 matches in 100 roll a squad with one gun or none - one such
  // match (4 Rush Jobs of 5) failed this check at checkpoint C with the coordinator behaving
  // correctly. Re-roll the match until at least three enemies carry guns, so the check tests
  // flanking and not the archetype dice.
  let gunners = 0;
  for (let attempt = 0; attempt < 4 && gunners < 3; attempt++) {
    await startSoloMatch(page, 5);
    gunners = (await readEnemies(page)).filter((enemy) => enemy.archetype !== 'Rush Job').length;
  }
  expect(gunners, 'a squad with at least three gun-carrying enemies').toBeGreaterThanOrEqual(3);
  await waitForGameTime(page, 1);

  // Five enemies in an arc 12 to 14 m in front of the player (the open clearing around spawn), then
  // one shot into the air so they all come looking and engage.
  const player = await playerPosition(page);
  const arc = [
    { angle: -40, radius: 12 },
    { angle: -20, radius: 13 },
    { angle: 0, radius: 14 },
    { angle: 20, radius: 13 },
    { angle: 40, radius: 12 },
  ];
  for (const [index, spot] of arc.entries()) {
    const radians = (spot.angle * Math.PI) / 180;
    await page.evaluate(
      ({ index, x, z }) => window.__gameDebug?.placeEnemy(index, x, z),
      { index, x: player.x + Math.sin(radians) * spot.radius, z: player.z + Math.cos(radians) * spot.radius },
    );
  }
  await fireIntoAir(page);

  const bearingFromPlayer = (enemy: EnemyRecord): number => Math.atan2(enemy.x - player.x, enemy.z - player.z);
  const angleChange = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  // Each flank stint is measured from where that enemy stood when it took the role, and only while
  // it holds it. The role rotates (a flank has a time limit, then a cooldown), and an earlier
  // version followed only the first flanker, even after it stopped flanking, so it scored one
  // short stint (one checkpoint D run read 16 degrees).
  let maxShooters = 0;
  let sawChase = false;
  const openStints = new Map<number, { startBearing: number; maxTurn: number }>();
  const stintTurns: number[] = [];
  const timeline: string[] = [];
  for (let sample = 0; sample < 40; sample++) {
    await waitForGameTime(page, 0.5);
    const enemies = await readEnemies(page);
    const squad = await page.evaluate(() => window.__gameDebug?.getSquadDebug());
    timeline.push(timelineEntry(enemies, squad?.visibleCount));
    const shooters = enemies.filter((enemy) => enemy.role === 'shooter').length;
    maxShooters = Math.max(maxShooters, shooters);
    if (enemies.some((enemy) => enemy.state === 'chase')) sawChase = true;
    for (const enemy of enemies) {
      const stint = openStints.get(enemy.index);
      if (enemy.role === 'flanker') {
        if (stint) stint.maxTurn = Math.max(stint.maxTurn, angleChange(bearingFromPlayer(enemy), stint.startBearing));
        else openStints.set(enemy.index, { startBearing: bearingFromPlayer(enemy), maxTurn: 0 });
      } else if (stint) {
        stintTurns.push(stint.maxTurn);
        openStints.delete(enemy.index);
      }
    }
  }
  for (const stint of openStints.values()) stintTurns.push(stint.maxTurn);
  const turnsInDegrees = stintTurns.map((turn) => Math.round((turn * 180) / Math.PI));

  const story = `\n${timeline.slice(-12).join('\n')}`;
  expect(sawChase, `the enemies should engage after the shot${story}`).toBe(true);
  expect(maxShooters, `at most two shooter tokens at any sample${story}`).toBeLessThanOrEqual(2);
  expect(stintTurns.length, `one enemy should be sent to flank${story}`).toBeGreaterThan(0);
  expect(Math.max(...turnsInDegrees), `a flanker should work round the player (degrees per stint: ${turnsInDegrees.join(', ')})${story}`).toBeGreaterThanOrEqual(20);
});

/** One compact line per sample for failure messages: each enemy as state/role/spot, e.g.
 * "c:shooter:trunk/hiding", plus how many enemies see the player. */
function timelineEntry(enemies: EnemyRecord[], visibleCount: number | undefined): string {
  const parts = enemies.map((enemy) => `${enemy.state}:${enemy.role ?? '-'}${enemy.pick ? `:${enemy.pick.source}/${enemy.pick.phase}` : ''}`);
  return `[seen by ${visibleCount ?? '?'}] ${parts.join(' ')}`;
}

/** Moves the player outward from spawn until at least `minTrunks` tree trunks are registered as
 * cover within 15 m, lands there, and returns the spot. */
async function findWoods(page: Page, minTrunks: number): Promise<{ x: number; y: number; z: number } | null> {
  const origin = await playerPosition(page);
  for (const radius of [40, 70, 100, 130]) {
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * Math.PI * 2;
      const x = origin.x + Math.sin(angle) * radius;
      const z = origin.z + Math.cos(angle) * radius;
      await page.evaluate(({ x, z }) => window.__gameDebug?.teleport(x, 80, z), { x, z });
      await waitForGameTime(page, 0.5);
      const cover = await page.evaluate(({ x, z }) => window.__gameDebug?.getCoverNear(x, z, 15) ?? [], { x, z });
      if (cover.filter((entry) => entry.kind === 'trunk').length >= minTrunks) {
        await waitForGameTime(page, 4);
        return playerPosition(page);
      }
    }
  }
  return null;
}

test('enemies in a wood pick covered spots behind the trees and fight from them', async ({ page }) => {
  // The check itself is timed in game seconds; this wall-clock budget only has to outlast them. At
  // checkpoint E a loaded machine ran the game slow enough that 300 s ran out mid-sampling.
  test.setTimeout(480000);
  await startSoloMatch(page, 6);
  const spot = await findWoods(page, 8);
  expect(spot, 'a wooded spot should load within 130 m of spawn').not.toBeNull();

  // Six enemies on a 12 m ring around the player: inside every shooting archetype's cover band
  // (a Straggler fights from 5.6 to 14.4 m). Big obstacles are not used here on purpose - a watch
  // tower's hidden side is at least 6 m past its centre, out of a Straggler's band unless the
  // player hugs the tower (an earlier version of this check, see docs/enemy-ai-v2.md).
  for (let index = 0; index < 6; index++) {
    const angle = (index * 60 * Math.PI) / 180;
    await page.evaluate(
      ({ index, x, z }) => window.__gameDebug?.placeEnemy(index, x, z),
      { index, x: spot!.x + Math.sin(angle) * 12, z: spot!.z + Math.cos(angle) * 12 },
    );
  }
  await fireIntoAir(page);

  const coveredSpots = new Set<number>();
  const settledOnSpot = new Set<number>();
  const timeline: string[] = [];
  let maxShooters = 0;
  let sawChase = false;
  for (let sample = 0; sample < 50; sample++) {
    await waitForGameTime(page, 0.5);
    if (sample % 10 === 9) await fireIntoAir(page);
    const enemies = await readEnemies(page);
    const squad = await page.evaluate(() => window.__gameDebug?.getSquadDebug());
    timeline.push(timelineEntry(enemies, squad?.visibleCount));
    maxShooters = Math.max(maxShooters, enemies.filter((enemy) => enemy.role === 'shooter').length);
    for (const enemy of enemies) {
      if (enemy.state === 'chase') sawChase = true;
      if (enemy.pick?.covered && enemy.pick.source !== 'open') coveredSpots.add(enemy.index);
      if (enemy.pick && enemy.pick.phase !== 'moving') settledOnSpot.add(enemy.index);
    }
  }

  const story = `\n${timeline.slice(-12).join('\n')}`;
  expect(sawChase, `the enemies should engage${story}`).toBe(true);
  expect(coveredSpots.size, `at least two enemies should pick a covered spot${story}`).toBeGreaterThanOrEqual(2);
  expect(settledOnSpot.size, `at least one enemy should reach its spot and hide or peek${story}`).toBeGreaterThanOrEqual(1);
  expect(maxShooters, `still never more than two shooters${story}`).toBeLessThanOrEqual(2);
});

test('after a shot from hiding, searchers split up and sweep the likeliest ground', async ({ page }) => {
  test.setTimeout(240000);
  await startSoloMatch(page, 4);

  // Four enemies 22 to 28 m east of the player: close enough to hear a rifle (40 m), too far to see
  // the player (detection is at most 20 m). Placed straight away - a first version waited a second
  // first, and a patrolling enemy spotted the player before the shot, a different scenario. The
  // player fires, then slips 30 m west before anyone arrives, so the squad has only the shot.
  const player = await playerPosition(page);
  for (let index = 0; index < 4; index++) {
    await page.evaluate(
      ({ index, x, z }) => window.__gameDebug?.placeEnemy(index, x, z),
      { index, x: player.x + 22 + index * 2, z: player.z + (index - 1.5) * 4 },
    );
  }
  await fireIntoAir(page);
  const shotClock = (await page.evaluate(() => window.__gameDebug?.getSquadDebug()))?.clock ?? 0;
  await page.evaluate(({ x, y, z }) => window.__gameDebug?.teleport(x - 30, y + 1, z), player);

  // Timed on the squad clock (game time): each debug call lets the slow sandbox run on, so the
  // test's own waits undercount game time several times over.
  let sawSearch = false;
  let sawGrid = false;
  let lowestTotal = 1;
  let mostDistinctTargets = 0;
  let searchingAtEightSeconds: number | null = null;
  const timeline: string[] = [];
  for (let sample = 0; sample < 40; sample++) {
    await waitForGameTime(page, 0.5);
    const enemies = await readEnemies(page);
    const squad = await page.evaluate(() => window.__gameDebug?.getSquadDebug());
    const sinceShot = (squad?.clock ?? shotClock) - shotClock;
    if (enemies.some((enemy) => enemy.state === 'search')) sawSearch = true;
    if (squad?.searchGrid) {
      sawGrid = true;
      lowestTotal = Math.min(lowestTotal, squad.searchGrid.total);
    }
    const targets = new Set(
      enemies
        .filter((enemy) => enemy.state === 'search' && enemy.searchTarget)
        .map((enemy) => `${Math.round(enemy.searchTarget!.x)},${Math.round(enemy.searchTarget!.z)}`),
    );
    mostDistinctTargets = Math.max(mostDistinctTargets, targets.size);
    if (searchingAtEightSeconds === null && sinceShot >= 8) {
      searchingAtEightSeconds = enemies.filter((enemy) => enemy.state === 'search').length;
    }
    const grid = squad?.searchGrid ? `[grid ${squad.searchGrid.total.toFixed(2)} age ${squad.searchGrid.age.toFixed(1)}]` : '[no grid]';
    const belief = squad?.belief ? `belief ${squad.belief.source} age ${squad.belief.age.toFixed(1)}` : 'no belief';
    // Samples land seconds of game time apart here, so the grid's own record says what happened
    // between them: how many were built and why the last one ended.
    const end = squad?.lastSearchEnd;
    const lifecycle = `built ${squad?.searchGridsBuilt ?? 0}${end ? `, last ended ${end.reason} at ${end.age.toFixed(1)}s with ${end.total.toFixed(2)} left` : ''}`;
    timeline.push(`+${sinceShot.toFixed(1)}s ${grid} (${lifecycle}) ${belief} | ${enemies.map((enemy) => enemy.state).join(' ')}`);
    if (sinceShot > 16) break;
  }

  // The whole run, not just the tail: a search that never starts or ends early is only visible at
  // the beginning.
  const story = `\n${timeline.join('\n')}`;
  expect(sawSearch, `the shot should send the enemies searching${story}`).toBe(true);
  expect(sawGrid, `the squad should start a search grid around the shot${story}`).toBe(true);
  expect(mostDistinctTargets, `searchers should be sent to at least two different cells${story}`).toBeGreaterThanOrEqual(2);
  expect(lowestTotal, `searchers should clear some of the likely ground${story}`).toBeLessThan(0.95);
  expect(searchingAtEightSeconds ?? 0, `still searching 8 s after the shot, past the old 6 s stand${story}`).toBeGreaterThanOrEqual(1);
});

async function squadDebug(page: Page) {
  const squad = await page.evaluate(() => window.__gameDebug?.getSquadDebug());
  if (!squad) throw new Error('no squad debug');
  return squad;
}

test('enemies call out what they are doing, rationed like a squad', async ({ page }) => {
  test.setTimeout(240000);
  await startSoloMatch(page, 4);
  const player = await playerPosition(page);
  // Four enemies on a 10 m ring, then a shot: they come, see the player, and call it.
  for (let index = 0; index < 4; index++) {
    const angle = (index * 90 * Math.PI) / 180;
    await page.evaluate(
      ({ index, x, z }) => window.__gameDebug?.placeEnemy(index, x, z),
      { index, x: player.x + Math.sin(angle) * 10, z: player.z + Math.cos(angle) * 10 },
    );
  }
  await fireIntoAir(page);
  const start = (await squadDebug(page)).clock;
  let squad = await squadDebug(page);
  while (squad.clock - start < 15) {
    await waitForGameTime(page, 0.5);
    squad = await squadDebug(page);
  }
  const voiced = (squad.callouts.spotted ?? 0) + (squad.callouts.flanking ?? 0) + (squad.callouts.lostThem ?? 0);
  const span = squad.clock - start;
  const summary = JSON.stringify({ callouts: squad.callouts, span });
  expect(squad.callouts.spotted ?? 0, `someone should call out spotting the player: ${summary}`).toBeGreaterThanOrEqual(1);
  // Never more often than the global cooldown allows (1.2 s apart), so never a chorus.
  expect(voiced, `callouts stay rationed: ${summary}`).toBeLessThanOrEqual(Math.ceil(span / 1.2) + 1);
});

test('a heavy hit staggers an enemy, a light one does not', async ({ page }) => {
  test.setTimeout(180000);
  await startSoloMatch(page, 1);
  await waitForGameTime(page, 1);
  // Light hit first (10) then heavy (26, over the 25 threshold): even the 40 HP Ridge Walker lives.
  await page.evaluate(() => window.__gameDebug?.damageEnemy(0, 10));
  await waitForGameTime(page, 0.3);
  expect((await squadDebug(page)).callouts.staggered ?? 0, 'a light hit does not stagger').toBe(0);
  await page.evaluate(() => window.__gameDebug?.damageEnemy(0, 26));
  await waitForGameTime(page, 0.3);
  expect((await squadDebug(page)).callouts.staggered ?? 0, 'a heavy hit staggers').toBe(1);
  const [enemy] = await readEnemies(page);
  expect(enemy, 'the enemy survives both hits').toBeDefined();
});

test('a Ridge Walker lining up a long shot shows a glint first', async ({ page }) => {
  test.setTimeout(360000);
  // Re-roll until the squad has a Ridge Walker (20 percent of spawns).
  let sniper: EnemyRecord | undefined;
  for (let attempt = 0; attempt < 6 && !sniper; attempt++) {
    await startSoloMatch(page, 5);
    sniper = (await readEnemies(page)).find((enemy) => enemy.archetype === 'Ridge Walker');
  }
  expect(sniper, 'a match with a Ridge Walker').toBeDefined();

  // The Ridge Walker 18 m out (over the 15 m telegraph distance, inside its 20 m detection); every
  // other enemy far off, so it gets a shooter token of its own.
  const player = await playerPosition(page);
  const enemies = await readEnemies(page);
  for (const enemy of enemies) {
    const far = enemy.index === sniper!.index ? 18 : 80;
    const angle = enemy.index === sniper!.index ? 0 : ((enemy.index * 70 + 90) * Math.PI) / 180;
    await page.evaluate(
      ({ index, x, z }) => window.__gameDebug?.placeEnemy(index, x, z),
      { index: enemy.index, x: player.x + Math.sin(angle) * far, z: player.z + Math.cos(angle) * far },
    );
  }
  await fireIntoAir(page);
  const start = (await squadDebug(page)).clock;
  let squad = await squadDebug(page);
  // Two glints, not one: the telegraph must re-arm for each long shot. Its first version glinted
  // before a Ridge Walker's first shot only (found by the final review), and a check that stopped
  // at one glint could not see that.
  while (squad.clock - start < 25 && (squad.callouts.glint ?? 0) < 2) {
    await waitForGameTime(page, 0.5);
    squad = await squadDebug(page);
  }
  expect(squad.callouts.glint ?? 0, `the Ridge Walker should glint before each long shot: ${JSON.stringify(squad.callouts)}`).toBeGreaterThanOrEqual(2);
});

test('a rifle shot carries farther than a pistol shot', async ({ page }) => {
  test.setTimeout(180000);
  await startSoloMatch(page, 2);
  await equipPistol(page);

  // Pistol (heard to 30 m): an enemy 36 m away must not react. placeEnemy re-homes it there: before
  // it did, the enemy could walk back toward its spawn near the player and see them, which read as
  // "heard the pistol" (the intermittent failure from checkpoint C to E, solved by its own dump).
  const player = await playerPosition(page);
  await page.evaluate(({ x, z }) => window.__gameDebug?.placeEnemy(0, x + 36, z), player);
  await page.evaluate(({ x, z }) => window.__gameDebug?.placeEnemy(1, x, z - 70), player);
  await waitForGameTime(page, 0.3);
  const beforePistol = await readEnemies(page);
  await fireIntoAir(page);
  await waitForGameTime(page, 1);
  const afterPistol = await readEnemies(page);
  const farEnemy = afterPistol.find((record) => record.index === 0);
  // The message carries the whole picture, so a failure is diagnosable without the trace.
  const diagnosis = JSON.stringify({
    player,
    beforePistol,
    afterPistol,
    squad: await page.evaluate(() => window.__gameDebug?.getSquadDebug()),
  });
  expect(farEnemy?.state, `the enemy 36 m away should not react to a pistol: ${diagnosis}`).toBe('idle');

  // Rifle (heard to 40 m): an enemy 34 m away must react.
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.__gameDebug?.getWeaponName() !== 'Kestrel P9', undefined, { timeout: 5000 });
  await waitForGameTime(page, 0.5);
  await page.evaluate(({ x, z }) => window.__gameDebug?.placeEnemy(1, x, z + 34), player);
  await waitForGameTime(page, 0.3);
  await fireIntoAir(page);
  const reacted = await waitForEnemy(page, 1, (record) => record.state !== 'idle', 1.5);
  expect(reacted, 'the enemy 34 m away should hear the rifle').not.toBeNull();
});
