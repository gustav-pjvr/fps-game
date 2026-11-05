import { defineConfig, devices } from '@playwright/test';

/**
 * Behaviour specs run on Low graphics (no shadows, post-processing or environment light), the
 * lightest load for what they check. Measured 2026-10-23: a single page here runs at about 2.2 FPS
 * on Low and on Medium alike (the CPU, not the renderer, is the limit), so the multiplayer specs'
 * real fix was their budgets; Low stays because it costs nothing (docs/testing.md). Specs that judge the
 * rendered look (ui-qa, perf, the console-errors load test) opt back into the shipped default with
 * `test.use({ storageState: SHIPPED_GRAPHICS })`. E2E_GRAPHICS=medium or high runs everything at
 * that quality instead.
 */
const graphics = process.env.E2E_GRAPHICS ?? 'low';
// E2E_PORT lets two checkouts (git worktrees) run their suites side by side: each gets its own dev
// server, where a shared 5173 would let one checkout's tests silently reuse the other's server.
const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = `http://localhost:${port}`;
// E2E_TRANSPORT=server runs the multiplayer specs through a local relay (docs/server-relay-design.md):
// its own port beside the dev server's, a throwaway access code that only this local relay accepts
// (not a secret: it binds to 127.0.0.1 and lives for one run), and the browsers told to use it.
const transport = process.env.E2E_TRANSPORT === 'server' ? 'server' : 'p2p';
const relayPort = port + 1000;
const relayAccessCode = `e2e-local-${relayPort}`;
const relayStorage = transport === 'server'
  ? [
    { name: 'fps-game-relay-access-code', value: relayAccessCode },
    { name: 'fps-game-network-transport', value: 'server' },
    { name: 'fps-game-dev-relay-url', value: `ws://127.0.0.1:${relayPort}/ws` },
  ]
  : [];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // fullyParallel:false only serializes tests *within* one file - separate spec files still get
  // split across workers by default (confirmed directly: running smoke.spec.ts alone always used
  // 1 worker, but multiplayer.spec.ts + multiplayer-match.spec.ts together picked up 2 and one
  // failed on resource contention that vanished under a forced single worker). Multiplayer specs
  // each spin up two real browser contexts (WASM physics + a live WebRTC connection) per test, so
  // this is only going to get worse as more heavy multi-file suites land - pin to 1 globally
  // rather than let it silently depend on which files happen to get run together.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    storageState: {
      cookies: [],
      origins: [{ origin: baseURL, localStorage: [{ name: 'fps-game-settings-v1', value: JSON.stringify({ graphicsQuality: graphics }) }, ...relayStorage] }],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npm run dev -- --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: true,
      timeout: 30000,
    },
    ...(transport === 'server'
      ? [{
        command: 'node server/main.ts',
        url: `http://127.0.0.1:${relayPort}/healthz`,
        reuseExistingServer: false,
        timeout: 30000,
        env: {
          HNG_ACCESS_CODES: relayAccessCode,
          HNG_ALLOWED_ORIGINS: `${baseURL},http://127.0.0.1:${port}`,
          HNG_HOST: '127.0.0.1',
          HNG_PORT: String(relayPort),
          HNG_LOG_LEVEL: 'info',
        },
      }]
      : []),
  ],
});
