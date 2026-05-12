import { defineConfig } from 'vitest/config';

// Dedicated config for `npm run test:e2e`. Keeps the failing golden test isolated
// from the default suite so a broken CLI subcommand (Week 4 deliverable) can't
// red-line normal CI. The shell-quoting trap of `--exclude 'tests/e2e/**'` on
// Windows is avoided by moving the inclusion list into TypeScript.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'fixtures/**'],
    testTimeout: 120_000,
  },
});
