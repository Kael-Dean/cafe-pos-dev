import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * Visual capture harness for the touch-first UI upgrade (NOT part of `npm run test:e2e`:
 * that config only matches *.spec.ts; this one only matches *.capture.ts).
 *
 * Writes full-viewport PNGs + a small-touch-target report per viewport × state:
 *   <CAPTURE_OUT>/<viewport>__<state>.png
 *   <CAPTURE_OUT>/<viewport>__<state>.small-targets.json
 *
 *   CAPTURE_OUT   output dir (default D:\POS-dev\docs\touch-upgrade\baseline)
 *   + every knob of playwright.config.ts (E2E_DEV=1, E2E_SKIP_BUILD=1, E2E_BASE_URL, E2E_PORT …)
 *
 * Run:  npm run capture:screens
 *       CAPTURE_OUT=D:\POS-dev\docs\touch-upgrade\after npm run capture:screens
 *       npm run capture:screens -- --project=phone-390x844 -g kds
 *
 * Determinism: reduced motion + CSS animations disabled at capture time, light theme,
 * th-TH / Asia/Bangkok, page clock pinned (e2e/support/seed.ts FIXED_NOW), deviceScaleFactor 1,
 * toasts hidden in the PNG (they are transient and timing-dependent).
 */

// Every capture project shares these; only the viewport / touch flags differ.
const common = {
  ...devices['Desktop Chrome'],
  deviceScaleFactor: 1,
  reducedMotion: 'reduce' as const,
  colorScheme: 'light' as const,
};

export default defineConfig({
  ...base,
  testDir: './e2e/visual',
  testMatch: /.*\.capture\.ts/,
  outputDir: './test-results/capture',
  // One worker per CPU is fine (each test owns a fresh context) but keep it bounded:
  // a dev server compiling on demand under heavy parallel load is the main flake source.
  fullyParallel: true,
  workers: process.env.CAPTURE_WORKERS ? Number(process.env.CAPTURE_WORKERS) : 4,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...base.use,
    trace: 'retain-on-failure',
    screenshot: 'off',
  },
  projects: [
    { name: 'tablet-1024x768', use: { ...common, viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: 'tablet-1366x1024', use: { ...common, viewport: { width: 1366, height: 1024 }, hasTouch: true } },
    { name: 'pos-1920x1080', use: { ...common, viewport: { width: 1920, height: 1080 }, hasTouch: true } },
    { name: 'phone-390x844', use: { ...common, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
