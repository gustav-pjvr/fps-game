// Screenshots of weapon models from the dev-only weapon lab (weaponlab.html), for judging a model
// by eye. Needs `npm run dev -- --port <port> --strictPort` running in this checkout.
//   node scripts/weaponShots.mjs --port 5191 --out C:/tmp/shots --w rifle,pistol --k service,pulse --view display,hip,aim
// --spin sets the turntable angle of the display view (radians, default 1.15; -1.15 shows the far side).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => {
  if (word.startsWith('--')) pairs.push([word.slice(2), all[i + 1] ?? '']);
  return pairs;
}, []));
const port = args.port ?? '5173';
const out = args.out ?? 'test-results/weapon-shots';
const weapons = (args.w ?? 'rifle').split(',');
const skins = (args.k ?? 'service').split(',');
const views = (args.view ?? 'display,hip,aim').split(',');
const spin = args.spin ?? '1.15';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(args.width ?? 960), height: Number(args.height ?? 540) } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
for (const w of weapons) {
  for (const k of skins) {
    for (const view of views) {
      await page.goto(`http://localhost:${port}/weaponlab.html?w=${w}&k=${k}&view=${view}&spin=${spin}${args.extra ? `&${args.extra}` : ''}`);
      await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 }).catch(() => {});
      if (view === 'held') await page.waitForFunction(() => document.querySelector('canvas')?.dataset.held === 'ready', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(400);
      const file = `${out}/${w}-${k}-${view}${view !== 'hip' && view !== 'aim' && spin !== '1.15' ? `-${spin}` : ''}${args.tag ? `-${args.tag}` : ''}.png`;
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
}
await browser.close();
if (errors.length > 0) {
  console.error(`Page errors:\n${[...new Set(errors)].join('\n')}`);
  process.exit(1);
}
