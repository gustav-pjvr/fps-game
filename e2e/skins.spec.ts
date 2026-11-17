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
  await page.getByRole('button', { name: 'WORKBENCH', exact: true }).click();
  await expect(page.getByTestId('skins-screen')).toBeVisible();
}

/** Picks a weapon from the Workbench's weapon list, which is a sheet opened from the header. */
async function pickWeapon(page: Page, weaponId: string): Promise<void> {
  await page.getByTestId('workbench-weapons').click();
  await page.getByTestId(`skins-weapon-${weaponId}`).click();
}

async function weaponIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="skins-weapon-"]').evaluateAll((buttons) =>
    buttons.map((button) => (button as HTMLElement).dataset.testid!.replace('skins-weapon-', '')));
}

async function waitForShown(page: Page, shown: string): Promise<void> {
  await expect(page.getByTestId('skins-preview')).toHaveAttribute('data-shown', shown, { timeout: 20000 });
}

test('every weapon in every skin aims with its sight on the true aim point', async ({ page }) => {
  // 19 weapons by 6 skins, each a model build and a drawn frame on software rendering: about 4
  // minutes on a quiet machine, and over 15 with other browser runs going at the same time.
  test.setTimeout(45 * 60 * 1000);
  mkdirSync(SHOTS, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await openSkins(page);
  const ids = await weaponIds(page);
  expect(ids.length).toBe(19);
  await page.getByTestId('skins-view-aim').click();

  const report: string[] = [];
  for (const weaponId of ids) {
    await pickWeapon(page, weaponId);
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
  await pickWeapon(page, 'rifle');
  await page.getByTestId('skins-skin-pulse').click();
  await pickWeapon(page, 'pistol');
  await page.getByTestId('skins-skin-gilded').click();
  await expect(page.getByTestId('skins-weapon-rifle')).toContainText('Pulse');
  await expect(page.getByTestId('skins-weapon-pistol')).toContainText('Gilded Goose');
  await expect(page.getByTestId('skins-weapon-smg')).toContainText('Service');

  // Saved at once: a reload keeps both.
  await openSkins(page);
  await expect(page.getByTestId('skins-weapon-rifle')).toContainText('Pulse');
  await expect(page.getByTestId('skins-weapon-pistol')).toContainText('Gilded Goose');
  await pickWeapon(page, 'rifle');
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

test('attachments fit only the guns that take them, swap on one rail and survive a reload', async ({ page }) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await openSkins(page);
  const canvas = page.getByTestId('skins-preview');

  // The rifle takes both: each card is a toggle, and the preview is rebuilt with the unit on.
  await pickWeapon(page, 'rifle');
  await page.getByTestId('workbench-tab-attachments').click();
  await page.getByTestId('workbench-attachment-torch').click();
  await page.getByTestId('workbench-attachment-laser').click();
  await expect(page.getByTestId('workbench-attachment-laser')).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-fitted', 'laser+torch');
  await expect(page.getByTestId('workbench-meta')).toContainText('Laser sight, Weapon torch');

  // The rack turns under the mouse without an error.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();

  // The sniper rifle takes none, and says so; the shotgun is offered the torch alone.
  await pickWeapon(page, 'sniper');
  await expect(page.getByTestId('workbench-no-attachments')).toBeVisible();
  await expect(page.getByTestId('workbench-attachment-laser')).toHaveCount(0);
  await pickWeapon(page, 'shotgun');
  await expect(page.getByTestId('workbench-attachment-torch')).toBeVisible();
  await expect(page.getByTestId('workbench-attachment-laser')).toHaveCount(0);

  // One rail on the pistol: the second unit takes the first one off.
  await pickWeapon(page, 'pistol');
  await page.getByTestId('workbench-attachment-laser').click();
  await page.getByTestId('workbench-attachment-torch').click();
  await expect(page.getByTestId('workbench-attachment-laser')).toHaveAttribute('aria-pressed', 'false');
  await expect(canvas).toHaveAttribute('data-fitted', 'torch');

  // Saved at once: a reload keeps the fit, and the Loadout names it.
  await openSkins(page);
  await pickWeapon(page, 'rifle');
  await expect(canvas).toHaveAttribute('data-fitted', 'laser+torch');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'LOADOUT', exact: true }).click();
  await expect(page.getByTestId('loadout-skin')).toContainText('laser sight, weapon torch');
  expect(errors).toEqual([]);
});
