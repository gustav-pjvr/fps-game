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
