import { expect, test, type Page } from '@playwright/test';
import { lockPointer } from './helpers.ts';

// Operation Uplink (docs/uplink.md) on the Valley. The state machine's rules are unit tested in
// src/core/mission/; this plays the whole operation through the wiring: the setup option and the
// briefing, the four sites, the hack running in the zone, E taking the core and plugging it in, a
// death with a redeploy left, the Warden's wave, the win with its grade, and both ways to lose.
// The sandbox runs the game at a fraction of real speed, so the long timers are driven through the
// debug hooks (completeMissionStage, advanceMission) rather than waited out.

type MissionDebug = NonNullable<ReturnType<NonNullable<Window['__gameDebug']>['getMissionDebug']>>;

async function startMission(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('radio', { name: /Operation Uplink/ }).check();
  // The modes are exclusive: checking the mission clears the others.
  await expect(page.getByRole('radio', { name: /Director|Showdown/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 60000 });
  // The briefing holds the world until it is skipped.
  await expect(page.getByText(/^Breach: reach the uplink terminal/)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /skip/i }).click();
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(true));
}

async function mission(page: Page): Promise<MissionDebug> {
  const state = await page.evaluate(() => window.__gameDebug?.getMissionDebug() ?? null);
  expect(state, 'the mission runs in this mode').not.toBeNull();
  return state!;
}

/** Waits until `check`, run in the page, holds. */
const waitFor = (page: Page, check: () => boolean, timeout = 60000): Promise<unknown> => page.waitForFunction(check, undefined, { timeout });

/** Drops the player onto a tower site from above: anywhere within its zone counts. */
const dropOnto = (page: Page, site: { x: number; z: number }): Promise<void> =>
  page.evaluate(([x, z]) => window.__gameDebug!.teleport(x + 3, 60, z + 2), [site.x, site.z]);

/** Puts the player beside the data core where it hovers (down in the lab on the Valley). */
async function standAtCore(page: Page): Promise<void> {
  const { corePosition } = await mission(page);
  await page.evaluate(([x, y, z]) => window.__gameDebug!.teleport(x, y, z), [corePosition.x, corePosition.y, corePosition.z]);
  await waitFor(page, () => window.__gameDebug!.getMissionDebug()?.prompt === 'TAKE THE DATA CORE');
}

async function die(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__gameDebug?.setPlayerInvulnerable(false);
    window.__gameDebug?.damagePlayer(1000);
  });
}

async function respawn(page: Page): Promise<void> {
  // The button reads Redeploy mid-operation and Play again once it is over.
  await page.getByTestId('death-screen').getByRole('button', { name: /^(Redeploy|Play again)$/ }).click();
  await expect(page.getByTestId('death-screen')).toBeHidden({ timeout: 30000 });
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(true));
}

test('the whole operation: breach, fetch with a death and a redeploy, defend against the Warden, extract with a grade', async ({ page }) => {
  test.setTimeout(600000);
  await startMission(page);

  // Breach: three sites are towers of this map, the director runs, and the hack needs the zone.
  const start = await mission(page);
  expect(start).toMatchObject({ phase: 'breach', stageNumber: 1, alert: 1, redeploys: 2, carrying: false });
  const towers = await page.evaluate(() => window.__gameDebug!.getActiveTowerPositions());
  const onTower = (site: { x: number; z: number }) => towers.some((tower) => Math.hypot(site.x - tower.x, site.z - tower.z) < 0.01);
  for (const site of [start.sites.breach, start.sites.relay, start.sites.extraction]) expect(onTower(site), JSON.stringify({ site, towers })).toBe(true);
  expect(await page.evaluate(() => window.__gameDebug?.getDirectorDebug())).not.toBeNull();
  await expect(page.getByText('Reach the uplink terminal', { exact: true })).toBeVisible();
  expect(start.hack).toEqual({ progress: 0, paused: true });

  await dropOnto(page, start.sites.breach);
  await waitFor(page, () => {
    const hack = window.__gameDebug!.getMissionDebug()!.hack;
    return !hack.paused && hack.progress > 0;
  });
  await expect(page.getByText('Hold the terminal while the hack runs', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__gameDebug!.completeMissionStage());
  await expect(page.getByText('TERMINAL BREACHED: FETCH THE DATA CORE', { exact: true })).toBeVisible();

  // Fetch: E takes the core where it lies, and the carrier cannot sprint.
  const fetch = await mission(page);
  expect(fetch).toMatchObject({ phase: 'fetch', stageNumber: 2, core: { state: 'home' } });
  await standAtCore(page);
  await expect(page.getByText('TAKE THE DATA CORE', { exact: true })).toBeVisible();
  await page.keyboard.press('e');
  await waitFor(page, () => window.__gameDebug!.getMissionDebug()?.carrying === true);
  await expect(page.getByText('Carry the core to the relay', { exact: true })).toBeVisible();

  // A death with a redeploy left: the core drops there, Respawn redeploys at the terminal.
  await die(page);
  await expect(page.getByRole('heading', { name: 'Operative down' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Redeploy at the terminal', { exact: true })).toBeVisible();
  expect(await mission(page)).toMatchObject({ phase: 'fetch', awaitingRedeploy: true, redeploys: 2, carrying: false, core: { state: 'dropped' } });
  await respawn(page);
  const redeployed = await mission(page);
  expect(redeployed).toMatchObject({ phase: 'fetch', awaitingRedeploy: false, redeploys: 1, core: { state: 'dropped' } });
  const position = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  expect(Math.hypot(position.x - start.sites.breach.x, position.z - start.sites.breach.z), JSON.stringify(position)).toBeLessThan(20);
  await expect(page.getByText('Recover the dropped data core', { exact: true })).toBeVisible();

  // The dropped core is taken again and plugged into the relay with E.
  await standAtCore(page);
  await page.keyboard.press('e');
  await waitFor(page, () => window.__gameDebug!.getMissionDebug()?.carrying === true);
  await dropOnto(page, fetch.sites.relay);
  await waitFor(page, () => window.__gameDebug!.getMissionDebug()?.prompt === 'PLUG IN THE DATA CORE');
  await page.keyboard.press('e');
  await waitFor(page, () => window.__gameDebug!.getMissionDebug()?.phase === 'defend');

  // Defend: the upload runs in the zone, and its third wave brings the Warden.
  await waitFor(page, () => {
    const upload = window.__gameDebug!.getMissionDebug()!.upload;
    return !upload.paused && upload.progress > 0;
  });
  await expect(page.getByText('Defend the relay', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__gameDebug!.advanceMission(52));
  const defend = await mission(page);
  expect(defend.upload.wave).toBe(3);
  expect(defend.upload.progress).toBeGreaterThan(0.66);
  expect(await page.evaluate(() => window.__gameDebug!.getLiveEntityArchetypes())).toContain('The Warden');
  await page.evaluate(() => window.__gameDebug!.completeMissionStage());

  // Extract: the countdown runs, and reaching the point wins.
  await waitFor(page, () => {
    const state = window.__gameDebug!.getMissionDebug()!;
    return state.phase === 'extract' && state.extractionLeft < 60;
  });
  await expect(page.getByText('Reach the extraction point', { exact: true })).toBeVisible();
  await dropOnto(page, fetch.sites.extraction);
  await expect(page.getByRole('heading', { name: 'Operation complete' })).toBeVisible({ timeout: 60000 });
  const won = await mission(page);
  expect(won).toMatchObject({ phase: 'won', won: true, redeploys: 1 });
  // One redeploy used rules out an S.
  const screen = page.getByTestId('death-screen');
  await expect(screen.getByText('GRADE', { exact: true })).toBeVisible();
  await expect(screen.locator('dd').first()).toHaveText(/^[ABC]$/);
  await expect(screen.getByText('1 / 2', { exact: true })).toBeVisible();
});

test('the operation is lost with no redeploys left, and when the extraction countdown runs out', async ({ page }) => {
  test.setTimeout(600000);
  await startMission(page);

  // Two redeploys, then the third death loses.
  for (const left of [2, 1]) {
    await die(page);
    await expect(page.getByRole('heading', { name: 'Operative down' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`${left} / 2`, { exact: true })).toBeVisible();
    await respawn(page);
    expect(await mission(page)).toMatchObject({ phase: 'breach', redeploys: left - 1, awaitingRedeploy: false });
  }
  await die(page);
  await expect(page.getByRole('heading', { name: 'Signal lost' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('No redeploys left', { exact: true })).toBeVisible();
  expect(await mission(page)).toMatchObject({ phase: 'lost', loss: 'signalLost' });

  // Respawn starts a new operation from the beginning.
  await respawn(page);
  expect(await mission(page)).toMatchObject({ phase: 'breach', redeploys: 2, hack: { progress: 0 }, core: { state: 'hidden' } });

  // Through to the extraction, then let its countdown run out away from the point.
  for (const stage of ['fetch', 'defend', 'extract']) {
    await page.evaluate(() => window.__gameDebug!.completeMissionStage());
    expect((await mission(page)).phase).toBe(stage);
  }
  await page.evaluate(() => window.__gameDebug!.advanceMission(61));
  await expect(page.getByRole('heading', { name: 'Signal lost' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('The extraction window closed', { exact: true })).toBeVisible();
  expect(await mission(page)).toMatchObject({ phase: 'lost', loss: 'extractionMissed', extractionLeft: 0 });
});
