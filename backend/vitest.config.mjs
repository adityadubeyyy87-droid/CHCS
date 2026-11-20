import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/global-setup.js'],
    setupFiles: ['./tests/setup.js'],
    // One shared MySQL schema: run files sequentially so fixtures never collide.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'server.js'],
      exclude: ['tests/**'],
    },
  },
});
