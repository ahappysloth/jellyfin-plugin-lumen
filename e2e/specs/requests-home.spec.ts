import { expect, type Page, test } from '@playwright/test';
import { ADMIN, KID, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';
import { navLink } from '../support/nav';

// Seerr permission bits: REQUEST = 32. The admin is Seerr user 1 in every requests spec (Lumen caches the mapping).
const REQUEST_PERMISSION = 32;

test.beforeEach(async () => {
  const { admin, items } = loadState();
  await fetch(`${STUB_SEERR}/__stub/reset`, { method: 'POST' });
  await fetch(`${STUB_SEERR}/__stub/users`, {
    method: 'POST',
    body: JSON.stringify({ [admin.userId.replace(/-/g, '')]: { id: 1, permissions: REQUEST_PERMISSION } }),
  });
  await fetch(`${STUB_SEERR}/__stub/jellyfin`, {
    method: 'POST',
    body: JSON.stringify({ name: 'This server', serverId: (await api<{ Id: string }>('/System/Info/Public')).Id }),
  });
  // The stub's "Popular Movies" includes movie 604; make it a title this server has (Lumen Alpha).
  await fetch(`${STUB_SEERR}/__stub/library`, {
    method: 'POST',
    body: JSON.stringify({ tmdbId: 604, jellyfinMediaId: items['Lumen Alpha']!.replace(/-/g, '') }),
  });
});
test.afterEach(resetLumen);

/** Turns Seerr on and puts the catalog rows first on home (saving also refreshes the home cache). */
async function enableCatalogRows(types: string[]): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown> & { Sections: unknown[] }>('/Lumen/Admin/Config', {
    token: admin.token,
  });
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: {
      ...config,
      RequestsEnabled: true,
      SeerrUrl: SEERR_URL,
      SeerrApiKey: 'stub-key',
      Sections: [
        ...types.map((Type) => ({ Id: crypto.randomUUID(), Type, Enabled: true, Params: [] })),
        ...config.Sections,
      ],
    },
  });
}

/** Whether the page has asked for the catalog title page's code (client/src/views/catalog/lazyTitle.tsx). */
function watchTitleCode(page: Page): () => boolean {
  let requested = false;
  page.on('request', (request) => {
    if (/\/lumen-chunk-TitleView-[^/]*\.js/.test(request.url())) requested = true;
  });
  return () => requested;
}

test('catalog rows mix library cards with request cards', async ({ page }) => {
  await enableCatalogRows(['CatalogPopularMovies', 'CatalogUpcoming']);
  const titleCodeRequested = watchTitleCode(page);
  await login(page, ADMIN);

  const popular = page.getByRole('region', { name: 'Popular Movies' });
  await expect(popular.getByRole('button', { name: 'The Matrix, Request' })).toBeVisible();
  // 604 is on the server, so it's an ordinary Lumen card that opens the library details page.
  await expect(popular.getByRole('link', { name: /^Lumen Alpha/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Coming Soon' }).getByRole('button', { name: /Lumen Future/ })).toBeVisible();

  // The title page's code is fetched while the catalog cards show, before one is opened.
  await expect.poll(titleCodeRequested).toBe(true);

  await popular.getByRole('button', { name: 'The Matrix, Request' }).click();
  await expect(page).toHaveURL(/#\/home\?title=movie-603$/);
});

test('a server without Seerr never downloads the catalog title page', async ({ page }) => {
  const titleCodeRequested = watchTitleCode(page);
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await navLink(page, 'Search').click();
  await page.getByRole('searchbox', { name: 'Search' }).fill('matrix');
  await expect(page.getByText('No results for “matrix”')).toBeVisible();

  // Past the moment catalog cards would have fetched it: lazyTitle.tsx prefetches in an idle callback (within 3 s), or
  // 1 s on, where there are none (Safari). One queued now runs after any it queued.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        if (typeof window.requestIdleCallback !== 'function') setTimeout(resolve, 1000);
        else window.requestIdleCallback(() => resolve(), { timeout: 3000 });
      }),
  );
  // And for the request it would have made to reach the test.
  await page.waitForTimeout(250);
  expect(titleCodeRequested()).toBe(false);
});

test('My Requests lists what the user asked for', async ({ page }) => {
  const { admin } = loadState();
  await enableCatalogRows([]);
  await api('/Lumen/Requests', { method: 'POST', token: admin.token, body: { MediaType: 'movie', TmdbId: 603 } });
  // My Requests is in the default sections (requests spec §10); saving again refreshes the home cache.
  await enableCatalogRows([]);
  await login(page, ADMIN);

  const mine = page.getByRole('region', { name: 'My Requests' });
  await expect(mine.getByRole('button', { name: 'The Matrix, Requested' })).toBeVisible();
});

test("a Trending card carries its title over the art: its logo, or here (no logo lookups on a test server) its name", async ({ page }) => {
  await enableCatalogRows(['CatalogTrending']);
  await login(page, ADMIN);

  const trending = page.getByRole('region', { name: 'Trending' });
  const matrix = trending.getByRole('button', { name: 'The Matrix, Request' });
  await expect(matrix.locator('.lmn-card__art .lmn-card__name')).toHaveText('The Matrix');
  await expect(matrix.locator('.lmn-card__logo')).toHaveCount(0);
  // Along the foot of the art (inside its 1 px border), from its left.
  const art = (await matrix.locator('.lmn-card__art').boundingBox())!;
  const name = (await matrix.locator('.lmn-card__name').boundingBox())!;
  expect(Math.abs(name.y + name.height - (art.y + art.height))).toBeLessThan(2);
  expect(Math.abs(name.x - art.x)).toBeLessThan(2);
});

test('users without a Seerr account get no catalog rows', async ({ page }) => {
  await enableCatalogRows(['CatalogTrending']);
  await login(page, KID);

  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Trending' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'My Requests' })).toHaveCount(0);
});
