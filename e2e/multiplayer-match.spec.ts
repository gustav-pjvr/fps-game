import { test, expect, type Page } from '@playwright/test';
import { holdKey, lockPointer } from './helpers.ts';

declare global {
  interface Window {
    __gameDebug?: {
      getEntityCount(): number;
      getOpponentPosition(): { x: number; y: number; z: number } | null;
      getPlayerPosition(): { x: number; y: number; z: number };
    };
  }
}

async function waitForMatchReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
}

/** Phase 2 of MULTIPLAYER_PLAN.md: shared world seed + spawn points + RemotePlayer movement sync.
 * No combat yet - this only proves both players land in the same running match with zero AI
 * entities, and that moving on one side is visible as a position update on the other. */
test('starting a multiplayer match spawns both players with no AI and syncs movement', async ({ browser }) => {
  // Two full Game.create() loads (world gen, WASM physics init, asset loading) plus a real WebRTC
  // handshake, comfortably past the 30s default - matches this project's existing convention for
  // heavier e2e tests (see killPlayerByEnemy's test.setTimeout in helpers.ts).
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

  // Pure PvP - the bot/enemy system is single-player "training" only (see MULTIPLAYER_PLAN.md's
  // opening scope note), so neither side should have any AI-controlled entities at all.
  expect(await hostPage.evaluate(() => window.__gameDebug?.getEntityCount())).toBe(0);
  expect(await guestPage.evaluate(() => window.__gameDebug?.getEntityCount())).toBe(0);

  // Host spawns at Spawn A, guest at Spawn B (MULTIPLAYER_PLAN.md §4a) - each side's own position
  // should roughly match what the *other* side reports as the opponent's position.
  const hostOwnPosition = await hostPage.evaluate(() => window.__gameDebug?.getPlayerPosition());
  const guestOpponentPosition = await guestPage.evaluate(() => window.__gameDebug?.getOpponentPosition());
  expect(guestOpponentPosition).not.toBeNull();
  expect(guestOpponentPosition?.x).toBeCloseTo(hostOwnPosition?.x ?? NaN, 0);
  expect(guestOpponentPosition?.z).toBeCloseTo(hostOwnPosition?.z ?? NaN, 0);

  await lockPointer(hostPage);
  // The guest's own RemotePlayer damping only advances while the guest itself isn't paused (same
  // pause semantics as everything else in Game.update()) - both sides need to actually be playing,
  // not just the one that's moving, matching how two real players would both be unpaused.
  await lockPointer(guestPage);
  const opponentPositionBefore = await guestPage.evaluate(() => window.__gameDebug?.getOpponentPosition());

  // Move the host and confirm the guest's view of them actually updates - the real point of this
  // test: not just "a connection exists," but "movement on one side reaches the other."
  await holdKey(hostPage, 'KeyW', 1500);
  // Snapshots send at ~18Hz (PLAYER_SNAPSHOT_SEND_INTERVAL) and RemotePlayer smooths toward them
  // rather than snapping - give it a moment past the hold itself to catch up.
  await guestPage.waitForTimeout(500);

  const opponentPositionAfter = await guestPage.evaluate(() => window.__gameDebug?.getOpponentPosition());
  expect(opponentPositionAfter).not.toBeNull();
  if (!opponentPositionBefore || !opponentPositionAfter) throw new Error('expected opponent positions before and after moving');

  const dx = opponentPositionAfter.x - opponentPositionBefore.x;
  const dz = opponentPositionAfter.z - opponentPositionBefore.z;
  const moved = Math.sqrt(dx * dx + dz * dz);
  expect(moved).toBeGreaterThan(1);

  await hostContext.close();
  await guestContext.close();
});
