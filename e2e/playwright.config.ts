import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the real UI against the real API, with several browser windows at once
 * (a host and guests), so live updates between people are actually exercised.
 * Start the stack first (API on :4000, web app on :5173): see the README, or run ./run-local.ps1.
 * Uses the locally installed Chrome so no browser download is needed (BROWSER=chromium to use Playwright's own).
 */
const channel = process.env['BROWSER'] === 'chromium' ? undefined : (process.env['BROWSER'] ?? 'chrome');

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:5173',
    channel,
    viewport: { width: 1360, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: './test-results',
});
