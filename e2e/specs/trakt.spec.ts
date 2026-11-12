import { expect, type Page, test } from '@playwright/test';
import { ADMIN, api, loadState, resetLumen } from '../support/api';
import { walkDpad } from '../support/dpad';
import { login } from '../support/login';
import { PROVIDER_IDS, configureTrakt, resetStub, setProviderIds } from '../support/trakt';

// Top charts and Trakt's other home rows (Trakt design note, 2026-11-12), from the stub's Trakt lists
// (support/stub-seerr.mjs). Lumen Beta, Lumen Alpha and Lumen Show are on the server; the rest can be requested when
// Seerr is set up.

const PICKS = 'https://trakt.tv/users/lumen-tester/lists/lumen-picks';

test.beforeEach(async () => {
  await resetStub();
  await setProviderIds((name) => PROVIDER_IDS[name]!);
});
test.afterEach(async () => {
  await setProviderIds(() => ({}));
  await resetLumen();
});

/** The ranks a chart shows, in order. */
const ranks = (page: Page) => page.locator('.lmn-charts__rank').allTextContents();
const chart = (page: Page, name: string) => page.getByRole('list', { name });

test.describe('Top charts', () => {
  test('ranks Trakt’s most watched by period, with titles here opening and the rest requestable', { tag: '@smoke' }, async ({ page }) => {
    await configureTrakt({ trakt: true, seerr: true }, [{ Type: 'Top10Movies' }, { Type: 'Top10Shows' }]);
    await login(page, ADMIN);

    // From the Top 10 row's title.
    await page.getByRole('link', { name: 'Top 10 Movies This Week, see all in Top charts' }).click();
    await expect(page).toHaveURL(/#\/home\?lumen=charts&chart=movies&period=weekly$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Top charts' })).toBeVisible();

    // True Trakt ranks: the title Seerr doesn't know (3rd) leaves a gap.
    const week = chart(page, 'Top movies this week');
    await expect(week.getByRole('link', { name: '1, Lumen Beta' })).toBeVisible();
    await expect(week.getByRole('button', { name: '2, The Matrix' })).toBeVisible();
    await expect(week.getByRole('link', { name: '4, Lumen Alpha' })).toBeVisible();
    await expect(week.getByRole('button', { name: '5, The Matrix Reloaded, Requested' })).toBeVisible();
    expect(await ranks(page)).toEqual(['1', '2', '4', '5']);
    await expect(week.getByRole('button', { name: /^Request / })).toHaveCount(1);

    // Requested in place.
    await week.getByRole('button', { name: 'Request The Matrix' }).click();
    const dialog = page.getByRole('dialog', { name: 'Request The Matrix' });
    await dialog.getByRole('button', { name: 'Request', exact: true }).click();
    await expect(dialog.getByText('Requested, waiting for approval.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(week.getByRole('button', { name: '2, The Matrix, Requested' })).toBeVisible();

    // Shows.
    await page.getByRole('group', { name: 'Movies or shows' }).getByRole('button', { name: 'Shows' }).click();
    const shows = chart(page, 'Top shows this week');
    await expect(shows.getByRole('button', { name: '1, Lumen Saga, Partly available' })).toBeVisible();
    await expect(shows.getByRole('link', { name: '2, Lumen Show' })).toBeVisible();
    await expect(page).toHaveURL(/chart=shows&period=weekly$/);

    // Each period is its own chart.
    await page.getByRole('group', { name: 'Movies or shows' }).getByRole('button', { name: 'Movies' }).click();
    const periods = page.getByRole('group', { name: 'Period' });
    await periods.getByRole('button', { name: 'This month' }).click();
    const month = chart(page, 'Top movies this month');
    await expect(month.getByRole('link', { name: '2, Lumen Alpha' })).toBeVisible();
    expect(await ranks(page)).toEqual(['1', '2', '3', '4']);
    await periods.getByRole('button', { name: 'This year' }).click();
    await expect(chart(page, 'Top movies this year').getByRole('link', { name: '2, Lumen Beta' })).toBeVisible();
    expect(await ranks(page)).toEqual(['1', '2']);

    // All time: 30 titles (one Seerr can't describe), a page of 24 at first and the rest as the grid's end nears the
    // screen (on a desktop that's at once: the window shows the first page whole).
    const pages: string[] = [];
    page.on('request', (r) => r.url().includes('/Lumen/Charts/movies/all') && pages.push(new URL(r.url()).search));
    await periods.getByRole('button', { name: 'All time' }).click();
    const all = chart(page, 'Top movies all time');
    await expect(all.getByRole('button', { name: '24, Stub Request 782' })).toBeVisible();
    await all.getByRole('button', { name: '24, Stub Request 782' }).scrollIntoViewIfNeeded();
    await expect(all.getByRole('link', { name: '29, Lumen Beta' })).toBeVisible();
    expect(pages).toEqual(['?startIndex=0&limit=24', '?startIndex=24&limit=24']);
    await expect(all.getByRole('link', { name: '27, Lumen Alpha' })).toBeVisible();
    await expect(all.getByRole('listitem')).toHaveCount(29);

    // A title opens its page; Back returns to the same chart.
    await all.getByRole('link', { name: '27, Lumen Alpha' }).click();
    await expect(page).toHaveURL(/#\/details\?id=/);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/chart=movies&period=all$/);
    await expect(periods.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
    await expect(all.getByRole('link', { name: '27, Lumen Alpha' })).toBeVisible();
  });

  test('without Seerr, Top charts keep the titles here at their true rank', async ({ page }) => {
    await configureTrakt({ trakt: true, seerr: false }, [{ Type: 'Top10Movies' }]);
    await login(page, ADMIN);
    await page.goto('/web/#/home?lumen=charts&chart=movies&period=all');

    const all = chart(page, 'Top movies all time');
    await expect(all.getByRole('link', { name: '27, Lumen Alpha' })).toBeVisible();
    await expect(all.getByRole('link', { name: '29, Lumen Beta' })).toBeVisible();
    expect(await ranks(page)).toEqual(['27', '29']);
    await expect(all.locator('[data-catalog-key]')).toHaveCount(0);

    await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'This week' }).click();
    await expect(chart(page, 'Top movies this week').getByRole('link', { name: '4, Lumen Alpha' })).toBeVisible();
    expect(await ranks(page)).toEqual(['1', '4']);
  });

  test('without a Trakt key there is no Top charts page, and no See all', async ({ page }) => {
    await configureTrakt({ trakt: false, seerr: true }, [{ Type: 'Top10Movies' }]);
    await login(page, ADMIN);

    // The row falls back to Seerr's trending titles, without a link to charts.
    await expect(page.getByRole('region', { name: 'Top 10 Movies This Week' }).getByRole('button', { name: '1, The Matrix' })).toBeVisible();
    await expect(page.getByRole('link', { name: /see all in Top charts/ })).toHaveCount(0);

    await page.goto('/web/#/home?lumen=charts');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    const { admin } = loadState();
    await expect(api('/Lumen/Charts/movies/weekly', { token: admin.token })).rejects.toThrow(/404/);
  });
});

test.describe('Trakt rows', () => {
  const ALL_ROWS = [
    { Type: 'TraktBoxOffice' },
    { Type: 'TraktAnticipatedMovies' },
    { Type: 'TraktAnticipatedShows' },
    { Type: 'TraktTrendingMovies' },
    { Type: 'TraktTrendingShows' },
    { Type: 'TraktList', Params: [{ Name: 'url', Value: PICKS }] },
    { Type: 'TraktList', Title: 'Staff picks', Params: [{ Name: 'url', Value: 'trakt.tv/lists/4242' }] },
    { Type: 'TraktList', Title: 'Private list', Params: [{ Name: 'url', Value: 'https://trakt.tv/users/lumen-tester/lists/secret' }] },
    { Type: 'TraktList', Title: 'Missing list', Params: [{ Name: 'url', Value: 'https://trakt.tv/users/lumen-tester/lists/gone' }] },
  ];

  test('each Trakt row shows its list in order, the titles here opening and the rest requestable', { tag: '@smoke' }, async ({ page }) => {
    await configureTrakt({ trakt: true, seerr: true, only: true }, ALL_ROWS);
    await login(page, ADMIN);

    const box = page.getByRole('region', { name: 'Box Office This Weekend' });
    await expect(box.getByRole('button', { name: 'The Matrix', exact: true })).toBeVisible();
    await expect(box.getByRole('link', { name: 'Lumen Beta' })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Stub Request 790', exact: true })).toBeVisible();
    await expect(box.getByRole('button', { name: /^Request / })).toHaveCount(2);

    const anticipated = page.getByRole('region', { name: 'Most Anticipated Movies' });
    await expect(anticipated.getByRole('button', { name: 'Lumen Future', exact: true })).toBeVisible();
    await expect(anticipated.getByRole('button', { name: 'Request Stub Request 792' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Most Anticipated Shows' }).getByRole('button', { name: 'Lumen Saga, Partly available' })).toBeVisible();

    const trending = page.getByRole('region', { name: 'Trending Movies' });
    await expect(trending.getByRole('link', { name: 'Lumen Alpha' })).toBeVisible();
    await expect(trending.getByRole('button', { name: 'The Matrix Reloaded, Requested' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Trending Shows' }).getByRole('link', { name: 'Lumen Show' })).toBeVisible();

    // A list is titled with its name on Trakt, unless the admin gave it one; movies and shows mix.
    const picks = page.getByRole('region', { name: 'Lumen Picks' });
    await expect(picks.getByRole('button', { name: 'Lumen Saga, Partly available' })).toBeVisible();
    await expect(picks.getByRole('link', { name: 'Lumen Beta' })).toBeVisible();
    await expect(picks.getByRole('button', { name: 'Stub Request 793', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Staff picks' }).getByRole('link', { name: 'Lumen Beta' })).toBeVisible();
    // A private or missing list's row is hidden.
    await expect(page.getByRole('region', { name: 'Private list' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Missing list' })).toHaveCount(0);

    // Posters without Top 10's numerals.
    await expect(page.locator('.lmn-row--trakt')).toHaveCount(7);
    await expect(page.locator('.lmn-row--trakt .lmn-top10__rank')).toHaveCount(0);

    // Requested in place, as from a Top 10 row.
    await box.getByRole('button', { name: 'Request Stub Request 790' }).click();
    const dialog = page.getByRole('dialog', { name: 'Request Stub Request 790' });
    await dialog.getByRole('button', { name: 'Request', exact: true }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(box.getByRole('button', { name: 'Stub Request 790, Requested' })).toBeVisible();
  });

  test('without Seerr, the rows show only titles here, and Most Anticipated is hidden', async ({ page }) => {
    await configureTrakt({ trakt: true, seerr: false, only: true }, ALL_ROWS);
    await login(page, ADMIN);

    await expect(page.getByRole('region', { name: 'Box Office This Weekend' }).getByRole('link', { name: 'Lumen Beta' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Trending Movies' }).getByRole('link', { name: 'Lumen Alpha' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lumen Picks' }).getByRole('link', { name: 'Lumen Beta' })).toBeVisible();
    await expect(page.locator('.lmn-row--trakt [data-catalog-key]')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Most Anticipated Movies' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Most Anticipated Shows' })).toHaveCount(0);
  });

  test('without a Trakt key the rows are hidden', async ({ page }) => {
    await configureTrakt({ trakt: false, seerr: true }, ALL_ROWS);
    await login(page, ADMIN);

    await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();
    await expect(page.locator('.lmn-row--trakt')).toHaveCount(0);
  });

  test('a Trakt list’s address is checked on save, with a clear error', async () => {
    const { admin } = loadState();
    const config = await api<Record<string, unknown> & { Sections: unknown[] }>('/Lumen/Admin/Config', { token: admin.token });
    const save = (url: string) =>
      api('/Lumen/Admin/Config', {
        method: 'POST',
        token: admin.token,
        body: { ...config, Sections: [{ Id: crypto.randomUUID(), Type: 'TraktList', Enabled: true, Params: [{ Name: 'url', Value: url }] }] },
      });

    for (const url of ['https://trakt.tv/users/lumen-tester/watchlist', 'https://letterboxd.com/me/list/picks/', 'picks']) {
      await expect(save(url)).rejects.toThrow(/400 .*Enter a public Trakt list.{1,6}s address, like https:\/\/trakt\.tv\/users\/name\/lists\/list-name\./);
    }
    await expect(save('')).rejects.toThrow(/400 .*is required/);
    await save(PICKS);

    // The section types the admin page offers include it, with its address field (repeatable: a Text parameter).
    const types = await api<{ Type: string; Parameters: { Name: string; Kind: string; Required: boolean }[] }[]>('/Lumen/Admin/SectionTypes', {
      token: admin.token,
    });
    expect(types.find((t) => t.Type === 'TraktList')?.Parameters).toEqual([expect.objectContaining({ Name: 'url', Kind: 'Text', Required: true })]);
    for (const type of ['TraktBoxOffice', 'TraktAnticipatedMovies', 'TraktAnticipatedShows', 'TraktTrendingMovies', 'TraktTrendingShows']) {
      expect(types.map((t) => t.Type)).toContain(type);
    }
  });
});

test.describe('TV layout', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });

  async function signInOnTv(page: Page): Promise<void> {
    await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
    await login(page, ADMIN);
    await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  }

  test('TV layout: the D-pad reaches the switches, every chart card and its Request button', async ({ page }) => {
    await configureTrakt({ trakt: true, seerr: true, only: true }, [{ Type: 'Top10Movies' }]);
    await signInOnTv(page);
    // From home, the D-pad reaches the row's See all.
    const seeAll = page.getByRole('link', { name: 'Top 10 Movies This Week, see all in Top charts' });
    await expect(seeAll).toBeVisible();
    await page.getByRole('region', { name: 'Top 10 Movies This Week' }).getByRole('link', { name: '1, Lumen Beta' }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(seeAll).toBeFocused();
    await page.keyboard.press('Enter');

    const week = chart(page, 'Top movies this week');
    await expect(week.getByRole('link', { name: '1, Lumen Beta' })).toBeVisible();
    // The chart switch has focus on arrival.
    const movies = page.getByRole('group', { name: 'Movies or shows' }).getByRole('button', { name: 'Movies' });
    await expect(movies).toBeFocused();

    const { controls, unreachable } = await walkDpad(page, movies);

    // Six chips, four cards and The Matrix's Request button.
    expect(controls.filter((c) => /lmn-chip/.test(c.classes)).length).toBe(6);
    expect(controls.filter((c) => /lmn-card|lmn-top10__request/.test(c.classes)).length).toBeGreaterThanOrEqual(5);
    expect(unreachable.map((c) => c.name)).toEqual([]);

    // Down from the card reaches its Request button, and OK on it opens the dialog.
    await week.getByRole('button', { name: '2, The Matrix' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(week.getByRole('button', { name: 'Request The Matrix' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Request The Matrix' })).toBeVisible();
  });

  test('TV layout: OK on a period chip switches the chart, and focus stays on it', async ({ page }) => {
    await configureTrakt({ trakt: true, seerr: false, only: true }, [{ Type: 'Top10Movies' }]);
    await signInOnTv(page);
    await page.goto('/web/#/home?lumen=charts');
    const periods = page.getByRole('group', { name: 'Period' });
    await expect(chart(page, 'Top movies this week').getByRole('link', { name: '1, Lumen Beta' })).toBeVisible();

    const month = periods.getByRole('button', { name: 'This month' });
    await month.focus();
    await page.keyboard.press('Enter');
    await expect(chart(page, 'Top movies this month').getByRole('link', { name: '2, Lumen Alpha' })).toBeVisible();
    await expect(month).toBeFocused();
    await expect(month).toHaveAttribute('aria-pressed', 'true');
  });
});
