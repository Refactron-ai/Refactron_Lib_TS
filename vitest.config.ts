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
    // tests/e2e/** is excluded from the default `npm test` via the script flag;
    // `npm run test:e2e` opts back in by targeting the directory explicitly.
    exclude: ['node_modules/**', 'dist/**', 'fixtures/**'],
    timeout: 30000,
  },
});
