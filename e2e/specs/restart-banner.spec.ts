import { expect, test, type APIResponse, type Page, type Route } from '@playwright/test';
import { STOCK_SELECTORS } from '../../client/src/compat/registry';
import { ADMIN } from '../support/api';
import { login } from '../support/login';

/**
 * The restart banner on jellyfin-web's admin pages (client/src/takeover/RestartBanner.tsx). A real pending restart
 * needs a plugin installed from the catalog, and a real restart takes the shared server away from the other specs, so
 * the server's answers are stubbed: System/Info says a restart is pending, /Plugins lists one waiting for it, and
 * POST /System/Restart is answered without restarting anything.
 */
// jellyfin-web's service worker would fetch some of these itself after the reload, past the stubs.
test.use({ serviceWorkers: 'block' });

/**
 * Answers with the server's response, rewritten. The page reloads after the restart, and a request still in flight then
 * has its response disposed (Firefox): that one is abandoned, not an error.
 */
async function rewrite(route: Route, json: (response: APIResponse) => Promise<unknown>): Promise<void> {
  try {
    const response = await route.fetch();
    await route.fulfill({ response, json: await json(response) });
  } catch {
    await route.abort().catch(() => undefined);
  }
}

async function stubRestart(page: Page): Promise<{ restarts: () => number }> {
  let pending = true;
  let restarts = 0;
  await page.route(/\/System\/Info(\?|$)/, (route) =>
    rewrite(route, async (response) => ({ ...((await response.json()) as object), HasPendingRestart: pending })),
  );
  await page.route(/\/Plugins(\?|$)/, (route) =>
    rewrite(route, async (response) => {
      // Whatever the server really has waiting is left out, so the message is always the same.
      const plugins = ((await response.json()) as Record<string, unknown>[]).map((p) => ({ ...p, Status: 'Active' }));
      return [...plugins, { Name: 'Webhook', Id: 'b0000000000000000000000000000000', Version: '22.0.0.0', Status: 'Restart' }];
    }),
  );
  await page.route(/\/System\/Restart(\?|$)/, async (route) => {
    restarts++;
    pending = false; // as if Jellyfin restarted quicker than the banner's first check
    await route.fulfill({ status: 204 });
  });
  return { restarts: () => restarts };
}

test('a pending restart shows the banner on the admin pages, and Restart Jellyfin restarts and reloads', { tag: '@smoke' }, async ({ page }) => {
  const server = await stubRestart(page);
  await login(page, ADMIN);
  // Lumen's own pages don't show it.
  await expect(page.locator('#lmn-restart')).toHaveCount(0);

  await page.goto('/web/#/dashboard');
  const banner = page.getByRole('region', { name: 'Restart needed' });
  await expect(banner).toContainText('Restart Jellyfin to finish installing Webhook.');
  // Under the app bar, and the page makes room for it.
  const bar = await page.locator(STOCK_SELECTORS.modernAppBar.selector).first().boundingBox();
  await expect.poll(async () => (await banner.boundingBox())?.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
  await expect(page.locator(`${STOCK_SELECTORS.routedPage.selector}:visible`).first()).not.toHaveCSS('margin-top', '0px');
  await expect(page.locator('#lmn-restart-live')).toHaveText('Restart Jellyfin to finish installing Webhook.');

  // Stays at the top while the page scrolls.
  await page.evaluate(() => window.scrollBy(0, 800));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(banner).toBeInViewport();

  await banner.getByRole('button', { name: 'Restart Jellyfin' }).click();
  await expect(banner).toContainText('Restart Jellyfin now?');
  expect(server.restarts()).toBe(0);
  await page.evaluate(() => ((window as unknown as { beforeRestart?: boolean }).beforeRestart = true));
  // Clicks in the question's first half second are ignored, so a double-click on Restart Jellyfin can't confirm it.
  await page.waitForTimeout(600);
  await banner.getByRole('button', { name: 'Restart now' }).click();
  await expect(banner).toContainText('Restarting Jellyfin');
  expect(server.restarts()).toBe(1);

  // Jellyfin is "back" with nothing pending: the page reloads, without the banner.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { beforeRestart?: boolean }).beforeRestart ?? false), {
      timeout: 20_000,
    })
    .toBe(false);
  await expect(page.locator(STOCK_SELECTORS.modernAppBar.selector).first()).toBeVisible();
  await expect(page.locator('#lmn-restart')).toHaveCount(0);
});

test('a dismissed restart banner stays away on the admin pages until coming back to them', async ({ page }) => {
  await stubRestart(page);
  await login(page, ADMIN);
  await page.goto('/web/#/dashboard');
  const banner = page.getByRole('region', { name: 'Restart needed' });
  await expect(banner).toBeVisible();

  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('#lmn-restart')).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/dashboard/users'));
  await expect(page).toHaveURL(/dashboard\/users/);
  // It would have come back by now: the check is quick, and the banner slides in in 250 ms.
  await page.waitForTimeout(1500);
  await expect(page.locator('#lmn-restart')).toHaveCount(0);

  await page.evaluate(() => (location.hash = '#/home'));
  await expect(page).toHaveURL(/#\/home/);
  await page.evaluate(() => (location.hash = '#/dashboard'));
  await expect(banner).toBeVisible();
});
