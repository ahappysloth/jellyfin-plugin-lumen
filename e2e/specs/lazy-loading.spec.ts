import { expect, type Page, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

/**
 * What loads on demand: the pages in views/secondary's file (search, person and collection pages, a library's
 * Suggestions and Upcoming tabs, History, Watch together) with their stylesheet, and the stock pages' stylesheets the
 * inline guard links where they're used (veil/skinCss.ts).
 */
const SECONDARY = /lumen-chunk-SecondaryViews-.*\.js$/;

async function personId(name: string): Promise<string> {
  const { admin } = loadState();
  const result = await api<{ Items: { Id: string }[] }>('/Persons', {
    token: admin.token,
    query: { searchTerm: name, userId: admin.userId },
  });
  return result.Items[0]!.Id;
}

/** How each stylesheet the page loaded held up its first paint (Chromium's Resource Timing). */
async function cssBlocking(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      performance
        .getEntriesByType('resource')
        .filter((e) => /\.css(\?|$)/.test(e.name))
        .map((e) => [
          e.name.replace(/^.*\//, '').replace(/\?.*$/, ''),
          (e as PerformanceResourceTiming & { renderBlockingStatus?: string }).renderBlockingStatus ?? '',
        ]),
    ),
  );
}

test('a cold load on Search keeps the veil up until its file is in, then shows the page', async ({ page }) => {
  await login(page, ADMIN);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(SECONDARY, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('about:blank');
  await page.goto('/web/#/search');

  // Lumen's nav is up under the veil, but not the page: the veil stays until the file arrives.
  await expect(page.locator('#lmn-root .lmn-nav')).toBeAttached();
  await page.waitForTimeout(1000);
  await expect(page.locator('#lmn-veil')).toBeVisible();
  await expect(page.locator('#lmn-veil')).not.toHaveClass(/is-lifting/);

  release();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await expect(page.locator('#lmn-veil')).toHaveCount(0);
});

test("a person page whose file can't load shows Lumen's error page, and Try again loads it", async ({ page }) => {
  const id = await personId('Ada Vance');
  await login(page, ADMIN);
  let fail = true;
  await page.route(SECONDARY, (route) => (fail ? route.abort() : route.continue()));
  await page.goto('about:blank');
  await page.goto(`/web/#/details?id=${id}`);

  await expect(page.getByRole('heading', { name: "Couldn't load this page", level: 1 })).toBeVisible();
  await expect(page.locator('#lmn-veil')).toHaveCount(0);
  // The page's way out, and Lumen's nav: no dead end.
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-nav')).toBeVisible();

  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Ada Vance', level: 1 })).toBeVisible();
  await expect(page.locator('.lmn-person-page__name')).toHaveCSS('font-weight', '800');
});

test("Lumen's pages fetch the file once the first page is up, so Search opens without waiting", async ({ page }) => {
  const fetched = page.waitForRequest(SECONDARY);
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();
  await fetched;
  // Its stylesheet came with it.
  await expect(page.locator('link[href*="lumen-secondary.css"]')).toHaveCount(1);

  let asked = false;
  page.on('request', (r) => {
    if (SECONDARY.test(r.url())) asked = true;
  });
  await page.getByRole('link', { name: 'Search' }).first().click();
  await expect(page.getByRole('searchbox')).toBeVisible();
  expect(asked).toBe(false);
});

test('TV layout: a cold load on a person page focuses its first title once its file is in', async ({ page }) => {
  const id = await personId('Ada Vance');
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await page.route(SECONDARY, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto('about:blank');
  await page.goto(`/web/#/details?id=${id}`);

  await expect(page.getByRole('heading', { name: 'Ada Vance', level: 1 })).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-person-page :focus')).toHaveCount(1);
});

test("the stock pages' stylesheet loads beside Lumen's pages without holding them up", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('about:blank');
  await page.goto('/web/#/home');
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();

  // There for jellyfin-web's dialogs (the More menu opens them), but out of the way of the first paint; the admin
  // pages' own stylesheet isn't fetched at all.
  await expect(page.locator('link[data-lmn-css="lumen-stock.css"]')).toHaveAttribute('media', 'all');
  await expect(page.locator('link[data-lmn-css="lumen-dashboard.css"]')).toHaveCount(0);
  const blocking = await cssBlocking(page);
  test.skip(!blocking['lumen.css'], 'no renderBlockingStatus in this browser');
  expect(blocking).toMatchObject({ 'lumen.css': 'blocking', 'lumen-stock.css': 'non-blocking' });
});

test('the sign-in, settings and admin pages wait for their stylesheets before they paint', async ({ page }) => {
  await page.goto('/web/#/login');
  await expect(page.locator('.manualLoginForm')).toBeVisible();
  const signIn = await cssBlocking(page);
  test.skip(!signIn['lumen.css'], 'no renderBlockingStatus in this browser');
  expect(signIn['lumen-stock.css']).toBe('blocking');
  expect(signIn['lumen-dashboard.css']).toBeUndefined();

  await login(page, ADMIN);
  for (const [hash, ready] of [
    ['#/mypreferencesdisplay', '.lmn-settings-frame'],
    ['#/dashboard', '.MuiDrawer-paper'],
  ] as const) {
    await page.goto('about:blank');
    await page.goto(`/web/${hash}`);
    await expect(page.locator(ready).first()).toBeVisible();
    const blocking = await cssBlocking(page);
    expect(blocking['lumen-stock.css'], hash).toBe('blocking');
    if (hash === '#/dashboard') expect(blocking['lumen-dashboard.css']).toBe('blocking');
  }
});

test('an admin page reached from Lumen is never shown without its stylesheet', async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();
  // A slow stylesheet: the page stays hidden (lmn-skin-wait) until it's in, rather than show unstyled.
  await page.route(/lumen-dashboard\.css/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.evaluate(() => (location.hash = '#/dashboard'));
  await expect(page.locator('html')).toHaveClass(/\blmn-skin-wait\b/);
  await expect(page.locator('body')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('html')).not.toHaveClass(/\blmn-skin-wait\b/, { timeout: 10_000 });
  await expect(page.locator('.MuiDrawer-paper').first()).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/\blmn-skin-dashboard\b/);
});
