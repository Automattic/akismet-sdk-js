import { defineConfig } from 'vitest/config';

// Calls the real API. Run with `npm run test:live`; never part of `npm test`.
export default defineConfig({
  test: {
    include: ['test/live/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
