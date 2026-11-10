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
  await expect(grid.getByRole('button', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(page.getByText(/\d+ titles/)).toBeVisible();

  await page.getByRole('button', { name: /^Sort by:/ }).click();
  await page.getByRole('option', { name: 'Title' }).click();
  await expect(grid.getByRole('button').first()).toHaveAccessibleName('Lumen Alpha');

  await grid.getByRole('button', { name: 'Lumen Alpha' }).click();
  await expect(page).toHaveURL(/#\/details\?id=/);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Sort by: Title' })).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'Lumen Beta' })).toBeVisible();
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

  await page.getByRole('list', { name: 'Movies' }).getByRole('button', { name: 'Lumen Gamma' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for Lumen Gamma' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Play', 'More info', 'Open in new tab', 'Add to favorites', 'Mark as watched']);
  await menu.getByRole('menuitem', { name: 'Add to favorites' }).click();
  await expect(menu).toBeHidden();

  try {
    await navLink(page, 'Favorites').click();
    await expect(page.getByRole('button', { name: 'Lumen Gamma' })).toBeVisible();
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
