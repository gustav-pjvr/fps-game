import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SHIPPED_GRAPHICS } from './helpers.ts';

// Accessibility and layout are judged on what players get by default.
test.use({ storageState: SHIPPED_GRAPHICS });

// The site-qa guards for the v4.0 menu reskin (docs/visual-overhaul-ui.md): each menu screen at
// desktop and phone width, failing on console errors, uncaught errors, 5xx responses, axe
// violations and anything laid out past the viewport. The game itself is desktop only; the menus
// still have to hold together on a narrow window.

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

/** Each screen as the main menu button that opens it; null is the title screen itself. */
const SCREENS: { name: string; open: string | null }[] = [
  { name: 'title', open: null },
  { name: 'match setup', open: 'PLAY' },
  { name: 'multiplayer', open: 'MULTIPLAYER' },
  { name: 'loadout', open: 'LOADOUT' },
  { name: 'skins', open: 'SKINS' },
  { name: 'settings', open: 'SETTINGS' },
];

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) problems.push(`${res.status()} on ${res.url()}`);
  });
  return problems;
}

/** Every visible button, heading, label and input must sit inside the viewport horizontally. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, h1, h2, h3, label, input, select')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (rect.left < -1 || rect.right > width + 1) out.push(`${el.tagName} "${(el.textContent ?? '').trim().slice(0, 40)}" spans ${Math.round(rect.left)} to ${Math.round(rect.right)} of ${width}`);
    }
    return out;
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`menu guards at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const screen of SCREENS) {
      test(`${screen.name}: no errors, no 5xx, no axe violations, nothing off screen`, async ({ page }) => {
        test.setTimeout(120000);
        const problems = watch(page);
        await page.goto('/');
        await page.getByRole('button', { name: 'PLAY', exact: true }).waitFor({ state: 'visible', timeout: 60000 });
        if (screen.open) await page.getByRole('button', { name: screen.open, exact: true }).click();
        // Panels enter with a 180 ms fade; let it settle before measuring contrast.
        await page.waitForTimeout(1500);

        const results = await new AxeBuilder({ page }).analyze();
        for (const v of results.violations) {
          problems.push(`axe ${v.id} (${v.impact}): ${v.help} at ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
        }
        problems.push(...(await overflowing(page)));
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  });
}

test('F01-H1 a keyboard alone opens match setup, picks Operation Uplink and cancels', async ({ page }) => {
  test.setTimeout(120000);
  const problems = watch(page);
  await page.goto('/');
  const play = page.getByRole('button', { name: 'PLAY', exact: true });
  await play.waitFor({ state: 'visible', timeout: 60000 });
  await play.focus();
  // Focus is visible: the menu stylesheet draws an accent outline on :focus-visible.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(play).toBeFocused();
  expect(await play.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');

  const mission = page.getByRole('radio', { name: /Operation Uplink/ });
  await expect(mission).toBeVisible();
  await mission.focus();
  await page.keyboard.press('Space');
  await expect(mission).toBeChecked();
  // Labels are tied to their controls, so a count field is reachable by its name.
  await expect(page.getByLabel(/Enemies/)).toHaveValue(/\d+/);

  await page.keyboard.press('Escape');
  await expect(mission).toBeHidden();
  await expect(play).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('F01-E1 an out-of-range enemy count is clamped, not passed through', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const max = Number(/0 to (\d+)/.exec((await page.getByText(/Enemies \(0 to/).textContent()) ?? '')?.[1]);
  expect(max).toBeGreaterThan(0);
  await page.getByLabel(/Enemies/).fill('99999');
  await page.getByLabel(/Targets/).fill('0');
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 60000 });
  await page.waitForFunction((limit) => (window.__gameDebug?.getEntityCount() ?? 0) >= limit, max, { timeout: 60000 });
  expect(await page.evaluate(() => window.__gameDebug?.getEntityCount())).toBe(max);
});
