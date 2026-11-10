import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { lockPointer, SHIPPED_GRAPHICS, waitForGameReady } from './helpers.ts';

// The Skins screen draws its own preview, so the look matters: the shipped default graphics.
test.use({ storageState: SHIPPED_GRAPHICS });

/** Where the aimed-view screenshots go: one PNG per weapon and skin (docs/skins.md, "Evidence").
 * SKINS_SHOTS overrides it, for example to collect them outside the checkout. */
const SHOTS = process.env.SKINS_SHOTS ?? 'test-results/skins-aim';
const SKIN_IDS = ['service', 'ranger', 'whiteout', 'ember', 'gilded', 'pulse'] as const;

async function openSkins(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'SKINS', exact: true }).click();
  await expect(page.getByTestId('skins-screen')).toBeVisible();
}

async function weaponIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="skins-weapon-"]').evaluateAll((buttons) =>
    buttons.map((button) => (button as HTMLElement).dataset.testid!.replace('skins-weapon-', '')));
}

async function waitForShown(page: Page, shown: string): Promise<void> {
  await expect(page.getByTestId('skins-preview')).toHaveAttribute('data-shown', shown, { timeout: 20000 });
}

test('every weapon in every skin aims with its sight on the true aim point', async ({ page }) => {
  // 19 weapons by 6 skins, each a model build and a drawn frame on software rendering: measured
  // at about 4 minutes here.
  test.setTimeout(15 * 60 * 1000);
  mkdirSync(SHOTS, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await openSkins(page);
  const ids = await weaponIds(page);
  expect(ids.length).toBe(19);
  await page.getByTestId('skins-view-aim').click();

  const report: string[] = [];
  for (const weaponId of ids) {
    await page.getByTestId(`skins-weapon-${weaponId}`).click();
    // A blade is never aimed: its sights view is switched off and it is shown in hand instead.
    const aims = await page.getByTestId('skins-view-aim').isEnabled();
    for (const skinId of SKIN_IDS) {
      await page.getByTestId(`skins-skin-${skinId}`).click();
      await waitForShown(page, `${weaponId}:${skinId}:${aims ? 'aim' : 'hip'}`);
      await expect(page.getByTestId(`skins-skin-${skinId}`)).toHaveAttribute('aria-pressed', 'true');
      const canvas = page.getByTestId('skins-preview');
      if (aims) {
        // The middle of the picture is where a shot goes; the sight tip must be drawn on it.
        const offset = Number(await canvas.getAttribute('data-sight-offset'));
        report.push(`${weaponId}/${skinId}: ${offset.toFixed(2)} px`);
        expect(offset, `${weaponId} in ${skinId}: sight tip to screen centre, in pixels`).toBeLessThan(1);
      }
      await canvas.screenshot({ path: `${SHOTS}/${weaponId}-${skinId}.png` });
    }
  }
  console.log(`[skins] aimed sight offsets:\n${report.join('\n')}`);
  expect(errors).toEqual([]);
});

test('a skin is equipped per weapon, survives a reload and is worn in the match', async ({ page }) => {
  test.setTimeout(240000);
  await openSkins(page);
  await page.getByTestId('skins-weapon-rifle').click();
  await page.getByTestId('skins-skin-pulse').click();
  await page.getByTestId('skins-weapon-pistol').click();
  await page.getByTestId('skins-skin-gilded').click();
  await expect(page.getByTestId('skins-weapon-rifle')).toContainText('Pulse');
  await expect(page.getByTestId('skins-weapon-pistol')).toContainText('Gilded Goose');
  await expect(page.getByTestId('skins-weapon-smg')).toContainText('Service');

  // Saved at once: a reload keeps both.
  await openSkins(page);
  await expect(page.getByTestId('skins-weapon-rifle')).toContainText('Pulse');
  await expect(page.getByTestId('skins-weapon-pistol')).toContainText('Gilded Goose');
  await page.getByTestId('skins-weapon-rifle').click();
  await expect(page.getByTestId('skins-skin-pulse')).toHaveAttribute('aria-pressed', 'true');

  // Escape closes the page and gives the keyboard back to the main menu.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('skins-screen')).toBeHidden();

  // The Loadout page names the skin and opens Skins on the weapon in view.
  await page.getByRole('button', { name: 'LOADOUT', exact: true }).click();
  await expect(page.getByTestId('loadout-skin')).toContainText('Pulse');
  await page.getByTestId('loadout-change-skin').click();
  await expect(page.getByTestId('skins-weapon-rifle')).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('skins-skin-ember').click();
  await page.getByTestId('skins-screen').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('loadout-skin')).toContainText('Ember');
  await page.getByTestId('loadout-screen').getByRole('button', { name: 'Close', exact: true }).click();

  // The match wears it: the rifle in hand is in Ember, the pistol in Gilded Goose.
  await waitForGameReady(page);
  await lockPointer(page);
  expect(await page.evaluate(() => window.__gameDebug?.getHeldWeapon())).toEqual({ weaponId: 'rifle', skinId: 'ember' });
  await page.keyboard.press('Digit2');
  await page.waitForFunction(() => window.__gameDebug?.getHeldWeapon().weaponId === 'pistol', undefined, { timeout: 20000 });
  expect(await page.evaluate(() => window.__gameDebug?.getHeldWeapon().skinId)).toBe('gilded');
});
