import { test, expect, type Page } from '@playwright/test';
import type { PlayerLoadout } from '../src/core/gameModes.ts';
import { equipPistol, findFirstEnemyIndex, killPlayerByEnemy, lockPointer, openPauseMenu, SHIPPED_GRAPHICS, waitForGameReady } from './helpers.ts';

/** Same key core/loadout.ts persists the Loadout page's choice under (its STORAGE_KEY isn't
 * exported). Since v3.8.0 a default single-player match always resolves its weapons from this
 * stored loadout (see gameModes.ts resolveWeaponLoadout), falling back per slot to
 * LOADOUT_SLOT_DEFAULTS: slot 1 primary 'rifle', slot 2 secondary 'pistol', slot 3 melee 'knife'. */
const LOADOUT_STORAGE_KEY = 'fps-game-loadout';

/** The per-slot defaults, pinned explicitly rather than inherited from empty storage, for tests that
 * need a specific weapon in a specific slot. The weapon switching test is the one that deliberately
 * exercises the empty-storage default resolution instead. */
const STANDARD_LOADOUT: PlayerLoadout = { primary: 'rifle', secondary: 'pistol', melee: 'knife' };
const SNIPER_LOADOUT: PlayerLoadout = { primary: 'sniper', secondary: 'pistol', melee: 'knife' };

/** DEFAULT_TARGET_COUNT (5) + DEFAULT_ENEMY_COUNT (3) from config.ts, the lobby's default match. */
const DEFAULT_MATCH_ENTITY_COUNT = 8;

/** Pistol magazine and the rifle's, per weapons/definitions.ts. */
const PISTOL_MAGAZINE = 12;
const RIFLE_MAGAZINE = 30;

/** Upper bound on trigger pulls fireSemiAutoShot spends on landing one round, see its comment. */
const MAX_TRIGGER_PULLS = 6;

/** Generous wall-clock bound for "the game gets there eventually" polls. This sandbox renders with
 * software WebGL at roughly 2 FPS and Loop advances at most MAX_FRAME_TIME (0.25s) of game time per
 * frame, so game time runs at about half wall time here: a 1.2s pistol reload takes 2.4s+ of wall
 * time. Polls use this instead of the old 3s bounds, which were tuned for a real GPU. */
const SLOW_POLL_TIMEOUT = 15000;

/** Writes the given loadout before any page script runs, so Game.create()'s loadStoredLoadout()
 * reads it deterministically instead of whatever a previous session happened to leave behind. */
async function useLoadout(page: Page, loadout: PlayerLoadout): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: LOADOUT_STORAGE_KEY, value: JSON.stringify(loadout) },
  );
}

/** Resolves once at least `seconds` of GAME time has elapsed, measured the way core/Loop.ts
 * advances it: each animation frame contributes its real frame time clamped to MAX_FRAME_TIME
 * (0.25s). A fixed waitForTimeout silently shrinks every in-game interval in this slow sandbox, so a
 * key "held for 500ms" could span zero rendered frames and never be seen by a tick at all. The
 * game's own loop callback was registered before this one, so within any frame it runs first: by the
 * time this resolves, the game has simulated at least this much time since the call. */
async function waitForGameTime(page: Page, seconds: number): Promise<void> {
  await page.evaluate(
    (target) =>
      new Promise<void>((resolve) => {
        let elapsed = 0;
        let last: number | undefined;
        const step = (now: number): void => {
          if (last !== undefined) elapsed += Math.min((now - last) / 1000, 0.25);
          last = now;
          if (elapsed >= target) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    seconds,
  );
}

async function holdKeyForGameTime(page: Page, key: string, seconds: number): Promise<void> {
  await page.keyboard.down(key);
  await waitForGameTime(page, seconds);
  await page.keyboard.up(key);
}

async function readAmmo(page: Page): Promise<number> {
  return page.evaluate(() => window.__gameDebug?.getAmmo() ?? Number.NaN);
}

/** Fires exactly one round from a semi-automatic weapon. A click is only a queued just-pressed flag
 * (InputManager), and WeaponManager can legitimately eat it: consumed while the fireRate cooldown is
 * still running, or drained by fireLockedUntilRelease right after a weapon switch finishes. Once
 * 0.1s of game time has passed, a click has either fired or been consumed for good (a click queued
 * mid-switch is drained, never fired late), so re-pulling after that can never double-fire. The
 * caller's exact ammo assertions therefore still prove one round per click. */
async function fireSemiAutoShot(page: Page): Promise<void> {
  const before = await readAmmo(page);
  for (let pull = 0; pull < MAX_TRIGGER_PULLS; pull++) {
    await page.mouse.down();
    await page.mouse.up();
    await waitForGameTime(page, 0.1);
    if ((await readAmmo(page)) < before) return;
  }
  throw new Error(`${MAX_TRIGGER_PULLS} trigger pulls never spent a round (ammo stayed at ${before})`);
}

/** Rounds spent on one target before moving to the next: two landed pistol rounds (20 dmg each)
 * kill a 40 HP target, so a third covers one miss. */
const ROUNDS_PER_TARGET = 3;

/** Kills one live target (not an enemy: targets report no archetype) with single pistol rounds,
 * moving on to the next ring target if one doesn't die. Single-player randomizes the world seed every
 * match, so a tree, rock or building can sit between spawn and a given target: blindly aiming at
 * entity [0] once missed every round (measured: four confirmed rounds, score unchanged). Trying each
 * target in turn is simpler and more robust than probing line of sight first (the debug
 * raycastForward hook now excludes the player's own capsule, so it could serve that purpose if a
 * future test needs it). */
async function killReachableTarget(page: Page): Promise<void> {
  const scoreBefore = await page.evaluate(() => window.__gameDebug?.getScore() ?? 0);
  const { positions, archetypes } = await page.evaluate(() => ({
    positions: window.__gameDebug?.getLiveEntityPositions() ?? [],
    archetypes: window.__gameDebug?.getLiveEntityArchetypes() ?? [],
  }));

  for (let i = 0; i < positions.length; i++) {
    const target = positions[i];
    if (!target || archetypes[i] != null) continue;
    await page.evaluate(({ x, y, z }) => window.__gameDebug?.lookAt(x, y, z), target);
    // debugLookAt sets yaw/pitch; the camera quaternion only updates on the next fixed-timestep tick.
    await waitForGameTime(page, 0.1);

    for (let round = 0; round < ROUNDS_PER_TARGET; round++) {
      if ((await readAmmo(page)) <= 0) throw new Error('the magazine ran dry before any target died');
      await fireSemiAutoShot(page);
      if ((await page.evaluate(() => window.__gameDebug?.getScore() ?? 0)) > scoreBefore) return;
    }
  }
  // Every ring target surviving its rounds means the shots never left the spawn point. Observed
  // once: the camera faced a flat house wall filling the whole view (a procedurally placed house
  // on the fixed single-player spawn), which is a product bug, so it must fail loudly, not retry.
  const player = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  throw new Error(`no live target died after being shot from ${JSON.stringify(player)}; is spawn blocked by a structure?`);
}

// The full shipped render path (post-processing, shadows) is loaded once, here, at the default
// quality; the behaviour tests below run on Low (playwright.config.ts).
test.describe('at the shipped graphics quality', () => {
  test.use({ storageState: SHIPPED_GRAPHICS });

  test('loads without console errors and renders a canvas', { tag: '@quick' }, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await waitForGameReady(page);

    // The game's renderer canvas specifically (Renderer mounts it in #app, see main.ts): since v3.8.0
    // the lobby's Loadout page keeps its own character-preview canvas in the DOM as well, so a bare
    // 'canvas' locator matches two elements and trips Playwright's strict mode.
    await expect(page.locator('#app canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('pointer lock engages on click', { tag: '@quick' }, async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);

  await lockPointer(page);
  expect(await page.evaluate(() => window.__gameDebug?.isPointerLocked())).toBe(true);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeHidden();
});

test('WASD movement changes player position', { tag: '@quick' }, async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  const before = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  await holdKeyForGameTime(page, 'KeyW', 0.5);
  const after = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());

  expect(before).toBeDefined();
  expect(after).toBeDefined();
  const dx = (after?.x ?? 0) - (before?.x ?? 0);
  const dz = (after?.z ?? 0) - (before?.z ?? 0);
  const distanceMoved = Math.sqrt(dx * dx + dz * dz);
  expect(distanceMoved).toBeGreaterThan(0.5);
});

test('weapon switching changes the active weapon name', async ({ page }) => {
  // A trace (2026-10-23) showed every step completing at about 2 s per action, the last landing at
  // 30.1 s; it passed at 33.7 s the run before. Same slow-machine budget as its siblings.
  test.setTimeout(60000);
  // Nothing stored: this test is the one that covers the per-slot default resolution itself.
  await page.addInitScript((key) => window.localStorage.removeItem(key), LOADOUT_STORAGE_KEY);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  expect(await page.evaluate(() => window.__gameDebug?.getWeaponName())).toBe('VR-4 Fieldhand'); // slot 1, rifle

  // Weapon switch plays a holster/draw animation (WEAPON_SWITCH_DURATION) before the swap lands.
  await page.keyboard.press('Digit2');
  await page.waitForFunction(() => window.__gameDebug?.getWeaponName() === 'Kestrel P9', undefined, { timeout: SLOW_POLL_TIMEOUT });

  await page.keyboard.press('Digit3');
  await page.waitForFunction(() => window.__gameDebug?.getWeaponName() === 'Bicknell Trench Knife', undefined, {
    timeout: SLOW_POLL_TIMEOUT,
  });

  // A loadout has exactly three slots now, so the old "sniper on 4" key must do nothing. 0.5s of game
  // time covers the rest of the knife's draw plus the midpoint of a hypothetical fourth-slot switch.
  await page.keyboard.press('Digit4');
  await waitForGameTime(page, 0.5);
  expect(await page.evaluate(() => window.__gameDebug?.getWeaponName())).toBe('Bicknell Trench Knife');
});

test('assault rifle fires automatically while the trigger is held', async ({ page }) => {
  await useLoadout(page, STANDARD_LOADOUT);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  expect(await page.evaluate(() => window.__gameDebug?.getWeaponName())).toBe('VR-4 Fieldhand'); // slot 1
  expect(await readAmmo(page)).toBe(RIFLE_MAGAZINE);

  // One press, held: several rounds without repeated clicks proves the automatic path
  // (isActionActive vs consumeJustPressed). Polled rather than held for a fixed 550ms, because in
  // this sandbox a short hold can straddle few or no rendered frames; the rifle's 100ms cooldown
  // lands three rounds in 0.2s of game time once ticks actually run.
  await page.mouse.down();
  await page.waitForFunction((full) => (window.__gameDebug?.getAmmo() ?? full) <= full - 3, RIFLE_MAGAZINE, {
    timeout: SLOW_POLL_TIMEOUT,
  });
  await page.mouse.up();

  expect(await readAmmo(page)).toBeLessThanOrEqual(RIFLE_MAGAZINE - 3);
});

test('aiming down sights narrows the camera FOV and releasing restores it', async ({ page }) => {
  // The sniper, pinned via the stored loadout: its authored 15 degree scope zoom (adsFov in
  // weapons/definitions.ts) is unmistakable, and it proves a stored primary actually reaches slot 1.
  const sniperAdsFov = 15;
  await useLoadout(page, SNIPER_LOADOUT);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  expect(await page.evaluate(() => window.__gameDebug?.getWeaponName())).toBe('Marchand Longview');
  const hipFov = await page.evaluate(() => window.__gameDebug?.getCameraFov() ?? 0);
  expect(hipFov).toBeGreaterThan(sniperAdsFov + 5);

  await page.mouse.down({ button: 'right' });
  // Polled, not a fixed 500ms: ADS_LERP_SPEED settles in well under 0.5s of game time, but game time
  // runs far slower than wall time here.
  await page.waitForFunction((adsFov) => Math.abs((window.__gameDebug?.getCameraFov() ?? 0) - adsFov) < 1, sniperAdsFov, {
    timeout: SLOW_POLL_TIMEOUT,
  });

  await page.mouse.up({ button: 'right' });
  await page.waitForFunction((hip) => Math.abs((window.__gameDebug?.getCameraFov() ?? 0) - hip) < 1, hipFov, {
    timeout: SLOW_POLL_TIMEOUT,
  });
});

test('firing consumes ammo and reload refills it', async ({ page }) => {
  test.setTimeout(60000);
  await useLoadout(page, STANDARD_LOADOUT);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  // The pistol (slot 2), not the slot-1 rifle: semi-auto, so one click is exactly one round.
  await equipPistol(page);

  expect(await readAmmo(page)).toBe(PISTOL_MAGAZINE);

  await fireSemiAutoShot(page);
  expect(await readAmmo(page)).toBe(PISTOL_MAGAZINE - 1);

  await page.keyboard.press('KeyR');
  // Pistol reload time is 1.2s of game time per weapons/definitions.ts.
  await page.waitForFunction((full) => window.__gameDebug?.getAmmo() === full, PISTOL_MAGAZINE, { timeout: SLOW_POLL_TIMEOUT });
});

test('aiming at a live target and firing kills it and increases score', { tag: '@quick' }, async ({ page }) => {
  test.setTimeout(90000); // measured ~45s here: a slow load plus individually confirmed pistol rounds
  await useLoadout(page, STANDARD_LOADOUT);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  await equipPistol(page);

  const scoreBefore = await page.evaluate(() => window.__gameDebug?.getScore() ?? 0);
  const countBefore = await page.evaluate(() => window.__gameDebug?.getEntityCount() ?? 0);
  expect(countBefore).toBeGreaterThan(0);

  await killReachableTarget(page);

  await page.waitForFunction((before) => (window.__gameDebug?.getScore() ?? 0) > before, scoreBefore, { timeout: SLOW_POLL_TIMEOUT });
  expect(await page.evaluate(() => window.__gameDebug?.getEntityCount())).toBeLessThan(countBefore);
});

test('enemies wander near spawn instead of beelining when the player is far away', async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  // Enemies spawn on a radius-25 ring - at spawn the player is well outside every archetype's
  // detectionRange (max 20) from any of them. The enemy is found by archetype (targets report
  // none), not a hard-coded index tied to the default spawn order.
  const enemyIndex = await findFirstEnemyIndex(page);
  const positions = await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions());
  const enemyBefore = positions?.[enemyIndex];
  expect(enemyBefore).toBeDefined();
  if (!enemyBefore) throw new Error('expected a live enemy');

  // 3s of GAME time, not wall time: the drift bound below is derived from in-game speeds.
  await waitForGameTime(page, 3);

  const positionsAfter = await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions());
  const enemyAfter = positionsAfter?.[enemyIndex];
  expect(enemyAfter).toBeDefined();
  if (!enemyAfter) throw new Error('expected a live enemy after waiting');

  const dx = enemyAfter.x - enemyBefore.x;
  const dz = enemyAfter.z - enemyBefore.z;
  const drift = Math.sqrt(dx * dx + dz * dz);
  // Idle patrol moves at ENEMY_PATROL_SPEED (1.5 u/s) toward far-off destinations, covering at
  // most ~4.5 units in this window; the old always-chase behavior would have closed most of the
  // ~25 unit gap toward the stationary player by now.
  expect(drift).toBeLessThan(8);
});

test('pressing T resets ammo, entities, and score to a fresh state', async ({ page }) => {
  test.setTimeout(90000); // measured ~49s here: a slow load, confirmed pistol rounds, then a batched respawn
  await useLoadout(page, STANDARD_LOADOUT);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  await equipPistol(page);

  // This is a reset test, not a fight. At roughly 2 FPS it spends far more game time at spawn than
  // on a real GPU, and a death there releases pointer lock, so T never reaches InputManager. Once a
  // wandering enemy killed the player between the kill and the T press; since enemy AI v2 the pistol
  // shots bring the squad looking for the shooter, and at checkpoint D they killed the player while
  // it was still shooting targets. So the player is invulnerable until it has stepped well clear.
  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(true));

  // Kill one target to move score/entity-count off their initial values; the rounds spent doing so
  // move the pistol's magazine off full as well.
  await killReachableTarget(page);
  // Then step well clear of the enemy spawn ring, same as the auto-reload test. The reset under test
  // puts the player back at spawn regardless.
  await page.evaluate(() => window.__gameDebug?.teleport(250, 30, 250));
  // Real damage once clear, so restoring health stays part of what the reset is checked for.
  await page.evaluate(() => {
    window.__gameDebug?.setPlayerInvulnerable(false);
    window.__gameDebug?.damagePlayer(30);
  });
  await page.waitForFunction(() => (window.__gameDebug?.getPlayerHealth() ?? 100) <= 70, undefined, { timeout: SLOW_POLL_TIMEOUT });
  expect(
    await page.evaluate(() => window.__gameDebug?.getPlayerHealth()),
    'the player must still be alive for the T key to reach the game',
  ).toBeGreaterThan(0);

  const scoreBefore = await page.evaluate(() => window.__gameDebug?.getScore());
  const countBefore = await page.evaluate(() => window.__gameDebug?.getEntityCount());
  const ammoBefore = await readAmmo(page);
  expect(scoreBefore).toBeGreaterThan(0);
  expect(countBefore).toBeLessThan(DEFAULT_MATCH_ENTITY_COUNT);
  expect(ammoBefore).toBeLessThan(PISTOL_MAGAZINE);

  await page.keyboard.press('KeyT');
  // resetPlay refills ammo and zeroes the score in one go, but respawns entities in batches that
  // yield to requestAnimationFrame (spawnEncountersAsync), so the count is polled, not read once.
  await page.waitForFunction((full) => window.__gameDebug?.getAmmo() === full, PISTOL_MAGAZINE, { timeout: SLOW_POLL_TIMEOUT });
  await page.waitForFunction((count) => window.__gameDebug?.getEntityCount() === count, DEFAULT_MATCH_ENTITY_COUNT, {
    timeout: SLOW_POLL_TIMEOUT,
  });

  expect(await page.evaluate(() => window.__gameDebug?.getScore())).toBe(0);
  expect(await page.evaluate(() => window.__gameDebug?.getEntityCount())).toBe(DEFAULT_MATCH_ENTITY_COUNT);
  expect(await readAmmo(page)).toBe(PISTOL_MAGAZINE);
  expect(await page.evaluate(() => window.__gameDebug?.getPlayerHealth())).toBe(100);
});

test('firing an empty magazine auto-reloads without pressing R', async ({ page }) => {
  // Twelve individually confirmed pistol rounds at roughly 2 FPS take far longer than on a real GPU.
  test.setTimeout(120000);
  await useLoadout(page, STANDARD_LOADOUT);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  await equipPistol(page);

  // This test is about ammo/reload bookkeeping, not combat - teleport well clear of the enemy
  // spawn ring first. One real cause found and fixed separately (a new enemy archetype's detection
  // range exceeded the spawn ring radius, sniping a passive player from match start) - this
  // teleport removes combat as a variable entirely regardless of enemy tuning, since ammo/reload
  // has nothing to do with nearby enemies.
  await page.evaluate(() => window.__gameDebug?.teleport(250, 30, 250));

  expect(await readAmmo(page)).toBe(PISTOL_MAGAZINE);

  // Empty the magazine one confirmed semi-auto round at a time (fire rate 4/s -> 250ms cooldown).
  for (let i = 0; i < PISTOL_MAGAZINE; i++) {
    await fireSemiAutoShot(page);
  }
  expect(await readAmmo(page)).toBe(0);

  // One more trigger pull on an empty mag should start a reload automatically. A single click is
  // enough here: with the magazine empty, WeaponManager starts the reload even while the cooldown
  // is still running, so this pull cannot be eaten the way a live round can.
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction((full) => window.__gameDebug?.getAmmo() === full, PISTOL_MAGAZINE, { timeout: SLOW_POLL_TIMEOUT });
});

test('dying releases pointer lock and Respawn resets the match without leaving it', async ({ page }) => {
  // killPlayerByEnemy allows up to 90 GAME seconds (a kiting archetype); that deadline is the real
  // check. This wall-clock budget only has to outlast it: about 180 s in the half-speed sandbox, but
  // at checkpoint E a loaded machine ran slower still and 240 s ran out first, plus a slow load.
  test.setTimeout(400000);
  await useLoadout(page, STANDARD_LOADOUT);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  await killPlayerByEnemy(page);

  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === false, undefined, { timeout: SLOW_POLL_TIMEOUT });
  const deathScreen = page.getByTestId('death-screen');
  await expect(deathScreen.getByRole('button', { name: 'Respawn', exact: true })).toBeVisible();
  await expect(deathScreen.getByRole('button', { name: 'Return to Lobby', exact: true })).toBeVisible();

  await deathScreen.getByRole('button', { name: 'Respawn', exact: true }).click();

  await page.waitForFunction(() => window.__gameDebug?.getPlayerHealth() === 100, undefined, { timeout: SLOW_POLL_TIMEOUT });
  expect(await page.evaluate(() => window.__gameDebug?.getScore())).toBe(0);
  // Entities respawn in rAF-yielding batches (spawnEncountersAsync), so poll for the full count.
  await page.waitForFunction((count) => window.__gameDebug?.getEntityCount() === count, DEFAULT_MATCH_ENTITY_COUNT, {
    timeout: SLOW_POLL_TIMEOUT,
  });
  // Still the slot-1 rifle (nothing switched weapons), with a full magazine.
  expect(await page.evaluate(() => window.__gameDebug?.getWeaponName())).toBe('VR-4 Fieldhand');
  expect(await readAmmo(page)).toBe(RIFLE_MAGAZINE);
  // Respawn re-requests pointer lock as part of the same click, so play can continue immediately.
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, undefined, { timeout: SLOW_POLL_TIMEOUT });
});

test('Return to Lobby after death tears down the match and shows the lobby again', async ({ page }) => {
  // Measured 30.5 to 33.5 s here once the full-size characters (about 3 MB) joined the match load
  // (v4.0 phase 7): the 30 s default no longer leaves room. Same budget as its pause-menu siblings.
  test.setTimeout(60000);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  // This test is about the death screen's teardown UI flow, not combat - the debug damage hook
  // reaches the death screen in one tick instead of up to ~90s of staged real combat. The
  // genuine enemy-damages-player path stays covered by the Respawn death-flow test above, which
  // deliberately keeps killPlayerByEnemy.
  await page.evaluate(() => window.__gameDebug?.damagePlayer(999));
  await page.waitForFunction(() => window.__gameDebug?.getPlayerHealth() === 0, undefined, { timeout: SLOW_POLL_TIMEOUT });
  const deathScreen = page.getByTestId('death-screen');
  await expect(deathScreen.getByRole('button', { name: 'Return to Lobby', exact: true })).toBeVisible();

  await deathScreen.getByRole('button', { name: 'Return to Lobby', exact: true }).click();

  await page.waitForFunction(() => window.__gameDebug === undefined, undefined, { timeout: SLOW_POLL_TIMEOUT });
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible();
});

test('Escape opens the pause menu and freezes the game; Resume continues it', async ({ page }) => {
  // Measured at ~34s here with every assertion passing (a trace showed no step hanging, just ~1s per
  // Playwright action at roughly 2 FPS and ~5s for the Resume click), so the 30s default cut it off.
  // Then 56.4 s and a 60 s timeout on the next two runs (2026-10-23), with the full-size characters
  // loading: raised again.
  test.setTimeout(90000);
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
  // Holds are measured in game time so they are guaranteed to span real ticks in this slow sandbox.
  const duringPauseBefore = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  await holdKeyForGameTime(page, 'KeyW', 0.5);
  const duringPauseAfter = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  expect(duringPauseAfter).toEqual(duringPauseBefore);

  await pauseMenu.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, undefined, { timeout: SLOW_POLL_TIMEOUT });

  await holdKeyForGameTime(page, 'KeyW', 0.5);
  const afterResume = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
  expect(afterResume).not.toEqual(duringPauseAfter);
});

test('Reset Play in the pause menu resets the match and resumes play', async ({ page }) => {
  test.setTimeout(60000);
  await useLoadout(page, STANDARD_LOADOUT);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  await equipPistol(page);

  // Fire a shot so ammo/score have room to diverge from defaults before resetting.
  await fireSemiAutoShot(page);
  expect(await readAmmo(page)).toBe(PISTOL_MAGAZINE - 1);

  await openPauseMenu(page);
  const pauseMenu = page.getByTestId('pause-menu');
  await pauseMenu.getByRole('button', { name: 'Reset Play', exact: true }).click();

  await page.waitForFunction((full) => window.__gameDebug?.getAmmo() === full, PISTOL_MAGAZINE, { timeout: SLOW_POLL_TIMEOUT });
  expect(await page.evaluate(() => window.__gameDebug?.getScore())).toBe(0);
  // Entities respawn in rAF-yielding batches (spawnEncountersAsync), so poll for the full count.
  await page.waitForFunction((count) => window.__gameDebug?.getEntityCount() === count, DEFAULT_MATCH_ENTITY_COUNT, {
    timeout: SLOW_POLL_TIMEOUT,
  });
  // Reset Play re-requests pointer lock, same as the death screen's Respawn button. Timeout
  // widened from 3000 - now that vegetation density is much higher everywhere (not just inside
  // forest zones, per user request), the extra InstancedMesh/collider churn measurably slows
  // pointer-lock re-acquisition in this software-rendered sandbox specifically; the reset logic
  // itself (ammo/score/entities, asserted above) still completes well within the original window.
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, undefined, { timeout: SLOW_POLL_TIMEOUT });
});

test('Return to Lobby in the pause menu tears down the match and shows the lobby again', async ({ page }) => {
  // Measured 30.5 to 33.5 s here once the full-size characters (about 3 MB) joined the match load
  // (v4.0 phase 7): the 30 s default no longer leaves room. Same budget as its pause-menu siblings.
  test.setTimeout(60000);
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);

  await openPauseMenu(page);
  const pauseMenu = page.getByTestId('pause-menu');
  await pauseMenu.getByRole('button', { name: 'Return to Lobby', exact: true }).click();

  await page.waitForFunction(() => window.__gameDebug === undefined, undefined, { timeout: SLOW_POLL_TIMEOUT });
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible();
});
