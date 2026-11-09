import { expect, type Page } from '@playwright/test';
import { STOCK_SELECTORS } from '../../client/src/compat/registry';

/** jellyfin-web's 404 page (react-router's catch-all). */
export const NOT_FOUND = STOCK_SELECTORS.notFoundPage.selector;

/**
 * Opens a jellyfin-web URL in a fresh document (a hash-only change would keep the previous route's DOM around) and
 * waits until jellyfin-web's router has rendered the route: a page, or the 404 page. (Not Lumen's page: on routes
 * Lumen takes over, the stock page still renders underneath, and that's what these checks are about.)
 */
export async function openFresh(page: Page, hash: string): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`/web/${hash}`);
  await expect(page.locator(`${NOT_FOUND}, #reactRoot .skinBody .page`).first()).toBeAttached({
    timeout: 15_000,
  });
}
