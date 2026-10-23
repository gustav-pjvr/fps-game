import type { Page } from '@playwright/test';

/** No stored settings, so the game starts on its shipped default graphics (Medium). The config runs
 * behaviour specs on Low (playwright.config.ts); a spec that judges the rendered look opts back in
 * with `test.use({ storageState: SHIPPED_GRAPHICS })`. */
export const SHIPPED_GRAPHICS = { cookies: [], origins: [] };

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
  // The options are waitForFunction's third argument: passed second (as this was until enemy AI v2
  // checkpoint E) they became the page function's argument, the 5 s limit never applied, and a lock
  // that never came waited out the whole test.
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, undefined, { timeout: 5000 });
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

/** Resolves once at least `seconds` of GAME time has elapsed, measured the way core/Loop.ts advances
 * it: each animation frame contributes its real frame time clamped to MAX_FRAME_TIME (0.25 s). The
 * same helper smoke.spec.ts keeps locally; a fixed waitForTimeout silently shrinks every in-game
 * interval in the slow sandbox. */
export async function waitForGameTime(page: Page, seconds: number): Promise<void> {
  await page.evaluate(
    (target) =>
      new Promise<void>((resolve) => {
        let elapsed = 0;
        let last: number | undefined;
        const step = (now: number): void => {
          if (last !== undefined) elapsed += Math.min((now - last) / 1000, 0.25);
          last = now;
          if (elapsed >= target) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    seconds,
  );
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

const KILL_PLAYER_GAME_SECONDS = 90;

type GameClockWindow = Window & { __e2eGameClock?: { elapsed: number } };

/** Starts a fresh page-side game clock: each animation frame adds its real frame time clamped to
 * MAX_FRAME_TIME (0.25 s), exactly as core/Loop.ts advances the game. Starting a new clock retires
 * the previous one. */
async function startGameClock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const clockWindow = window as GameClockWindow;
    const clock = { elapsed: 0 };
    clockWindow.__e2eGameClock = clock;
    let last: number | undefined;
    const step = (now: number): void => {
      if (clockWindow.__e2eGameClock !== clock) return;
      if (last !== undefined) clock.elapsed += Math.min((now - last) / 1000, 0.25);
      last = now;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function readGameClock(page: Page): Promise<number> {
  return page.evaluate(() => (window as GameClockWindow).__e2eGameClock?.elapsed ?? 0);
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
  // The deadline is in GAME time, not wall-clock time: the sandbox renders at 2 to 4 frames a
  // second, so the game runs at roughly half speed and the old 90 s wall-clock deadline was only
  // about 45 s of play - thin enough that one run in ten timed out (enemy AI v2 checkpoint B).
  // KILL_PLAYER_GAME_SECONDS is the original 90 s budget as it plays on real hardware.
  await startGameClock(page);

  // A straight sprint has no way round a tree or rock on its line: one enemy AI v2 checkpoint D run
  // spent its whole budget 23 m from the enemy it was sprinting at, every enemy idle and unaware.
  // So three steps without moving trigger a sideways step (alternating sides), and pointer lock is
  // re-taken if it was lost, since keys pressed while unlocked never reach the game.
  let lastPosition: { x: number; z: number } | null = null;
  let stepsWithoutMoving = 0;
  let strafeLeft = true;
  let strafes = 0;

  while (true) {
    const health = await page.evaluate(() => window.__gameDebug?.getPlayerHealth());
    if ((health ?? 100) <= 0) return;
    if ((await readGameClock(page)) > KILL_PLAYER_GAME_SECONDS) {
      // A timeout is otherwise undiagnosable once the trace is overwritten by a later run, so it
      // carries its own snapshot: every enemy's state, role and awareness, and the squad's belief.
      const snapshot = await page.evaluate(() => ({
        player: window.__gameDebug?.getPlayerPosition(),
        pointerLocked: window.__gameDebug?.isPointerLocked(),
        enemies: window.__gameDebug?.getLiveEnemyDebug(),
        squad: window.__gameDebug?.getSquadDebug(),
      }));
      throw new Error(
        `killPlayerByEnemy timed out without the player dying (health ${health}, ${strafes} strafes round obstacles): ${JSON.stringify(snapshot)}`,
      );
    }
    if (!(await page.evaluate(() => window.__gameDebug?.isPointerLocked() === true))) {
      // Death releases pointer lock too, and death is what this loop is waiting for, so this never
      // waits for the lock itself: it clicks Resume if the pause menu is up and goes back round,
      // where the health check catches a death. The first version called lockPointer here, which
      // waited on a death screen for a lock that could not come until the test timed out
      // (checkpoint E).
      const resume = page.getByRole('button', { name: 'Resume', exact: true });
      if (await resume.isVisible().catch(() => false)) await resume.click();
      await page.waitForTimeout(300);
      continue;
    }

    // Re-found each iteration (cheap) so a mid-fight entity-list change can't leave a stale index.
    const enemyIndex = await findFirstEnemyIndex(page);
    const enemyPos = (await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions()))?.[enemyIndex];
    const playerPos = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
    if (!enemyPos || !playerPos) throw new Error('expected a live enemy and a player position');

    const dx = enemyPos.x - playerPos.x;
    const dz = enemyPos.z - playerPos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const moved = lastPosition ? Math.hypot(playerPos.x - lastPosition.x, playerPos.z - lastPosition.z) : Infinity;
    lastPosition = { x: playerPos.x, z: playerPos.z };
    stepsWithoutMoving = distance > 2.5 && moved < 0.3 ? stepsWithoutMoving + 1 : 0;

    await page.evaluate(({ x, y, z }) => window.__gameDebug?.lookAt(x, y, z), enemyPos);

    if (distance > 2.5 && stepsWithoutMoving >= 3) {
      const side = strafeLeft ? 'KeyA' : 'KeyD';
      strafeLeft = !strafeLeft;
      stepsWithoutMoving = 0;
      strafes++;
      await page.keyboard.down(side);
      await page.waitForTimeout(500);
      await page.keyboard.up(side);
    } else if (distance > 2.5) {
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
