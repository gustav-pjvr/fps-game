import { test, expect, type Page } from '@playwright/test';
import { lockPointer, waitForGameTime } from './helpers.ts';

async function joinRoom(page: Page, code: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await page.getByPlaceholder('ABCDEF').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
}

async function waitForMatch(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 90000 });
}

async function faceDoor(page: Page, sideOffset = 0): Promise<void> {
  await lockPointer(page);
  await page.evaluate(offset => {
    const lab = window.__gameDebug!.getUndergroundDebug().labs.find(l => l.index === 0)!;
    window.__gameDebug!.teleport(lab.x + 4.8, lab.groundY + 1, lab.z + offset);
    window.__gameDebug!.lookAt(lab.x + 3, lab.groundY + 1.7, lab.z);
  }, sideOffset);
  await waitForGameTime(page, 1);
  expect(await page.evaluate(() => {
    const lab = window.__gameDebug!.getUndergroundDebug().labs.find(l => l.index === 0)!;
    return window.__gameDebug!.getActiveTowerPositions().some(t => t.x === lab.x && t.z === lab.z);
  }), 'tower 0 is streamed in before checking its door').toBe(true);
}

/** A collision ray through the entrance proves the received door state removed its collider.
 * Give network delivery and the slide up to five seconds on the receiving game's clock. */
async function expectOpen(page: Page, blockedDistance = 2): Promise<void> {
  let open = false;
  for (let elapsed = 0; elapsed < 5; elapsed += 0.5) {
    await waitForGameTime(page, 0.5);
    const ray = await page.evaluate(() => window.__gameDebug!.raycastForward());
    if ((ray.distance ?? Infinity) > blockedDistance) { open = true; break; }
  }
  expect(open, 'tower door 0 opens within five game seconds').toBe(true);
}

test('the host opening tower door 0 syncs to a guest and a late joiner', async ({ browser }) => {
  // Three browser contexts on software rendering run at about 2 frames a second each; the whole
  // host, guest and late-join sequence measured just over five minutes in this sandbox.
  test.setTimeout(600000);
  const hostContext = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const guestContext = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const lateContext = await browser.newContext({ viewport: { width: 640, height: 360 } });
  try {
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    await host.goto('/');
    await host.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
    await host.getByRole('button', { name: 'Create Room', exact: true }).click();
    await host.locator('#create-room-map').selectOption('valley');
    const codeLocator = host.locator('div').filter({ hasText: /^[A-Z2-9]{6}$/ }).last();
    await codeLocator.waitFor({ state: 'visible', timeout: 10000 });
    const code = await codeLocator.textContent();
    if (!code) throw new Error('room code never appeared');
    await joinRoom(guest, code);
    await guest.getByRole('button', { name: 'Ready', exact: true }).click({ timeout: 60000 });
    await host.getByRole('button', { name: 'Start Match', exact: true }).click({ timeout: 30000 });
    await waitForMatch(host);
    await waitForMatch(guest);
    await faceDoor(guest);
    const closed = await guest.evaluate(() => window.__gameDebug!.raycastForward());
    expect(closed.hit).toBe(true);
    expect(closed.distance).toBeLessThan(2);
    await lockPointer(host);
    expect(await host.evaluate(() => window.__gameDebug!.setTowerDoor(0, true))).toBe(true);
    await expectOpen(guest);

    // Prove the late joiner's 3 m threshold separates the two states: from the same side spot, the
    // guest's ray hits a closed door short of it.
    expect(await host.evaluate(() => window.__gameDebug!.setTowerDoor(0, false))).toBe(true);
    await waitForGameTime(guest, 2);
    await faceDoor(guest, 1.5);
    const closedAside = await guest.evaluate(() => window.__gameDebug!.raycastForward());
    expect(closedAside.hit).toBe(true);
    expect(closedAside.distance).toBeLessThan(3);
    expect(await host.evaluate(() => window.__gameDebug!.setTowerDoor(0, true))).toBe(true);
    await expectOpen(guest, 3);

    // multiplayer-four.spec.ts joins a running match directly, without a Ready step.
    const late = await lateContext.newPage();
    await joinRoom(late, code);
    await waitForMatch(late);
    await guest.evaluate(() => {
      const lab = window.__gameDebug!.getUndergroundDebug().labs.find(l => l.index === 0)!;
      window.__gameDebug!.teleport(lab.x + 8, lab.groundY + 1, lab.z - 4);
    });
    await waitForGameTime(guest, 1);
    await faceDoor(late, 1.5);
    // The side offset puts a closed door about 2.3 m away, beyond the straight-on threshold.
    await expectOpen(late, 3);
  } finally {
    await lateContext.close();
    await guestContext.close();
    await hostContext.close();
  }
});
