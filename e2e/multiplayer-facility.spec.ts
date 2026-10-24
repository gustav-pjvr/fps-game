import { test, expect, type Page } from '@playwright/test';
import { lockPointer } from './helpers.ts';

async function waitForFacility(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gameDebug?.getFacilityDebug?.() != null, undefined, { timeout: 60000 });
}

/** Both players build the identical facility from the shared match seed, and a lamp one player
 * shoots out goes dark for the other too (docs/facility-map.md sections 2 and 11). */
test('a multiplayer Facility match gives both players the same layout and shares shot-out lamps', async ({ browser }) => {
  // Creating, joining and starting a match takes about 50 s on SwiftShader (see the pause-damage spec).
  test.setTimeout(240000);

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  await hostPage.goto('/');
  await hostPage.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await hostPage.getByRole('button', { name: 'Create Room', exact: true }).click();
  await hostPage.locator('#create-room-map').selectOption('facility');

  const codeLocator = hostPage.locator('div').filter({ hasText: /^[A-Z2-9]{6}$/ }).last();
  await codeLocator.waitFor({ state: 'visible', timeout: 10000 });
  const code = await codeLocator.textContent();
  if (!code) throw new Error('room code never appeared');

  await guestPage.goto('/');
  await guestPage.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guestPage.getByPlaceholder('ABCDEF').fill(code);
  await guestPage.getByRole('button', { name: 'Join', exact: true }).click();
  await guestPage.getByRole('button', { name: 'Ready', exact: true }).click();
  const startButton = hostPage.getByRole('button', { name: 'Start Match', exact: true });
  await startButton.waitFor({ state: 'visible', timeout: 20000 });
  await startButton.click();

  await waitForFacility(hostPage);
  await waitForFacility(guestPage);
  await lockPointer(hostPage);
  await lockPointer(guestPage);

  const hostFacility = await hostPage.evaluate(() => window.__gameDebug!.getFacilityDebug()!);
  const guestFacility = await guestPage.evaluate(() => window.__gameDebug!.getFacilityDebug()!);
  expect(guestFacility.seed).toBe(hostFacility.seed);
  expect(guestFacility.rooms).toBe(hostFacility.rooms);
  expect(guestFacility.lamps).toBe(hostFacility.lamps);
  expect(guestFacility.openCells).toBe(hostFacility.openCells);

  await hostPage.evaluate(() => window.__gameDebug!.shootLamp(0));
  await expect.poll(() => hostPage.evaluate(() => window.__gameDebug!.getFacilityDebug()!.deadLamps)).toBe(1);
  await expect.poll(() => guestPage.evaluate(() => window.__gameDebug!.getFacilityDebug()!.deadLamps), { timeout: 15000 }).toBe(1);

  await hostContext.close();
  await guestContext.close();
});
