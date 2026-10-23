import { test, expect, type Page } from '@playwright/test';
import { equipPistol, lockPointer } from './helpers.ts';

declare global {
  interface Window {
    __gameDebug?: {
      getScore(): number;
      getOpponentScore(): number;
      getPlayerHealth(): number;
      getOpponentPosition(): { x: number; y: number; z: number } | null;
      isMultiplayerMatchEnded(): boolean;
      lookAt(x: number, y: number, z: number): void;
      teleport(x: number, y: number, z: number): void;
      debugDisconnect(): void;
    };
  }
}

async function waitForMatchReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gameDebug !== undefined, { timeout: 20000 });
}

// Several candidate offsets to teleport the host to, relative to the opponent - a single fixed
// offset occasionally lands somewhere with terrain/geometry blocking line of sight on some of this
// test's 10 rounds, since each run generates a fresh multiplayer seed (different terrain around
// the same relative spot every time). Retrying from a different side before giving up on a round
// is cheap and matches how a real player would just reposition after a miss.
const KILL_ATTEMPT_OFFSETS: Array<[number, number]> = [
  [12, 0],
  [-12, 0],
  [0, 12],
  [0, -12],
];

/** One kill: teleport the host next to the opponent's current (already-settled) position and fire
 * until the guest's own health reads 0 - same technique as multiplayer-combat.spec.ts, reused here
 * because match-end needs several kills in a row, not just one. */
async function killOpponentOnce(hostPage: Page, guestPage: Page): Promise<void> {
  // Every round, not once: a respawn (and the Rematch's fresh match) rebuilds the default loadout,
  // which starts on the automatic rifle again (see equipPistol).
  await equipPistol(hostPage);
  for (const [offsetX, offsetZ] of KILL_ATTEMPT_OFFSETS) {
    // The opponent appears once its character has loaded, which a starved CPU can stretch past
    // the match start (2026-10-23): wait for it rather than fail the round.
    await hostPage.waitForFunction(() => window.__gameDebug?.getOpponentPosition() != null, null, { timeout: 30000 });
    const opponentPosition = await hostPage.evaluate(() => window.__gameDebug?.getOpponentPosition());
    if (!opponentPosition) throw new Error('host has no opponent position');

    await hostPage.evaluate(
      ({ x, y, z, dx, dz }) => window.__gameDebug?.teleport(x + dx, y + 8, z + dz),
      { ...opponentPosition, dx: offsetX, dz: offsetZ },
    );
    await hostPage.waitForTimeout(1000);
    await hostPage.evaluate(({ x, y, z }) => window.__gameDebug?.lookAt(x, y, z), opponentPosition);
    await hostPage.waitForTimeout(100);

    let guestHealth = 100;
    for (let i = 0; i < 6 && guestHealth > 0; i++) {
      await hostPage.mouse.down();
      await hostPage.mouse.up();
      await hostPage.waitForTimeout(300);
      guestHealth = (await guestPage.evaluate(() => window.__gameDebug?.getPlayerHealth())) ?? 100;
    }
    if (guestHealth <= 0) return;
  }
  throw new Error('failed to land the killing shot this round from any offset');
}

/** Phase 4 of MULTIPLAYER_PLAN.md: the win condition (first to killLimit) actually ends the match
 * on both sides, MatchEndScreen shows the right result to each player, and the host's Rematch
 * button starts a genuinely fresh match on the same room/connection - all verified across two real
 * browser contexts, no mocking. Uses the lowest kill-limit option (10) to keep this test's runtime
 * down; the option list itself (config.ts's MULTIPLAYER_KILL_LIMIT_OPTIONS) isn't otherwise
 * exercised end-to-end here. */
test('reaching the kill limit ends the match for both players, and Rematch starts a fresh one', async ({ browser }) => {
  // 10 full kill/respawn cycles, each already ~10-20s in this environment's software-rendered
  // sandbox (see PERFORMANCE.md - single-digit real FPS here, unrelated to MULTIPLAYER_RESPAWN_DELAY
  // itself, which is wall-clock, not frame-count, based), plus occasional offset retries within a
  // round (see KILL_ATTEMPT_OFFSETS) - generous headroom, not padding for its own sake.
  test.setTimeout(600000);
  const KILL_LIMIT = 10;

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  await hostPage.goto('/');
  await hostPage.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await hostPage.getByRole('button', { name: 'Create Room', exact: true }).click();

  const codeLocator = hostPage.locator('div').filter({ hasText: /^[A-Z2-9]{6}$/ }).last();
  await codeLocator.waitFor({ state: 'visible', timeout: 10000 });
  const code = await codeLocator.textContent();
  if (!code) throw new Error('room code never appeared');

  // Kill limit defaults to 15 (DEFAULT_MULTIPLAYER_KILL_LIMIT) - explicitly picks the lowest option
  // instead, since this test needs to actually reach it, not just start a match.
  // The kill limit is a free number input since v3.2.0; the old first-<select> target now hits the
  // goose difficulty dropdown instead. `:visible` because the (hidden) podium's rematch panel has a
  // kill-limit input of its own.
  await hostPage.locator('input[type="number"]:visible').fill(String(KILL_LIMIT));

  await guestPage.goto('/');
  await guestPage.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guestPage.getByPlaceholder('ABCDEF').fill(code);
  await guestPage.getByRole('button', { name: 'Join', exact: true }).click();

  // The lobby ready check (v3.9.0) keeps Start Match disabled until every guest clicks Ready.
  await guestPage.getByRole('button', { name: 'Ready', exact: true }).click();
  const startButton = hostPage.getByRole('button', { name: 'Start Match', exact: true });
  await startButton.waitFor({ state: 'visible', timeout: 20000 });
  await startButton.click();

  await waitForMatchReady(hostPage);
  await waitForMatchReady(guestPage);
  await lockPointer(hostPage);
  await lockPointer(guestPage);

  for (let kill = 0; kill < KILL_LIMIT; kill++) {
    const alreadyEnded = await hostPage.evaluate(() => window.__gameDebug?.isMultiplayerMatchEnded());
    if (alreadyEnded) break;

    await killOpponentOnce(hostPage, guestPage);

    // Wait for the guest to either respawn (mid-match) or for the match to end outright (the
    // final kill) before the next round - firing at a dead-and-not-yet-respawned or already-frozen
    // opponent would just waste shots.
    await guestPage.waitForFunction(
      () => window.__gameDebug?.isMultiplayerMatchEnded() === true || window.__gameDebug?.getPlayerHealth() === 100,
      { timeout: 15000 },
    );
  }

  // Both sides detect the win condition independently off their own local counters
  // (MULTIPLAYER_PLAN.md §4/§6) - confirms both actually converged on the same outcome, not just
  // that the host's own count reached the limit.
  await hostPage.waitForFunction(() => window.__gameDebug?.isMultiplayerMatchEnded() === true, { timeout: 5000 });
  await guestPage.waitForFunction(() => window.__gameDebug?.isMultiplayerMatchEnded() === true, { timeout: 5000 });
  expect(await hostPage.evaluate(() => window.__gameDebug?.getScore())).toBe(KILL_LIMIT);
  expect(await guestPage.evaluate(() => window.__gameDebug?.getOpponentScore())).toBe(KILL_LIMIT);

  const matchEndScreen = hostPage.locator('[data-testid="match-end-screen"]');
  await expect(matchEndScreen).toBeVisible();
  await expect(matchEndScreen).toContainText('VICTORY');
  await expect(guestPage.locator('[data-testid="match-end-screen"]')).toContainText('DEFEAT');

  // Only the host ever sees Rematch (MatchEndScreen's own rule - the guest just gets swept along
  // once the host actually clicks it).
  const rematchButton = hostPage.getByRole('button', { name: 'Rematch', exact: true });
  await expect(rematchButton).toBeVisible();
  await expect(guestPage.getByRole('button', { name: 'Rematch', exact: true })).toBeHidden();

  await rematchButton.click();

  // A fresh Game instance on both sides - __gameDebug gets reinstalled by the new Game.create(),
  // and score/health/match-ended state all reset, confirming this is a genuinely new match rather
  // than the old frozen one still sitting underneath.
  await hostPage.waitForFunction(() => window.__gameDebug?.getScore() === 0, { timeout: 20000 });
  await guestPage.waitForFunction(() => window.__gameDebug?.getScore() === 0, { timeout: 20000 });
  expect(await hostPage.evaluate(() => window.__gameDebug?.isMultiplayerMatchEnded())).toBe(false);
  expect(await guestPage.evaluate(() => window.__gameDebug?.isMultiplayerMatchEnded())).toBe(false);
  await expect(matchEndScreen).toBeHidden();

  await hostContext.close();
  await guestContext.close();
});

/** The other half of phase 4's lifecycle work: a mid-match disconnect ends the match too, rather
 * than leaving the remaining player's RemotePlayer frozen in place forever with no way out short
 * of a page reload (the pre-phase-4 behavior). No Rematch option here - the connection itself is gone. */
test('the host disconnecting mid-match ends it for the guest', async ({ browser }) => {
  // Measured 2026-10-23 on SwiftShader with the v4 characters: creating, joining and starting the
  // match alone takes about 50 s here on Low graphics (a click 5 to 10 s, the second page's load
  // 7 s), and a 90 s budget ran out with every step still advancing (docs/testing.md).
  test.setTimeout(150000);

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  await hostPage.goto('/');
  await hostPage.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await hostPage.getByRole('button', { name: 'Create Room', exact: true }).click();

  const codeLocator = hostPage.locator('div').filter({ hasText: /^[A-Z2-9]{6}$/ }).last();
  await codeLocator.waitFor({ state: 'visible', timeout: 10000 });
  const code = await codeLocator.textContent();
  if (!code) throw new Error('room code never appeared');

  await guestPage.goto('/');
  await guestPage.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guestPage.getByPlaceholder('ABCDEF').fill(code);
  await guestPage.getByRole('button', { name: 'Join', exact: true }).click();

  // The lobby ready check (v3.9.0) keeps Start Match disabled until every guest clicks Ready.
  await guestPage.getByRole('button', { name: 'Ready', exact: true }).click();
  const startButton = hostPage.getByRole('button', { name: 'Start Match', exact: true });
  await startButton.waitFor({ state: 'visible', timeout: 20000 });
  await startButton.click();

  await waitForMatchReady(hostPage);
  await waitForMatchReady(guestPage);
  await lockPointer(hostPage);
  await lockPointer(guestPage);

  // Uses the debugDisconnect hook rather than closing the guest's page/context: a real vanished
  // opponent is detected via WebRTC's own close/ICE-failure signals, which have no bound on how
  // long they take to fire (confirmed experimentally - neither event arrived within 90s of closing
  // the guest's tab in this environment) - that timing is WebRTC's concern, not this feature's. This
  // still exercises the exact product code path (PeerConnection 'close' -> Game's onDisconnected ->
  // endMultiplayerMatch), just triggered deterministically instead of waiting on browser teardown.
  //
  // Disconnects the HOST: since 4-player lobbies (v2.1.0) a guest leaving deliberately does NOT end
  // the match for the host (the rest of the room keeps playing, see Game.ts's onPeerDisconnected),
  // so the old guest-disconnects-then-host-ends expectation could never pass. A guest's only
  // connection is to the host, and losing it always ends the guest's match.
  await hostPage.evaluate(() => window.__gameDebug?.debugDisconnect());

  await guestPage.waitForFunction(() => window.__gameDebug?.isMultiplayerMatchEnded() === true, { timeout: 15000 });
  const matchEndScreen = guestPage.locator('[data-testid="match-end-screen"]');
  await expect(matchEndScreen).toBeVisible();
  await expect(matchEndScreen).toContainText('OPPONENT DISCONNECTED');
  // Rematch is host-only, and there is no connection left to rematch over anyway.
  await expect(guestPage.getByRole('button', { name: 'Rematch', exact: true })).toBeHidden();

  await hostContext.close();
  await guestContext.close();
});
