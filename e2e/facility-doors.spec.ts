import { test, expect, type Page } from '@playwright/test';
import { lockPointer } from './helpers.ts';

async function startFacilityMatch(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.locator('#match-setup-map').selectOption('facility');
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug?.getFacilityDebug?.() != null, undefined, { timeout: 40000 });
}

test('Facility doors block rays while closed and breakers preserve emergency lighting', async ({ page }) => {
  test.setTimeout(120000);
  await startFacilityMatch(page);
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));

  const target = await page.evaluate(() => {
    const debug = window.__gameDebug!, count = debug.getFacilityDebug()!.doors;
    for (let id = 0; id < count; id++) {
      const door = debug.facilityDoor(id)!;
      if (door.front) return { id, ...door, front: door.front };
    }
    throw new Error('No door has a walkable front');
  });
  await page.evaluate(({ front }) => window.__gameDebug!.teleport(front.x, 1, front.z), target);
  await expect.poll(() => page.evaluate(({ id }) => {
    const debug = window.__gameDebug!;
    debug.setFacilityDoor(id, false);
    return debug.facilityDoor(id)!.collider;
  }, target)).toBe(true);
  await page.evaluate(({ x, z }) => window.__gameDebug!.lookAt(x, 1.5, z), target);
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.facilityLookTarget())).toEqual({ kind: 'door', id: target.id });
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.raycastForward().distance ?? Infinity)).toBeLessThan(2.5);
  const closed = await page.evaluate(() => window.__gameDebug!.raycastForward().distance!);
  expect(closed).toBeGreaterThan(0.5);
  expect(await page.evaluate(({ id }) => window.__gameDebug!.setFacilityDoor(id, true), target)).toBe(true);
  await expect.poll(() => page.evaluate(({ id }) => window.__gameDebug!.facilityDoor(id)!.collider, target)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.raycastForward().distance ?? Infinity)).toBeGreaterThan(closed + 0.5);

  const zone = await page.evaluate(() => {
    const debug = window.__gameDebug!, count = debug.getFacilityDebug()!.breakers;
    for (let id = 0; id < count; id++) {
      const breaker = debug.facilityBreaker(id)!;
      if (breaker.emergencyLamps > 0 && breaker.panelLamps > 0) return { id, ...breaker };
    }
    throw new Error('No breaker zone has both panel and emergency lamps');
  });
  expect(zone.on).toBe(true);
  expect(zone.panelLampsLit).toBe(zone.panelLamps);
  expect(zone.emergencyLampsLit).toBe(zone.emergencyLamps);
  expect(await page.evaluate(({ id }) => window.__gameDebug!.setFacilityBreaker(id, false), zone)).toBe(true);
  await expect.poll(() => page.evaluate(({ id }) => window.__gameDebug!.facilityBreaker(id), zone)).toMatchObject({
    on: false, panelLampsLit: 0, emergencyLampsLit: zone.emergencyLamps,
  });
  expect(await page.evaluate(() => window.__gameDebug!.getFacilityDebug()!.breakersOff)).toBe(1);
  expect(await page.evaluate(({ id }) => window.__gameDebug!.setFacilityBreaker(id, true), zone)).toBe(true);
  await expect.poll(() => page.evaluate(({ id }) => window.__gameDebug!.facilityBreaker(id), zone)).toMatchObject({
    on: true, panelLampsLit: zone.panelLamps, emergencyLampsLit: zone.emergencyLamps,
  });
  expect(await page.evaluate(() => window.__gameDebug!.getFacilityDebug()!.breakersOff)).toBe(0);
});
