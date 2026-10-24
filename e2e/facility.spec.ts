import { test, expect, type Page } from '@playwright/test';
import { lockPointer } from './helpers.ts';

/** Starts a single-player match on the Facility map (docs/facility-map.md) and waits until the
 * facility is built and baked. */
async function startFacilityMatch(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.locator('#match-setup-map').selectOption('facility');
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug?.getFacilityDebug?.() != null, undefined, { timeout: 40000 });
}

test('the Facility builds a fresh lit layout with the torch on and the plan on the map', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await startFacilityMatch(page);
  await lockPointer(page);
  const facility = await page.evaluate(() => window.__gameDebug!.getFacilityDebug()!);
  expect(facility.map).toBe('facility');
  expect(facility.rooms).toBeGreaterThanOrEqual(10);
  expect(facility.lamps).toBeGreaterThan(20);
  expect(facility.vertexCount).toBeLessThan(140000);
  expect(facility.torchOn).toBe(true);
  await expect(page.getByTestId('facility-map')).toBeVisible();

  // F toggles the torch.
  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.getFacilityDebug()!.torchOn)).toBe(false);
  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.getFacilityDebug()!.torchOn)).toBe(true);

  // Enemies were placed inside the facility, not on the outdoor rings.
  const positions = await page.evaluate(() => window.__gameDebug!.getLiveEntityPositions());
  expect(positions.length).toBeGreaterThan(0);
  for (const position of positions) {
    expect(Math.abs(position.x)).toBeLessThan(42);
    expect(Math.abs(position.z)).toBeLessThan(42);
  }

  expect(errors).toEqual([]);
});

test('shooting a ceiling lamp puts it out', async ({ page }) => {
  test.setTimeout(120000);
  await startFacilityMatch(page);
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));

  // Stand under a lamp and fire straight up at it with the starting rifle.
  const lamp = await page.evaluate(() => window.__gameDebug!.lampPosition(0));
  if (!lamp) throw new Error('the facility has no lamp 0');
  await page.evaluate(({ x, z }) => window.__gameDebug!.teleport(x, 1, z), lamp);
  await page.waitForTimeout(500);
  await page.evaluate(({ x, y, z }) => window.__gameDebug!.lookAt(x + 0.001, y, z), lamp);
  await page.waitForTimeout(200);
  for (let shot = 0; shot < 4; shot++) {
    if ((await page.evaluate(() => window.__gameDebug!.getFacilityDebug()!.deadLamps)) > 0) break;
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.getFacilityDebug()!.deadLamps)).toBe(1);
});
