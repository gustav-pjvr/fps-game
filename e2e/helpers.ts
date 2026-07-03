import type { Page } from '@playwright/test';

/** Clicks through the lobby (Play -> Start Match with default counts) and waits for Game.create()
 * to finish (WASM init, world seed, encounters spawned) - see Game.installDebugApi(). */
export async function waitForGameReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
}

/** Clicks the "click to play" blocker to engage pointer lock, then waits for it to actually take effect. */
export async function lockPointer(page: Page): Promise<void> {
  await page.click('#blocker');
  await page.waitForFunction(() => window.__gameDebug?.isPointerLocked() === true, { timeout: 5000 });
}

export async function holdKey(page: Page, key: string, durationMs: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(key);
}
