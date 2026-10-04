import { defineConfig, devices } from '@playwright/test';

/**
 * e2e for the cafe POS. Everything is local and deterministic:
 *
 *   browser ──► Next (BFF, real build) ──► fake upstream (e2e/support/fake-upstream.mjs)
 *
 * Most flows mock the BFF boundary in the browser (`page.route` on /api/v1/** and
 * /api/auth/**, see e2e/support/mock-api.ts). The security specs hit the REAL BFF
 * (cookies, origin guard, headers) and, for login, the fake upstream stands in for Railway.
 *
 * Env knobs
 *   E2E_PORT           app port                       (default 3141)
 *   E2E_UPSTREAM_PORT  fake Railway API port          (default 3142)
 *   E2E_BASE_URL       use an already-running app (no webServer is started)
 *   E2E_DEV=1          `next dev` instead of build+start (slower, but no rebuild)
 *   E2E_SKIP_BUILD=1   reuse the existing .next build (re-runs while only specs change)
 *
 * Run:  npm run test:e2e            (all projects)
 *       npx playwright test --project=desktop-1440 e2e/pos-cash-sale.spec.ts
 */

const PORT = Number(process.env.E2E_PORT ?? 3141);
const UPSTREAM_PORT = Number(process.env.E2E_UPSTREAM_PORT ?? 3142);
const externalBase = process.env.E2E_BASE_URL;
const baseURL = externalBase ?? `http://127.0.0.1:${PORT}`;

const appCommand = process.env.E2E_DEV
  ? `npx next dev -H 127.0.0.1 -p ${PORT}`
  : `${process.env.E2E_SKIP_BUILD ? '' : 'npx next build && '}npx next start -H 127.0.0.1 -p ${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A retry would hide flakiness; specs must be deterministic. Allow none locally, one in CI only to
  // capture a trace of a failure.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The service worker would cache responses across tests and bypass page.route.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'tablet-1024',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 }, hasTouch: true },
    },
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-375',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: externalBase
    ? undefined
    : [
        {
          command: 'node e2e/support/fake-upstream.mjs',
          url: `http://127.0.0.1:${UPSTREAM_PORT}/__health`,
          env: { E2E_UPSTREAM_PORT: String(UPSTREAM_PORT) },
          reuseExistingServer: !process.env.CI,
          timeout: 20_000,
        },
        {
          command: appCommand,
          url: `http://127.0.0.1:${PORT}/manifest.webmanifest`,
          env: {
            RAILWAY_API_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
            NODE_ENV: process.env.E2E_DEV ? 'development' : 'production',
          },
          reuseExistingServer: !process.env.CI,
          timeout: 600_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      ],
});
