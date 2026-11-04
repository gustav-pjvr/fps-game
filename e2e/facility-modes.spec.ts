import { test, expect, type Page } from '@playwright/test';
import { lockPointer } from './helpers.ts';

// Goose Horde and the Uplink mission on the Facility (docs/facility-map.md, "Modes on the
// Facility"). Where things go is unit tested in src/world/facility/facilityModes.test.ts; this
// guards the wiring: the setup lets the mode run on the Facility and its pieces land inside it.

/** The Facility spans 84 m centred on the origin. */
const HALF_EXTENT = 42;

async function startFacilityMode(page: Page, mode: RegExp): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.locator('#match-setup-map').selectOption('facility');
  await page.getByRole('radio', { name: mode }).check();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug?.getFacilityDebug?.() != null, undefined, { timeout: 40000 });
  // Goose Horde opens on its mode briefing, which holds the world until skipped.
  const skip = page.getByRole('button', { name: /skip/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));
}

test('solo Goose Horde on the Facility starts a wave inside the walls, flyers under the ceiling', async ({ page }) => {
  test.setTimeout(120000);
  await startFacilityMode(page, /Goose Horde/);
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.getHordeDebug()?.geese.length ?? 0), { timeout: 30000 }).toBeGreaterThan(0);
  const horde = (await page.evaluate(() => window.__gameDebug!.getHordeDebug()))!;
  expect(horde.wave).toBe(1);
  for (const goose of horde.geese) {
    expect(Math.abs(goose.x), JSON.stringify(goose)).toBeLessThan(HALF_EXTENT);
    expect(Math.abs(goose.z), JSON.stringify(goose)).toBeLessThan(HALF_EXTENT);
    // The lowest ceiling is a corridor's 3.2 m.
    expect(goose.y, JSON.stringify(goose)).toBeLessThan(3.2);
  }
});

test('solo Uplink mission on the Facility puts four objectives inside it, marked on the map', async ({ page }) => {
  test.setTimeout(120000);
  await startFacilityMode(page, /Uplink mission/);
  const mission = (await page.evaluate(() => window.__gameDebug!.getMissionDebug()))!;
  expect(mission.phase).toBe('uplinks');
  const points = [...mission.uplinks, mission.extraction];
  expect(points).toHaveLength(4);
  expect(new Set(points.map((p) => `${p.x},${p.z}`)).size).toBe(4);
  for (const point of points) {
    expect(Math.abs(point.x)).toBeLessThan(HALF_EXTENT);
    expect(Math.abs(point.z)).toBeLessThan(HALF_EXTENT);
  }
  for (const label of ['A', 'B', 'C']) await expect(page.getByTestId(`minimap-marker-uplink-${label}`)).toBeAttached();
});
