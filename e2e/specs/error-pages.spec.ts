import { expect, test } from '@playwright/test';
import { ADMIN, KID, loadState } from '../support/api';
import { login } from '../support/login';
import { expectPresentButHidden } from '../support/stock';

const mainNav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Main' });

test("a title the user can't see says it isn't found, with Lumen's nav and Back", async ({ page }) => {
  // kid can't see the Movies library: the server answers 404, as for an item that's gone.
  const { items } = loadState();
  await login(page, KID);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(mainNav(page)).toBeVisible();
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
  await expect(mainNav(page)).toBeVisible();
  await page.unroute(offline);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lumen Alpha' })).toBeVisible();
  await expect(mainNav(page)).toHaveCount(0);
});
