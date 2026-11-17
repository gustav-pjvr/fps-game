import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The sound test page (soundlab.html, docs/sound.md) at desktop and phone width: no console errors,
// no axe violations, nothing laid out past the viewport, tap targets a thumb can hit, the place
// chooser usable by keyboard, a Play press starts audio, and the engine behind it places a sound
// on the side it comes from. How the sounds sound is for a person: scripts/soundRender.mjs measures
// the rest.

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
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

for (const vp of VIEWPORTS) {
  test.describe(`sound test page at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('holds together, is accessible and plays', async ({ page }) => {
      test.setTimeout(120000);
      const problems = watch(page);
      await page.goto('/soundlab.html');
      await page.waitForFunction(() => window.__soundLab !== undefined);

      // The page itself never scrolls sideways (the phone's place chooser scrolls inside its own row).
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      // Every Play button and switch is a full tap target.
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('button.play, button.toggle, a.back'))
          .map((el) => ({ text: (el.textContent ?? '').trim(), rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.height < 44 || rect.width < 44)
          .map(({ text }) => text));
      expect(small).toEqual([]);

      // One Play button per sound that has a place, one Mine or Play per sound of the player's own.
      const counts = await page.evaluate(() => ({
        sounds: window.__soundLab.sounds.length,
        rows: document.querySelectorAll('.sound').length,
      }));
      expect(counts.rows).toBe(counts.sounds);
      expect(counts.sounds).toBeGreaterThan(60);

      // The place chooser is a radio group: one tab stop, arrows move, the choice is marked.
      const near = page.getByRole('radio', { name: 'Near', exact: true });
      await near.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('radio', { name: 'Left', exact: true })).toHaveAttribute('aria-checked', 'true');
      await expect(near).toHaveAttribute('aria-checked', 'false');
      await page.getByRole('radio', { name: 'Behind a wall', exact: true }).click();
      await expect(page.locator('.hint')).toContainText('wall');

      // A press plays: the status line says what and from where.
      await page.getByRole('button', { name: 'Play from the chosen place: Rifle', exact: true }).click();
      await expect(page.locator('#status')).toHaveText('Rifle: behind a wall');
      await page.getByRole('button', { name: 'Play as your own: Rifle', exact: true }).click();
      await expect(page.locator('#status')).toHaveText('Rifle: your own');

      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes.length} node(s)`)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

test('the engine behind the page puts a sound on the side it comes from, and a wall muffles it', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/soundlab.html');
  await page.waitForFunction(() => window.__soundLab !== undefined);
  const measured = await page.evaluate(async () => {
    const lab = window.__soundLab;
    return {
      left: await lab.measure('glassBreak', { placement: 'left' }),
      right: await lab.measure('glassBreak', { placement: 'right' }),
      open: await lab.measure('glassBreak', { at: { x: 0, y: 0, z: -8 } }),
      wall: await lab.measure('glassBreak', { placement: 'wall' }),
      pane: await lab.measure('glassBreak', { placement: 'glass' }),
    };
  });
  const level = (m: { left: number; right: number }): number => Math.hypot(m.left, m.right);
  expect(measured.left.left).toBeGreaterThan(measured.left.right * 1.5);
  expect(measured.right.right).toBeGreaterThan(measured.right.left * 1.5);
  expect(level(measured.wall)).toBeLessThan(level(measured.pane));
  expect(level(measured.pane)).toBeLessThan(level(measured.open));
  expect(measured.wall.brightness).toBeLessThan(measured.open.brightness);
  expect(measured.open.peak).toBeLessThanOrEqual(1);
});
