import { expect, test, type Page } from '@playwright/test';
import { lockPointer, waitForGameReady, waitForGameTime } from './helpers.ts';

/** Gun handling in a real match (docs/gun-handling.md): what the shots a player actually fires come
 * to. One page, the default loadout (the VR-4 rifle in slot 1, the P9 pistol in slot 2). The rules
 * themselves are unit tested in src/weapons/gunHandling.test.ts. */

type Shot = ReturnType<NonNullable<Window['__gameDebug']>['getShotLog']>[number];
const shots = (page: Page): Promise<Shot[]> => page.evaluate(() => window.__gameDebug!.getShotLog());

/** Holds fire for `seconds` of game time and returns the shots that fired. */
async function hold(page: Page, seconds: number): Promise<Shot[]> {
  const before = (await shots(page)).length;
  await page.mouse.down();
  await waitForGameTime(page, seconds);
  await page.mouse.up();
  await waitForGameTime(page, 0.2);
  return (await shots(page)).slice(before);
}

test('a rifle burst climbs then settles, opens from the hip and tightens down the sights', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));

  // From the hip: a burst of automatic fire.
  const hip = await hold(page, 1.6);
  expect(hip.length, 'the rifle fired a burst').toBeGreaterThanOrEqual(9);
  expect(hip.every((shot) => shot.weaponId === 'rifle')).toBe(true);
  // The shots count up through the burst, and the first is a first shot.
  expect(hip[0]!.shotIndex).toBe(0);
  expect(hip.map((shot) => shot.shotIndex)).toEqual(hip.map((_, i) => i));
  // The first seven climb at full strength; after that the climb is the smaller, sustained one.
  expect(hip[0]!.kick).toBeCloseTo(0.0085, 5);
  expect(hip[6]!.kick).toBeCloseTo(hip[0]!.kick, 6);
  expect(hip[8]!.kick).toBeLessThan(hip[0]!.kick * 0.5);
  // The cone starts at the hip's and opens as the burst goes on.
  expect(hip[0]!.spread).toBeGreaterThan(0.02);
  expect(hip.at(-1)!.spread).toBeGreaterThan(hip[0]!.spread);
  expect(hip.at(-1)!.bloom).toBeGreaterThan(0);

  // A pause ends the burst: the next shot is a first shot again, with no bloom left.
  await waitForGameTime(page, 1);
  const again = await hold(page, 0.3);
  expect(again[0]!.shotIndex).toBe(0);
  expect(again[0]!.bloom).toBe(0);

  // Down the sights: the first shot goes where the sights point (a service rifle's 4 MOA), and
  // the kick is the shouldered one.
  await waitForGameTime(page, 1);
  await page.mouse.down({ button: 'right' });
  await waitForGameTime(page, 1);
  const aimed = await hold(page, 1.2);
  await page.mouse.up({ button: 'right' });
  expect(aimed[0]!.aim).toBeGreaterThan(0.95);
  expect(aimed[0]!.spread).toBeLessThan(0.0012);
  expect(aimed[0]!.kick).toBeLessThan(hip[0]!.kick);
  // Aimed sustained fire still opens up, but stays far inside the hip's cone.
  expect(aimed.at(-1)!.spread).toBeGreaterThan(aimed[0]!.spread);
  expect(aimed.at(-1)!.spread).toBeLessThan(hip[0]!.spread / 2);
});

test('the pistol kicks harder than the rifle shot for shot and does not spray on its own', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));
  await page.keyboard.press('Digit2');
  await page.waitForFunction(() => window.__gameDebug?.getWeaponName() === 'P9 Pistol', undefined, { timeout: 20000 });
  await waitForGameTime(page, 0.6);

  // Holding the trigger of a semi-automatic fires once.
  const held = await hold(page, 1);
  expect(held).toHaveLength(1);
  expect(held[0]).toMatchObject({ weaponId: 'pistol', shotIndex: 0 });
  expect(held[0]!.kick).toBeCloseTo(0.014, 5);
  expect(held[0]!.kick).toBeGreaterThan(0.0085);
  // From the hip the sidearm is handier than the rifle.
  expect(held[0]!.spread).toBeLessThan(0.02);
});
