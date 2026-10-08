import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

test('movie details are rendered by Lumen, including the local trailer', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  const details = page.locator('#lmn-root .lmn-details--movie');
  await expect(details.getByRole('img', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(details.getByText('2001')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Trailer' })).toBeVisible();
});

test('series details offer smart play and season browsing', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const details = page.locator('#lmn-root .lmn-details--series');
  await expect(details.getByRole('button', { name: /S1:E1/ })).toBeVisible();
  await expect(details.getByRole('combobox', { name: 'Season' }).locator('option')).toHaveText(['Season 1', 'Season 2']);
  await expect(details.locator('.lmn-episode')).toHaveCount(3);
});

test('items Lumen does not handle stay on the stock details page', async ({ page }) => {
  const { admin, items } = loadState();
  const episodes = await api<{ Items: { Id: string }[] }>(`/Shows/${items['Lumen Show']}/Episodes`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${episodes.Items[0]!.Id}`);

  await expect(page.locator('#itemDetailPage:not(.hide)')).toBeVisible();
  await expect(page.locator('#lmn-root')).toBeHidden();
});
