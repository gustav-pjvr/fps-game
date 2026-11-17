import { test, expect, type Page } from '@playwright/test';
import { joinLobby, joinRunningMatch, openPlayer, placeAt, rejoinToken, skipBriefing, startMatch } from './coop.ts';

/** Glass across players (docs/glass.md): a hit one player makes cracks or breaks the same pane for
 * the other, at the same spot; and a player who joins after the glass was broken sees it as it is.
 * Never more than two browser contexts at once: the late joiner is the guest coming back. */

type Glass = NonNullable<ReturnType<NonNullable<Window['__gameDebug']>['getGlassDebug']>>;
type Pane = Glass['panes'][number];

async function createValleyRoom(host: Page): Promise<string> {
  await host.goto('/');
  await host.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await host.getByRole('button', { name: 'Create Room', exact: true }).click();
  await host.locator('#create-room-map').selectOption('valley');
  const codeLocator = host.locator('div').filter({ hasText: /^[A-Z2-9]{6}$/ }).last();
  await codeLocator.waitFor({ state: 'visible', timeout: 20000 });
  const code = await codeLocator.textContent();
  if (!code) throw new Error('room code never appeared');
  return code;
}

const panes = (page: Page): Promise<Pane[]> => page.evaluate(() => window.__gameDebug!.getGlassDebug()?.panes ?? []);

/** Brings `page`'s player beside the pane (so its house is streamed in for them) and returns the
 * pane as that player sees it. */
async function seenBy(page: Page, pane: Pane): Promise<Pane> {
  await placeAt(page, pane.x + pane.nx * 5, pane.z + pane.nz * 5);
  let seen: Pane | undefined;
  await expect.poll(async () => {
    seen = (await panes(page)).find((candidate) => candidate.id === pane.id);
    return seen !== undefined;
  }, { timeout: 120000 }).toBe(true);
  return seen!;
}

test('a hit on a window is the same for both players, and a late joiner sees the glass as it is', async ({ browser }) => {
  // Two software-rendered pages, a match start and a rejoin into the running match.
  test.setTimeout(600000);
  const errors: string[] = [];
  const host = await openPlayer(browser);
  let guest = await openPlayer(browser);
  host.page.on('pageerror', (error) => errors.push(String(error)));
  guest.page.on('pageerror', (error) => errors.push(String(error)));

  const code = await createValleyRoom(host.page);
  await joinLobby(guest.page, code);
  await startMatch(host.page, [guest.page]);
  for (const page of [host.page, guest.page]) await page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));

  // Two windows near the host.
  let near: Pane[] = [];
  await expect.poll(async () => {
    near = await panes(host.page);
    return near.length;
  }, { timeout: 90000 }).toBeGreaterThan(1);
  const [cracked, smashed] = near as [Pane, Pane];

  // The host holes one pane off-centre: the guest gets the same hole in the same place.
  expect(await host.page.evaluate((id) => window.__gameDebug!.hitGlass(id, 0.2, -0.1, 1), cracked.id)).toBe(true);
  const guestCracked = await seenBy(guest.page, cracked);
  await expect.poll(async () => (await panes(guest.page)).find((pane) => pane.id === cracked.id)?.damage, { timeout: 30000 }).toBe(1);
  expect((await panes(guest.page)).find((pane) => pane.id === cracked.id)?.holes).toEqual([0.2, -0.1]);
  expect(guestCracked.x).toBeCloseTo(cracked.x, 3);
  expect(guestCracked.z).toBeCloseTo(cracked.z, 3);

  // The guest breaks the other pane: the host sees it go.
  await seenBy(guest.page, smashed);
  expect(await guest.page.evaluate((id) => window.__gameDebug!.hitGlass(id, 0, 0, 6), smashed.id)).toBe(true);
  await expect.poll(async () => (await panes(host.page)).find((pane) => pane.id === smashed.id)?.broken, { timeout: 30000 }).toBe(true);

  // The guest leaves; the host cracks the first pane again; the guest comes back into the running
  // match in a new browser context and is told what the glass looks like now.
  const token = await rejoinToken(guest.page, code);
  await guest.context.close();
  expect(await host.page.evaluate((id) => window.__gameDebug!.hitGlass(id, -0.3, 0.15, 2), cracked.id)).toBe(true);
  guest = await openPlayer(browser, { code, token });
  guest.page.on('pageerror', (error) => errors.push(String(error)));
  await joinRunningMatch(guest.page, code);
  await skipBriefing([guest.page]);
  await guest.page.evaluate(() => window.__gameDebug!.setPlayerInvulnerable(true));

  await seenBy(guest.page, cracked);
  await expect.poll(async () => (await panes(guest.page)).find((pane) => pane.id === cracked.id)?.damage, { timeout: 60000 }).toBe(3);
  expect((await panes(guest.page)).find((pane) => pane.id === cracked.id)?.holes).toEqual([0.2, -0.1, -0.3, 0.15]);
  await seenBy(guest.page, smashed);
  await expect.poll(async () => (await panes(guest.page)).find((pane) => pane.id === smashed.id)?.broken, { timeout: 60000 }).toBe(true);

  expect(errors).toEqual([]);
  await host.context.close();
  await guest.context.close();
});
