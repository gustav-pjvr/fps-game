// Real-browser QA of the game server menu controls (site-qa, 2026-11-05): starts vite and a local relay on
// their own ports, then drives Chromium through 15 cases (F01-N3 is the stale-access-code regression).
// Run from the repo root: node scripts/relay-menu-qa.mjs. Becomes a Playwright spec in WP 9.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = 5199;
const RELAY = 6199;
const CODE = 'qa-local-only';
const BASE = `http://localhost:${PORT}`;
const children = [];
const results = [];
const consoleErrors = [];
const record = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${note}`); };

function start(cmd, args, env = {}) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, shell: true, stdio: 'ignore' });
  children.push(child);
}
async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`never came up: ${url}`);
}

start('npx', ['vite', '--port', String(PORT), '--strictPort']);
start('node', ['server/main.ts'], { HNG_ACCESS_CODES: CODE, HNG_ALLOWED_ORIGINS: BASE, HNG_HOST: '127.0.0.1', HNG_PORT: String(RELAY), HNG_LOG_LEVEL: 'warn' });
await waitFor(BASE);
await waitFor(`http://127.0.0.1:${RELAY}/healthz`);

const browser = await chromium.launch();
async function newPage(storage, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript((entries) => { for (const [k, v] of entries) localStorage.setItem(k, v); },
    [['fps-game-dev-relay-url', `ws://127.0.0.1:${RELAY}/ws`], ['fps-game-settings-v1', JSON.stringify({ graphicsQuality: 'low' })], ...storage]);
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(BASE);
  await page.getByRole('button', { name: 'MULTIPLAYER', exact: true }).click();
  return page;
}
const codeText = (page) => page.locator('div').filter({ hasText: /^([A-Z2-9]{6}|Creating…)$/ }).last();

try {
  // F01-H1: no stored code: the field shows, empty; Create Room has no Game server control (P2P as today).
  let page = await newPage([]);
  const field = page.getByLabel('Access code');
  record('F01-H1a field visible and empty', await field.isVisible() && (await field.inputValue()) === '');
  record('F01-H1b field is masked', (await field.getAttribute('type')) === 'password');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await page.waitForTimeout(1500);
  record('F01-H1c no Game server control without a code', !(await page.getByLabel('Game server').isVisible()));
  await page.context().close();

  // F01-H2: typing a code and tabbing away saves it; Create Room then shows the unticked checkbox.
  page = await newPage([]);
  await page.getByLabel('Access code').fill(CODE);
  await page.keyboard.press('Tab');
  const saved = await page.evaluate(() => localStorage.getItem('fps-game-relay-access-code'));
  record('F01-H2a code saved on blur', saved === CODE);
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  const box = page.getByLabel('Game server');
  await box.waitFor({ state: 'visible', timeout: 10000 });
  record('F01-H2b checkbox shown, off by default (P2P)', !(await box.isChecked()));
  // F01-H3: ticking it re-creates the room through the server: a fresh server code appears.
  const p2pCode = await codeText(page).textContent();
  await box.check();
  await page.waitForFunction((old) => { const t = [...document.querySelectorAll('div')].map((d) => d.textContent).find((x) => /^[A-Z2-9]{6}$/.test(x ?? '') && x !== old); return Boolean(t); }, p2pCode, { timeout: 20000 });
  const serverCode = await codeText(page).textContent();
  record('F01-H3 server room code arrives', /^[A-Z2-9]{6}$/.test(serverCode ?? '') && serverCode !== p2pCode, `${p2pCode} -> ${serverCode}`);
  record('F01-H3b preference saved', (await page.evaluate(() => localStorage.getItem('fps-game-network-transport'))) === 'server');

  // F01-H4: a guest joins through the server; the host's checkbox locks with the explaining hint.
  const guest = await newPage([['fps-game-relay-access-code', CODE]]);
  await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guest.getByPlaceholder('ABCDEF').fill(serverCode.toLowerCase());
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await guest.getByRole('button', { name: 'Ready', exact: true }).waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForFunction(() => document.querySelector('#create-room-server')?.disabled === true, undefined, { timeout: 10000 });
  record('F01-H4 checkbox locks after a guest joins', await box.isDisabled());
  record('F01-H4b locked hint shown', await page.getByText('Locked once a player has joined.').isVisible());
  await guest.context().close();
  await page.context().close();

  // F01-N1: a wrong code: host sees the access-denied text with its next step.
  page = await newPage([['fps-game-relay-access-code', 'wrong-code'], ['fps-game-network-transport', 'server']]);
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  const denied = page.getByText('That access code isn’t valid. Check it under Multiplayer.');
  await denied.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  record('F01-N1 wrong code on Create Room', await denied.isVisible());
  await page.context().close();

  // F01-N2: a guest with a wrong code joining a P2P-unknown code: falls back to P2P, ends in a readable message.
  page = await newPage([['fps-game-relay-access-code', 'wrong-code']]);
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await page.getByPlaceholder('ABCDEF').fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.waitForTimeout(8000);
  const status = await page.locator('[role=status], div').filter({ hasText: /access code|No room|Couldn’t/ }).last().textContent().catch(() => '');
  record('F01-N2 guest wrong code shows a message', Boolean(status), (status ?? '').slice(0, 90));
  await page.context().close();

  // F01-N3 (regression): a guest with a wrong stored code still joins a P2P room (falls back after the refusal).
  const p2pHost = await newPage([]);
  await p2pHost.getByRole('button', { name: 'Create Room', exact: true }).click();
  await p2pHost.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => /^[A-Z2-9]{6}$/.test(d.textContent ?? '')), undefined, { timeout: 20000 });
  const p2pRoom = await codeText(p2pHost).textContent();
  const staleGuest = await newPage([['fps-game-relay-access-code', 'old-code']]);
  await staleGuest.getByRole('button', { name: 'Join Room', exact: true }).click();
  await staleGuest.getByPlaceholder('ABCDEF').fill(p2pRoom);
  await staleGuest.getByRole('button', { name: 'Join', exact: true }).click();
  const joined = await staleGuest.getByRole('button', { name: 'Ready', exact: true }).waitFor({ state: 'visible', timeout: 40000 }).then(() => true, () => false);
  record('F01-N3 wrong stored code still joins a P2P room', joined, p2pRoom);
  await staleGuest.context().close();
  await p2pHost.context().close();

  // F01-E1: phone width: the Multiplayer menu with the field has no horizontal scroll.
  page = await newPage([], 390);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  record('F01-E1 390 px no horizontal scroll', overflow <= 0, `overflow ${overflow}px`);
  await page.screenshot({ path: 'qa-menu-390.png' });
  // F01-E2: keyboard: the field is reachable by Tab and shows a focus outline.
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => { const el = document.activeElement; return el ? { id: el.id, outline: getComputedStyle(el).outlineStyle } : null; });
  record('F01-E2 keyboard focus reaches a control with a visible outline', Boolean(focused && focused.outline !== 'none'), JSON.stringify(focused));
  // F01-E3: a 128-character paste is accepted, a longer one is cut at 128.
  await page.getByLabel('Access code').fill('x'.repeat(200));
  record('F01-E3 long input capped at 128', (await page.getByLabel('Access code').inputValue()).length === 128);
  await page.context().close();
} catch (error) {
  record('RUN', false, String(error).slice(0, 300));
} finally {
  await browser.close();
  for (const child of children) { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: true }) : child.kill(); } catch {} }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed; console errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 8)) console.log('  console:', e.slice(0, 160));
  setTimeout(() => process.exit(failed ? 1 : 0), 1500);
}
