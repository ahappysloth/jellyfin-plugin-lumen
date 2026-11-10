import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,
  workers: 1, // specs share one server and some change its configuration
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.LUMEN_E2E_BASE_URL ?? 'http://localhost:8096',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  // CI runs every spec on chromium, and the `@smoke` ones on firefox and webkit-iphone, per pull request; the nightly
  // workflow runs everything on all three (.github/workflows/e2e.yml).
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Tests of the TV layout (their titles say "TV layout") run on Chromium only: that's what TVs' browsers are
    // (webOS, Tizen, Android TV).
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: /\bTV layout\b/ },
    // Mobile Safari: WebKit with an iPhone's viewport, touch and user agent (jellyfin-web picks its mobile layout).
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] }, grepInvert: /\bTV layout\b/ },
  ],
  // Stub Seerr + TMDB images. The Jellyfin server reaches it at LUMEN_E2E_SEERR_URL (see support/stub-seerr.mjs).
  webServer: {
    command: 'node support/stub-seerr.mjs',
    url: 'http://localhost:5055/__stub/health',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
