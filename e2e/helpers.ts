import type { Page } from '@playwright/test';

/** Clicks through the lobby (Play -> Start Match with default counts) and waits for Game.create()
 * to finish (WASM init, world seed, encounters spawned) - see Game.installDebugApi(). */
export async function waitForGameReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
}

/** Clicks the "click to play" blocker to engage pointer lock, then waits for it to actually take effect. */
export async function lockPointer(page: Page): Promise<void> {
  await page.click('#blocker');
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, { timeout: 5000 });
}

export async function holdKey(page: Page, key: string, durationMs: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(key);
}

/** Seeks the first live enemy (index 5 in the default 5-target/3-enemy match) and holds position
 * next to it until it attacks the player down to 0 HP - no debug damage hook exists on purpose
 * (window.__gameDebug is aim-only, no gameplay cheats), so this is real combat damage.
 *
 * Re-aims and re-taps forward every iteration instead of holding a fixed heading/sprint: the
 * player's sprint speed (8) far outpaces the enemy's chase speed (2.5), so a single fixed-heading
 * sprint blows straight past the enemy after one graze and never comes back in range. */
export async function killPlayerByEnemy(page: Page): Promise<void> {
  const deadline = Date.now() + 40000;

  while (true) {
    const health = await page.evaluate(() => window.__gameDebug?.getPlayerHealth());
    if ((health ?? 100) <= 0) return;
    if (Date.now() > deadline) throw new Error('killPlayerByEnemy timed out without the player dying');

    const enemyPos = (await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions()))?.[5];
    const playerPos = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
    if (!enemyPos || !playerPos) throw new Error('expected an enemy at index 5 and a player position');

    const dx = enemyPos.x - playerPos.x;
    const dz = enemyPos.z - playerPos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    await page.evaluate(({ x, y, z }) => window.__gameDebug?.lookAt(x, y, z), enemyPos);

    if (distance > 2.5) {
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(Math.min(400, distance * 60));
      await page.keyboard.up('KeyW');
    } else {
      await page.waitForTimeout(300);
    }
  }
}
