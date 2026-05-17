import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'tests/fixtures/'],
    },
    include: ['tests/**/*.test.ts'],
    // tests/e2e/** is excluded from the default `npm test`. `npm run test:e2e`
    // opts back in via vitest.e2e.config.ts so this exclude doesn't filter the
    // explicit e2e run (config-level exclude beats CLI positional includes).
    exclude: ['node_modules/**', 'dist/**', 'fixtures/**', 'tests/e2e/**'],
    // `testTimeout` is the per-test budget — the Python/LibCST transform tests
    // each spawn a subprocess and run >5s under full parallel load. The key
    // was previously `timeout`, which vitest ignores, so tests silently fell
    // back to the 5000ms default and flaked.
    testTimeout: 30000,
  },
});
