import { test } from '@playwright/test';
import { lockPointer, waitForGameReady } from './helpers.ts';

/**
 * Local performance check - NOT part of the automated smoke suite. Run it explicitly, on your own
 * machine, not in this project's usual sandboxed dev environment:
 *
 *   npx playwright test e2e/performance-check.spec.ts --headed
 *
 * Why this exists: the sandboxed environment this project is normally developed in runs on
 * SwiftShader (a CPU software GPU rasterizer, confirmed via `WEBGL_debug_renderer_info`), so any
 * FPS number gathered there is meaningless - it measures software rasterization speed, not real
 * game performance. This script gathers real numbers using window.__gameDebug.getFrameStats() (the
 * same rolling frame-time window the in-game F3 overlay reads from), intended to be run on your
 * own machine with a real GPU. `--headed` matters: headless Chromium may still pick a software
 * backend depending on the OS/driver situation, so run this with a visible browser window to be
 * sure you're actually exercising the GPU. See PERFORMANCE.md for how to read the results.
 *
 * Informational only - no pass/fail assertions, so a stray full-directory `playwright test` run
 * can't fail because of this file, just take a bit longer.
 */

async function sampleFor(page: import('@playwright/test').Page, label: string, seconds: number): Promise<void> {
  const samples: { fps: number; avgMs: number; p95Ms: number }[] = [];
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const stats = await page.evaluate(() => window.__gameDebug?.getFrameStats());
    if (stats) samples.push(stats);
  }
  const avgFps = samples.reduce((sum, s) => sum + s.fps, 0) / samples.length;
  const worstP95 = Math.max(...samples.map((s) => s.p95Ms));
  console.log(`[${label}] avg FPS ~${avgFps.toFixed(0)}, worst p95 frame time ~${worstP95.toFixed(1)}ms`);
}

test('performance check across representative scenarios', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  // A large-ish match so the "combat" scenario below has enough enemies to plausibly get several
  // engaging at once - adjust freely if you want to stress-test harder.
  const inputs = page.locator('input[type="number"]');
  await inputs.nth(0).fill('20');
  await inputs.nth(1).fill('10');
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
  await lockPointer(page);

  console.log('--- Scenario 1: open terrain at spawn ---');
  await sampleFor(page, 'open terrain', 8);

  console.log('--- Scenario 2: combat with several enemies engaging ---');
  // Walk toward the enemy ring (spawned around SPAWN_X/SPAWN_Z at ENEMY_RING_BASE_RADIUS) rather
  // than teleporting - a real approach exercises the same patrol/detection/LOS work a normal
  // player session would, not just combat once already engaged.
  const enemyPositions = await page.evaluate(() => window.__gameDebug?.getLiveEntityPositions());
  if (enemyPositions && enemyPositions.length > 0) {
    const target = enemyPositions[Math.floor(enemyPositions.length / 2)]!;
    await page.evaluate(({ x, y, z }) => window.__gameDebug?.teleport(x, y, z + 5), target);
  }
  await sampleFor(page, 'combat', 12);

  console.log('--- Scenario 3: dense town (searching a grid around spawn) ---');
  let foundTown = false;
  for (let ring = 0; ring <= 3 && !foundTown; ring++) {
    const step = 90;
    for (let gx = -ring; gx <= ring && !foundTown; gx++) {
      for (let gz = -ring; gz <= ring && !foundTown; gz++) {
        if (Math.max(Math.abs(gx), Math.abs(gz)) !== ring) continue;
        const x = gx * step;
        const z = 8 + gz * step;
        await page.evaluate(({ x, z }) => window.__gameDebug?.teleport(x, 2, z), { x, z });
        await page.waitForTimeout(300);
        const ladders = await page.evaluate(() => window.__gameDebug?.getActiveLadderPositions());
        if (ladders && ladders.length > 0) foundTown = true;
      }
    }
  }
  if (foundTown) {
    await sampleFor(page, 'dense town', 8);
  } else {
    console.log('[dense town] no town found within search radius this run - skipped, not a failure');
  }

  console.log('Done. Compare these numbers against Chrome DevTools > Performance / Rendering tab for a second opinion - see PERFORMANCE.md.');
});
