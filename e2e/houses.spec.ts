import { test, expect, type Page } from '@playwright/test';
import { findFirstEnemyIndex, holdKey, lockPointer, waitForGameReady } from './helpers.ts';

/** The enterable Valley houses (docs/enterable-buildings.md): a solo Valley match, a house found
 * through the debug API, its door, its rooms and an enemy following the player inside. */

interface House {
  name: string; design: string; x: number; y: number; z: number; rotationY: number; doorId: number; doorOpen: boolean;
}

/** Per design with two rooms on one floor, in the house's local frame: where to stand in the first
 * room, where to walk to through the inner doorway, the test for "in the other room", the door's
 * x and the footprint's half sizes. */
const PLANS: Record<string, { start: [number, number]; goal: [number, number]; inOther: (x: number, z: number) => boolean; doorX: number; halfX: number; halfZ: number }> = {
  bunkhouse: { start: [-0.55, 1.4], goal: [-0.55, -1.4], inOther: (_x, z) => z < -0.2, doorX: 0.3, halfX: 1.65, halfZ: 3.25 },
  workshop: { start: [1.75, 0.4], goal: [1.75, -2.3], inOther: (x, z) => z < -1.1 && x > 0.7, doorX: 1.65, halfX: 3.0, halfZ: 3.45 },
};

const toWorld = (h: House, x: number, z: number) => {
  const c = Math.cos(h.rotationY), s = Math.sin(h.rotationY);
  return { x: h.x + x * c + z * s, z: h.z - x * s + z * c };
};
const toLocal = (h: House, x: number, z: number) => {
  const c = Math.cos(h.rotationY), s = Math.sin(h.rotationY), dx = x - h.x, dz = z - h.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
};

/** A solo Valley match with the player invulnerable, and a streamed-in bunkhouse or workshop. */
async function startWithHouse(page: Page): Promise<House> {
  await page.goto('/');
  await waitForGameReady(page);
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));
  let house: House | undefined;
  await expect.poll(async () => {
    const houses = await page.evaluate(() => window.__gameDebug!.getValleyHouses());
    const player = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
    house = houses.filter((h) => h.design in PLANS)
      .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
    return house !== undefined;
  }, { timeout: 40000 }).toBe(true);
  return house!;
}

async function standAt(page: Page, house: House, x: number, z: number): Promise<void> {
  const at = toWorld(house, x, z);
  await page.evaluate(({ x, y, z }) => window.__gameDebug!.teleport(x, y, z), { x: at.x, y: house.y + 1.2, z: at.z });
  await page.waitForTimeout(600);
}

test('a house door opens, the player stands inside and walks through to the other room', async ({ page }) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const house = await startWithHouse(page), plan = PLANS[house.design]!;

  expect(await page.evaluate((id) => window.__gameDebug!.setValleyDoor(id, true), house.doorId)).toBe(true);
  await expect.poll(async () => (await page.evaluate(() => window.__gameDebug!.getValleyHouses())).find((h) => h.doorId === house.doorId)?.doorOpen).toBe(true);

  await standAt(page, house, plan.start[0], plan.start[1]);
  const inside = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  const local = toLocal(house, inside.x, inside.z);
  expect(Math.abs(local.x)).toBeLessThan(plan.halfX);
  expect(Math.abs(local.z)).toBeLessThan(plan.halfZ);
  expect(inside.y).toBeGreaterThan(house.y);
  expect(inside.y).toBeLessThan(house.y + 2.5);
  expect(plan.inOther(local.x, local.z)).toBe(false);

  const goal = toWorld(house, plan.goal[0], plan.goal[1]);
  await page.evaluate(({ x, y, z }) => window.__gameDebug!.lookAt(x, y, z), { x: goal.x, y: inside.y + 0.6, z: goal.z });
  await holdKey(page, 'KeyW', 1400);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  const there = toLocal(house, after.x, after.z);
  expect(plan.inOther(there.x, there.z), `player at local (${there.x.toFixed(2)}, ${there.z.toFixed(2)})`).toBe(true);
  expect(Math.abs(there.x)).toBeLessThan(plan.halfX);
  expect(errors).toEqual([]);
});

test('an enemy commanded to the player inside a house opens its door and comes in', async ({ page }) => {
  test.setTimeout(180000);
  const house = await startWithHouse(page), plan = PLANS[house.design]!;
  // The door stays shut: the enemy has to open it (the enemy door gate).
  await standAt(page, house, plan.goal[0], plan.goal[1]);
  const player = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  const index = await findFirstEnemyIndex(page);
  const street = toWorld(house, plan.doorX, plan.halfZ + 9);
  await page.evaluate(({ index, x, z }) => window.__gameDebug!.placeEnemy(index, x, z), { index, x: street.x, z: street.z });

  const deadline = Date.now() + 60000;
  let reached = false, last = { x: 0, z: 0 };
  // Commanded rather than lured: a lured enemy that sees the player through a window rightly stands
  // and shoots from outside; this checks the way in (the navigator, the door gate and the floors).
  await page.evaluate(({ index, p }) => window.__gameDebug!.commandEnemy(index, p), { index, p: player });
  while (Date.now() < deadline && !reached) {
    await page.waitForTimeout(1000);
    const enemy = (await page.evaluate(() => window.__gameDebug!.getLiveEnemyDebug())).find((e) => e.index === index);
    if (!enemy) break;
    last = toLocal(house, enemy.x, enemy.z);
    // Inside the walls; or, by the deadline, at least in the doorway (within a step of it).
    reached = Math.abs(last.x) < plan.halfX && Math.abs(last.z) < plan.halfZ;
  }
  reached ||= Math.abs(last.x - plan.doorX) < 1.0 && Math.abs(last.z - plan.halfZ) < 1.2;
  expect(reached, `enemy last at local (${last.x.toFixed(2)}, ${last.z.toFixed(2)}) of the ${house.design}`).toBe(true);
  // Inside, the shut door was opened on the way (by the enemy door gate).
  if (Math.abs(last.z) < plan.halfZ - 0.3) {
    expect((await page.evaluate(() => window.__gameDebug!.getValleyHouses())).find((h) => h.doorId === house.doorId)?.doorOpen).toBe(true);
  }
});
