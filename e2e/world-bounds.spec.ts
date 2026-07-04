import { test, expect } from '@playwright/test';
import { WORLD_HARD_CLAMP_RADIUS, WORLD_SOFT_PUSH_START_RADIUS } from '../src/core/config.ts';
import { lockPointer, waitForGameReady } from './helpers.ts';

/** Sprints the player straight toward the world boundary (WORLD_PLAN.md §2) long enough to reach
 * the soft-push zone and confirms the edge-safety net (config.ts's WORLD_SOFT_PUSH_START_RADIUS /
 * WORLD_HARD_CLAMP_RADIUS, wired in Player.ts) actually holds in a live game, not just on paper -
 * same verify-in-browser discipline as the rest of this project's bug history (see NOTES.md). */
test('player is held within the world boundary when sprinting straight at it', async ({ page }) => {
  test.setTimeout(320_000);

  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');

  // Towns are now guaranteed to exist and are large, so a fixed heading has real odds of running
  // straight into a building's flat wall face - and holding pure forward with zero strafe against
  // a wall exactly perpendicular to travel direction correctly slides to a near-standstill (there's
  // no tangential input component to slide along). That's correct player-controller behavior, not a
  // bug: a real player would just strafe around it. So this polls progress and nudges sideways
  // (alternating direction so it doesn't just oscillate into a corner) whenever forward progress
  // stalls, the same way a real player would route around an obstacle in their path.
  const deadline = Date.now() + 300_000;
  let lastPosition = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  let stuckStrikes = 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const position = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
    if (!position) break;

    const horizontalDistance = Math.sqrt(position.x * position.x + position.z * position.z);
    if (horizontalDistance > WORLD_HARD_CLAMP_RADIUS - 2) break;

    const progress = lastPosition ? Math.hypot(position.x - lastPosition.x, position.z - lastPosition.z) : Infinity;
    if (progress < 2) {
      stuckStrikes++;
      const strafeKey = stuckStrikes % 2 === 0 ? 'KeyD' : 'KeyA';
      await page.keyboard.down(strafeKey);
      await page.waitForTimeout(1200);
      await page.keyboard.up(strafeKey);
    } else {
      stuckStrikes = 0;
    }
    lastPosition = position;
  }

  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');

  const position = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  expect(position).toBeDefined();

  const horizontalDistance = Math.sqrt((position?.x ?? 0) ** 2 + (position?.z ?? 0) ** 2);

  // Must have actually reached the push zone - otherwise this test isn't exercising the safety net at all.
  expect(horizontalDistance).toBeGreaterThan(WORLD_SOFT_PUSH_START_RADIUS);
  // Must never cross the hard clamp (small epsilon for the single frame the clamp is applied on).
  expect(horizontalDistance).toBeLessThanOrEqual(WORLD_HARD_CLAMP_RADIUS + 1);
  // Must not have fallen through the world (no collider exists past the boundary).
  expect(position?.y ?? -9999).toBeGreaterThan(-50);
});
