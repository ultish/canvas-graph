import { defineConfig } from 'vitest/config';

// The engine is plain TypeScript with no Ember in it, so it is tested in Node.
// A dedicated config keeps vitest away from vite.config.mjs (Embroider + babel), which the QUnit build uses.
export default defineConfig({
  test: {
    include: ['tests/engine/**/*.test.ts'],
    environment: 'node',
  },
});
