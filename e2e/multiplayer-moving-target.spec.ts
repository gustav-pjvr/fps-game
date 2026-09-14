import { test, expect, type Page } from '@playwright/test';
import { equipPistol, lockPointer } from './helpers.ts';

declare global {
  interface Window {
    __gameDebug?: {
      getPlayerHealth(): number;
      getOpponentPosition(): { x: number; y: number; z: number } | null;
      lookAt(x: number, y: number, z: number): void;
      teleport(x: number, y: number, z: number): void;
    };
  }
}

async function waitForMatchReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
}

/** Real bug reported from actual play: two players moving and shooting at each other had a large
 * fraction of hits silently not register, worst with the sniper at range, but present with pistol
 * and shotgun too. Root causes fixed in Game.ts/RemotePlayer.ts/config.ts:
 *   1. `RemotePlayer.update()` (advances its damped position and commits the new collider
 *      position) used to run *after* `weaponManager.update()` in the same tick - every shot's
 *      raycast checked a collider position that was one whole extra frame stale on top of the
 *      network sync lag already inherent to snapshot-sync, for no reason. Reordered so the
 *      collider is current for this tick's own raycast.
 *   2. Snapshot send rate (~18Hz) and the receiving-end damping rate were both too slow relative
 *      to sprint speed (8 units/sec) - real position could drift up to ~0.44 units between
 *      updates, close to the target's own 0.4-unit hit-radius, before damping's own further lag
 *      stacked on top. Both raised (see config.ts/RemotePlayer.ts comments).
 *
 * This is the first multiplayer combat test to fire at a genuinely *moving* target (via held
 * movement keys, real physics-driven motion) rather than a stationary teleported one - every
 * earlier combat test would have missed this whole bug class, since aiming at a motionless target
 * has nothing for network lag to throw off.
 *
 * Deliberately not asserting "the guest always dies" - this environment's own automation overhead
 * (each aim/fire step is a real CDP round-trip, on top of software-rendered rendering already
 * measured elsewhere in this repo at single-digit FPS) adds lag on top of the game's own network
 * lag that a real human clicking a real mouse never pays, so a strict kill-every-time bar would be
 * partly grading this test harness, not the fix. What's checked instead is the thing this bug
 * actually broke: that *some* shots against a moving target land at all, across a real multi-shot
 * exchange - before this fix, real playtesting reported long stretches of *zero* landed hits. */
test('shots land against a moving target, not just a stationary one', async ({ browser }) => {
  test.setTimeout(150000);

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  await hostPage.goto('/');
  await hostPage.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await hostPage.getByRole('button', { name: 'Create Room', exact: true }).click();

  const codeLocator = hostPage.locator('div').filter({ hasText: /^[A-Z2-9]{6}$/ }).last();
  await codeLocator.waitFor({ state: 'visible', timeout: 10000 });
  const code = await codeLocator.textContent();
  if (!code) throw new Error('room code never appeared');

  await guestPage.goto('/');
  await guestPage.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guestPage.getByPlaceholder('ABCDEF').fill(code);
  await guestPage.getByRole('button', { name: 'Join', exact: true }).click();

  // The lobby ready check (v3.9.0) keeps Start Match disabled until every guest clicks Ready.
  await guestPage.getByRole('button', { name: 'Ready', exact: true }).click();
  const startButton = hostPage.getByRole('button', { name: 'Start Match', exact: true });
  await startButton.waitFor({ state: 'visible', timeout: 20000 });
  await startButton.click();

  await waitForMatchReady(hostPage);
  await waitForMatchReady(guestPage);
  await lockPointer(hostPage);
  await lockPointer(guestPage);
  await equipPistol(hostPage);

  const opponentPosition = await hostPage.evaluate(() => window.__gameDebug?.getOpponentPosition());
  if (!opponentPosition) throw new Error('host has no opponent position yet');

  // Host gets within pistol range but not right on top of the guest, so the guest's own
  // side-to-side movement is actually large relative to the distance (the condition that made
  // this bug visible in real play - close-range strafing, not far-off sniping).
  await hostPage.evaluate(({ x, y, z }) => window.__gameDebug?.teleport(x + 8, y + 5, z), opponentPosition);
  await hostPage.waitForTimeout(1000);

  // Guest strafes back and forth for the rest of the test - real physics-driven movement (not a
  // teleport), so the position the host's client learns about is always somewhat behind where the
  // guest actually now is, exactly like a real player dodging during a fight. Direction flips
  // once per shot (inline in the loop below, not on a separate interval - overlapping async
  // keyboard calls from a setInterval firing independently of the shot loop caused a hang) so the
  // guest stays roughly in the same area instead of running hundreds of units away in a straight
  // line, which isn't a realistic combat scenario and stops testing hit registration at all once
  // the target is simply out of any reasonable engagement range.
  let strafeRight = true;
  await guestPage.keyboard.down('KeyD');

  try {
    // Pistol: 20 damage. 10 shots at a real, continuously-strafing target.
    let guestHealth = 100;
    for (let i = 0; i < 10 && guestHealth > 0; i++) {
      if (i > 0 && i % 2 === 0) {
        await guestPage.keyboard.up(strafeRight ? 'KeyD' : 'KeyA');
        strafeRight = !strafeRight;
        await guestPage.keyboard.down(strafeRight ? 'KeyD' : 'KeyA');
      }

      // Fetch-and-aim in a single evaluate call, not two - each round-trip costs real wall-clock
      // time in this environment, and every extra one just adds test-harness-induced lag on top of
      // the lag this test exists to measure, rather than being a neutral observation step.
      await hostPage.evaluate(() => {
        const opponent = window.__gameDebug?.getOpponentPosition();
        if (opponent) window.__gameDebug?.lookAt(opponent.x, opponent.y, opponent.z);
      });
      await hostPage.mouse.down();
      await hostPage.mouse.up();
      await hostPage.waitForTimeout(300);
      guestHealth = (await guestPage.evaluate(() => window.__gameDebug?.getPlayerHealth())) ?? 100;
    }

    // At least one hit must have landed against the moving target - the bug this test guards
    // against was long stretches of zero registered hits during real strafing combat.
    expect(guestHealth).toBeLessThan(100);
  } finally {
    await guestPage.keyboard.up('KeyD').catch(() => {});
    await guestPage.keyboard.up('KeyA').catch(() => {});
  }

  await hostContext.close();
  await guestContext.close();
});
