import type { Page } from '@playwright/test';

/** Clicks through the lobby (Play -> Start Match with default counts) and waits for Game.create()
 * to finish (WASM init, world seed, encounters spawned) - see Game.installDebugApi(). */
export async function waitForGameReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
}

/** Ensures pointer lock is engaged, clicking the pause menu's Resume button if needed. Since v3.0.0
 * Game.start() requests pointer lock itself, which succeeds whenever the match starts close enough
 * behind a real click (the host's Start Match, single-player's Start Match), so the pause menu and its
 * Resume button may never appear at all. Only a match with no local click behind it (a guest whose
 * start arrived over the network) still opens on the pause menu. Polls for either outcome because
 * start()'s lock request resolves asynchronously. */
export async function lockPointer(page: Page): Promise<void> {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.__gameDebug?.isPointerLocked() === true)) return;
    if (await resume.isVisible().catch(() => false)) {
      await resume.click();
      break;
    }
    await page.waitForTimeout(100);
  }
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, { timeout: 5000 });
}

/** Switches to the Kestrel P9 pistol (slot 2 of the default rifle/pistol/knife loadout, v3.8.0) and
 * waits for the switch to finish. The multiplayer combat tests are written around the pistol's 20
 * damage per shot, and they fire with a quick mouse down/up: that click never fires the slot-1 rifle,
 * which is automatic and only shoots while fire is held at the moment a tick samples input, whereas
 * a semi-automatic pistol queues the press. Requires pointer lock (keys are ignored while unlocked). */
export async function equipPistol(page: Page): Promise<void> {
  await page.keyboard.press('Digit2');
  await page.waitForFunction(() => window.__gameDebug?.getWeaponName() === 'Kestrel P9', { timeout: 5000 });
  // The switch animation (WEAPON_SWITCH_DURATION, 0.35s) blocks firing until it completes.
  await page.waitForTimeout(500);
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

/** Index of the first live enemy, identified by archetype (enemies report one, targets don't) -
 * replaces the old hard-coded "index 5 is an enemy" assumption, which was only true for the
 * default 5-target/3-enemy match with the current spawn order and broke obscurely if either
 * changed. Note: page.evaluate JSON-serializes the array, so targets' undefined entries arrive
 * as null - hence the loose != null check. */
export async function findFirstEnemyIndex(page: Page): Promise<number> {
  const archetypes = await page.evaluate(() => window.__gameDebug?.getLiveEntityArchetypes());
  const index = archetypes?.findIndex((archetype) => archetype != null) ?? -1;
  if (index < 0) throw new Error('no live enemy found');
  return index;
}

/** Seeks the first live enemy (found by archetype, not a hard-coded index) and holds position
 * next to it until it attacks the player down to 0 HP - this is real combat damage on purpose:
 * exactly one death-flow test keeps the genuine enemy-damages-player path covered end to end
 * (the other uses the faster debug damagePlayer hook, which exists for death-UI-flow tests).
 *
 * Re-aims and re-taps forward every iteration instead of holding a fixed heading/sprint: the
 * player's sprint speed (8) far outpaces the enemy's chase speed (2.5), so a single fixed-heading
 * sprint blows straight past the enemy after one graze and never comes back in range.
 *
 * Deadline widened twice now. 40s -> 50s for enemy AI Phase B/C/D (an engaging enemy often stands
 * its ground firing ranged bursts with a real aim-error cone - can whiff a whole burst - rather
 * than beelining straight into a guaranteed-hit melee tick, and melee itself can miss too).
 * 50s -> 90s for per-archetype loadouts: whichever archetype the targeted enemy gets is random, and
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

    // Re-found each iteration (cheap) so a mid-fight entity-list change can't leave a stale index.
    const enemyIndex = await findFirstEnemyIndex(page);
    const enemyPos = (await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions()))?.[enemyIndex];
    const playerPos = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
    if (!enemyPos || !playerPos) throw new Error('expected a live enemy and a player position');

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
      // eventually-guaranteed but reliably fast regardless of which archetype the enemy drew.
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
