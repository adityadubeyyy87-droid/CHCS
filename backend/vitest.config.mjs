import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/global-setup.js'],
    setupFiles: ['./tests/setup.js'],
    // One shared MySQL schema: run files sequentially so fixtures never collide.
    fileParallelism: false,
    // Local MySQL containers can need more than a minute for the 50-transaction
    // integrity proofs when the rest of the suite has warmed the buffer pool;
    // CI was already comfortably under the old 30s ceiling.
    testTimeout: 120000,
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'server.js'],
      exclude: ['tests/**'],
    },
  },
});
