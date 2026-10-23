import { defineConfig, devices } from '@playwright/test';

/**
 * Behaviour specs run on Low graphics (no shadows, post-processing or environment light): on this
 * machine's SwiftShader the v4 Medium look ran two lobby pages at about 2 FPS, so every multiplayer
 * spec ran out of time with all its steps still advancing (docs/testing.md). Specs that judge the
 * rendered look (ui-qa, perf, the console-errors load test) opt back into the shipped default with
 * `test.use({ storageState: SHIPPED_GRAPHICS })`. E2E_GRAPHICS=medium or high runs everything at
 * that quality instead.
 */
const graphics = process.env.E2E_GRAPHICS ?? 'low';

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
    baseURL: 'http://localhost:5173',
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://localhost:5173', localStorage: [{ name: 'fps-game-settings-v1', value: JSON.stringify({ graphicsQuality: graphics }) }] }],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
