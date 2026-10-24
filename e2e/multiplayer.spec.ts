import { test, expect } from '@playwright/test';

/** Phase 1 of MULTIPLAYER_PLAN.md: the connection layer only, no gameplay yet. Two independent
 * browser contexts (not just tabs - contexts, so there's no shared storage/state) verify that
 * create-room -> generated code -> join-room -> code entry actually establishes a real WebRTC
 * connection via the public PeerJS broker and that messages flow both ways across it. */
test('creating and joining a room establishes a working connection', async ({ browser }) => {
  // Two pages render the lobby world at once here, so each step crawls: a trace showed the guest's
  // load at 8.8 s and its MULTIPLAYER click at 10.7 s, and the 30 s default ran out with "Join Room"
  // resolved but not yet clicked (v4.0 phase 7). Nothing hung; the budget was too small.
  test.setTimeout(90000);
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
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  if (!code) throw new Error('room code never appeared');

  await guestPage.goto('/');
  await guestPage.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guestPage.getByPlaceholder('ABCDEF').fill(code);
  await guestPage.getByRole('button', { name: 'Join', exact: true }).click();

  // The guest sends `hello` once connected, and only reports back once the host's `welcome` reply
  // (assigning it a slot and the current roster) actually arrives - proves the DataChannel works
  // in both directions, not just that a connection object exists.
  await expect(hostPage.getByText('Everyone is connected. Start when ready.')).toBeVisible({ timeout: 20000 });
  await expect(guestPage.getByText('Connected. Waiting for the host…')).toBeVisible({ timeout: 20000 });

  await hostContext.close();
  await guestContext.close();
});

test('joining a nonexistent room shows an error instead of hanging', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await page.getByPlaceholder('ABCDEF').fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Join', exact: true }).click();

  await expect(page.getByText('No room found with that code.')).toBeVisible({ timeout: 15000 });
});
