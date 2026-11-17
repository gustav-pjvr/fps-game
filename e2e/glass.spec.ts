import { test, expect, type Page } from '@playwright/test';
import { equipPistol, lockPointer, waitForGameReady, waitForGameTime } from './helpers.ts';

/** The glass in the Valley houses' windows (docs/glass.md), solo: a shot leaves a hole where it
 * struck, enough shots break the pane, a broken window stays broken when its house streams out and
 * back, an intact pane stops a thrown grenade and the frag's blast breaks it. */

type Glass = NonNullable<ReturnType<NonNullable<Window['__gameDebug']>['getGlassDebug']>>;
type Pane = Glass['panes'][number];

const glass = (page: Page, radius?: number): Promise<Glass> =>
  page.evaluate((r) => window.__gameDebug!.getGlassDebug(r)!, radius);
const paneNow = async (page: Page, id: number): Promise<Pane | undefined> => (await glass(page)).panes.find((pane) => pane.id === id);

/** A solo Valley match, the player invulnerable, standing outside a ground-floor window with a
 * clear line through it: returns the pane and where the player stands. */
async function standAtWindow(page: Page, distance: number): Promise<{ pane: Pane; stand: { x: number; y: number; z: number }; house: { x: number; z: number } }> {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));
  await expect.poll(async () => (await page.evaluate(() => window.__gameDebug!.getGlassDebug()))?.streamed ?? 0, { timeout: 60000 }).toBeGreaterThan(0);

  const houses = await page.evaluate(() => window.__gameDebug!.getValleyHouses());
  const player = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  const all = (await glass(page)).panes;
  // Ground-floor windows only (the block's upper ones are out of a standing player's reach), nearest first.
  const candidates = all
    .map((pane) => {
      const house = houses.slice().sort((a, b) => Math.hypot(a.x - pane.x, a.z - pane.z) - Math.hypot(b.x - pane.x, b.z - pane.z))[0]!;
      return { pane, ground: house.y, house: { x: house.x, z: house.z } };
    })
    .filter(({ pane, ground }) => pane.y - ground < 2.4)
    .sort((a, b) => Math.hypot(a.pane.x - player.x, a.pane.z - player.z) - Math.hypot(b.pane.x - player.x, b.pane.z - player.z));
  expect(candidates.length).toBeGreaterThan(0);

  for (const { pane, ground, house } of candidates.slice(0, 8)) {
    const stand = { x: pane.x + pane.nx * distance, y: ground + 1.2, z: pane.z + pane.nz * distance };
    await page.evaluate(({ x, y, z }) => window.__gameDebug!.teleport(x, y, z), stand);
    await page.waitForTimeout(700);
    await page.evaluate(({ x, y, z }) => window.__gameDebug!.lookAt(x, y, z), { x: pane.x, y: pane.y, z: pane.z });
    await page.waitForTimeout(300);
    const at = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
    const ray = await page.evaluate(() => window.__gameDebug!.raycastForward());
    // Standing where intended, and nothing solid between the eye and the far side of the pane.
    const placed = Math.hypot(at.x - stand.x, at.z - stand.z) < 0.6;
    if (placed && (!ray.hit || (ray.distance ?? 0) > distance + 0.3)) return { pane, stand, house };
  }
  throw new Error('no window with a clear line to it was found near the spawn');
}

/** One round at the pane's centre. Aimed again every time: recoil walks the sights off a window. */
async function fireOnce(page: Page, pane: Pane): Promise<void> {
  await page.evaluate(({ x, y, z }) => window.__gameDebug!.lookAt(x, y, z), { x: pane.x, y: pane.y, z: pane.z });
  await page.mouse.down();
  await page.mouse.up();
  await waitForGameTime(page, 0.45);
}

test('a shot holes a window where it struck, more shots break it, and it stays broken through streaming', async ({ page }) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const { pane, house } = await standAtWindow(page, 3.5);
  await equipPistol(page);
  expect((await paneNow(page, pane.id))?.damage).toBe(0);
  const voicesBefore = (await page.evaluate(() => window.__gameDebug!.getSoundDebug())).voices.opened;

  // One pistol round: one hole, inside the pane, near where the round was aimed (its centre).
  await fireOnce(page, pane);
  await expect.poll(async () => (await paneNow(page, pane.id))?.damage, { timeout: 10000 }).toBe(1);
  const holed = (await paneNow(page, pane.id))!;
  expect(holed.broken).toBe(false);
  expect(holed.holes).toHaveLength(2);
  expect(Math.abs(holed.holes[0]!)).toBeLessThan(pane.halfWidth);
  expect(Math.abs(holed.holes[1]!)).toBeLessThan(pane.halfHeight);
  expect(Math.hypot(holed.holes[0]!, holed.holes[1]!)).toBeLessThan(0.3);
  // The hit was heard: the engine opened positioned voices for the shot's impact and the glass.
  expect((await page.evaluate(() => window.__gameDebug!.getSoundDebug())).voices.opened).toBeGreaterThan(voicesBefore);

  // Six pistol rounds break a pane (docs/glass.md); a few spare for a round that strays off it.
  for (let shot = 0; shot < 12 && !(await paneNow(page, pane.id))!.broken; shot++) await fireOnce(page, pane);
  const broken = (await paneNow(page, pane.id))!;
  expect(broken.broken).toBe(true);
  expect(broken.holes).toHaveLength(0);
  expect((await glass(page)).drawn.lying).toBeGreaterThan(0);

  // The house streams out and back in (its chunk unloaded and loaded again through the real
  // streaming path; the world is too small for that to happen by walking): the window is still open.
  const before = (await glass(page)).streamed;
  const gone = await page.evaluate(({ at, id }) => {
    const debug = window.__gameDebug!;
    const unloaded = debug.restreamChunkAt(at.x, at.z);
    // Read in the same turn, before a tick can load the chunk again.
    const now = debug.getGlassDebug()!;
    return { unloaded, streamed: now.streamed, stillThere: now.panes.some((pane) => pane.id === id) };
  }, { at: house, id: pane.id });
  expect(gone.unloaded).toBe(true);
  expect(gone.stillThere, 'the pane left the world with its house').toBe(false);
  expect(gone.streamed).toBeLessThan(before);
  await expect.poll(async () => (await glass(page)).streamed, { timeout: 60000 }).toBe(before);
  await expect.poll(async () => (await paneNow(page, pane.id))?.broken, { timeout: 60000 }).toBe(true);
  expect((await glass(page)).drawn.lying).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('an intact window stops a thrown grenade and the frag breaks it', async ({ page }) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const { pane } = await standAtWindow(page, 4);
  const eye = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  const aim = { x: pane.x - eye.x, y: pane.y - eye.y + 0.25, z: pane.z - eye.z };
  const length = Math.hypot(aim.x, aim.y, aim.z);
  const id = await page.evaluate((d) => window.__gameDebug!.throwGrenade(d), { x: aim.x / length, y: aim.y / length, z: aim.z / length });
  expect(id).not.toBeNull();

  // Until it goes off the grenade never gets through the pane: it stays on the outside of the plane.
  let deepest = Infinity, samples = 0;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const debug = await page.evaluate(() => window.__gameDebug!.getGrenadeDebug());
    const live = debug?.live.find((grenade) => grenade.id === id);
    if (!live) break;
    const state = await paneNow(page, pane.id);
    if (state && !state.broken) {
      deepest = Math.min(deepest, (live.position.x - pane.x) * pane.nx + (live.position.z - pane.z) * pane.nz);
      samples++;
    }
    await page.waitForTimeout(100);
  }
  expect(samples).toBeGreaterThan(0);
  expect(deepest, 'the grenade stayed outside the glass').toBeGreaterThan(-0.05);
  // The frag went off within reach of the window: the pane is gone.
  await expect.poll(async () => (await paneNow(page, pane.id))?.broken, { timeout: 20000 }).toBe(true);
  expect(errors).toEqual([]);
});
