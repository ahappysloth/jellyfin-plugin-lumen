import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

test('movie details are rendered by Lumen, including the local trailer', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  const details = page.locator('#lmn-root .lmn-details--movie');
  await expect(details.getByRole('img', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(details.getByRole('img', { name: 'Lumen Alpha' })).toBeInViewport();
  await expect(details.getByText('2001')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Trailer' })).toBeVisible();
});

test('series details offer smart play and season browsing', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const details = page.locator('#lmn-root .lmn-details--series');
  await expect(details.getByRole('button', { name: /S1:E1/ })).toBeVisible();
  await details.getByRole('button', { name: /^Season:/ }).click();
  await expect(details.getByRole('option')).toHaveText(['Season 1', 'Season 2']);
  await page.keyboard.press('Escape');
  await expect(details.locator('.lmn-episode')).toHaveCount(3);
});

test('episode details are rendered by Lumen, with previous/next across seasons', async ({ page }) => {
  const { admin, items } = loadState();
  const episodes = await api<{ Items: { Id: string; ParentIndexNumber: number; IndexNumber: number }[] }>(
    `/Shows/${items['Lumen Show']}/Episodes`,
    { token: admin.token, query: { userId: admin.userId } },
  );
  const last = episodes.Items.find((e) => e.ParentIndexNumber === 1 && e.IndexNumber === 3)!;
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${last.Id}`);

  const details = page.locator('#lmn-root .lmn-details--episode');
  await expect(details.getByText('S1:E3', { exact: true })).toBeVisible();
  await expect(details.getByRole('link', { name: 'Lumen Show', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(details.getByRole('region', { name: 'More from Season 1' }).getByRole('button')).toHaveCount(3);

  await details.getByRole('link', { name: /^Next episode: S2:E1/ }).click();
  await expect(page.locator('#lmn-root .lmn-details--episode').getByText('S2:E1', { exact: true })).toBeVisible();

  // The show link opens the series page at the episode's season.
  await page.locator('#lmn-root .lmn-details--episode').getByRole('link', { name: 'Lumen Show', exact: true }).click();
  await expect(page.locator('#lmn-root .lmn-details--series').getByRole('button', { name: 'Season: Season 2' })).toBeVisible();
});

test("a season's episode rows link to the episode page", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const series = page.locator('#lmn-root .lmn-details--series');
  await series.getByRole('link', { name: /^Details for / }).first().click();
  await expect(page.locator('#lmn-root .lmn-details--episode')).toBeVisible();
});

test('items Lumen does not handle stay on the stock details page', async ({ page }) => {
  const { admin } = loadState();
  // A library folder: Lumen has no details page for it.
  const views = await api<{ Items: { Id: string; CollectionType?: string }[] }>('/UserViews', {
    token: admin.token,
    query: { userId: admin.userId },
  });
  const library = views.Items.find((v) => v.CollectionType === 'movies')!;
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${library.Id}`);

  await expect(page.locator('#itemDetailPage:not(.hide)')).toBeVisible();
  await expect(page.locator('#lmn-root')).toBeHidden();
});
