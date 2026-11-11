import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

test('movie details are rendered by Lumen, including the local trailer', { tag: '@smoke' }, async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  const details = page.locator('#lmn-root .lmn-details--movie');
  await expect(details.getByRole('img', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(details.getByRole('img', { name: 'Lumen Alpha' })).toBeInViewport();
  await expect(details.getByText('2001')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Trailer' })).toBeVisible();
});

test('movie details offer the file as a download beside Play', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  const details = page.locator('#lmn-root .lmn-details--movie');
  // Named "Download" at every size, though a phone shows only its icon.
  const download = details.getByRole('link', { name: 'Download' });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', new RegExp(`/Items/${items['Lumen Alpha']}/Download\\?ApiKey=`));
  await expect(download).toHaveAttribute('title', /^Download \(\d/);

  const file = page.waitForEvent('download');
  await download.click();
  expect((await file).suggestedFilename()).toBe('Lumen Alpha (2001).webm');
});

test('the details trailer fades in over the backdrop once it plays, Mute in the corner', async ({ page, browserName }) => {
  // The fixture trailer is WebM, which Playwright's WebKit on Linux may not play.
  test.skip(browserName === 'webkit', 'WebM playback');
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Zeta']}`);

  const header = page.locator('#lmn-root .lmn-details__header');
  const unmute = header.getByRole('button', { name: 'Unmute trailer' });
  // The backdrop first; no trailer controls until there's a trailer to control.
  await expect(header.locator('.lmn-details__backdrop')).toBeVisible();
  await expect(unmute).toBeHidden();

  const video = header.locator('.lmn-details__trailer video');
  await expect(video).toHaveClass(/\bis-shown\b/, { timeout: 20_000 });
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  await expect(unmute).toBeVisible();
  await expect(header.getByRole('button', { name: 'Pause trailer' })).toBeVisible();

  // Top right of the backdrop, clear of the title and the action row.
  const box = (await unmute.boundingBox())!;
  const area = (await header.boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(area.x + area.width - 120);
  expect(box.y).toBeLessThan(area.y + 120);

  await unmute.click();
  await expect(header.getByRole('button', { name: 'Mute trailer' })).toBeFocused();
});

test('series details offer smart play and season browsing', { tag: '@smoke' }, async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const details = page.locator('#lmn-root .lmn-details--series');
  await expect(details.getByRole('button', { name: /S1:E1/ })).toBeVisible();
  await details.getByRole('button', { name: /^Season:/ }).click();
  await expect(details.getByRole('option')).toHaveText(['Season 1', 'Season 2']);
  await page.keyboard.press('Escape');
  await expect(details.locator('.lmn-episode')).toHaveCount(3);
  // A series is a folder: no Download (jellyfin-web's "Download all" stays in its own menu).
  await expect(details.getByRole('link', { name: 'Download' })).toHaveCount(0);
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
  await expect(details.getByRole('region', { name: 'More from Season 1' }).getByRole('link')).toHaveCount(3);

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
