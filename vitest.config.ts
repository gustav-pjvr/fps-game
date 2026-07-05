import { defineConfig } from 'vitest/config';

/**
 * Unit-test layer (Vitest) for the pure, deterministic functions - RNG, zone placement
 * invariants, archetype invariants. Deliberately scoped to `src/**` so it never collides with
 * the Playwright e2e suite in `e2e/` (which owns everything that needs a real browser/WASM/GL).
 * Run with `npm run test:unit`; the e2e workflow (`npx playwright test`) is unchanged.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
