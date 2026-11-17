// Frame sequences of the first-person weapon view in a real match, for judging hand and weapon
// animation by eye: the inspect, a blade's draw and attacks, walking, sprinting, a reload.
// Needs `npm run dev -- --port <port> --strictPort` running in this checkout.
//   node scripts/viewShots.mjs --port 5191 --out C:/tmp/shots --seq inspect,knife,move,reload
// Each sequence is saved as one contact sheet (frames left to right, top to bottom), cropped to the
// lower part of the screen where the weapon is. The game's clock is held and stepped between
// frames (--step seconds, default 0.12), so the frames are evenly spaced however slow the machine is.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => {
  if (word.startsWith('--')) pairs.push([word.slice(2), all[i + 1] ?? '']);
  return pairs;
}, []));
const port = args.port ?? '5173';
const out = args.out ?? 'test-results/view-shots';
const sequences = (args.seq ?? 'inspect,knife,move,reload').split(',');
const WIDTH = 960, HEIGHT = 540;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  storageState: { cookies: [], origins: [{ origin: `http://localhost:${port}`, localStorage: [{ name: 'fps-game-settings-v1', value: JSON.stringify({ graphicsQuality: 'low' }) }] }] },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
await page.goto(`http://localhost:${port}/`);
await page.getByRole('button', { name: 'PLAY', exact: true }).click();
await page.getByRole('button', { name: 'Start Match', exact: true }).click();
await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 120000 });
// Pointer lock, as a player clicking into the game.
for (let attempt = 0; attempt < 20; attempt++) {
  if (await page.evaluate(() => window.__gameDebug.isPointerLocked())) break;
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  // The pause menu may close between the look and the click: a missed click is tried again.
  if (await resume.isVisible().catch(() => false)) await resume.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}
await page.evaluate(() => window.__gameDebug.setPlayerInvulnerable(true));
const stepSeconds = Number(args.step ?? 0.12);
await page.evaluate(() => window.__gameDebug.holdTime(true));
const advance = (seconds) => page.evaluate((s) => window.__gameDebug.stepTime(s), seconds);

/** Takes `count` frames one after another and saves them as a sheet named `name`. */
async function sheet(name, count, before, step = stepSeconds) {
  if (before) await before();
  const frames = [];
  for (let i = 0; i < count; i++) {
    await advance(step);
    frames.push((await page.screenshot({ timeout: 180000, clip: { x: 0, y: HEIGHT * 0.3, width: WIDTH, height: HEIGHT * 0.7 } })).toString('base64'));
  }
  // Lay the frames out with the browser itself: no image library needed.
  const cols = Math.min(4, count);
  const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},480px);gap:4px;font:12px monospace;color:#fff">${frames.map((f, i) => `<div style="position:relative"><img src="data:image/png;base64,${f}" width="480"><span style="position:absolute;left:4px;top:2px;background:#000a;padding:0 4px">${name} ${i}</span></div>`).join('')}</body>`;
  const sheetPage = await context.newPage();
  await sheetPage.setViewportSize({ width: cols * 484, height: Math.ceil(count / cols) * 194 });
  await sheetPage.setContent(html);
  await sheetPage.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  await sheetPage.close();
  console.log(`${out}/${name}.png`);
}

const key = (code) => page.keyboard.press(code);
const settle = () => advance(1.5);

if (sequences.includes('inspect')) {
  await settle();
  await sheet('rifle-inspect', 16, () => key('KeyG'), 0.2);
  await key('Digit2');
  await settle();
  await sheet('pistol-inspect', 16, () => key('KeyG'), 0.2);
}
if (sequences.includes('knife')) {
  await sheet('knife-draw', 8, () => key('Digit3'), 0.08);
  await settle();
  await sheet('knife-slash', 8, () => page.mouse.click(WIDTH / 2, HEIGHT / 2), 0.05);
  await settle();
  await sheet('knife-slash-2', 8, () => page.mouse.click(WIDTH / 2, HEIGHT / 2), 0.05);
  await settle();
  await page.mouse.down({ button: 'right' });
  await advance(0.1);
  await sheet('knife-stab', 8, () => page.mouse.click(WIDTH / 2, HEIGHT / 2), 0.06);
  await page.mouse.up({ button: 'right' });
  await settle();
  await sheet('knife-inspect', 12, () => key('KeyG'), 0.25);
}
if (sequences.includes('move')) {
  await key('Digit1');
  await settle();
  await page.keyboard.down('KeyW');
  await sheet('rifle-walk', 8);
  await page.keyboard.down('ShiftLeft');
  await sheet('rifle-sprint', 8);
  await page.keyboard.up('ShiftLeft');
  await sheet('rifle-sprint-stop', 4);
  await page.keyboard.up('KeyW');
  await key('Digit3');
  await settle();
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await sheet('knife-sprint', 6);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
}
if (sequences.includes('reload')) {
  await key('Digit1');
  await settle();
  await page.mouse.down();
  await advance(1.2);
  await page.mouse.up();
  await advance(0.3);
  await sheet('rifle-reload', 12, () => key('KeyR'), 0.18);
  await page.mouse.down({ button: 'right' });
  await sheet('rifle-aim', 4);
  await page.mouse.up({ button: 'right' });
}
writeFileSync(`${out}/errors.txt`, errors.join('\n'));
if (errors.length) console.error(`Page errors:\n${[...new Set(errors)].join('\n')}`);
await browser.close();
