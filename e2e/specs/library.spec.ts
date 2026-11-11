import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';
import { navLink } from '../support/nav';
import { expectPresentButHidden } from '../support/stock';

test('the Movies page lists the library as a poster grid with filters and sort', { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);
  await navLink(page, 'Movies').click();

  await expect(page.getByRole('heading', { name: 'Movies', level: 1 })).toBeVisible();
  await expectPresentButHidden(page.locator('#reactRoot .skinBody'));
  const grid = page.getByRole('list', { name: 'Movies' });
  await expect(grid.getByRole('link', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(page.getByText(/\d+ titles/)).toBeVisible();

  await page.getByRole('button', { name: /^Sort by / }).click();
  await page.getByRole('option', { name: 'Title' }).click();
  await expect(grid.getByRole('link').first()).toHaveAccessibleName('Lumen Alpha');

  await grid.getByRole('link', { name: 'Lumen Alpha' }).click();
  await expect(page).toHaveURL(/#\/details\?id=/);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Sort by Title' })).toBeVisible();
});

test("a card's More button opens its menu from the keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, 'touch screens open the menu with a long-press; the button is for pointers and keyboards');
  await login(page, ADMIN);
  await navLink(page, 'Movies').click();

  const grid = page.getByRole('list', { name: 'Movies' });
  const card = grid.getByRole('link', { name: 'Lumen Gamma', exact: true });
  const more = grid.getByRole('button', { name: 'More options for Lumen Gamma' });
  await card.focus();
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await expect(more).toHaveCSS('opacity', '1');
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');

  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Actions for Lumen Gamma' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'More info' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
});

test.describe('favorites', () => {
  test.afterEach(async () => {
    const { admin, items } = loadState();
    await api(`/UserFavoriteItems/${items['Lumen Beta']}`, {
      method: 'DELETE',
      token: admin.token,
      query: { userId: admin.userId },
    });
  });

  test('Favorites lists what the user hearted', async ({ page }) => {
    const { admin, items } = loadState();
    await api(`/UserFavoriteItems/${items['Lumen Beta']}`, {
      method: 'POST',
      token: admin.token,
      query: { userId: admin.userId },
    });
    await login(page, ADMIN);
    await navLink(page, 'Favorites').click();

    await expect(page.getByRole('heading', { name: 'Favorites', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lumen Beta' })).toBeVisible();
  });
});

test('a reload of home never paints the stock header', async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  // Record whether the stock app bar is ever visible between navigation and Lumen taking over.
  await page.addInitScript(() => {
    (window as unknown as { __stockSeen: boolean }).__stockSeen = false;
    const check = (): void => {
      const bar = document.querySelector('.MuiAppBar-root, .skinHeader');
      if (bar && bar.getBoundingClientRect().height > 0 && getComputedStyle(bar).display !== 'none') {
        (window as unknown as { __stockSeen: boolean }).__stockSeen = true;
      }
      if (!document.documentElement.classList.contains('lmn-active')) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });

  await page.reload();

  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __stockSeen: boolean }).__stockSeen)).toBe(false);
});

test('right-clicking a card offers its actions, and favoriting from the menu shows up in Favorites', async ({ page }) => {
  const { admin, items } = loadState();
  await login(page, ADMIN);
  await navLink(page, 'Movies').click();

  await page.getByRole('list', { name: 'Movies' }).getByRole('link', { name: 'Lumen Gamma' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for Lumen Gamma' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Play',
    'More info',
    'Open in new tab',
    'Add to favorites',
    'Mark as watched',
    // jellyfin-web's item actions, in a menu of their own (details.spec.ts covers them).
    'More actions…',
  ]);
  await menu.getByRole('menuitem', { name: 'Add to favorites' }).click();
  await expect(menu).toBeHidden();

  try {
    await navLink(page, 'Favorites').click();
    await expect(page.getByRole('link', { name: 'Lumen Gamma' })).toBeVisible();
  } finally {
    await api(`/UserFavoriteItems/${items['Lumen Gamma']}`, {
      method: 'DELETE',
      token: admin.token,
      query: { userId: admin.userId },
    });
  }
});

test('a cold load shows the veil and lifts it once home is ready', { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);
  await page.reload();

  await expect(page.locator('#lmn-root .lmn-home .lmn-hero')).toBeVisible();
  await expect(page.locator('#lmn-veil')).toHaveCount(0);
  await expect(page.locator('.docspinner')).toBeHidden();
});
