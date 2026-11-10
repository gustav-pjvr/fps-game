import type { Browser, BrowserContext, Page } from '@playwright/test';

/** Shared steps for the multiplayer mode specs (King of the Hill, Goose Horde, the co-op modes):
 * each player is a browser context of its own, over real WebRTC. Kept apart from helpers.ts, which
 * every spec shares, so a change here reruns only the mode specs (scripts/e2eGroups.mjs). */

export interface ModePlayer {
  readonly context: BrowserContext;
  readonly page: Page;
}

/** A small viewport: several software-rendered pages at once leave little CPU for pixels. */
export async function openPlayer(browser: Browser): Promise<ModePlayer> {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  return { context, page: await context.newPage() };
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

/** A player joins a match that is already running. */
export async function joinRunningMatch(guest: Page, code: string): Promise<void> {
  await joinRoom(guest, code, () => guest.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 90000 }));
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
  for (const page of pages) {
    const skip = page.getByRole('button', { name: 'Skip', exact: true });
    if (await skip.isVisible().catch(() => false)) await skip.click();
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
