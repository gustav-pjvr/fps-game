// Frames of one house window in every state of its glass (docs/glass.md), from outside and from
// inside, laid out as one contact sheet: intact, one hole, four holes, the burst (three frames with
// the game's clock held and stepped), and the open window with its shards lying.
// Needs `npx vite --port <port> --strictPort` running in this checkout.
//   node scripts/glassShots.mjs --port 5193 --out C:/tmp/shots --quality medium
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => {
  if (word.startsWith('--')) pairs.push([word.slice(2), all[i + 1] ?? '']);
  return pairs;
}, []));
const port = args.port ?? '5173';
const out = args.out ?? 'test-results/glass-shots';
const quality = args.quality ?? 'medium';
const WIDTH = 960, HEIGHT = 540;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  storageState: { cookies: [], origins: [{ origin: `http://localhost:${port}`, localStorage: [{ name: 'fps-game-settings-v1', value: JSON.stringify({ graphicsQuality: quality }) }] }] },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
await page.goto(`http://localhost:${port}/`);
await page.getByRole('button', { name: 'PLAY', exact: true }).click();
await page.getByRole('button', { name: 'Start Match', exact: true }).click();
await page.waitForFunction(() => window.__gameDebug !== undefined, undefined, { timeout: 120000 });
for (let attempt = 0; attempt < 20; attempt++) {
  if (await page.evaluate(() => window.__gameDebug.isPointerLocked())) break;
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible().catch(() => false)) await resume.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}
await page.evaluate(() => window.__gameDebug.setPlayerInvulnerable(true));
await page.waitForFunction(() => (window.__gameDebug.getGlassDebug()?.streamed ?? 0) > 0, undefined, { timeout: 120000 });

// A ground-floor window with a clear view of it from outside.
const houses = await page.evaluate(() => window.__gameDebug.getValleyHouses());
const player = await page.evaluate(() => window.__gameDebug.getPlayerPosition());
const panes = (await page.evaluate(() => window.__gameDebug.getGlassDebug().panes))
  .map((pane) => ({ pane, ground: houses.slice().sort((a, b) => Math.hypot(a.x - pane.x, a.z - pane.z) - Math.hypot(b.x - pane.x, b.z - pane.z))[0].y }))
  .filter(({ pane, ground }) => pane.y - ground < 2.4)
  .sort((a, b) => Math.hypot(a.pane.x - player.x, a.pane.z - player.z) - Math.hypot(b.pane.x - player.x, b.pane.z - player.z));

const stand = async (pane, ground, across, along = 0) => {
  const at = { x: pane.x + pane.nx * across + pane.ux * along, y: ground + 1.2, z: pane.z + pane.nz * across + pane.uz * along };
  await page.evaluate(({ x, y, z }) => window.__gameDebug.teleport(x, y, z), at);
  await page.waitForTimeout(700);
  await page.evaluate(({ x, y, z }) => window.__gameDebug.lookAt(x, y, z), { x: pane.x, y: pane.y, z: pane.z });
  await page.waitForTimeout(400);
};

let chosen = null;
for (const candidate of panes.slice(0, 8)) {
  await stand(candidate.pane, candidate.ground, 2.6);
  const ray = await page.evaluate(() => window.__gameDebug.raycastForward());
  if (!ray.hit || ray.distance > 2.9) {
    chosen = candidate;
    break;
  }
}
if (!chosen) throw new Error('no window with a clear view was found');
const { pane, ground } = chosen;

const frames = [];
const shot = async (label) => {
  frames.push({ label, data: (await page.screenshot({ timeout: 180000, clip: { x: 160, y: 60, width: 640, height: 400 } })).toString('base64') });
};
const hit = (u, v, power) => page.evaluate(({ id, u, v, power }) => window.__gameDebug.hitGlass(id, u, v, power), { id: pane.id, u, v, power });
// Outside a little off to one side, so the pane is seen at an angle; inside straight on.
const outside = () => stand(pane, ground, 2.6, 0.9);
const inside = () => stand(pane, ground, -1.5, 0);
const both = async (label) => {
  await outside();
  await shot(`${label}, outside`);
  await inside();
  await shot(`${label}, inside`);
};

await both('intact');
await hit(0.18, 0.06, 1);
await both('one hole');
await hit(-0.3, -0.15, 1);
await hit(0.02, 0.22, 1);
await hit(-0.12, 0.02, 1);
await both('four holes');

// The burst, with the clock held so each frame is an exact moment.
await outside();
await page.evaluate(() => window.__gameDebug.holdTime(true));
await hit(0, 0, 6);
for (const [index, step] of [0.05, 0.12, 0.25].entries()) {
  await page.evaluate((s) => window.__gameDebug.stepTime(s), step);
  await shot(`burst ${index + 1}`);
}
await page.evaluate(() => window.__gameDebug.stepTime(2.5));
await page.evaluate(() => window.__gameDebug.holdTime(false));
await both('broken');
// Looking down at the floor inside, where the pieces lie.
await inside();
await page.evaluate(({ x, y, z }) => window.__gameDebug.lookAt(x, y, z), { x: pane.x - pane.nx * 0.4, y: ground + 0.05, z: pane.z - pane.nz * 0.4 });
await page.waitForTimeout(400);
await shot('pieces on the floor inside');
// The sill from close by, and the ground under the window outside.
await stand(pane, ground, 1.3, 0);
await page.evaluate(({ x, y, z }) => window.__gameDebug.lookAt(x, y, z), { x: pane.x, y: pane.y - pane.halfHeight, z: pane.z });
await page.waitForTimeout(400);
await shot('the sill, close');
await page.evaluate(({ x, y, z }) => window.__gameDebug.lookAt(x, y, z), { x: pane.x + pane.nx * 0.45, y: ground + 0.02, z: pane.z + pane.nz * 0.45 });
await page.waitForTimeout(400);
await shot('pieces on the ground outside');

const cols = 4;
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},480px);gap:4px;font:12px monospace;color:#fff">${frames.map((f) => `<div style="position:relative"><img src="data:image/png;base64,${f.data}" width="480"><span style="position:absolute;left:4px;top:2px;background:#000a;padding:0 4px">${f.label}</span></div>`).join('')}</body>`;
const sheet = await context.newPage();
await sheet.setViewportSize({ width: cols * 484, height: Math.ceil(frames.length / cols) * 304 });
await sheet.setContent(html);
await sheet.screenshot({ path: `${out}/glass-${quality}.png`, fullPage: true });
console.log(`${out}/glass-${quality}.png`);
console.log('drawn:', JSON.stringify(await page.evaluate(() => window.__gameDebug.getGlassDebug().drawn)));
if (errors.length > 0) console.log('page errors:', errors);
await browser.close();
