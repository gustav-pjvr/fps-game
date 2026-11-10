import { expect, test, type Page } from '@playwright/test';
import { lockPointer, waitForGameTime } from './helpers.ts';

// Enemy AI v2 step 6 (docs/enemy-ai-v2.md): the opt-in Director solo mode. The sandbox runs the game
// at a fraction of real speed, so every wait here is on the game's own clock.

async function startMatch(page: Page, director: boolean): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  if (director) await page.getByRole('radio', { name: /Director/ }).check();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 60000 });
  // Showdown opens on its mode briefing, which holds the world until skipped.
  const skip = page.getByRole("button", { name: /skip/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(true));
}

async function directorDebug(page: Page) {
  return page.evaluate(() => window.__gameDebug?.getDirectorDebug() ?? null);
}

async function clock(page: Page): Promise<number> {
  return (await page.evaluate(() => window.__gameDebug?.getSquadDebug().clock)) ?? 0;
}

test('a normal solo match has no director', async ({ page }) => {
  test.setTimeout(120000);
  await startMatch(page, false);
  expect(await directorDebug(page)).toBeNull();
});

test('a director match starts small, then sends waves in from behind, out of sight', async ({ page }) => {
  test.setTimeout(300000);
  await startMatch(page, true);
  const start = await directorDebug(page);
  expect(start, 'the director runs in this mode').not.toBeNull();
  expect(start!.phase).toBe('buildUp');
  // Two enemies to begin with and no practice targets: the director brings the rest.
  expect(await page.evaluate(() => window.__gameDebug?.getEntityCount())).toBe(2);

  const begin = await clock(page);
  let state = start!;
  while (state.totalSpawned < 2 && (await clock(page)) - begin < 40) {
    await waitForGameTime(page, 1);
    state = (await directorDebug(page))!;
  }
  expect(state.totalSpawned, `a wave within 40 s of game time: ${JSON.stringify(state)}`).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__gameDebug?.getEntityCount())).toBeGreaterThanOrEqual(3);

  for (const spawn of state.lastSpawns) {
    const detail = JSON.stringify(spawn);
    expect(spawn.onScreen, `the player could not see it arrive: ${detail}`).toBe(false);
    const dx = spawn.x - spawn.playerX;
    const dz = spawn.z - spawn.playerZ;
    const distance = Math.hypot(dx, dz);
    expect(distance, `18 to 30 m out: ${detail}`).toBeGreaterThanOrEqual(17.5);
    expect(distance, `18 to 30 m out: ${detail}`).toBeLessThanOrEqual(30.5);
    // Worked out here from where the player looked, not taken from the game: at least 70 degrees
    // off their forward, so well outside the screen (the spawner allows 80 and up).
    const ahead = (dx * spawn.forwardX + dz * spawn.forwardZ) / distance;
    expect(ahead, `behind the player, off screen: ${detail}`).toBeLessThan(Math.cos((70 * Math.PI) / 180));
  }
});

test('heavy damage takes the director to its peak, and it sends nothing more while it lasts', async ({ page }) => {
  test.setTimeout(240000);
  await startMatch(page, true);
  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(false));
  await page.evaluate(() => window.__gameDebug?.damagePlayer(55));
  await page.waitForFunction(() => (window.__gameDebug?.getPlayerHealth() ?? 100) <= 45, undefined, { timeout: 30000 });
  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(true));

  await waitForGameTime(page, 0.5);
  const peak = (await directorDebug(page))!;
  expect(peak.phase, `55 HP lost is a full peak: ${JSON.stringify(peak)}`).toBe('peak');

  // Peak lasts 3 to 5 s, then fade holds until the player is clear; no wave in either.
  await waitForGameTime(page, 8);
  const after = (await directorDebug(page))!;
  expect(['peak', 'fade', 'relax'], JSON.stringify(after)).toContain(after.phase);
  expect(after.totalSpawned, JSON.stringify(after)).toBe(peak.totalSpawned);
});

// Showdown (docs/showdown.md): the Director mode as a run of five acts and a finale.

type Showdown = NonNullable<ReturnType<NonNullable<Window['__gameDebug']>['getShowdownDebug']>>;
const showdown = (page: Page): Promise<Showdown> => page.evaluate(() => window.__gameDebug!.getShowdownDebug()!);

/** Kills every live enemy until the run passes `check` (the director only relaxes once the field is clear). */
async function clearUntil(page: Page, check: (state: Showdown) => boolean, what: string, timeout = 180000): Promise<Showdown> {
  const deadline = Date.now() + timeout;
  for (;;) {
    await page.evaluate(() => window.__gameDebug!.killEnemies());
    const state = await showdown(page);
    if (check(state)) return state;
    if (Date.now() > deadline) throw new Error(`Showdown never reached: ${what} (last ${JSON.stringify(state)})`);
    await page.waitForTimeout(500);
  }
}

test('Showdown: an act survived pays its bonus, drops a supply crate, and the next act begins', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await startMatch(page, true);
  const start = await showdown(page);
  expect(start).toMatchObject({ act: 1, totalActs: 5, stage: 'act', score: 0, multiplier: 1, redeploysLeft: 2 });
  await expect(page.getByTestId('showdown-hud')).toContainText('ACT 1 / 5');

  // The peak, then the field cleared: the breather clears the act.
  await page.evaluate(() => window.__gameDebug!.forceDirectorPeak());
  const cleared = await clearUntil(page, (state) => state.stage === 'breather', 'the first act cleared');
  expect(cleared.score).toBeGreaterThanOrEqual(500);
  expect(cleared.crates.length).toBe(1);
  await expect(page.getByTestId('showdown-hud')).toContainText('BREATHER');

  // The crate heals and is gone once walked onto.
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(false));
  await page.evaluate(() => window.__gameDebug!.damagePlayer(50));
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.getPlayerHealth()), { timeout: 20000 }).toBe(50);
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));
  const crate = cleared.crates[0]!;
  await page.evaluate(({ x, y, z }) => window.__gameDebug!.teleport(x, y + 1.5, z), crate);
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.getPlayerHealth()), { timeout: 30000 }).toBe(85);
  expect((await showdown(page)).crates).toHaveLength(0);

  // After the breather the second act starts, with its own numbers.
  const second = await clearUntil(page, (state) => state.act === 2 && state.stage === 'act', 'the second act', 240000);
  expect(second.phase).toBe('buildUp');
  await expect(page.getByTestId('showdown-hud')).toContainText('ACT 2 / 5');
});

test('Showdown: two deaths are redeploys, the third ends the run on its end screen', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  await startMatch(page, true);
  const fall = async (): Promise<void> => {
    await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(false));
    await page.evaluate(() => window.__gameDebug!.damagePlayer(500));
  };

  for (const left of [1, 0]) {
    await fall();
    await expect.poll(async () => (await showdown(page)).redeploysLeft, { timeout: 30000 }).toBe(left);
    // Back on their feet with full health, the run still going, no death screen.
    expect(await page.evaluate(() => window.__gameDebug!.getPlayerHealth())).toBe(100);
    expect((await showdown(page)).stage).toBe('act');
    await expect(page.getByTestId('death-screen')).toBeHidden();
    // The redeploy's shield has to run out before the next fall can land.
    await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));
    await waitForGameTime(page, 4);
  }

  await fall();
  const deathScreen = page.getByTestId('death-screen');
  await expect(deathScreen).toContainText('Overrun', { timeout: 30000 });
  await expect(deathScreen).toContainText('SCORE');
  await expect(deathScreen).toContainText('Grade');
  expect((await showdown(page)).stage).toBe('lost');

  // Respawn starts a new run: act 1, the redeploys back.
  await deathScreen.getByRole('button', { name: 'Respawn', exact: true }).click();
  await expect.poll(async () => (await showdown(page)).redeploysLeft, { timeout: 30000 }).toBe(2);
  expect(await showdown(page)).toMatchObject({ act: 1, stage: 'act', score: 0 });
});

test('Showdown: the fifth act\'s peak brings the Warden, and the finale squad dead wins the run', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await startMatch(page, true);
  await page.evaluate(() => window.__gameDebug!.setShowdownAct(5));
  expect(await showdown(page)).toMatchObject({ act: 5, stage: 'act' });

  await page.evaluate(() => window.__gameDebug!.forceDirectorPeak());
  // The peak lasts a few seconds; then the finale, with no breather before it.
  const deadline = Date.now() + 120000;
  let state = await showdown(page);
  while (state.stage !== 'finale') {
    if (Date.now() > deadline) throw new Error(`no finale: ${JSON.stringify(state)}`);
    await page.waitForTimeout(500);
    state = await showdown(page);
  }
  await expect(page.getByTestId('showdown-hud')).toContainText('KILL THE WARDEN');
  // The Warden comes in with its escorts, out of the player's sight like any wave.
  await expect.poll(async () => (await showdown(page)).warden, { timeout: 120000 }).toBe(true);
  expect((await showdown(page)).alive).toBeGreaterThanOrEqual(2);

  const won = await clearUntil(page, (now) => now.stage === 'won', 'the run won');
  expect(won.score).toBeGreaterThanOrEqual(2500);
  const deathScreen = page.getByTestId('death-screen');
  await expect(deathScreen).toContainText('Showdown won', { timeout: 30000 });
  await expect(deathScreen).toContainText('Grade');
});
