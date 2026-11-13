import { expect, type Locator, type Page, test } from '@playwright/test';
import { ADMIN, KID, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { walkDpad } from '../support/dpad';
import { login } from '../support/login';
import { PROVIDER_IDS, configureTrakt, resetStub, setProviderIds } from '../support/trakt';

// The Top 10 rows (Top 10 design note, 2026-11-12) read Trakt's weekly lists from the stub (support/stub-seerr.mjs,
// reached through the server's LUMEN_TRAKT_API_BASE), match them to the library by TMDB id, then IMDb id, and with Seerr
// show the other titles as cards that can be requested.

test.beforeEach(async () => {
  await resetStub();
  await setProviderIds((name) => PROVIDER_IDS[name]!);
});
test.afterEach(async () => {
  await setProviderIds(() => ({}));
  await resetLumen();
});

/** Puts the two Top 10 rows first on home, with Trakt and Seerr as asked (saving also refreshes the home cache). */
async function enableTop10({ trakt, seerr }: { trakt: boolean; seerr: boolean }): Promise<void> {
  await configureTrakt({ trakt, seerr }, [{ Type: 'Top10Movies' }, { Type: 'Top10Shows' }]);
}

/** The big numerals of a Top 10 row, in order. */
const numerals = (row: Locator) => row.locator('.lmn-top10__rank').allTextContents();

test('Top 10 ranks Trakt’s weekly titles: the ones here open their page, the rest can be requested', { tag: '@smoke' }, async ({ page }) => {
  await enableTop10({ trakt: true, seerr: true });
  await login(page, ADMIN);

  const movies = page.getByRole('region', { name: 'Top 10 Movies This Week' });
  // In Trakt's order; the title Seerr doesn't know is left out, and the ranks close up.
  await expect(movies.getByRole('link', { name: '1, Lumen Beta' })).toBeVisible();
  await expect(movies.getByRole('button', { name: '2, The Matrix' })).toBeVisible();
  await expect(movies.getByRole('link', { name: '3, Lumen Alpha' })).toBeVisible();
  await expect(movies.getByRole('button', { name: '4, The Matrix Reloaded, Requested' })).toBeVisible();
  expect(await numerals(movies)).toEqual(['1', '2', '3', '4']);
  // Decoration only: the numerals aren't read out (each card's name starts with its rank instead).
  await expect(movies.locator('.lmn-top10__rank').first()).toHaveAttribute('aria-hidden', 'true');
  // Only a title nobody has asked for yet offers Request.
  await expect(movies.getByRole('button', { name: /^Request / })).toHaveCount(1);

  const shows = page.getByRole('region', { name: 'Top 10 Shows This Week' });
  await expect(shows.getByRole('button', { name: '1, Lumen Saga, Partly available' })).toBeVisible();
  await expect(shows.getByRole('link', { name: '2, Lumen Show' })).toBeVisible();

  // Requested in place, through the same dialog as the title page.
  await movies.getByRole('button', { name: 'Request The Matrix' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request The Matrix' });
  await dialog.getByRole('button', { name: 'Request', exact: true }).click();
  await expect(dialog.getByText('Requested, waiting for approval.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(movies.getByRole('button', { name: '2, The Matrix, Requested' })).toBeVisible();
  await expect(movies.getByRole('button', { name: /^Request / })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/home/);
  const filed = (await (await fetch(`${STUB_SEERR}/__stub/requests`)).json()) as { body: { mediaId: number } }[];
  expect(filed.map((r) => r.body.mediaId)).toEqual([603]);

  // A title here is a normal card: it opens its page, where it plays.
  await movies.getByRole('link', { name: '1, Lumen Beta' }).click();
  await expect(page).toHaveURL(/#\/details\?id=/);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('Back from a title that isn’t on the server returns to its card, where the page was', async ({ page }) => {
  await enableTop10({ trakt: true, seerr: true });
  await login(page, ADMIN);
  const movies = page.getByRole('region', { name: 'Top 10 Movies This Week' });
  // A library card first: home remembers it, and used to come back to it from every catalog title opened after it.
  await movies.getByRole('link', { name: '1, Lumen Beta' }).click();
  await expect(page).toHaveURL(/#\/details\?id=/);
  await page.goBack();

  const matrix = movies.getByRole('button', { name: '2, The Matrix' });
  await expect(matrix).toBeVisible();
  await matrix.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  const top = (await matrix.boundingBox())!.y;
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await matrix.click();
  await expect(page).toHaveURL(/#\/home\?title=movie-603$/);
  await expect(page.getByRole('heading', { level: 1, name: 'The Matrix' })).toBeVisible();

  await page.goBack();
  await expect(matrix).toBeFocused();
  await expect.poll(async () => Math.abs((await matrix.boundingBox())!.y - top)).toBeLessThan(2);
});

test('a long Top 10 title ends in an ellipsis on a phone, and keeps See all in the row', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const title = 'The ten films everybody in this house watched the most this week';
  await configureTrakt({ trakt: true, seerr: false }, [{ Type: 'Top10Movies', Title: title }]);
  await login(page, ADMIN);

  const link = page.getByRole('link', { name: `${title}, see all in Top charts` });
  await expect(link).toBeVisible();
  // All of it but a fraction of a pixel (WebKit lays the title's box out at a part-pixel width).
  await expect(link.locator('.lmn-row__see-all')).toBeInViewport({ ratio: 0.95 });
  const text = link.locator('.lmn-row__link-text');
  expect(await text.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis')).toBe(true);
  await link.click();
  await expect(page).toHaveURL(/#\/home\?lumen=charts&chart=movies&period=weekly$/);
});

test('without Seerr, Top 10 shows just the ranked titles on the server', async ({ page }) => {
  await enableTop10({ trakt: true, seerr: false });
  await login(page, ADMIN);

  const movies = page.getByRole('region', { name: 'Top 10 Movies This Week' });
  await expect(movies.getByRole('link', { name: '1, Lumen Beta' })).toBeVisible();
  await expect(movies.getByRole('link', { name: '2, Lumen Alpha' })).toBeVisible();
  expect(await numerals(movies)).toEqual(['1', '2']);
  await expect(movies.locator('[data-catalog-key]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Top 10 Shows This Week' }).getByRole('link', { name: '1, Lumen Show' })).toBeVisible();
});

test('without a Trakt key, Top 10 ranks Seerr’s trending titles instead', async ({ page }) => {
  await enableTop10({ trakt: false, seerr: true });
  await login(page, ADMIN);

  // The stub's trending list: The Matrix, Lumen Saga and a person.
  const movies = page.getByRole('region', { name: 'Top 10 Movies This Week' });
  await expect(movies.getByRole('button', { name: '1, The Matrix' })).toBeVisible();
  expect(await numerals(movies)).toEqual(['1']);
  await expect(
    page.getByRole('region', { name: 'Top 10 Shows This Week' }).getByRole('button', { name: '1, Lumen Saga, Partly available' }),
  ).toBeVisible();
});

test('with neither Trakt nor Seerr, the Top 10 rows are hidden', async ({ page }) => {
  await enableTop10({ trakt: false, seerr: false });
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();
  await expect(page.locator('.lmn-row--top10')).toHaveCount(0);
});

test('a restricted user’s Top 10 only has titles they can open', async ({ page }) => {
  // kid sees only the Shows library and has no Seerr account: no movies at all, so no Top 10 Movies.
  await enableTop10({ trakt: true, seerr: true });
  await login(page, KID);

  const shows = page.getByRole('region', { name: 'Top 10 Shows This Week' });
  await expect(shows.getByRole('link', { name: '1, Lumen Show' })).toBeVisible();
  expect(await numerals(shows)).toEqual(['1']);
  await expect(page.getByRole('region', { name: 'Top 10 Movies This Week' })).toHaveCount(0);
});

test.describe('TV layout', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });

  async function signInOnTv(page: Page): Promise<void> {
    await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
    await login(page, ADMIN);
    await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  }

  test('TV layout: the D-pad reaches every Top 10 card and its Request button', async ({ page }) => {
    const { admin } = loadState();
    await enableTop10({ trakt: true, seerr: true });
    // Only the Top 10 rows, so the walk is about them.
    const config = await api<Record<string, unknown> & { Sections: { Type: string }[] }>('/Lumen/Admin/Config', { token: admin.token });
    await api('/Lumen/Admin/Config', {
      method: 'POST',
      token: admin.token,
      body: { ...config, Sections: config.Sections.filter((s) => s.Type.startsWith('Top10')) },
    });
    await signInOnTv(page);
    const movies = page.getByRole('region', { name: 'Top 10 Movies This Week' });
    const first = movies.getByRole('link', { name: '1, Lumen Beta' });
    await expect(first).toBeVisible();

    const { controls, unreachable } = await walkDpad(page, first);

    // Four movie cards, the Matrix's Request button, two show cards.
    expect(controls.filter((c) => /lmn-card|lmn-top10__request/.test(c.classes)).length).toBeGreaterThanOrEqual(7);
    expect(unreachable.map((c) => c.name)).toEqual([]);

    // Down from the card reaches its Request button, and OK on it opens the dialog.
    await movies.getByRole('button', { name: '2, The Matrix' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(movies.getByRole('button', { name: 'Request The Matrix' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Request The Matrix' })).toBeVisible();
  });
});
