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
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 60000 });
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
  test.setTimeout(180000);
  await startSoloMatch(page, 1);
  // Open ground: the enemy goes to the clearing around the player's spawn, where there are no trees
  // for its whiskers to swerve round, so its heading holds; the player waits 40 m away. Among trees
  // the heading can swing 80 degrees in a tick and no attempt counts (checkpoint C's first run).
  const spawn = await playerPosition(page);
  await page.evaluate(({ x, y, z }) => window.__gameDebug?.teleport(x + 40, y + 1, z), spawn);
  await page.evaluate(({ x, z }) => window.__gameDebug?.placeEnemy(0, x, z), spawn);
  await waitForGameTime(page, 1);

  // Only attempts where the enemy kept its heading count: a patrol that turns round mid-check is
  // allowed to notice the player.
  let checked = false;
  for (let attempt = 0; attempt < 6 && !checked; attempt++) {
    const [enemy] = await readEnemies(page);
    if (!enemy) throw new Error('expected one live enemy');
    await standRelativeToFacing(page, enemy, -8);
    let maxAwareness = 0;
    let turned = false;
    for (let sample = 0; sample < 5; sample++) {
      await waitForGameTime(page, 0.25);
      const now = (await readEnemies(page)).find((record) => record.index === enemy.index);
      if (!now) break;
      if (Math.abs(Math.atan2(Math.sin(now.yaw - enemy.yaw), Math.cos(now.yaw - enemy.yaw))) > Math.PI / 3) turned = true;
      maxAwareness = Math.max(maxAwareness, now.awareness);
    }
    if (turned) continue;
    checked = true;
    expect(maxAwareness).toBe(0);
  }
  expect(checked, 'at least one attempt with the enemy keeping its heading').toBe(true);
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

  let maxShooters = 0;
  let sawChase = false;
  let flankerIndex: number | null = null;
  let flankerStartBearing = 0;
  let flankerMaxTurn = 0;
  const timeline: string[] = [];
  for (let sample = 0; sample < 40; sample++) {
    await waitForGameTime(page, 0.5);
    const enemies = await readEnemies(page);
    const squad = await page.evaluate(() => window.__gameDebug?.getSquadDebug());
    timeline.push(timelineEntry(enemies, squad?.visibleCount));
    const shooters = enemies.filter((enemy) => enemy.role === 'shooter').length;
    maxShooters = Math.max(maxShooters, shooters);
    if (enemies.some((enemy) => enemy.state === 'chase')) sawChase = true;
    const flanker = enemies.find((enemy) => enemy.role === 'flanker');
    if (flankerIndex === null && flanker) {
      flankerIndex = flanker.index;
      flankerStartBearing = bearingFromPlayer(flanker);
    }
    const tracked = enemies.find((enemy) => enemy.index === flankerIndex);
    if (tracked) flankerMaxTurn = Math.max(flankerMaxTurn, angleChange(bearingFromPlayer(tracked), flankerStartBearing));
  }

  const story = `\n${timeline.slice(-12).join('\n')}`;
  expect(sawChase, `the enemies should engage after the shot${story}`).toBe(true);
  expect(maxShooters, `at most two shooter tokens at any sample${story}`).toBeLessThanOrEqual(2);
  expect(flankerIndex, `one enemy should be sent to flank${story}`).not.toBeNull();
  expect((flankerMaxTurn * 180) / Math.PI, `the flanker should work round the player${story}`).toBeGreaterThanOrEqual(20);
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
  test.setTimeout(300000);
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

test('a rifle shot carries farther than a pistol shot', async ({ page }) => {
  test.setTimeout(180000);
  await startSoloMatch(page, 2);
  await equipPistol(page);

  // Pistol (heard to 30 m): an enemy 36 m away must not react.
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
  await page.waitForFunction(() => window.__gameDebug?.getWeaponName() !== 'Kestrel P9', { timeout: 5000 });
  await waitForGameTime(page, 0.5);
  await page.evaluate(({ x, z }) => window.__gameDebug?.placeEnemy(1, x, z + 34), player);
  await waitForGameTime(page, 0.3);
  await fireIntoAir(page);
  const reacted = await waitForEnemy(page, 1, (record) => record.state !== 'idle', 1.5);
  expect(reacted, 'the enemy 34 m away should hear the rifle').not.toBeNull();
});
