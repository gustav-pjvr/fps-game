import { test, expect, type Page } from '@playwright/test';
import { lockPointer, waitForGameTime } from './helpers.ts';

test.use({ viewport: { width: 640, height: 360 } });

async function standAt(page: Page, point: { x: number; y: number; z: number }): Promise<void> {
  // Routes describe floors; teleport takes the capsule's centre.
  await page.evaluate(p => window.__gameDebug!.teleport(p.x, p.y + 1, p.z), point);
  await waitForGameTime(page, 1);
  const player = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  expect(Math.abs(player.y - point.y), `height at ${JSON.stringify(point)}: ${player.y}`).toBeLessThan(1.5);
}

test('a tower door blocks until opened, and its full lab supports descent and return at Dusk', async ({ page }) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.locator('#match-setup-map').selectOption('valley');
  await page.locator('#match-setup-weather').selectOption('day');
  await page.locator('#match-setup-enemies').fill('0');
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 30000 });
  await lockPointer(page);
  const lab = await page.evaluate(() => window.__gameDebug!.getUndergroundDebug().labs.find(l => l.kind === 'full'));
  expect(lab, 'a full lab exists').toBeDefined();
  if (!lab) throw new Error('no full lab');
  expect(await page.evaluate(() => window.__gameDebug!.getTorchDebug().weather)).toBe('day');

  const outside = { x: lab.x + 4.8, y: lab.groundY, z: lab.z };
  await standAt(page, outside);
  await page.evaluate(l => window.__gameDebug!.lookAt(l.x, l.groundY + 1.7, l.z), lab);
  await waitForGameTime(page, 0.25);
  const closed = await page.evaluate(() => window.__gameDebug!.raycastForward());
  expect(closed.hit).toBe(true);
  expect(closed.distance).toBeLessThan(2);
  await page.keyboard.down('KeyW');
  await waitForGameTime(page, 1);
  await page.keyboard.up('KeyW');
  expect((await page.evaluate(() => window.__gameDebug!.getPlayerPosition())).x).toBeGreaterThan(lab.x + 3);

  await standAt(page, outside);
  await page.evaluate(l => window.__gameDebug!.lookAt(l.x, l.groundY + 1.7, l.z), lab);
  await lockPointer(page);
  await waitForGameTime(page, 0.25);
  expect(await page.evaluate(() => window.__gameDebug!.facilityLookTarget())).toEqual({ kind: 'door', id: lab.doorId });
  await page.keyboard.press('KeyE');
  await waitForGameTime(page, 1);
  const opened = await page.evaluate(() => window.__gameDebug!.raycastForward());
  expect(opened.distance ?? Infinity).toBeGreaterThan(2);
  await page.keyboard.down('KeyW');
  await waitForGameTime(page, 0.65);
  await page.keyboard.up('KeyW');
  expect((await page.evaluate(() => window.__gameDebug!.getPlayerPosition())).x).toBeLessThan(lab.x + 3);

  for (const point of lab.route) await standAt(page, point);
  const bottom = await page.evaluate(() => window.__gameDebug!.getUndergroundDebug());
  expect(bottom.underground).toBe(true);
  expect(bottom.amount).toBe(1);
  expect(bottom.torchAvailable).toBe(true);
  const player = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  expect(Math.abs(player.y - lab.floorY)).toBeLessThan(1.5);

  for (const point of [...lab.route].reverse()) await standAt(page, point);
  await standAt(page, outside);
  const surface = await page.evaluate(() => window.__gameDebug!.getUndergroundDebug());
  expect(surface.underground).toBe(false);
  expect(surface.amount).toBe(0);
  expect(errors).toEqual([]);
});
