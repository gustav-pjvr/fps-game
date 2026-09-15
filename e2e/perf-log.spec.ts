import { test } from '@playwright/test';
import { lockPointer } from './helpers.ts';

/**
 * Enemy AI v2 performance log run (docs/enemy-ai-v2.md, task 3) - NOT part of the smoke suite.
 * Starts a solo match, prints the game's own once-a-second perf rows (core/perfStats.ts) while the
 * player stands at spawn, then while a real fight runs around them, and ends with a summary of
 * both phases. The player is made invulnerable for the run so a long fight never ends in a death
 * screen, which freezes single-player simulation.
 *
 *   npx playwright test e2e/perf-log.spec.ts                 (headless: CPU numbers only)
 *   npx playwright test e2e/perf-log.spec.ts --headed        (real GPU: FPS numbers mean something)
 *
 * PERF_ENEMIES (default 20) and PERF_SECONDS (combat length, default 30) are optional overrides.
 * In the SwiftShader sandbox, FPS and render time are meaningless, but the per-tick AI, physics
 * and world times plus raycasts per second are CPU work and compare fairly across builds.
 */

const ENEMIES = Number(process.env.PERF_ENEMIES ?? 20);
const COMBAT_SECONDS = Number(process.env.PERF_SECONDS ?? 30);
const BASELINE_SECONDS = 10;

interface Row {
  t: number;
  fps: number;
  ticks: number;
  physicsMs: number;
  worldMs: number;
  aiMs: number;
  aiMsMax: number;
  raycastsPerSec: number;
  tacticalRaysPerSec: number;
  budgetExhaustedPercent: number;
  tacticalPicks: number;
  unreachablePercent: number;
  enemies: number;
  states: Record<string, number>;
}

function summarize(label: string, rows: Row[]): void {
  if (rows.length === 0) {
    console.log(`[summary] ${label}: no rows recorded`);
    return;
  }
  const avg = (pick: (row: Row) => number): string => (rows.reduce((sum, row) => sum + pick(row), 0) / rows.length).toFixed(2);
  const worstAi = Math.max(...rows.map((row) => row.aiMsMax)).toFixed(2);
  const engaged = rows.reduce((sum, row) => sum + (row.states.chase ?? 0) + (row.states.alert ?? 0), 0) / rows.length;
  const last = rows[rows.length - 1]!;
  console.log(
    `[summary] ${label}: ${rows.length} rows | fps ${avg((r) => r.fps)} | ticks/s ${avg((r) => r.ticks)} | per tick: ai ${avg((r) => r.aiMs)}ms (worst ${worstAi}) physics ${avg((r) => r.physicsMs)}ms world ${avg((r) => r.worldMs)}ms | rays ${avg((r) => r.raycastsPerSec)}/s (tactical ${avg((r) => r.tacticalRaysPerSec ?? 0)}/s, budget out ${avg((r) => r.budgetExhaustedPercent ?? 0)}% of ticks) | spots picked ${last.tacticalPicks ?? 0}, ${last.unreachablePercent ?? 0}% unreachable | enemies alerted or chasing ${engaged.toFixed(1)} on average`,
  );
}

test('perf log: baseline at spawn, then a sustained fight', async ({ page }) => {
  test.setTimeout((BASELINE_SECONDS + COMBAT_SECONDS + 120) * 1000);
  page.on('console', (message) => {
    if (message.text().startsWith('[perf]')) console.log(message.text());
  });

  await page.goto('/?perflog');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  // Visible only: the page also holds a hidden number input elsewhere (min 1, max 100) that comes
  // first in DOM order, so an unfiltered locator waits forever on it.
  const counts = page.locator('input[type="number"]:visible');
  await counts.nth(0).fill(String(ENEMIES));
  await counts.nth(1).fill('0');
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 60000 });
  await lockPointer(page);
  await page.evaluate(() => window.__gameDebug?.setPlayerInvulnerable(true));

  console.log(`--- baseline: ${ENEMIES} enemies, player standing at spawn for ${BASELINE_SECONDS}s ---`);
  const baselineStart = await page.evaluate(() => window.__gameDebug?.getPerfLog().length ?? 0);
  await page.waitForTimeout(BASELINE_SECONDS * 1000);
  const baselineEnd = await page.evaluate(() => window.__gameDebug?.getPerfLog().length ?? 0);

  console.log(`--- fight: every 3s the player steps 8 m from the nearest idle enemy and fires into the air, for ${COMBAT_SECONDS}s ---`);
  const deadline = Date.now() + COMBAT_SECONDS * 1000;
  while (Date.now() < deadline) {
    await lockPointer(page);
    // Standing still in one spot only ever engaged a couple of enemies (the first baseline run
    // averaged 0.3 alerted or chasing), so each round moves next to an enemy that is still idle and
    // pulls it in too, building up a real multi-enemy fight. Shots go straight up: everything within
    // hearing range reacts, nothing gets killed, and the enemy count stays constant for a fair
    // comparison between builds.
    const snapshot = await page.evaluate(() => ({
      player: window.__gameDebug?.getPlayerPosition(),
      positions: window.__gameDebug?.getLiveEntityPositions() ?? [],
      states: window.__gameDebug?.getLiveEntityStates() ?? [],
    }));
    const player = snapshot.player;
    if (player) {
      let nearest: { x: number; y: number; z: number } | undefined;
      let nearestDistance = Infinity;
      snapshot.positions.forEach((position, index) => {
        if (snapshot.states[index] !== 'idle') return;
        const distance = Math.hypot(position.x - player.x, position.z - player.z);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = position;
        }
      });
      if (nearest) {
        const target = nearest;
        await page.evaluate(({ x, y, z }) => window.__gameDebug?.teleport(x + 8, y + 1, z), target);
      }
      const eye = await page.evaluate(() => window.__gameDebug?.getPlayerPosition());
      if (eye) await page.evaluate(({ x, y, z }) => window.__gameDebug?.lookAt(x, y + 100, z), eye);
    }
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.waitForTimeout(2750);
  }

  const rows = (await page.evaluate(() => window.__gameDebug?.getPerfLog() ?? [])) as Row[];
  summarize('baseline', rows.slice(baselineStart, baselineEnd));
  summarize('fight', rows.slice(baselineEnd));
});
