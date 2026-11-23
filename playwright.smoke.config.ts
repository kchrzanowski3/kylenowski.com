import { defineConfig, devices } from '@playwright/test';

// Read-only smoke tests against a deployed site (tests/smoke). No local servers: SMOKE_URL is the
// site to check, https://kylenowski.com by default.
export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 60_000,
  retries: 1, // a freshly deployed CDN edge can be a moment behind
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-smoke' }]] : 'list',
  use: {
    baseURL: process.env.SMOKE_URL ?? 'https://kylenowski.com',
    trace: 'off',
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
});
