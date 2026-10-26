import { test, expect } from '@playwright/test';

test('a solo Night match on the Valley starts with the torch available and on', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.locator('#match-setup-weather').selectOption('night');
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 30000 });
  const torch = await page.evaluate(() => window.__gameDebug!.getTorchDebug());
  expect(torch).toEqual({ available: true, on: true, weather: 'night', facility: false });
});

test('the solo setup lists the three weathers and greys the choice out on the Facility', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const weather = page.locator('#match-setup-weather');
  await expect(weather.locator('option')).toHaveText(['Dusk', 'Night', 'Fog']);
  await expect(weather).toBeEnabled();
  await page.locator('#match-setup-map').selectOption('facility');
  await expect(weather).toBeDisabled();
  await page.locator('#match-setup-map').selectOption('valley');
  await expect(weather).toBeEnabled();
});
