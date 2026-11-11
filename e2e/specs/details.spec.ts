import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

/** Titles a test marked watched: put back to never played afterwards (marking played, then unplayed, clears the date). */
let played: string[] = [];

test.afterEach(async () => {
  const { admin } = loadState();
  for (const id of played)
    for (const method of ['POST', 'DELETE'] as const)
      await api(`/UserPlayedItems/${id}`, { method, token: admin.token, query: { userId: admin.userId } });
  played = [];
});

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

test('Watched asks before marking unwatched: Cancel keeps it watched, confirming marks it unwatched', async ({ page }) => {
  const { admin, items } = loadState();
  const id = items['Lumen Delta']!;
  played = [id];
  await api(`/UserPlayedItems/${id}`, { method: 'POST', token: admin.token, query: { userId: admin.userId } });
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${id}`);

  const details = page.locator('#lmn-root .lmn-details--movie');
  const watched = details.getByRole('button', { name: 'Watched', exact: true });
  const confirm = page.getByRole('alertdialog', { name: 'Mark as unwatched?' });
  const isPlayed = async () => {
    const data = await api<{ Played: boolean }>(`/UserItems/${id}/UserData`, {
      token: admin.token,
      query: { userId: admin.userId },
    });
    return data.Played;
  };

  await watched.click();
  await expect(confirm).toContainText('This resets how far you got and removes it from your History.');
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(watched).toBeVisible();
  expect(await isPlayed()).toBe(true);

  // Escape is Cancel too, on a computer.
  await watched.click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/details\\?id=${id}`));
  await expect(watched).toBeVisible();

  await watched.click();
  await confirm.getByRole('button', { name: 'Mark unwatched' }).click();
  await expect(confirm).toBeHidden();
  const unwatched = details.getByRole('button', { name: 'Mark watched' });
  await expect(unwatched).toBeVisible();
  await expect.poll(isPlayed).toBe(false);

  // Marking watched doesn't ask.
  await unwatched.click();
  await expect(watched).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect.poll(isPlayed).toBe(true);
});

test('Mark as unwatched? goes away when jellyfin-web changes page, leaving the title watched', async ({
  page,
  isMobile,
}) => {
  const { admin, items } = loadState();
  const id = items['Lumen Delta']!;
  played = [id];
  await api(`/UserPlayedItems/${id}`, { method: 'POST', token: admin.token, query: { userId: admin.userId } });
  // A blue accent: the button that goes ahead stays Lumen's red.
  await page.route(/\/Lumen\/ClientConfig/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), AccentColor: '#3b82f6' } });
  });
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${id}`);

  const watched = page.locator('#lmn-root .lmn-details--movie').getByRole('button', { name: 'Watched', exact: true });
  const confirm = page.getByRole('alertdialog', { name: 'Mark as unwatched?' });
  await watched.click();
  await expect(confirm).toBeVisible();
  // The page behind doesn't scroll while it's open.
  const goAhead = confirm.getByRole('button', { name: 'Mark unwatched' });
  expect(await goAhead.evaluate((el) => getComputedStyle(el).getPropertyValue('--lmn-accent').trim())).toBe('#3b82f6');
  await expect(goAhead).toHaveCSS('background-color', 'rgb(227, 11, 23)');
  if (!isMobile) {
    // Hovered, it's a darker red.
    await goAhead.hover();
    await expect(goAhead).toHaveCSS('background-color', 'rgb(227, 11, 23)');
    await expect(goAhead).toHaveCSS('filter', 'brightness(0.85)');
  }
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');

  // What a remote's Home key, or a "go home" sent from another device, does: jellyfin-web's pushState.
  await page.evaluate(() => (window as unknown as { Emby: { Page: { goHome(): void } } }).Emby.Page.goHome());
  await expect(page).toHaveURL(/#\/home$/);
  await expect(confirm).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  const data = await api<{ Played: boolean }>(`/UserItems/${id}/UserData`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  expect(data.Played).toBe(true);
});
