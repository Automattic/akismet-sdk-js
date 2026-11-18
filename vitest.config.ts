import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A non-UTC zone, so a local-time bug in date encoding cannot pass on UTC CI runners.
    env: { TZ: 'America/Los_Angeles' },
    include: ['test/**/*.test.ts'],
    // The live suite calls the real API; it has its own config (vitest.live.config.ts).
    exclude: [...configDefaults.exclude, 'test/live/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/version.ts'],
    },
  },
});
