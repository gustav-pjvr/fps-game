import type { Page } from '@playwright/test';

/** Clicks through the lobby (Play -> Start Match with default counts) and waits for Game.create()
 * to finish (WASM init, world seed, encounters spawned) - see Game.installDebugApi(). */
export async function waitForGameReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
}

/** Clicks the pause menu's Resume button (shown by default on a freshly loaded match, since it
 * doubles as the "click to play" gate) to engage pointer lock, then waits for it to take effect. */
export async function lockPointer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, { timeout: 5000 });
}

export async function holdKey(page: Page, key: string, durationMs: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(key);
}

/** Simulates pressing Escape by releasing pointer lock directly (document.exitPointerLock()) and
 * waits for the pause menu to appear. Game's pause logic reacts purely to pointer-lock state, not
 * to a specific key, so this exercises the same production code path a real Escape press would -
 * necessary because headless Chromium's CDP-driven synthetic keydown for 'Escape' does not reach
 * the browser's native pointer-lock-release hatch (verified empirically: a real key.press('Escape')
 * left document.pointerLockElement unchanged), which is an automation/environment limitation, not
 * something Game.ts's Escape handling (or lack thereof) is responsible for. */
export async function openPauseMenu(page: Page): Promise<void> {
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === false, { timeout: 5000 });
  await page.getByTestId('pause-menu').getByRole('button', { name: 'Resume', exact: true }).waitFor({ state: 'visible' });
}

/** Seeks the first live enemy (index 5 in the default 5-target/3-enemy match) and holds position
 * next to it until it attacks the player down to 0 HP - no debug damage hook exists on purpose
 * (window.__gameDebug is aim-only, no gameplay cheats), so this is real combat damage.
 *
 * Re-aims and re-taps forward every iteration instead of holding a fixed heading/sprint: the
 * player's sprint speed (8) far outpaces the enemy's chase speed (2.5), so a single fixed-heading
 * sprint blows straight past the enemy after one graze and never comes back in range.
 *
 * Deadline widened twice now. 40s -> 50s for enemy AI Phase B/C/D (an engaging enemy often stands
 * its ground firing ranged bursts with a real aim-error cone - can whiff a whole burst - rather
 * than beelining straight into a guaranteed-hit melee tick, and melee itself can miss too).
 * 50s -> 90s for per-archetype loadouts: whichever archetype spawns at index 5 is now random, and
 * a Ridge Walker (kiter) actively backs away whenever this loop's approach brings the player within
 * its kite range, turning "walk up and get hit" into an extended, real (if slow) chase - measured
 * directly via a temporary diagnostic script: one Ridge Walker draw took 58s to die by this same
 * approach logic, comfortably past the old 50s deadline. Death is still guaranteed (a kiter can't
 * out-walk sprint forever, and this loop's re-aim-and-approach eventually closes the gap), just no
 * longer bounded by a fixed combat cadence the way melee-only combat used to be. */
export async function killPlayerByEnemy(page: Page): Promise<void> {
  const deadline = Date.now() + 90000;

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
      // Sprinting is safe here specifically because this loop re-aims and re-issues a short
      // (<=400ms) burst every iteration rather than holding one heading for a long stretch - the
      // "blows straight past" failure mode from the comment above only bites a single long,
      // uncorrected sprint. Needed against a kiting archetype (Ridge Walker, moveSpeed 2.2) that
      // actively retreats: at walk speed the net closing rate was too close to zero in the worst
      // case (measured up to ~58s to land a kill), sprint (8) makes the outcome not just
      // eventually-guaranteed but reliably fast regardless of which archetype is at index 5.
      await page.keyboard.down('ShiftLeft');
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(Math.min(400, distance * 60));
      await page.keyboard.up('KeyW');
      await page.keyboard.up('ShiftLeft');
    } else {
      await page.waitForTimeout(300);
    }
  }
}
