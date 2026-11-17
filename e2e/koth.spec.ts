import { expect, test, type Page } from '@playwright/test';
import { lockPointer } from './helpers.ts';
import { createRoom, joinLobby, joinRunningMatch, openPlayer, placeAt, startMatch } from './coop.ts';

/** King of the Hill (docs/king-of-the-hill.md), two players then a late joiner, on the Valley.
 * The host owns the hill, the crown and the score; this proves every client sees the same. */

type Koth = NonNullable<ReturnType<NonNullable<Window['__gameDebug']>['getKothDebug']>>;

const koth = (page: Page): Promise<Koth | null> => page.evaluate(() => window.__gameDebug?.getKothDebug() ?? null);
const scoreOf = (page: Page, slot: number): Promise<number> =>
  page.evaluate((slot) => window.__gameDebug?.getScoreboardRows().find((row) => row.slot === slot)?.score ?? 0, slot);

/** Waits until `page` shows a hill state that passes `check`. */
async function waitForKoth(page: Page, check: (state: Koth) => boolean, what: string): Promise<Koth> {
  const deadline = Date.now() + 90000;
  for (;;) {
    const state = await koth(page);
    if (state && check(state)) return state;
    if (Date.now() > deadline) throw new Error(`King of the Hill never reached: ${what} (last ${JSON.stringify(state)})`);
    await page.waitForTimeout(500);
  }
}

test('the hill, the crown and the score are the host\'s, and every client sees the same', async ({ browser }) => {
  // Three contexts on software rendering, a late join among them: measured about 6 minutes here.
  test.setTimeout(15 * 60 * 1000);
  const host = await openPlayer(browser);
  const guest = await openPlayer(browser);
  const late = await openPlayer(browser);
  const errors: string[] = [];
  for (const { page } of [host, guest, late]) page.on('pageerror', (error) => errors.push(String(error)));

  const code = await createRoom(host.page, 'kingOfTheHill');
  await joinLobby(guest.page, code);
  await startMatch(host.page, [guest.page]);

  // The hill's clock is stopped: three software-rendered pages take minutes over what a real
  // match does in seconds, and the hill would move (and call the crown back) under the checks.
  await host.page.evaluate(() => window.__gameDebug!.holdKothHill(true));
  // Both see the same hill, open, with the crown lying in its middle. Two players: no teams.
  const first = await waitForKoth(host.page, () => true, 'a first state on the host');
  const seenByGuest = await waitForKoth(guest.page, (state) => state.hill.x === first.hill.x && state.hill.z === first.hill.z, 'the host\'s hill on the guest');
  expect(seenByGuest.teams).toBe(false);
  expect(seenByGuest.crownAt).toEqual(first.hill);
  await expect(host.page.getByTestId('koth-hud')).toContainText('KING OF THE HILL');

  // The host stands on the hill alone: it holds it and scores, on both clients.
  await placeAt(host.page, first.hill.x + 3, first.hill.z);
  await placeAt(guest.page, first.hill.x + 30, first.hill.z + 30);
  await waitForKoth(guest.page, (state) => state.hold === 'held' && state.holder === 0, 'the host holding the hill, seen by the guest');
  await expect.poll(() => scoreOf(guest.page, 0), { timeout: 90000 }).toBeGreaterThanOrEqual(2);
  await expect(guest.page.getByTestId('koth-hud')).toContainText(/holds the hill/i);

  // The guest steps on: contested, and the score stops.
  await placeAt(guest.page, first.hill.x - 3, first.hill.z);
  await waitForKoth(host.page, (state) => state.hold === 'contested', 'a contested hill');
  const frozen = await scoreOf(host.page, 0);
  await host.page.waitForTimeout(6000);
  expect(await scoreOf(host.page, 0)).toBeLessThanOrEqual(frozen + 1);
  expect(await scoreOf(host.page, 1)).toBe(0);

  // The guest takes the crown with E: it asks the host, the host grants it by reach.
  await placeAt(guest.page, first.hill.x + 0.5, first.hill.z);
  await lockPointer(guest.page);
  await expect.poll(async () => {
    await guest.page.keyboard.press('KeyE');
    return (await koth(host.page))?.crown ?? null;
  }, { timeout: 90000, intervals: [1500] }).toBe(1);
  await waitForKoth(guest.page, (state) => state.crown === 1 && state.crownAt === null, 'the crown on the guest, seen by the guest');

  // A player joining now is told the whole state: the hill, who wears the crown, the score.
  await joinRunningMatch(late.page, code);
  const lateState = await waitForKoth(late.page, (state) => state.crown === 1, 'the crown wearer, seen by the late joiner');
  expect(lateState.hill).toEqual(first.hill);
  await expect.poll(() => scoreOf(late.page, 0), { timeout: 60000 }).toBeGreaterThanOrEqual(frozen);

  // The crowned guest dies: the crown lies where it fell, for everyone.
  await guest.page.evaluate(() => window.__gameDebug!.damagePlayer(500));
  const dropped = await waitForKoth(late.page, (state) => state.crown === null && state.crownAt !== null, 'the crown on the ground after its wearer died');
  expect(Math.hypot(dropped.crownAt!.x - first.hill.x, dropped.crownAt!.z - first.hill.z)).toBeLessThan(8);

  expect(errors).toEqual([]);
  for (const { context } of [host, guest, late]) await context.close();
});

test('four players play two against two: a side holds the hill together and scores together', async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);
  const players = [await openPlayer(browser), await openPlayer(browser), await openPlayer(browser), await openPlayer(browser)];
  const [host, ...guests] = players as [typeof players[number], ...typeof players];
  const errors: string[] = [];
  for (const { page } of players) page.on('pageerror', (error) => errors.push(String(error)));

  const code = await createRoom(host.page, 'kingOfTheHill');
  for (const guest of guests) await joinLobby(guest.page, code);
  await startMatch(host.page, guests.map((guest) => guest.page));
  await host.page.evaluate(() => window.__gameDebug!.holdKothHill(true));

  // Every client is told it is a team match, on the same hill.
  const first = await waitForKoth(host.page, (state) => state.teams, 'a team match on the host');
  for (const { page } of guests) {
    await waitForKoth(page, (state) => state.teams && state.hill.x === first.hill.x && state.hill.z === first.hill.z, 'the team match on a guest');
  }

  // Slots 0 and 2 are one side, 1 and 3 the other.
  const bySlot = new Map<number, Page>();
  for (const { page } of players) {
    bySlot.set(await page.evaluate(() => window.__gameDebug!.getScoreboardRows().find((row) => row.isYou)!.slot), page);
  }
  expect([...bySlot.keys()].sort()).toEqual([0, 1, 2, 3]);
  const page = (slot: number): Page => bySlot.get(slot)!;

  // Both of one side stand on the hill, the other side far off: the side holds it (a teammate does
  // not contest it) and both of its players show the side's points.
  await placeAt(page(1), first.hill.x + 40, first.hill.z + 40);
  await placeAt(page(3), first.hill.x - 40, first.hill.z + 40);
  await placeAt(page(0), first.hill.x + 3, first.hill.z);
  await placeAt(page(2), first.hill.x - 3, first.hill.z);
  await waitForKoth(page(1), (state) => state.hold === 'held' && state.holder === 0, 'side 0 holding the hill, seen by the other side');
  await expect.poll(() => scoreOf(page(3), 0), { timeout: 120000 }).toBeGreaterThanOrEqual(2);
  expect(await scoreOf(page(3), 2)).toBeGreaterThanOrEqual(2);
  expect(await scoreOf(page(3), 1)).toBe(0);
  await expect(page(2).getByTestId('koth-hud')).toContainText(/your team holds the hill/i);

  // One of the other side steps on: contested.
  await placeAt(page(1), first.hill.x, first.hill.z + 3);
  await waitForKoth(page(0), (state) => state.hold === 'contested', 'a contested hill');

  expect(errors).toEqual([]);
  for (const { context } of players) await context.close();
});
