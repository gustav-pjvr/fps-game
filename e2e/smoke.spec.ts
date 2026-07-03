import { test, expect } from '@playwright/test';
import { holdKey, killPlayerByEnemy, lockPointer, openPauseMenu, waitForGameReady } from './helpers.ts';

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
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeHidden();
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
  expect(initialWeapon).toBe('Kestrel P9'); // pistol

  // Loadout order is pistol, rifle, shotgun, sniper (Game.create's definitionIds list).
  await page.keyboard.press('Digit4');
  // Weapon switch plays a holster/draw animation (WEAPON_SWITCH_DURATION) before the swap lands.
  await page.waitForFunction(() => window.__gameDebug?.getWeaponName() === 'Marchand Longview', { timeout: 3000 });

  expect(await page.evaluate(() => window.__gameDebug?.getWeaponName())).toBe('Marchand Longview'); // sniper
});

test('assault rifle fires automatically while the trigger is held', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  await page.keyboard.press('Digit2');
  await page.waitForFunction(() => window.__gameDebug?.getWeaponName() === 'VR-4 Fieldhand', { timeout: 3000 });

  const fullAmmo = await page.evaluate(() => window.__gameDebug?.getAmmo());
  expect(fullAmmo).toBe(30);

  // Rifle fire rate is 10/s (100ms cooldown) - holding for 550ms should land several shots
  // without repeated clicks, proving the automatic path (isActionActive vs consumeJustPressed).
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.up();

  const ammoAfter = await page.evaluate(() => window.__gameDebug?.getAmmo());
  expect(ammoAfter).toBeLessThan(fullAmmo ?? 30);
  expect(ammoAfter).toBeLessThanOrEqual((fullAmmo ?? 30) - 3);
});

test('aiming down sights narrows the camera FOV and releasing restores it', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  const hipFov = await page.evaluate(() => window.__gameDebug?.getCameraFov());

  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(500); // ADS_LERP_SPEED settles well within 500ms
  const adsFov = await page.evaluate(() => window.__gameDebug?.getCameraFov());
  expect(adsFov ?? 999).toBeLessThan((hipFov ?? 0) - 5);

  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  const releasedFov = await page.evaluate(() => window.__gameDebug?.getCameraFov());
  expect(Math.abs((releasedFov ?? 0) - (hipFov ?? 0))).toBeLessThan(1);
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

test('enemies wander near spawn instead of beelining when the player is far away', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  // Encounters spawn 5 targets (radius 15) then 3 enemies (radius 25) - index 5 is an enemy,
  // and at spawn the player is well outside ENEMY_DETECTION_RANGE (18) from any of them.
  const positions = await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions());
  const enemyBefore = positions?.[5];
  expect(enemyBefore).toBeDefined();
  if (!enemyBefore) throw new Error('expected an enemy at index 5');

  await page.waitForTimeout(3000);

  const positionsAfter = await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions());
  const enemyAfter = positionsAfter?.[5];
  expect(enemyAfter).toBeDefined();
  if (!enemyAfter) throw new Error('expected an enemy at index 5 after waiting');

  const dx = enemyAfter.x - enemyBefore.x;
  const dz = enemyAfter.z - enemyBefore.z;
  const drift = Math.sqrt(dx * dx + dz * dz);
  // Idle wander stays within ENEMY_WANDER_RADIUS (6) of spawn; the old always-chase behavior
  // would have closed most of the ~25 unit gap toward the stationary player by now.
  expect(drift).toBeLessThan(8);
});

test('pressing T resets ammo, entities, and score to a fresh state', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  // Kill one target to move score/entity-count off their initial values.
  const target = (await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions()))?.[0];
  expect(target).toBeDefined();
  if (!target) throw new Error('no live entities to aim at');
  await page.evaluate(({ x, y, z }) => window.__gameDebug?.lookAt(x, y, z), target);
  await page.waitForTimeout(100);
  for (let i = 0; i < 2; i++) {
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);

  const scoreBefore = await page.evaluate(() => window.__gameDebug?.getScore());
  const countBefore = await page.evaluate(() => window.__gameDebug?.getEntityCount());
  const ammoBefore = await page.evaluate(() => window.__gameDebug?.getAmmo());
  expect(scoreBefore).toBeGreaterThan(0);
  expect(countBefore).toBeLessThan(8);
  expect(ammoBefore).toBeLessThan(12);

  await page.keyboard.press('KeyT');
  await page.waitForTimeout(100);

  expect(await page.evaluate(() => window.__gameDebug?.getScore())).toBe(0);
  expect(await page.evaluate(() => window.__gameDebug?.getEntityCount())).toBe(8);
  expect(await page.evaluate(() => window.__gameDebug?.getAmmo())).toBe(12);
  expect(await page.evaluate(() => window.__gameDebug?.getPlayerHealth())).toBe(100);
});

test('firing an empty magazine auto-reloads without pressing R', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  const fullAmmo = await page.evaluate(() => window.__gameDebug?.getAmmo());
  expect(fullAmmo).toBe(12); // pistol magazine size

  // Empty the magazine with spaced semi-auto clicks (fire rate 4/s -> 250ms cooldown).
  for (let i = 0; i < 12; i++) {
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(260);
  }
  expect(await page.evaluate(() => window.__gameDebug?.getAmmo())).toBe(0);

  // One more trigger pull on an empty mag should start a reload automatically.
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => window.__gameDebug?.getAmmo() === 12, { timeout: 3000 });
});

test('dying releases pointer lock and Respawn resets the match without leaving it', async ({ page }) => {
  test.setTimeout(60000); // killPlayerByEnemy waits on real combat timing, longer than the 30s default
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  await killPlayerByEnemy(page);

  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === false, { timeout: 3000 });
  const deathScreen = page.getByTestId('death-screen');
  await expect(deathScreen.getByRole('button', { name: 'Respawn', exact: true })).toBeVisible();
  await expect(deathScreen.getByRole('button', { name: 'Return to Lobby', exact: true })).toBeVisible();

  await deathScreen.getByRole('button', { name: 'Respawn', exact: true }).click();

  await page.waitForFunction(() => window.__gameDebug?.getPlayerHealth() === 100, { timeout: 3000 });
  expect(await page.evaluate(() => window.__gameDebug?.getScore())).toBe(0);
  expect(await page.evaluate(() => window.__gameDebug?.getEntityCount())).toBe(8);
  expect(await page.evaluate(() => window.__gameDebug?.getAmmo())).toBe(12);
  // Respawn re-requests pointer lock as part of the same click, so play can continue immediately.
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, { timeout: 3000 });
});

test('Return to Lobby after death tears down the match and shows the lobby again', async ({ page }) => {
  test.setTimeout(60000); // killPlayerByEnemy waits on real combat timing, longer than the 30s default
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  await killPlayerByEnemy(page);
  const deathScreen = page.getByTestId('death-screen');
  await expect(deathScreen.getByRole('button', { name: 'Return to Lobby', exact: true })).toBeVisible();

  await deathScreen.getByRole('button', { name: 'Return to Lobby', exact: true }).click();

  await page.waitForFunction(() => window.__gameDebug === undefined, { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible();
});

test('Escape opens the pause menu and freezes the game; Resume continues it', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  await openPauseMenu(page);

  const pauseMenu = page.getByTestId('pause-menu');
  await expect(pauseMenu.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(pauseMenu.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(pauseMenu.getByRole('button', { name: 'Reset Play', exact: true })).toBeVisible();
  await expect(pauseMenu.getByRole('button', { name: 'Return to Lobby', exact: true })).toBeVisible();

  // Capture position only once pause has actually taken effect (not before openPauseMenu resolves) -
  // otherwise ordinary physics settling in the gap before pause engages reads as false movement.
  const duringPauseBefore = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  await holdKey(page, 'KeyW', 500);
  const duringPauseAfter = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  expect(duringPauseAfter).toEqual(duringPauseBefore);

  await pauseMenu.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, { timeout: 3000 });

  await holdKey(page, 'KeyW', 500);
  const afterResume = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  expect(afterResume).not.toEqual(duringPauseAfter);
});

test('Reset Play in the pause menu resets the match and resumes play', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  // Fire a shot so ammo/score have room to diverge from defaults before resetting.
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__gameDebug?.getAmmo())).toBe(11);

  await openPauseMenu(page);
  const pauseMenu = page.getByTestId('pause-menu');
  await pauseMenu.getByRole('button', { name: 'Reset Play', exact: true }).click();

  await page.waitForFunction(() => window.__gameDebug?.getAmmo() === 12, { timeout: 3000 });
  expect(await page.evaluate(() => window.__gameDebug?.getScore())).toBe(0);
  expect(await page.evaluate(() => window.__gameDebug?.getEntityCount())).toBe(8);
  // Reset Play re-requests pointer lock, same as the death screen's Respawn button.
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, { timeout: 3000 });
});

test('Return to Lobby in the pause menu tears down the match and shows the lobby again', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  await openPauseMenu(page);
  const pauseMenu = page.getByTestId('pause-menu');
  await pauseMenu.getByRole('button', { name: 'Return to Lobby', exact: true }).click();

  await page.waitForFunction(() => window.__gameDebug === undefined, { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible();
});
