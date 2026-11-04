import { expect, test, type Page } from '@playwright/test';
import { lockPointer, waitForGameTime } from './helpers.ts';

// The Uplink mission (docs/visual-overhaul.md, phase 4). The state machine's rules are unit tested
// in src/core/mission/missionState.test.ts; this guards the wiring: the setup option, the towers
// it picks, E starting an upload at a tower, the HUD prompt, and death ending the mission. The
// sandbox runs the game at a fraction of real speed, so waits are on the game's own clock.

async function startMission(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('radio', { name: /Uplink mission/ }).check();
  // The three modes are exclusive: checking the mission clears the others.
  await expect(page.getByRole('radio', { name: /Director/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 60000 });
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(true));
}

async function mission(page: Page) {
  return page.evaluate(() => window.__gameDebug?.getMissionDebug() ?? null);
}

test('the mission makes three watch towers uplinks and the fourth the extraction, under the director', async ({ page }) => {
  test.setTimeout(150000);
  await startMission(page);
  const state = await mission(page);
  expect(state, 'the mission runs in this mode').not.toBeNull();
  expect(state!.phase).toBe('uplinks');
  expect(state!.uplinks.map((u) => u.label)).toEqual(['A', 'B', 'C']);
  const towers = await page.evaluate(() => window.__gameDebug!.getActiveTowerPositions());
  // Every uplink and the extraction sit on a real tower of this map (active ones are streamed in;
  // the mission knows all four from the seed, so at least the nearby ones must match).
  const all = [...state!.uplinks, state!.extraction];
  for (const tower of towers) {
    expect(all.some((p) => Math.hypot(p.x - tower.x, p.z - tower.z) < 0.01), JSON.stringify({ tower, all })).toBe(true);
  }
  expect(await page.evaluate(() => window.__gameDebug?.getDirectorDebug())).not.toBeNull();
  await expect(page.getByText('Bring the uplinks online')).toBeVisible();
});

test('E at an uplink starts its upload, and death ends the mission with Signal lost', async ({ page }) => {
  test.setTimeout(240000);
  await startMission(page);
  const a = (await mission(page))!.uplinks[0]!;
  // Beside the tower's stairs, inside the 9 m start radius.
  await page.evaluate(([x, z]) => window.__gameDebug!.teleport(x + 6, 60, z + 4), [a.x, a.z]);
  await page.waitForFunction(() => window.__gameDebug!.getMissionDebug()?.prompt === 'START UPLINK', undefined, { timeout: 60000 });
  await expect(page.getByText('START UPLINK')).toBeVisible();

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__gameDebug!.getMissionDebug()?.active?.label === 'A', undefined, { timeout: 30000 });
  await waitForGameTime(page, 3);
  const uploading = (await mission(page))!;
  expect(uploading.active!.paused).toBe(false);
  expect(uploading.active!.progress, JSON.stringify(uploading)).toBeGreaterThan(0);
  expect(uploading.uplinks[0]!.status).toBe('uploading');
  await expect(page.getByText('Hold the tower')).toBeVisible();

  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(false));
  await page.evaluate(() => window.__gameDebug?.damagePlayer(1000));
  await expect(page.getByText('Signal lost')).toBeVisible({ timeout: 30000 });
  expect((await mission(page))!.phase).toBe('lost');

  // Respawn restarts the mission from the beginning.
  await page.getByRole('button', { name: 'Respawn', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug!.getMissionDebug()?.phase === 'uplinks', undefined, { timeout: 30000 });
  const fresh = (await mission(page))!;
  expect(fresh.uplinks.every((u) => u.status === 'pending' && u.progress === 0), JSON.stringify(fresh)).toBe(true);
});
