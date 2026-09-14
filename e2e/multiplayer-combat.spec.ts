import { test, expect, type Page } from '@playwright/test';
import { equipPistol, lockPointer } from './helpers.ts';

declare global {
  interface Window {
    __gameDebug?: {
      getScore(): number;
      getPlayerHealth(): number;
      getPlayerPosition(): { x: number; y: number; z: number };
      getOpponentPosition(): { x: number; y: number; z: number } | null;
      lookAt(x: number, y: number, z: number): void;
      teleport(x: number, y: number, z: number): void;
    };
  }
}

async function waitForMatchReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
}

// Several candidate offsets to teleport the host to, relative to the opponent - see
// multiplayer-matchend.spec.ts's identical KILL_ATTEMPT_OFFSETS for why a single fixed offset
// isn't reliable: a fresh multiplayer seed generates different terrain/buildings around the same
// relative spot every run, and the world shrinking (WORLD_SIZE_CHUNKS 6 -> 4, see NOTES.md) packs
// obstructions closer to spawn than before, making this matter even for a close-range test like
// this one, not just the longer-range kill-limit test that originally needed it.
const APPROACH_OFFSETS: Array<[number, number]> = [
  [12, 0],
  [-12, 0],
  [0, 12],
  [0, -12],
];

/** Phase 3 of MULTIPLAYER_PLAN.md: fire/damage/death/respawn/score, all crossing the network for
 * real (two independent browser contexts, no mocking). Pistol deals 20 damage (100 max health) -
 * five landed shots kills.
 *
 * Uses the teleport debug hook to get the host near the opponent instead of actually walking
 * there: the two spawn points start 280 units apart with no guaranteed line of sight at that range
 * across real procedurally-generated terrain, and an earlier version of this test spent several
 * minutes fighting exactly that (zero hits firing from spawn - blocked terrain in between; then a
 * sprint-and-strafe approach loop that got stuck dead against an obstacle for dozens of iterations).
 * Whether a player can walk across the map at all is world-bounds.spec.ts's job, not this test's -
 * this one only needs to verify that damage/death/respawn/score actually cross the network
 * correctly once two players are in range of each other.
 *
 * Checks the guest's health *immediately* after firing, not after any extra diagnostic round-trips
 * - MULTIPLAYER_RESPAWN_DELAY is only 3 seconds, and an earlier version of this test padded enough
 * extra page.evaluate calls between the last shot and the health check that the auto-respawn had
 * already fired and reset health back to 100 before the assertion ever ran, timing out waiting for
 * a "dead" state that had already passed. Confirmed via temporary logging that the actual
 * damage/death sequence (100 -> 80 -> 60 -> 40 -> 20 -> 0) was always correct - the failure was
 * purely test overhead racing the respawn timer, not a product bug. */
test('shooting the opponent damages, kills, respawns, and scores across the network', async ({ browser }) => {
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

  expect(await hostPage.evaluate(() => window.__gameDebug?.getScore())).toBe(0);

  const opponentPosition = await hostPage.evaluate(() => window.__gameDebug?.getOpponentPosition());
  if (!opponentPosition) throw new Error('host has no opponent position yet');

  // Teleport a few units above and to the side of the opponent's own already-settled position (not
  // a freshly guessed terrain height) and let gravity bring the host down onto real ground -
  // teleporting straight down from a known-good spot avoids the project's known "teleport sideways
  // with a stale y goes stale" failure mode (see NOTES.md), and waiting for the fall to fully
  // settle *before* aiming avoids computing yaw/pitch against a position about to move out from
  // under it. Retries from a different side if a whole round of shots misses - see
  // APPROACH_OFFSETS's comment.
  let guestHealth = 100;
  for (const [offsetX, offsetZ] of APPROACH_OFFSETS) {
    await hostPage.evaluate(
      ({ x, y, z, dx, dz }) => window.__gameDebug?.teleport(x + dx, y + 8, z + dz),
      { ...opponentPosition, dx: offsetX, dz: offsetZ },
    );
    await hostPage.waitForTimeout(1000);

    await hostPage.evaluate(({ x, y, z }) => window.__gameDebug?.lookAt(x, y, z), opponentPosition);
    // debugLookAt sets yaw/pitch; the camera quaternion only updates on the next fixed-timestep tick.
    await hostPage.waitForTimeout(100);

    // Pistol deals 20 damage, fire rate is 4/s (250ms cooldown) - five spaced shots kills exactly
    // (100 max health); stops firing the instant health reaches 0 rather than always firing a fixed
    // count, so there's no extra delay between the killing shot and the health check below racing
    // the 3-second auto-respawn timer (see the class comment).
    guestHealth = 100;
    for (let i = 0; i < 6 && guestHealth > 0; i++) {
      await hostPage.mouse.down();
      await hostPage.mouse.up();
      await hostPage.waitForTimeout(300);
      guestHealth = (await guestPage.evaluate(() => window.__gameDebug?.getPlayerHealth())) ?? 100;
    }
    if (guestHealth <= 0) break;
  }

  // Health is authoritative on the guest's own client (MULTIPLAYER_PLAN.md §3/§6) - confirms the
  // damage actually reached and was applied there, not just that the host thinks it hit something.
  expect(guestHealth).toBeLessThanOrEqual(0);

  // The host only learns about the kill via the guest's own `playerDied` message - confirms that
  // round-trip actually happened, not just that the guest died locally.
  await hostPage.waitForFunction(() => (window.__gameDebug?.getScore() ?? 0) > 0, { timeout: 5000 });
  expect(await hostPage.evaluate(() => window.__gameDebug?.getScore())).toBe(1);

  // Auto-respawn (MULTIPLAYER_RESPAWN_DELAY) should bring the guest back to full health at its own
  // spawn point, without needing to click anything.
  await guestPage.waitForFunction(() => window.__gameDebug?.getPlayerHealth() === 100, { timeout: 8000 });
  const guestPositionAfterRespawn = await guestPage.evaluate(() => window.__gameDebug?.getPlayerPosition());
  expect(guestPositionAfterRespawn).not.toBeNull();

  // The host's view of the opponent should reflect the respawn (a `respawnEvent`, not a slow
  // interpolated slide back across the map) within the same timeframe.
  await hostPage.waitForFunction(
    (expected) => {
      const opponent = window.__gameDebug?.getOpponentPosition();
      if (!opponent || !expected) return false;
      const dx = opponent.x - expected.x;
      const dz = opponent.z - expected.z;
      return Math.sqrt(dx * dx + dz * dz) < 5;
    },
    guestPositionAfterRespawn,
    { timeout: 5000 },
  );

  await hostContext.close();
  await guestContext.close();
});
