import { test, expect } from '@playwright/test';
import { WORLD_HARD_CLAMP_RADIUS, WORLD_SOFT_PUSH_START_RADIUS } from '../src/core/config.ts';
import { lockPointer, waitForGameReady } from './helpers.ts';

/** Sprints the player straight toward the world boundary (WORLD_PLAN.md §2) long enough to reach
 * the soft-push zone and confirms the edge-safety net (config.ts's WORLD_SOFT_PUSH_START_RADIUS /
 * WORLD_HARD_CLAMP_RADIUS, wired in Player.ts) actually holds in a live game, not just on paper -
 * same verify-in-browser discipline as the rest of this project's bug history (see NOTES.md). */
test('player is held within the world boundary when sprinting straight at it', async ({ page }) => {
  test.setTimeout(220_000);

  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');

  // Poll in-browser rather than a fixed wall-clock wait - headless Chromium throttles rAF for
  // backgrounded/unfocused tabs, so simulated distance per real second isn't a fixed rate.
  await page.waitForFunction(
    (hardClampRadius) => {
      const p = window.__gameDebug?.getPlayerPosition();
      if (!p) return false;
      return Math.sqrt(p.x * p.x + p.z * p.z) > hardClampRadius - 2;
    },
    WORLD_HARD_CLAMP_RADIUS,
    { timeout: 200_000, polling: 500 },
  );

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
