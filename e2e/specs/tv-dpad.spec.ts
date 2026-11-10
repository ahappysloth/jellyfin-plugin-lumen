import { expect, test, type Page } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { walkDpad } from '../support/dpad';
import { login } from '../support/login';

// TV remotes have only arrows, OK and Back: a control the arrows can't reach can't be used at all. (Chromium only, like
// TVs' browsers: see playwright.config.ts.)
// The walk presses four keys from every control on the page.
test.setTimeout(180_000);
// No sliding hero or trailer preview moving controls around under the walk.
test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });

async function signInOnTv(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  // Hold the hero on one slide: a slide change swaps which slide's buttons are live partway through the walk.
  await page.route(/\/Lumen\/ClientConfig/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), HeroIntervalSeconds: 3600 } });
  });
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
}

test('TV layout: every control on home is reachable with the D-pad', async ({ page }) => {
  await signInOnTv(page);
  const start = page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-button--primary');
  await expect(start).toBeFocused();
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();

  const { controls, unreachable } = await walkDpad(page, start);

  expect(controls.length).toBeGreaterThan(10);
  expect(unreachable.map((c) => c.name)).toEqual([]);
});

test('TV layout: every control on a series page is reachable with the D-pad', async ({ page }) => {
  const { items } = loadState();
  await signInOnTv(page);
  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);
  const series = page.locator('#lmn-root .lmn-details--series');
  const start = series.locator('.lmn-autofocus');
  await expect(series.locator('.lmn-episode')).toHaveCount(3);
  // The page moves focus to its own default once it has loaded: start once that has happened, i.e. focus stays put.
  await expect(async () => {
    await start.focus();
    await page.waitForTimeout(300);
    await expect(start).toBeFocused({ timeout: 100 });
  }).toPass({ timeout: 10_000 });

  const { controls, unreachable } = await walkDpad(page, start);

  // Including each episode row's details link, which sat over the row's right end, out of reach (#89).
  expect(controls.filter((c) => c.classes.split(' ').includes('lmn-episodes__details'))).toHaveLength(3);
  expect(unreachable.map((c) => c.name)).toEqual([]);
});
