import { expect, test, type Page } from '@playwright/test';
import { lockPointer, waitForGameTime } from './helpers.ts';
import { createRoom, joinLobby, joinRunningMatch, openPlayer, placeAt, rejoinToken, startMatch } from './coop.ts';

/** Goose Horde (docs/goose-horde.md): a solo run, then the co-op one with two players, a late
 * joiner and a rejoin, then four players. The host (or the solo player) owns the waves; a fallen
 * player owns its own standing up. */

type Horde = NonNullable<ReturnType<NonNullable<Window['__gameDebug']>['getHordeDebug']>>;

const horde = (page: Page): Promise<Horde | null> => page.evaluate(() => window.__gameDebug?.getHordeDebug() ?? null);
const health = (page: Page): Promise<number> => page.evaluate(() => window.__gameDebug!.getPlayerHealth());
const invulnerable = (page: Page, on: boolean): Promise<void> => page.evaluate((on) => window.__gameDebug!.setPlayerInvulnerable(on), on);
const position = (page: Page) => page.evaluate(() => window.__gameDebug!.getPlayerPosition()!);

/** Waits until `page` shows a horde state that passes `check`; `each` runs before every look. */
async function waitForHorde(page: Page, check: (state: Horde) => boolean, what: string, each?: () => Promise<unknown>, timeout = 120000): Promise<Horde> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (each) await each();
    const state = await horde(page);
    if (state && check(state)) return state;
    if (Date.now() > deadline) throw new Error(`Goose Horde never reached: ${what} (last ${JSON.stringify(state && { ...state, geese: state.geese.length })})`);
    await page.waitForTimeout(500);
  }
}

/** The authoritative side kills every live goose, as that side's own player's kills. */
const killAll = (page: Page) => () => page.evaluate(() => window.__gameDebug!.killHordeGeese());

/** Takes the player down for real: the debug damage goes through the same path as a goose's blast. */
async function fell(page: Page): Promise<void> {
  await invulnerable(page, false);
  await page.evaluate(() => window.__gameDebug!.damagePlayer(500));
}

test('solo: waves, a supply drop, a Second Wind, a boss, and the run won', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('radio', { name: /Goose Horde/ }).check();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug?.getHordeDebug() != null, undefined, { timeout: 60000 });
  // The solo briefing says what is different alone, and holds the world until skipped.
  await expect(page.getByText('A Second Wind saves you from one death')).toBeVisible();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await lockPointer(page);
  await invulnerable(page, true);

  // Wave 1 of 12, sized for one player, with one Second Wind in hand.
  const first = await waitForHorde(page, (state) => state.geese.length > 0, 'the first geese');
  expect(first.wave).toBe(1);
  expect(first.totalWaves).toBe(12);
  expect(first.need).toBe(14);
  expect(first.secondWinds).toBe(1);
  await expect(page.getByTestId('horde-hud')).toContainText('WAVE 1 / 12');

  // Kills fill the supply meter: waves 1 and 2 are 15 geese, one more than a drop takes.
  const supplied = await waitForHorde(page, (state) => state.crates.length > 0, 'a supply drop', killAll(page));
  expect(supplied.wave).toBeGreaterThanOrEqual(2);
  expect(supplied.kills[0]?.kills).toBeGreaterThanOrEqual(14);

  // A Second Wind: the death does not happen, the player stands with a little health and none left.
  await fell(page);
  await expect.poll(() => health(page), { timeout: 20000 }).toBe(35);
  expect((await horde(page))!.secondWinds).toBe(0);
  await expect(page.getByTestId('death-screen')).toBeHidden();

  // The crate heals: walking onto it takes it off the field.
  const crate = supplied.crates[0]!;
  await invulnerable(page, true);
  await page.evaluate(({ x, y, z }) => window.__gameDebug!.teleport(x, y + 1.5, z), crate);
  await expect.poll(() => health(page), { timeout: 30000 }).toBe(70);
  expect((await horde(page))!.crates.find((entry) => entry.id === crate.id)).toBeUndefined();

  // With no Second Wind left, the next death ends the run (once the Second Wind's shield is over).
  await waitForGameTime(page, 3);
  await fell(page);
  const deathScreen = page.getByTestId('death-screen');
  await expect(deathScreen).toContainText('Overrun', { timeout: 30000 });
  await expect(deathScreen).toContainText('GEESE KILLED');

  // A new run starts from wave 1 with its Second Wind back.
  await deathScreen.getByRole('button', { name: 'Respawn', exact: true }).click();
  await lockPointer(page);
  await invulnerable(page, true);
  const restarted = await waitForHorde(page, (state) => state.wave === 1 && state.secondWinds === 1, 'a fresh run');
  expect(restarted.kills.reduce((sum, entry) => sum + entry.kills, 0)).toBe(0);

  // Wave 6 is Mother Goose: a boss with a health bar.
  await page.evaluate(() => window.__gameDebug!.setHordeWave(6));
  const boss = await waitForHorde(page, (state) => state.boss !== null, 'the boss of wave 6');
  expect(boss.boss).toMatchObject({ id: 'mother', hp: 1500, max: 1500 });
  expect(boss.geese.some((goose) => goose.flavor === 'boss')).toBe(true);
  await expect(page.getByTestId('horde-boss')).toContainText('MOTHER GOOSE');

  // The last wave survived wins the run.
  await page.evaluate(() => window.__gameDebug!.setHordeWave(12));
  await waitForHorde(page, (state) => state.phase === 'cleared', 'the horde cleared', killAll(page));
  await expect(deathScreen).toContainText('The horde is broken', { timeout: 30000 });
  await expect(deathScreen).toContainText('12 / 12');

  expect(errors).toEqual([]);
});

test('co-op: the host\'s waves on every client, a fall, a revive, the next wave, a late joiner and a rejoin', async ({ browser }) => {
  // Three contexts on software rendering, a late join and a rejoin among them.
  test.setTimeout(25 * 60 * 1000);
  const host = await openPlayer(browser);
  const guest = await openPlayer(browser);
  const late = await openPlayer(browser);
  const errors: string[] = [];
  for (const { page } of [host, guest, late]) page.on('pageerror', (error) => errors.push(String(error)));

  const code = await createRoom(host.page, 'gooseHorde');
  await joinLobby(guest.page, code);
  await startMatch(host.page, [guest.page]);
  for (const { page } of [host, guest]) await invulnerable(page, true);

  // The guest shows the host's wave, sized for two, and the host's geese.
  const seen = await waitForHorde(guest.page, (state) => state.geese.length > 0 && state.need === 18, 'the host\'s wave on the guest');
  expect(seen.wave).toBe(1);
  await expect(guest.page.getByTestId('horde-hud')).toContainText('WAVE 1 / 12');

  // The host's kills are the scoreboard, on both clients.
  await waitForHorde(guest.page, (state) => (state.kills.find((entry) => entry.slot === 0)?.kills ?? 0) > 0, 'the host\'s kills on the guest', killAll(host.page));
  await expect.poll(() => guest.page.evaluate(() => window.__gameDebug!.getScoreboardRows().find((row) => row.slot === 0)?.score ?? 0), { timeout: 30000 }).toBeGreaterThan(0);

  // The guest falls: down, not dead. No death screen; everyone counts it among the fallen.
  await fell(guest.page);
  await waitForHorde(guest.page, (state) => state.own === 'down', 'the guest down');
  await invulnerable(guest.page, true);
  await expect(guest.page.getByTestId('downed-overlay')).toContainText('YOU ARE DOWN');
  await expect(guest.page.getByTestId('death-screen')).toBeHidden();
  await waitForHorde(host.page, (state) => state.fallen.includes(1), 'the guest among the fallen, on the host');
  expect(await guest.page.evaluate(() => window.__gameDebug!.isMultiplayerMatchEnded())).toBe(false);

  // The host stands by the guest and holds E: the guest stands up where it fell, with 40 health.
  const fallenAt = await position(guest.page);
  await placeAt(host.page, fallenAt.x + 1, fallenAt.z);
  await lockPointer(host.page);
  await host.page.keyboard.down('KeyE');
  await waitForHorde(guest.page, (state) => state.own === 'up', 'the guest revived');
  await host.page.keyboard.up('KeyE');
  expect(await health(guest.page)).toBe(40);
  const stoodAt = await position(guest.page);
  expect(Math.hypot(stoodAt.x - fallenAt.x, stoodAt.z - fallenAt.z)).toBeLessThan(3);
  await waitForHorde(host.page, (state) => state.fallen.length === 0, 'nobody fallen, on the host');
  await expect(guest.page.getByTestId('downed-overlay')).toBeHidden();

  // The guest falls again and nobody comes: the next wave stands it up, with full health.
  await fell(guest.page);
  await waitForHorde(guest.page, (state) => state.own !== 'up', 'the guest down again');
  await invulnerable(guest.page, true);
  const waveAtFall = (await horde(host.page))!.wave;
  await waitForHorde(guest.page, (state) => state.own === 'up' && state.wave > waveAtFall, 'the guest back with the next wave', killAll(host.page), 240000);
  expect(await health(guest.page)).toBe(100);

  // A player joining now is told the wave, the kills and the flock.
  await joinRunningMatch(late.page, code);
  await invulnerable(late.page, true);
  const hostNow = (await horde(host.page))!;
  const lateState = await waitForHorde(late.page, (state) => state.wave >= hostNow.wave && state.kills.length > 0, 'the run, seen by the late joiner');
  expect(lateState.totalWaves).toBe(12);
  await waitForHorde(late.page, (state) => state.geese.length > 0, 'the flock, seen by the late joiner', undefined, 240000);

  // The guest leaves and comes back with its token: back in its slot, in the same run.
  const token = await rejoinToken(guest.page, code);
  const comeback = await openPlayer(browser, { code, token });
  comeback.page.on('pageerror', (error) => errors.push(String(error)));
  await guest.context.close();
  await expect.poll(() => host.page.evaluate(() => window.__gameDebug!.getOpponentCount()), { timeout: 120000 }).toBe(1);
  await joinRunningMatch(comeback.page, code);
  await invulnerable(comeback.page, true);
  await expect.poll(() => host.page.evaluate(() => window.__gameDebug!.getOpponentCount()), { timeout: 120000 }).toBe(2);
  const back = await waitForHorde(comeback.page, (state) => state.wave >= hostNow.wave, 'the run, seen by the rejoined guest');
  expect(back.own).toBe('up');
  expect(await comeback.page.evaluate(() => window.__gameDebug!.getScoreboardRows().find((row) => row.isYou)?.slot)).toBe(1);

  expect(errors).toEqual([]);
  for (const { context } of [host, late, comeback]) await context.close();
});

test('four players: a wave sized for four, and the run lost when all four are down at once', async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);
  const players = [await openPlayer(browser), await openPlayer(browser), await openPlayer(browser), await openPlayer(browser)];
  const [host, ...guests] = players as [typeof players[number], ...typeof players];
  const errors: string[] = [];
  for (const { page } of players) page.on('pageerror', (error) => errors.push(String(error)));

  const code = await createRoom(host.page, 'gooseHorde');
  for (const guest of guests) await joinLobby(guest.page, code);
  await startMatch(host.page, guests.map((guest) => guest.page));
  for (const { page } of players) await invulnerable(page, true);

  // Every client shows the wave sized for four: 26 kills to a supply drop.
  for (const { page } of players) {
    const state = await waitForHorde(page, (state) => state.need === 26, 'a wave sized for four', undefined, 180000);
    expect(state.wave).toBe(1);
  }

  // Three down is not a loss: the fourth can still revive them.
  for (const { page } of guests) await fell(page);
  await waitForHorde(host.page, (state) => state.fallen.length === 3, 'three fallen, on the host', undefined, 180000);
  expect(await host.page.evaluate(() => window.__gameDebug!.isMultiplayerMatchEnded())).toBe(false);

  // The fourth falls: the whole squad is down, and the run is lost on every client.
  await fell(host.page);
  for (const { page } of players) {
    await expect(page.locator('[data-testid="match-end-screen"]')).toContainText('THE HORDE WINS', { timeout: 180000 });
  }

  expect(errors).toEqual([]);
  for (const { context } of players) await context.close();
});
