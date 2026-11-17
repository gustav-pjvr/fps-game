import type { Browser, BrowserContext, Page } from '@playwright/test';

/** Shared steps for the multiplayer mode specs (King of the Hill, Goose Horde, the co-op modes):
 * each player is a browser context of its own, over real WebRTC. Kept apart from helpers.ts, which
 * every spec shares, so a change here reruns only the mode specs (scripts/e2eGroups.mjs). */

export interface ModePlayer {
  readonly context: BrowserContext;
  readonly page: Page;
}

const REJOIN_KEY_PREFIX = 'fps-game-rejoin-';

/** A small viewport: several software-rendered pages at once leave little CPU for pixels. With
 * `rejoin`, the new context carries a player's old rejoin token for that room (see rejoinToken),
 * so joining puts it back in its slot. */
export async function openPlayer(browser: Browser, rejoin?: { code: string; token: string }): Promise<ModePlayer> {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  if (rejoin) {
    // core/multiplayerRejoin.ts keeps the token in sessionStorage per room code: a new context starts
    // with none, so a rejoin hands it the old one before the page's own scripts run.
    await context.addInitScript(
      ({ key, token }) => {
        if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, token);
      },
      { key: REJOIN_KEY_PREFIX + rejoin.code, token: rejoin.token },
    );
  }
  return { context, page: await context.newPage() };
}

/** The token that lets `page`'s player take its slot back in room `code` after it leaves. */
export async function rejoinToken(page: Page, code: string): Promise<string> {
  const token = await page.evaluate((key) => sessionStorage.getItem(key), REJOIN_KEY_PREFIX + code);
  if (!token) throw new Error('this player has no rejoin token');
  return token;
}

/** Opens Create Room with `mode` (a GameMode id) and `map` chosen and returns the room code. */
export async function createRoom(host: Page, mode: string, map: 'valley' | 'facility' = 'valley'): Promise<string> {
  await host.goto('/');
  await host.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await host.getByRole('button', { name: 'Create Room', exact: true }).click();
  await host.locator('#create-room-mode').selectOption(mode);
  await host.locator('#create-room-map').selectOption(map);
  const codeLocator = host.locator('div').filter({ hasText: /^[A-Z2-9]{6}$/ }).last();
  await codeLocator.waitFor({ state: 'visible', timeout: 20000 });
  const code = await codeLocator.textContent();
  if (!code) throw new Error('room code never appeared');
  return code;
}

/** Joins the room and waits for `joined` (the lobby's Ready button, or the running match for a
 * late join). A slow machine can outlast the join screen's own timeout, which re-enables Join, so
 * the click is retried. */
export async function joinRoom(guest: Page, code: string, joined: () => Promise<unknown>): Promise<void> {
  await guest.goto('/');
  await guest.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guest.getByPlaceholder('ABCDEF').fill(code);
  for (let attempt = 1; ; attempt++) {
    await guest.getByRole('button', { name: 'Join', exact: true }).click();
    try {
      await joined();
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

/** A guest joins the lobby and readies up. */
export async function joinLobby(guest: Page, code: string): Promise<void> {
  const ready = guest.getByRole('button', { name: 'Ready', exact: true });
  await joinRoom(guest, code, () => ready.waitFor({ state: 'visible', timeout: 40000 }));
  await ready.click();
}

/** A player joins a match that is already running (a late join, or a rejoin with its old token).
 * Loading a running world takes minutes with several software-rendered pages open: a short wait
 * would give up and press Join again on a page that is already loading the match. */
export async function joinRunningMatch(guest: Page, code: string): Promise<void> {
  await joinRoom(guest, code, () => guest.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 240000 }));
}

/** The host starts the match; every page waits for its own match, then skips the mode briefing
 * (the world stays frozen until every player has). */
export async function startMatch(host: Page, guests: readonly Page[]): Promise<void> {
  const start = host.getByRole('button', { name: 'Start Match', exact: true });
  await start.waitFor({ state: 'visible', timeout: 40000 });
  await host.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Start Match');
    return !!button && !button.disabled;
  }, undefined, { timeout: 60000 });
  await start.click();
  const pages = [host, ...guests];
  for (const page of pages) await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 120000 });
  await skipBriefing(pages);
}

/** Dismisses the mode briefing on every page. The world stays frozen until every player has, and
 * on a small viewport the Skip button sits below the fold of the briefing panel, so it is clicked
 * through the DOM rather than by pointer. A page with no briefing (a mode without one) is left alone. */
export async function skipBriefing(pages: readonly Page[]): Promise<void> {
  for (const page of pages) {
    // In a room the button reads "Skip (1/2)": it counts the players who have.
    const skip = page.getByRole('button', { name: /^Skip/ });
    try {
      await skip.waitFor({ state: 'attached', timeout: 30000 });
    } catch {
      continue;
    }
    await skip.evaluate((button) => (button as HTMLButtonElement).click());
  }
}

/** Puts a player at (x, z), dropped from a little above the ground there. */
export async function placeAt(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(({ x, z }) => {
    const debug = window.__gameDebug!;
    const y = debug.getPlayerPosition()?.y ?? 0;
    debug.teleport(x, y + 6, z);
  }, { x, z });
}
