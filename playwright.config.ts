import { defineConfig, devices } from '@playwright/test';

// End-to-end smoke test of the demo path against a production build in REPLAY mode, with its own
// throwaway database: no PayPal calls, no shared state. Set E2E_BASE_URL to test a deployed app.
const PORT = 3100;
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: external ?? `http://localhost:${PORT}`, trace: 'retain-on-failure', viewport: { width: 1440, height: 1000 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: external
    ? undefined
    : {
        command: `rm -f data/e2e.sqlite data/e2e.sqlite-wal data/e2e.sqlite-shm && npx next build && npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}/war-room`,
        timeout: 240_000,
        reuseExistingServer: false,
        env: { REPLAY_MODE: '1', DATABASE_PATH: 'data/e2e.sqlite', SYNC_POLL_SECONDS: '0' },
      },
});
