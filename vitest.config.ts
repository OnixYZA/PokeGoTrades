import { defineConfig } from 'vitest/config';

// Minimal config for the pure-function unit tests under store/ and constants/. Deliberately no
// jsdom/RN environment and no globals: these are plain TypeScript with no runtime dependencies,
// and the repo already has two other test runners scoped to their own directories (Playwright's
// `e2e/`, node:test's `workers/azure-ocr/test/`), so this one is scoped to stay out of their way.
export default defineConfig({
  test: {
    include: ['store/**/*.test.ts', 'constants/**/*.test.ts'],
  },
});
