import { test, expect, type Page } from '@playwright/test';
import { equipPistol, lockPointer, openPauseMenu } from './helpers.ts';

declare global {
  interface Window {
    __gameDebug?: {
      getPlayerHealth(): number;
      getOpponentPosition(): { x: number; y: number; z: number } | null;
      isPointerLocked(): boolean;
      lookAt(x: number, y: number, z: number): void;
      teleport(x: number, y: number, z: number): void;
    };
  }
}

async function waitForMatchReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
}

/** Real exploit reported during playtesting: pausing (releasing pointer lock) used to freeze
 * *all* of Game's per-tick logic, including applying already-arrived network damage and the
 * death transition that reports a kill - so a paused player took no damage and could not die
 * no matter how many hits actually landed, until they unpaused. A player could sit in the pause
 * menu indefinitely and be functionally invincible. Fixed by letting network damage/death/respawn
 * keep flowing while paused in multiplayer specifically (local movement/shooting/AI still freeze -
 * see Game.ts's update()); single-player still freezes everything, since nothing else is "live"
 * to exploit there. */
test('pausing does not grant invincibility in multiplayer - damage still applies and kills while paused', async ({ browser }) => {
  // Measured 2026-10-23 on SwiftShader with the v4 characters: creating, joining and starting the
  // match alone takes about 50 s here on Low graphics (a click 5 to 10 s, the second page's load
  // 7 s), and a 90 s budget ran out with every step still advancing (docs/testing.md).
  test.setTimeout(180000);

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

  // The guest pauses and stays paused for the rest of the test - the exact scenario reported: a
  // player sitting in the pause menu while the opponent keeps shooting.
  await openPauseMenu(guestPage);
  expect(await guestPage.evaluate(() => window.__gameDebug?.isPointerLocked())).toBe(false);

  const opponentPosition = await hostPage.evaluate(() => window.__gameDebug?.getOpponentPosition());
  if (!opponentPosition) throw new Error('host has no opponent position yet');

  // Shoot from 12 m away in the first of eight directions with a clear line to the guest: a fixed
  // offset put a house between the two players (v4.1 houses are solid where drawn, 2026-10-24).
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    await hostPage.evaluate(({ x, y, z, a }) => window.__gameDebug?.teleport(x + Math.cos(a) * 12, y + 8, z + Math.sin(a) * 12), { ...opponentPosition, a: angle });
    await hostPage.waitForTimeout(1000);
    await hostPage.evaluate(({ x, y, z }) => window.__gameDebug?.lookAt(x, y, z), opponentPosition);
    await hostPage.waitForTimeout(100);
    if ((await hostPage.evaluate(() => window.__gameDebug?.raycastForward()))?.isEntity) break;
  }

  let guestHealth = 100;
  for (let i = 0; i < 6 && guestHealth > 0; i++) {
    await hostPage.mouse.down();
    await hostPage.mouse.up();
    await hostPage.waitForTimeout(300);
    guestHealth = (await guestPage.evaluate(() => window.__gameDebug?.getPlayerHealth())) ?? 100;
  }

  // Checked while STILL paused - the whole point is that this must not require unpausing first.
  expect(await guestPage.evaluate(() => window.__gameDebug?.isPointerLocked())).toBe(false);
  expect(guestHealth).toBeLessThanOrEqual(0);

  await hostContext.close();
  await guestContext.close();
});
