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
