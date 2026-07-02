import { test, expect } from '@playwright/test';
import { holdKey, lockPointer, waitForGameReady } from './helpers.ts';

test('loads without console errors and renders a canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await waitForGameReady(page);

  await expect(page.locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('pointer lock engages on click', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);

  await lockPointer(page);
  expect(await page.evaluate(() => window.__gameDebug?.isPointerLocked())).toBe(true);
  await expect(page.locator('#blocker')).toBeHidden();
});

test('WASD movement changes player position', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  const before = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  await holdKey(page, 'KeyW', 500);
  const after = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());

  expect(before).toBeDefined();
  expect(after).toBeDefined();
  const dx = (after?.x ?? 0) - (before?.x ?? 0);
  const dz = (after?.z ?? 0) - (before?.z ?? 0);
  const distanceMoved = Math.sqrt(dx * dx + dz * dz);
  expect(distanceMoved).toBeGreaterThan(0.5);
});

test('weapon switching changes the active weapon name', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  const initialWeapon = await page.evaluate(() => window.__gameDebug?.getWeaponName());
  expect(initialWeapon).toBe('Pistol');

  await page.keyboard.press('Digit2');
  // Weapon switch plays a holster/draw animation (WEAPON_SWITCH_DURATION) before the swap lands.
  await page.waitForFunction(() => window.__gameDebug?.getWeaponName() === 'Sniper Rifle', { timeout: 3000 });

  expect(await page.evaluate(() => window.__gameDebug?.getWeaponName())).toBe('Sniper Rifle');
});

test('firing consumes ammo and reload refills it', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  const fullAmmo = await page.evaluate(() => window.__gameDebug?.getAmmo());
  expect(fullAmmo).toBe(12); // pistol magazine size

  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);

  const afterShot = await page.evaluate(() => window.__gameDebug?.getAmmo());
  expect(afterShot).toBe(11);

  await page.keyboard.press('KeyR');
  // Pistol reload time is 1.2s per weapons/definitions.ts.
  await page.waitForFunction(() => window.__gameDebug?.getAmmo() === 12, { timeout: 3000 });
});

test('aiming at a live target and firing kills it and increases score', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  const scoreBefore = await page.evaluate(() => window.__gameDebug?.getScore());
  const countBefore = await page.evaluate(() => window.__gameDebug?.getEntityCount());
  expect(countBefore).toBeGreaterThan(0);

  const positions = await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions());
  const firstTarget = positions?.[0];
  expect(firstTarget).toBeDefined();
  if (!firstTarget) throw new Error('no live entities to aim at');

  await page.evaluate(
    ({ x, y, z }) => window.__gameDebug?.lookAt(x, y, z),
    { x: firstTarget.x, y: firstTarget.y, z: firstTarget.z },
  );
  // debugLookAt sets yaw/pitch; the camera quaternion only updates on the next fixed-timestep tick.
  await page.waitForTimeout(100);

  // Pistol deals 20 dmg, targets have 40 HP, fire rate is 4/s (250ms cooldown) - three spaced
  // shots comfortably guarantees at least two land.
  for (let i = 0; i < 3; i++) {
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
  }

  const scoreAfter = await page.evaluate(() => window.__gameDebug?.getScore());
  const countAfter = await page.evaluate(() => window.__gameDebug?.getEntityCount());

  expect(scoreAfter).toBeGreaterThan(scoreBefore ?? 0);
  expect(countAfter).toBeLessThan(countBefore ?? 0);
});
