import { test, expect, type Page } from '@playwright/test';
import { WORLD_BOUNDARY_RADIUS } from '../src/core/config.ts';
import { lockPointer, waitForGameReady } from './helpers.ts';

/** Starts a single-player match on the Facility map (docs/facility-map.md) and waits until the
 * facility is built and baked. */
async function startFacilityMatch(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.locator('#match-setup-map').selectOption('facility');
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug?.getFacilityDebug?.() != null, undefined, { timeout: 40000 });
}

test('a health pack heals the player, reports taken, and returns after its timer (Facility)', async ({ page }) => {
  test.setTimeout(180000);
  await startFacilityMatch(page);
  await lockPointer(page);

  const start = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  const packs = await page.evaluate(() => window.__gameDebug!.getPickups().filter((pickup) => pickup.kind === 'health'));
  expect(packs.length).toBeGreaterThan(0);
  const pack = packs[0]!;
  expect(pack.available).toBe(true);

  // Hurt the player for real, and shorten the respawn so the test does not wait the 30 s.
  await page.evaluate(() => {
    window.__gameDebug!.setPlayerInvulnerable(false);
    window.__gameDebug!.setPickupRespawnSeconds(2);
    window.__gameDebug!.damagePlayer(50);
  });
  const hurt = await page.evaluate(() => window.__gameDebug!.getPlayerHealth());
  expect(hurt).toBeGreaterThan(0);
  expect(hurt).toBeLessThan(100);

  // Step onto the pack.
  await page.evaluate(({ x, y, z }) => window.__gameDebug!.teleport(x, y + 1, z), pack);
  await expect
    .poll(() => page.evaluate((id) => window.__gameDebug!.getPickups().find((pickup) => pickup.id === id)!.available, pack.id), { timeout: 60000 })
    .toBe(false);
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.getPlayerHealth()), { timeout: 30000 }).toBeGreaterThan(hurt);

  // Walk away (a player standing on a returned pack would just take it again), then wait it out.
  await page.evaluate(({ x, y, z }) => window.__gameDebug!.teleport(x, y, z), start);
  await expect
    .poll(() => page.evaluate((id) => window.__gameDebug!.getPickups().find((pickup) => pickup.id === id)!.available, pack.id), { timeout: 90000 })
    .toBe(true);
});

test('the Valley places about 16 pickups, all inside the world', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await waitForGameReady(page);
  const pickups = await page.evaluate(() => window.__gameDebug!.getPickups());
  expect(pickups.length).toBeGreaterThanOrEqual(10);
  expect(pickups.length).toBeLessThanOrEqual(16);
  for (const pickup of pickups) {
    expect(Math.hypot(pickup.x, pickup.z)).toBeLessThan(WORLD_BOUNDARY_RADIUS);
    expect(pickup.available).toBe(true);
  }
  // Grenades are not on yet (docs/pickups.md): the Valley mix is health and ammo only.
  expect(pickups.some((pickup) => pickup.kind === 'health')).toBe(true);
  expect(pickups.some((pickup) => pickup.kind === 'ammo')).toBe(true);
});
