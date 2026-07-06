import { defineConfig, devices } from '@playwright/test';

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
