import { expect, test } from '@playwright/test';
import { ADMIN, KID, loadState } from '../support/api';
import { login } from '../support/login';
import { expectNoLumenNav, lumenNav } from '../support/nav';
import { expectPresentButHidden } from '../support/stock';

test("a title the user can't see says it isn't found, with Lumen's nav and Back", async ({ page }) => {
  // kid can't see the Movies library: the server answers 404, as for an item that's gone.
  const { items } = loadState();
  await login(page, KID);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(lumenNav(page)).toBeVisible();
  await expectPresentButHidden(page.locator('#reactRoot .skinBody'));
});

test("a details page the server doesn't answer for offers Try again", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  const offline = (url: URL) => url.pathname.startsWith(`/Items/${items['Lumen Alpha']}`);
  await page.route(offline, (route) => route.abort());

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  await expect(page.getByRole('heading', { level: 1, name: "Couldn't load this page" })).toBeVisible();
  await expect(lumenNav(page)).toBeVisible();
  await page.unroute(offline);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lumen Alpha' })).toBeVisible();
  await expectNoLumenNav(page);
});

test("an unknown address shows Lumen's page not found, with Home", { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);

  await page.goto('/web/#/no-such-page');

  const notFound = page.getByRole('region', { name: 'Page not found' });
  await expect(notFound.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(lumenNav(page)).toBeVisible();
  // jellyfin-web decided it's a 404 (Lumen never guesses): its page is there, under Lumen's.
  await expectPresentButHidden(page.locator('#fallbackPage'));

  await notFound.getByRole('link', { name: 'Home' }).click();
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
});

test("a plugin's page drawn into jellyfin-web's 404 page isn't covered by Lumen's", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/my-plugin-page');
  await expect(page.getByRole('region', { name: 'Page not found' })).toBeVisible();

  // A plugin that owns this hash draws its page into jellyfin-web's 404 page.
  await page.locator('#fallbackPage').evaluate((stock) => {
    const mine = document.createElement('section');
    mine.setAttribute('aria-label', 'My plugin');
    mine.textContent = "My plugin's page";
    stock.appendChild(mine);
  });

  await expect(page.getByRole('region', { name: 'Page not found' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'My plugin' })).toBeVisible();
});

test.describe(() => {
  // jellyfin-web's service worker answers some of the page's requests itself, out of page.route's reach (WebKit).
  test.use({ serviceWorkers: 'block' });

  test('a reload that the server never answers says so on the loading screen, with Try again', async ({ page }) => {
    await login(page, ADMIN);
    // The page and Lumen's files load (from a cache, say), but nothing else reaches the server.
    await page.route(
      (url) => !url.pathname.startsWith('/web/') && !url.pathname.startsWith('/Lumen/Assets/'),
      (route) => route.abort(),
    );

    await page.reload();

    const veil = page.locator('#lmn-veil');
    await expect(veil.getByRole('alert')).toHaveText(/taking longer than usual/, { timeout: 15_000 });
    await expect(veil.getByRole('button', { name: 'Try again' })).toBeFocused();
  });
});

test("the loading screen's mark keeps its size when Lumen's stylesheet doesn't load", async ({ page }) => {
  await login(page, ADMIN);
  await page.route(/\/Lumen\/Assets\/lumen\.css/, (route) => route.abort());

  await page.reload({ waitUntil: 'domcontentloaded' });

  const mark = (await page.locator('#lmn-veil svg').boundingBox())!;
  expect(mark.width).toBeLessThanOrEqual(56);
  expect(mark.height).toBeLessThanOrEqual(56);
});
