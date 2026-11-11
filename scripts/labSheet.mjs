// One contact sheet of weapon lab frames (weaponlab.html), for judging models, attachments and
// reloads by eye without one screenshot per frame. Needs the dev server running.
//   node scripts/labSheet.mjs <port> <out.png> <columns> "w=rifle&view=hip&cross=0&reload=0.8" "w=lmg&a=all&view=display&spin=2.35&pitch=0.3" ...
import { chromium } from '@playwright/test';
const [port, out, cols, ...queries] = process.argv.slice(2);
const W = 640, H = 360;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const frames = [];
for (const q of queries) {
  await page.goto(`http://localhost:${port}/weaponlab.html?${q}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(350);
  frames.push([q, (await page.screenshot()).toString('base64')]);
}
const n = Number(cols);
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${n},${W}px);gap:4px;font:12px monospace;color:#fff">${frames.map(([q, f]) => `<div style="position:relative"><img src="data:image/png;base64,${f}" width="${W}"><span style="position:absolute;left:4px;top:2px;background:#000a;padding:0 4px">${q.replace(/&/g, ' ')}</span></div>`).join('')}</body>`;
const sheet = await context.newPage();
await sheet.setViewportSize({ width: n * (W + 4), height: Math.ceil(frames.length / n) * (H + 4) });
await sheet.setContent(html);
await sheet.screenshot({ path: out, fullPage: true });
await browser.close();
if (errors.length) console.error([...new Set(errors)].join('\n'));
console.log(out);
