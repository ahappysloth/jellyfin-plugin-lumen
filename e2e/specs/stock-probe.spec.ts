import { expect, test, type Page } from '@playwright/test';
import { DASHBOARD_THEME_VARIABLE, STOCK_SELECTORS, type ProbePage } from '../../client/src/compat/registry';
import { ADMIN, loadState } from '../support/api';
import { login } from '../support/login';
import { openFresh } from '../support/stock-pages';

/**
 * Probe: every jellyfin-web selector Lumen depends on (client/src/compat/registry.ts) still matches on its page. A miss
 * means part of Lumen silently stops working after a Jellyfin update: stock controls showing through Lumen's, a
 * header that won't hide, or settings that look stock again. The nightly job runs this against new Jellyfin builds.
 */
const byPage = (probe: ProbePage) =>
  Object.entries(STOCK_SELECTORS).filter(([, entry]) => entry.probe === probe);

async function expectSelectorsOn(page: Page, probe: ProbePage): Promise<void> {
  for (const [name, { selector }] of byPage(probe)) {
    await expect(page.locator(selector), `${name} (${selector}) should match on the ${probe} page`).not.toHaveCount(0);
  }
}

test('stock selectors on the sign-in page', async ({ page }) => {
  await openFresh(page, '#/login');
  await expect(page.locator('#txtManualName')).toBeVisible();
  await expectSelectorsOn(page, 'login');
});

test('stock selectors on home and the settings pages', async ({ page }) => {
  const { admin } = loadState();
  await login(page, ADMIN);

  await openFresh(page, '#/home');
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expectSelectorsOn(page, 'home');

  await openFresh(page, `#/mypreferencesplayback?userId=${admin.userId}`);
  await expectSelectorsOn(page, 'settings');

  await openFresh(page, `#/mypreferencesdisplay?userId=${admin.userId}`);
  await expectSelectorsOn(page, 'display');
});

test('stock selectors in the video player', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  await expect(page).toHaveURL(/#\/video/);
  // Lumen found jellyfin-web's PlaybackManager (its controls replace the stock ones).
  await expect(page.locator('#lmn-root .lmn-osd')).toBeVisible();
  await expectSelectorsOn(page, 'player');
});

test('stock selectors on the Dashboard and the metadata manager', async ({ page }) => {
  await login(page, ADMIN);
  await openFresh(page, '#/dashboard');
  // The device card (this session) and the Restart button come in with the server info.
  await expect(page.locator('.MuiButton-containedError').first()).toBeVisible();
  await expectSelectorsOn(page, 'dashboard');
  // dashboard.css recolours the Dashboard through jellyfin-web's MUI theme variables; jellyfin-web must still define them.
  const defined = await page.evaluate((name) => {
    const rules = (sheet: CSSStyleSheet): CSSRule[] => {
      try {
        return Array.from(sheet.cssRules);
      } catch {
        return [];
      }
    };
    return Array.from(document.styleSheets).some((sheet) =>
      rules(sheet).some((rule) => rule instanceof CSSStyleRule && !rule.selectorText.includes('lmn') && rule.style.getPropertyValue(name) !== ''),
    );
  }, DASHBOARD_THEME_VARIABLE);
  expect(defined, `jellyfin-web's theme should define ${DASHBOARD_THEME_VARIABLE}`).toBe(true);

  await openFresh(page, '#/metadata');
  await expect(page.locator('.libraryTree')).toBeVisible();
  await expectSelectorsOn(page, 'metadata');
});

test('every probed selector belongs to a page this spec opens', () => {
  const probed = new Set<ProbePage>(['login', 'home', 'settings', 'display', 'player', 'dashboard', 'metadata']);
  for (const [name, entry] of Object.entries(STOCK_SELECTORS)) {
    if (entry.probe !== null) expect(probed.has(entry.probe), name).toBe(true);
  }
});
