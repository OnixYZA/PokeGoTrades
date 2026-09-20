import { defineConfig, devices } from '@playwright/test';

// The specs need the same Supabase URL / key the app was built with. Optional: CI can set them directly.
try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: rely on the environment
}

const PORT = 8081;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * E2E runs against the *static web export* of the app, wired to the local Supabase stack
 * (`npm run db:start`; see the note in e2e/chat-flow.spec.ts). The export is rebuilt on every run so the
 * test always exercises the current code, and `EXPO_PUBLIC_DATA_SOURCE` is forced to `supabase` because
 * Expo inlines it at bundle time. `expo serve` cannot open a dynamic route such as /chats/<id> from a
 * cold URL (the export has no `generateStaticParams`), so specs enter at `/` and navigate through the UI.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 412, height: 860 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 412, height: 860 } } }],
  webServer: {
    command: `npx expo export -p web && npx expo serve --port ${PORT}`,
    url: BASE_URL,
    // Never reuse: the whole point of the `expo export` above is that the suite runs against the code as
    // it is right now. Reusing a server left over from an earlier session silently tests that older
    // bundle and reports it green — a fix can look verified without ever having been exercised.
    reuseExistingServer: false,
    timeout: 240_000,
    env: { EXPO_PUBLIC_DATA_SOURCE: 'supabase', CI: '1' },
  },
});
