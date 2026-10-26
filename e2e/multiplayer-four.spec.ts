import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { lockPointer } from './helpers.ts';

/** Three and four players (docs/squad-arsenal-night.md section 1.2, docs/multiplayer.md "Three and
 * four players (v4.4.0)"): the host plus up to three guests, each in its own browser context, all
 * over real WebRTC. Valley map, default mode. */

interface Player {
  readonly context: BrowserContext;
  readonly page: Page;
}

const REJOIN_KEY_PREFIX = 'fps-game-rejoin-';

async function openPlayer(browser: Browser, rejoinToken?: { code: string; token: string }): Promise<Player> {
  // A small viewport: four software-rendered pages at once leave little CPU for pixels.
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  if (rejoinToken) {
    // core/multiplayerRejoin.ts keeps the token in sessionStorage per room code: a new context starts
    // with none, so a rejoin hands it the old one before the page's own scripts run.
    await context.addInitScript(
      ({ key, token }) => {
        if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, token);
      },
      { key: REJOIN_KEY_PREFIX + rejoinToken.code, token: rejoinToken.token },
    );
  }
  return { context, page: await context.newPage() };
}

async function createRoom(host: Page): Promise<string> {
  await host.goto('/');
  await host.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await host.getByRole('button', { name: 'Create Room', exact: true }).click();
  const codeLocator = host.locator('div').filter({ hasText: /^[A-Z2-9]{6}$/ }).last();
  await codeLocator.waitFor({ state: 'visible', timeout: 10000 });
  const code = await codeLocator.textContent();
  if (!code) throw new Error('room code never appeared');
  return code;
}

/** Opens the join screen and enters the code. `waitFor` is what proves the join worked (the lobby's
 * Ready button, or the running match). A slow machine can outlast the screen's own 25 s join timeout
 * ("your network is blocking peer-to-peer play"), which re-enables Join, so the click is retried. */
async function joinRoom(guest: Page, code: string, waitFor: () => Promise<unknown>): Promise<void> {
  await openJoinScreen(guest, code);
  await submitJoin(guest, waitFor);
}

/** Loads the game and brings it to the Join Room screen with the code filled in, without joining. */
async function openJoinScreen(guest: Page, code: string): Promise<void> {
  await guest.goto('/');
  await guest.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guest.getByPlaceholder('ABCDEF').fill(code);
}

/** Clicks Join on a filled-in Join Room screen until `waitFor` succeeds (see joinRoom). */
async function submitJoin(guest: Page, waitFor: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await guest.getByRole('button', { name: 'Join', exact: true }).click();
    try {
      await waitFor();
      return;
    } catch (error) {
      if (attempt >= 4) throw error;
      console.log(`join attempt ${attempt} did not connect, trying again`);
    }
  }
}

/** A guest into a room that has not started: joined once its Ready button is clicked. */
async function joinLobby(guest: Page, code: string): Promise<void> {
  const ready = guest.getByRole('button', { name: 'Ready', exact: true });
  await joinRoom(guest, code, () => ready.waitFor({ state: 'visible', timeout: 60000 }));
  await ready.click();
}

const inGame = (guest: Page, timeout = 90000) => () => guest.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout });

/** A guest into a running match (a late join or a rejoin): in once the game's debug hooks exist. */
async function joinMatch(guest: Page, code: string): Promise<void> {
  await joinRoom(guest, code, inGame(guest));
}

const started = Date.now();
const step = (label: string): void => console.log(`[${Math.round((Date.now() - started) / 1000)} s] ${label}`);

/** Host plus `guestCount` guests, all ready, match started and every page in game. */
async function startMatch(browser: Browser, guestCount: number): Promise<{ host: Player; guests: Player[]; code: string }> {
  const host = await openPlayer(browser);
  const code = await createRoom(host.page);
  const guests: Player[] = [];
  for (let i = 0; i < guestCount; i++) {
    const guest = await openPlayer(browser);
    guests.push(guest);
    await joinLobby(guest.page, code);
    step(`guest ${guests.length} ready`);
  }
  const startButton = host.page.getByRole('button', { name: 'Start Match', exact: true });
  await startButton.waitFor({ state: 'visible', timeout: 30000 });
  // Start Match enables once every connected slot is ready (host included).
  await expect(startButton).toBeEnabled({ timeout: 60000 });
  await startButton.click();
  step('match started');
  for (const { page } of [host, ...guests]) {
    await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 120000 });
  }
  // A paused player takes no damage (multiplayer-pause-damage.spec.ts), so everyone must be live.
  for (const { page } of [host, ...guests]) await lockPointerPatiently(page);
  step('everyone in game and locked');
  return { host, guests, code };
}

const ownSlot = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const row = window.__gameDebug!.getScoreboardRows().find((entry) => entry.isYou);
    if (!row) throw new Error('no own scoreboard row');
    return row.slot;
  });

const scoreOf = (page: Page, slot: number): Promise<number | null> =>
  page.evaluate((wanted) => window.__gameDebug!.getScoreboardRows().find((entry) => entry.slot === wanted)?.score ?? null, slot);

// Where to stand relative to the target; a fresh seed puts different terrain around the same spot
// (see multiplayer-combat.spec.ts's APPROACH_OFFSETS).
const APPROACH_OFFSETS: Array<[number, number]> = [
  [12, 0],
  [-12, 0],
  [0, 12],
  [0, -12],
];

/** helpers.ts's lockPointer allows 5 s for the lock, which four busy pages can overrun: retry it. */
async function lockPointerPatiently(page: Page): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await lockPointer(page);
      return;
    } catch (error) {
      if (attempt >= 4) throw error;
    }
  }
}

/** Pistol equipped, with a longer wait than helpers.ts's equipPistol (the switch is a game tick). */
async function equipPistolPatiently(page: Page): Promise<void> {
  await page.keyboard.press('Digit2');
  await page.waitForFunction(() => window.__gameDebug!.getWeaponName() === 'Kestrel P9', undefined, { timeout: 30000 });
  await page.waitForTimeout(1500);
}

/** Waits until the player has landed: its height reads the same on two reads a second apart. */
async function waitUntilSettled(page: Page): Promise<void> {
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const y = (await page.evaluate(() => window.__gameDebug!.getPlayerPosition())).y;
        const settled = Math.abs(y - last) < 0.05;
        last = y;
        return settled;
      },
      { timeout: 60000, intervals: [1000] },
    )
    .toBe(true);
}

/** `shooter` teleports beside `target` and fires pistol shots until the target's own health reaches
 * 0 (health is authoritative on the victim's client). Returns whether the target died. Every shot
 * re-aims at the target's latest position: at a frame or two a second a fixed aim goes stale. */
async function killOpponent(shooter: Page, target: Page, targetSlot: number): Promise<boolean> {
  const positionOf = (): Promise<{ x: number; y: number; z: number } | null> =>
    shooter.evaluate((slot) => window.__gameDebug!.getOpponentPositions().find((entry) => entry.slot === slot) ?? null, targetSlot);
  await lockPointerPatiently(shooter);
  await equipPistolPatiently(shooter);
  for (const [offsetX, offsetZ] of APPROACH_OFFSETS) {
    const where = await positionOf();
    if (!where) throw new Error(`shooter has no position for slot ${targetSlot}`);
    await shooter.evaluate(({ x, y, z, dx, dz }) => window.__gameDebug!.teleport(x + dx, y + 8, z + dz), { ...where, dx: offsetX, dz: offsetZ });
    await waitUntilSettled(shooter);
    let health = 100;
    for (let i = 0; i < 10 && health > 0; i++) {
      const aimAt = await positionOf();
      if (!aimAt) throw new Error(`shooter lost slot ${targetSlot}`);
      await shooter.evaluate(({ x, y, z }) => window.__gameDebug!.lookAt(x, y, z), aimAt);
      // The aim reaches the camera on the next fixed-timestep tick.
      await shooter.waitForTimeout(700);
      await shooter.mouse.down();
      await shooter.mouse.up();
      await shooter.waitForTimeout(700);
      health = await target.evaluate(() => window.__gameDebug!.getPlayerHealth());
    }
    if (health <= 0) return true;
  }
  return false;
}

async function expectOpponentCount(players: Player[], count: number, timeout: number): Promise<void> {
  for (const { page } of players) {
    await expect.poll(() => page.evaluate(() => window.__gameDebug!.getOpponentPositions().length), { timeout }).toBe(count);
  }
}

test.describe('three and four players', () => {
  test('four players: opponents, a guest to guest kill, direct links, leave and rejoin with the score', async ({ browser }) => {
    // Four pages at about 2 FPS each: creating, joining and starting alone takes several minutes, and
    // under load the whole test measured over 15 (the rejoin alone about 4).
    test.setTimeout(1200000);
    const { host, guests, code } = await startMatch(browser, 3);
    const [shooter, victim, bystander] = guests;
    const everyone = [host, ...guests];

    // a. every page sees three opponents, in three distinct slots that are not its own.
    await expectOpponentCount(everyone, 3, 150000);
    step('a: three opponents everywhere');
    for (const { page } of everyone) {
      const mine = await ownSlot(page);
      const slots = await page.evaluate(() => window.__gameDebug!.getOpponentPositions().map((entry) => entry.slot));
      expect(new Set(slots).size).toBe(3);
      expect(slots).not.toContain(mine);
    }

    // c. direct guest links. Headless contexts may not manage WebRTC between each other here, so a
    // value that never rises is logged, not failed (a link that never opens falls back to the host).
    const linkReadings: Record<string, number> = {};
    for (const [index, { page }] of [host, ...guests].entries()) {
      const label = index === 0 ? 'host' : `guest${index}`;
      const wanted = index === 0 ? 3 : 2;
      await expect
        .poll(() => page.evaluate(() => window.__gameDebug!.getNetworkDebug().directLinksReady), { timeout: 45000 })
        .toBeGreaterThanOrEqual(wanted)
        .catch(() => undefined);
      linkReadings[label] = await page.evaluate(() => window.__gameDebug!.getNetworkDebug().directLinksReady);
    }
    console.log(`directLinksReady (host counts linked pairs, guests their own links): ${JSON.stringify(linkReadings)}`);
    test.info().annotations.push({ type: 'directLinksReady', description: JSON.stringify(linkReadings) });

    // b. one guest kills another; every scoreboard shows the kill under the shooter's slot.
    const shooterSlot = await ownSlot(shooter.page);
    const victimSlot = await ownSlot(victim.page);
    expect(await killOpponent(shooter.page, victim.page, victimSlot)).toBe(true);
    step('b: victim died');
    for (const { page } of everyone) {
      await expect.poll(() => scoreOf(page, shooterSlot), { timeout: 90000 }).toBe(1);
      const rows = await page.evaluate(() => window.__gameDebug!.getScoreboardRows());
      expect(rows).toHaveLength(4);
      expect(rows.find((entry) => entry.slot === victimSlot)?.score).toBe(0);
    }

    // d. the shooter closes its page: the others drop to two opponents ...
    const token = await shooter.page.evaluate((key) => sessionStorage.getItem(key), REJOIN_KEY_PREFIX + code);
    if (!token) throw new Error('the shooter has no rejoin token');
    step('b: kill on every scoreboard');
    // The rejoin page is loaded and on the Join Room screen before the shooter leaves: under load,
    // loading it afterwards outlasted the host's 90 s rejoin grace and the slot went to a stranger.
    const comeback = await openPlayer(browser, { code, token });
    await openJoinScreen(comeback.page, code);
    step('d: rejoin page ready on the Join Room screen');
    await shooter.context.close();
    const stayers = [host, victim, bystander];
    await expectOpponentCount(stayers, 2, 120000);
    step('d: the others dropped to two opponents');

    // ... and it rejoins in a new context with its old token, back in its slot with its score.
    // A rejoin loads the running world (minutes under load): a 90 s wait gave up and clicked Join
    // again on a page already loading the match.
    await submitJoin(comeback.page, inGame(comeback.page, 240000));
    step('rejoined');
    await expectOpponentCount([comeback, ...stayers], 3, 90000);
    expect(await ownSlot(comeback.page)).toBe(shooterSlot);
    await expect.poll(() => scoreOf(comeback.page, shooterSlot), { timeout: 30000 }).toBe(1);
    for (const { page } of stayers) {
      await expect.poll(() => scoreOf(page, shooterSlot), { timeout: 30000 }).toBe(1);
    }
    const rejoinLinks = await comeback.page.evaluate(() => window.__gameDebug!.getNetworkDebug().directLinksReady);
    console.log(`directLinksReady after the rejoin (rejoined guest): ${rejoinLinks}`);

    for (const { context } of [...stayers, comeback]) await context.close();
  });

  test('a fourth player joining mid-match gets the full state', async ({ browser }) => {
    // Three players to start, a kill, then the late join.
    test.setTimeout(720000);
    const { host, guests, code } = await startMatch(browser, 2);
    const [shooter, victim] = guests;
    const early = [host, shooter, victim];
    await expectOpponentCount(early, 2, 90000);

    const shooterSlot = await ownSlot(shooter.page);
    const victimSlot = await ownSlot(victim.page);
    expect(await killOpponent(shooter.page, victim.page, victimSlot)).toBe(true);
    await expect.poll(() => scoreOf(host.page, shooterSlot), { timeout: 90000 }).toBe(1);

    const late = await openPlayer(browser);
    // The match is already running, so there is no lobby and no Ready: the welcome drops it in.
    await joinMatch(late.page, code);
    step('late joiner in game');

    // The late joiner sees every opponent and the scoreboard, kill included, with names.
    await expectOpponentCount([late], 3, 90000);
    await expect.poll(() => scoreOf(late.page, shooterSlot), { timeout: 60000 }).toBe(1);
    const rows = await late.page.evaluate(() => window.__gameDebug!.getScoreboardRows());
    expect(rows).toHaveLength(4);
    expect(rows.filter((entry) => entry.isYou)).toHaveLength(1);
    for (const row of rows) expect(row.name.trim().length).toBeGreaterThan(0);
    expect(rows.find((entry) => entry.slot === victimSlot)?.score).toBe(0);

    // Everyone else now sees the newcomer as a third opponent (a fourth player in the room).
    await expectOpponentCount(early, 3, 90000);
    const lateSlot = await ownSlot(late.page);
    for (const { page } of early) {
      const slots = await page.evaluate(() => window.__gameDebug!.getOpponentPositions().map((entry) => entry.slot));
      expect(slots).toContain(lateSlot);
    }

    for (const { context } of [...early, late]) await context.close();
  });
});
