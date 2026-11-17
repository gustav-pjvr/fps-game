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

test('solo Operation Uplink on the Facility puts its four sites inside it, marked on the map stage by stage', async ({ page }) => {
  test.setTimeout(180000);
  await startFacilityMode(page, /Operation Uplink/);
  const mission = (await page.evaluate(() => window.__gameDebug!.getMissionDebug()))!;
  expect(mission.phase).toBe('breach');
  const points = [mission.sites.breach, mission.sites.core, mission.sites.relay, mission.sites.extraction];
  expect(new Set(points.map((p) => `${p.x},${p.z}`)).size).toBe(4);
  for (const point of points) {
    expect(Math.abs(point.x)).toBeLessThan(HALF_EXTENT);
    expect(Math.abs(point.z)).toBeLessThan(HALF_EXTENT);
  }
  // Indoors the core rests on a console in a far room, not underground, under the room's ceiling.
  expect(mission.core.underground).toBe(false);
  expect(mission.corePosition.y).toBeGreaterThan(1);
  expect(mission.corePosition.y).toBeLessThan(3.2);

  // The map marks where each stage sends the player: the terminal, then the core and the relay,
  // then the relay alone, then the extraction.
  const marker = (id: string) => page.getByTestId(`minimap-marker-${id}`);
  const nextStage = () => page.evaluate(() => window.__gameDebug!.completeMissionStage());
  await expect(marker('terminal')).toBeAttached();
  await expect(marker('relay')).not.toBeAttached();
  await nextStage();
  await expect(marker('core')).toBeAttached();
  await expect(marker('relay')).toBeAttached();
  await expect(marker('terminal')).not.toBeAttached();
  await nextStage();
  await expect(marker('relay')).toBeAttached();
  await expect(marker('core')).not.toBeAttached();
  await nextStage();
  await expect(marker('extract')).toBeAttached();
  await expect(marker('relay')).not.toBeAttached();
});
