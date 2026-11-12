import { expect, type Page, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';
import { accountButton, accountMenu } from '../support/nav';

/**
 * What loads on demand: the pages in views/secondary's file (search, person and collection pages, a library's
 * Suggestions and Upcoming tabs, History, Watch together) with their stylesheet, and the stock pages' stylesheets the
 * inline guard links where they're used (veil/skinCss.ts).
 */
const SECONDARY = /lumen-chunk-SecondaryViews-.*\.js$/;
/**
 * Playwright's WebKit serves a file it has seen from its cache without asking page.route, even one the route failed,
 * so it can't hold the file back or fail it.
 */
const CACHE_PAST_ROUTE = "Playwright's WebKit serves the file from its cache past page.route";

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

test('a cold load on Search keeps the veil up until its file is in, then shows the page', { tag: '@smoke' }, async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', CACHE_PAST_ROUTE);
  // Held from the start, the first page's prefetch too: a browser may serve the file from its cache otherwise.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(SECONDARY, async (route) => {
    await held;
    await route.continue();
  });
  await login(page, ADMIN);
  await page.goto('about:blank');
  await page.goto('/web/#/search');

  // Lumen's nav is up under the veil, but not the page: the veil stays until the file arrives.
  await expect(page.locator('#lmn-root .lmn-nav')).toBeAttached();
  // Proving the veil doesn't lift without it: past the one deadline it has before the slow-load message, its wait for
  // the fonts (FONT_WAIT_MS, 800 ms).
  await page.waitForTimeout(1000);
  await expect(page.locator('#lmn-veil')).toBeVisible();
  await expect(page.locator('#lmn-veil')).not.toHaveClass(/is-lifting/);

  release();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await expect(page.locator('#lmn-veil')).toHaveCount(0);
});

test("a person page whose file can't load shows Lumen's error page, and Try again loads it", { tag: '@smoke' }, async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', CACHE_PAST_ROUTE);
  const id = await personId('Ada Vance');
  // Failing from the start, the first page's prefetch too: a browser may serve the file from its cache otherwise.
  let fail = true;
  await page.route(SECONDARY, (route) => (fail ? route.abort() : route.continue()));
  await login(page, ADMIN);
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

test('a person page whose file still fails on Try again reloads, for a browser that remembers the failure', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', CACHE_PAST_ROUTE);
  const id = await personId('Ada Vance');
  await page.route(SECONDARY, (route) => route.abort());
  await login(page, ADMIN);
  await page.goto('about:blank');
  await page.goto(`/web/#/details?id=${id}`);
  await expect(page.getByRole('heading', { name: "Couldn't load this page", level: 1 })).toBeVisible();

  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Try again' }).click();
  await reloaded;
  await expect(page).toHaveURL(new RegExp(`#/details\\?id=${id}`));
  await expect(page.getByRole('heading', { name: "Couldn't load this page", level: 1 })).toBeVisible();
});

test("Watch together says so when its file can't load", async ({ page, browserName, isMobile }) => {
  test.skip(browserName === 'webkit', CACHE_PAST_ROUTE);
  test.skip(isMobile, 'phones have Watch together on the profile page');
  await page.route(SECONDARY, (route) => route.abort());
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();

  await accountButton(page).click();
  await accountMenu(page).getByRole('menuitem', { name: /^Watch together/ }).click();
  await expect(page.locator('.lmn-toast')).toHaveText("Couldn't open Watch together. Try again.");
  await expect(page.getByRole('menu', { name: 'Watch together' })).toHaveCount(0);
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
  await page.route(SECONDARY, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await login(page, ADMIN);
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

test("a signed-out visit to Lumen's address waits for the sign-in page's stylesheet, where jellyfin-web sends it", async ({ page }) => {
  // No one signed in: jellyfin-web goes from home to its sign-in page.
  await page.goto('/web/');
  await expect(page.locator('.manualLoginForm')).toBeVisible();
  const blocking = await cssBlocking(page);
  test.skip(!blocking['lumen.css'], 'no renderBlockingStatus in this browser');
  expect(blocking['lumen-stock.css']).toBe('blocking');
});

test('an admin page reached from Lumen is never shown without its stylesheet', async ({ page, isMobile }) => {
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
  // On phones the drawer is closed until its menu button opens it.
  await expect(page.locator(isMobile ? '.MuiAppBar-root' : '.MuiDrawer-paper').first()).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/\blmn-skin-dashboard\b/);
});

test('an admin page left and come back to before its stylesheet came waits for it anew, not until the first deadline', async ({ page, isMobile }) => {
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();
  await expect(page.locator('link[data-lmn-css="lumen-stock.css"]')).toHaveAttribute('media', 'all');
  // In 4.5 s: past the first visit's 3 s deadline, before the second's.
  await page.route(/lumen-dashboard\.css/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4500));
    await route.continue();
  });
  const hiddenOnReturn = await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    location.hash = '#/dashboard';
    await sleep(1000);
    location.hash = '#/home';
    await sleep(1500);
    location.hash = '#/dashboard';
    // Past the first visit's deadline.
    await sleep(1000);
    return document.documentElement.classList.contains('lmn-skin-wait');
  });
  expect(hiddenOnReturn).toBe(true);
  await expect(page.locator('html')).not.toHaveClass(/\blmn-skin-wait\b/, { timeout: 10_000 });
  // Shown because the stylesheet came, not because a deadline ran out.
  expect(await page.evaluate(() => !!document.querySelector<HTMLLinkElement>('link[data-lmn-css="lumen-dashboard.css"]')!.sheet)).toBe(true);
  await expect(page.locator(isMobile ? '.MuiAppBar-root' : '.MuiDrawer-paper').first()).toBeVisible();
});

test("clicking through the admin pages doesn't hide each one again while their stylesheet is on its way", async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();
  await expect(page.locator('link[data-lmn-css="lumen-stock.css"]')).toHaveAttribute('media', 'all');
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/lumen-dashboard\.css/, async (route) => {
    await held;
    await route.continue();
  });
  const hidden = await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const waiting = () => document.documentElement.classList.contains('lmn-skin-wait');
    location.hash = '#/dashboard';
    await sleep(2000);
    location.hash = '#/dashboard/users';
    await sleep(200);
    const second = waiting();
    // Past the first page's deadline: the second didn't put it off.
    await sleep(1300);
    const afterDeadline = waiting();
    location.hash = '#/dashboard/devices';
    await sleep(300);
    return { second, afterDeadline, third: waiting() };
  });
  release();
  // Hidden on through the second page until the deadline, then shown; the third page isn't hidden again.
  expect(hidden).toEqual({ second: true, afterDeadline: false, third: false });
});

test("the More menu opens jellyfin-web's dialog once the dialogs' stylesheet is in", async ({ page, browserName, isMobile }) => {
  test.skip(browserName === 'webkit', CACHE_PAST_ROUTE);
  test.skip(isMobile, 'phones open the More menu as a sheet; the desktop one is enough here');
  const { items } = loadState();
  await login(page, ADMIN);
  // Held from the cold load on: a slow network, where it comes after the page.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/lumen-stock\.css/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('about:blank');
  // Not until load: the page's load waits for every stylesheet.
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`, { waitUntil: 'commit' });
  await page.locator('#lmn-root .lmn-details__header').getByRole('button', { name: /^More actions for / }).click();
  await page.getByRole('menu', { name: 'More actions for Lumen Alpha' }).getByRole('menuitem', { name: 'Media info' }).click();
  // Proving the dialog doesn't open without it: time enough for jellyfin-web to fetch the dialog's code and open it,
  // well short of the 3 s Lumen waits for the stylesheet at most (SKIN_WAIT_MS).
  await page.waitForTimeout(1000);
  await expect(page.locator('.dialogContainer')).toHaveCount(0);

  release();
  await expect(page.locator('.dialogContainer')).toBeVisible();
  expect(await page.evaluate(() => !!document.querySelector<HTMLLinkElement>('link[data-lmn-css="lumen-stock.css"]')!.sheet)).toBe(true);
});
