import { test, expect, type Page } from '@playwright/test';
import { findFirstEnemyIndex, lockPointer, waitForGameReady } from './helpers.ts';

/**
 * Grenades (docs/grenades.md), solo on the default map, through the debug hooks. The player carries
 * the one kind the stored loadout names: a frag kills an enemy next to it and spends one from the
 * carry; a flash whites out a player looking at it and leaves one looking away from a far flash
 * clear.
 */

const LOADOUT_STORAGE_KEY = 'fps-game-loadout';

/** Starts a solo match whose stored loadout carries `grenade` (read once, at match start). */
async function startSolo(page: Page, grenade: 'frag' | 'flash'): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: LOADOUT_STORAGE_KEY, value: JSON.stringify({ primary: 'rifle', secondary: 'pistol', melee: 'knife', grenade }) },
  );
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));
  await page.waitForFunction(() => window.__gameDebug!.getGrenadeDebug()?.enabled === true, undefined, { timeout: 10000 });
  const carry = await page.evaluate(() => window.__gameDebug!.getGrenadeDebug()!);
  expect(carry.kind).toBe(grenade);
  expect(carry.count).toBe(2);
}

function liveEnemies(page: Page): Promise<number> {
  return page.evaluate(() => window.__gameDebug!.getLiveEntityArchetypes().filter((archetype) => archetype != null).length);
}

/** Turns the player to face -z, level, so the throws below are reproducible; returns that facing. */
async function forward(page: Page): Promise<{ x: number; z: number }> {
  const player = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  await page.evaluate(({ x, y, z }) => window.__gameDebug!.lookAt(x, y + 1.5, z - 20), player);
  return { x: 0, z: -1 };
}

test('a frag carrier throws a frag that kills the enemy beside it and spends one', async ({ page }) => {
  test.setTimeout(120000);
  await startSolo(page, 'frag');
  const before = await page.evaluate(() => window.__gameDebug!.getGrenadeDebug()!);
  expect(before.count).toBeGreaterThan(0);
  const enemiesBefore = await liveEnemies(page);
  expect(enemiesBefore).toBeGreaterThan(0);

  const aim = await forward(page);
  const id = await page.evaluate((direction) => window.__gameDebug!.throwGrenade(direction), { x: aim.x, y: -0.35, z: aim.z });
  expect(id).not.toBeNull();
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.getGrenadeDebug()!.count)).toBe(before.count - 1);

  // Keep an enemy pinned beside the grenade until it goes off (enemies walk; the frag rolls).
  const enemy = await findFirstEnemyIndex(page);
  await expect
    .poll(
      async () =>
        page.evaluate(
          ({ index, detonations }) => {
            const debug = window.__gameDebug!;
            const grenades = debug.getGrenadeDebug()!;
            const live = grenades.live[0];
            if (live) debug.placeEnemy(index, live.position.x + 0.8, live.position.z);
            return grenades.detonations > detonations;
          },
          { index: enemy, detonations: before.detonations },
        ),
      { timeout: 60000, intervals: [100] },
    )
    .toBe(true);

  const detonation = await page.evaluate(() => window.__gameDebug!.getGrenadeDebug()!.lastDetonation);
  expect(detonation?.kind).toBe('frag');
  await expect.poll(() => liveEnemies(page), { timeout: 20000 }).toBeLessThan(enemiesBefore);
});

/** Throws a flash along `direction` and, until it goes off, keeps the camera on it (`face`) or
 * turned away from it. Returns the highest blind level seen afterwards. */
async function flashAndWatch(page: Page, direction: { x: number; y: number; z: number }, face: boolean): Promise<number> {
  const before = await page.evaluate(() => window.__gameDebug!.getGrenadeDebug()!);
  const id = await page.evaluate((d) => window.__gameDebug!.throwGrenade(d), direction);
  expect(id).not.toBeNull();
  await expect
    .poll(
      async () =>
        page.evaluate(
          ({ detonations, face }) => {
            const debug = window.__gameDebug!;
            const grenades = debug.getGrenadeDebug()!;
            const live = grenades.live[0];
            if (live) {
              const eye = debug.getPlayerPosition();
              const p = live.position;
              // Facing: straight at it. Away: the opposite way, level.
              if (face) debug.lookAt(p.x, p.y, p.z);
              else debug.lookAt(2 * eye.x - p.x, eye.y + 1.5, 2 * eye.z - p.z);
            }
            return grenades.detonations > detonations;
          },
          { detonations: before.detonations, face },
        ),
      { timeout: 60000, intervals: [100] },
    )
    .toBe(true);
  const after = await page.evaluate(() => window.__gameDebug!.getGrenadeDebug()!);
  expect(after.lastDetonation?.kind).toBe('flash');
  expect(after.count).toBe(before.count - 1);
  return after.blindLevel;
}

test('a flash carrier throws a flash that whites out a player facing it, and not one facing away from a far one', async ({ page }) => {
  test.setTimeout(150000);
  await startSolo(page, 'flash');
  const aim = await forward(page);

  // Thrown at the ground a few metres ahead and watched: strongly blinded. (A flatter throw now
  // carries 15 m and more, over the brow of the spawn's slope and out of sight.)
  const facing = await flashAndWatch(page, { x: aim.x, y: -0.9, z: aim.z }, true);
  expect(facing).toBeGreaterThan(0.5);

  // Let the white-out clear (hold up to 3.5 s, fade up to 1.2 s of game time).
  await expect.poll(() => page.evaluate(() => window.__gameDebug!.getGrenadeDebug()!.blindLevel), { timeout: 60000 }).toBe(0);

  // Thrown long, with the player turned away: past about 11 m behind, too weak to blind.
  await forward(page);
  const away = await flashAndWatch(page, { x: aim.x, y: 0.15, z: aim.z }, false);
  expect(away).toBeLessThan(0.05);
});
