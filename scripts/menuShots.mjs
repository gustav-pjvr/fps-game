// Screenshots of the lobby menu screens at desktop and phone width, for judging a UI change by
// eye. Needs `npm run dev -- --port <port> --strictPort` running in this checkout.
//   node scripts/menuShots.mjs --port 5191 --out C:/tmp/shots --screen WORKBENCH,LOADOUT
// --click "testid,testid" clicks those data-testid elements in order after the screen opens.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => {
  if (word.startsWith('--')) pairs.push([word.slice(2), all[i + 1] ?? '']);
  return pairs;
}, []));
const port = args.port ?? '5173';
const out = args.out ?? 'test-results/menu-shots';
const screens = (args.screen ?? 'WORKBENCH').split(',');
const clicks = args.click ? args.click.split(',') : [];
const sizes = [['desktop', 1440, 900], ['phone', 390, 844]];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const errors = [];
for (const [label, width, height] of sizes) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  for (const screen of screens) {
    await page.goto(`http://localhost:${port}/`);
    await page.getByRole('button', { name: screen, exact: true }).click({ timeout: 60000 });
    for (const id of clicks) await page.locator(`[data-testid="${id}"]`).click();
    await page.waitForTimeout(1500);
    const file = `${out}/${screen.toLowerCase()}-${label}${args.tag ? `-${args.tag}` : ''}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log(file);
  }
  await page.close();
}
await browser.close();
if (errors.length > 0) {
  console.error(`Page errors:\n${[...new Set(errors)].join('\n')}`);
  process.exit(1);
}
