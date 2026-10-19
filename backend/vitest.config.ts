import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup-env.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // every test file shares one real PostgreSQL database, so files run one after another
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
