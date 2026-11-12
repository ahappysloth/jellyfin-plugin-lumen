import { defineConfig, devices } from '@playwright/test';
import { STUB_SEERR } from './support/api';

// CI splits the chromium run across two jobs, each with its own Jellyfin (.github/workflows/e2e.yml).
// LUMEN_E2E_PART=1 runs these specs, LUMEN_E2E_PART=2 every other one, and leaving it unset runs them all.
// The list holds about half the suite's time on CI: the specs were 320 s of a 629 s chromium run.
// Playwright's own --shard splits by test count, which put 4 of the 10.5 minutes on one side.
const PART_ONE = [
  '**/playback.spec.ts',
  '**/player-touch.spec.ts',
  '**/tv-dpad.spec.ts',
  '**/lazy-loading.spec.ts',
  '**/stock-routes.spec.ts',
];
const part = process.env.LUMEN_E2E_PART;
if (part && part !== '1' && part !== '2') throw new Error(`LUMEN_E2E_PART must be 1 or 2, not "${part}"`);

export default defineConfig({
  testDir: './specs',
  ...(part === '1' && { testMatch: PART_ONE }),
  ...(part === '2' && { testIgnore: PART_ONE }),
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
  // Stub Seerr + TMDB images, on LUMEN_STUB_SEERR_PORT (5055 by default; the command inherits the variable). The
  // Jellyfin server reaches it at LUMEN_E2E_SEERR_URL (see support/stub-seerr.mjs).
  webServer: {
    command: 'node support/stub-seerr.mjs',
    url: `${STUB_SEERR}/__stub/health`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
