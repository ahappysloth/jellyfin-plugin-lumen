import { expect, test } from '@playwright/test';
import { ADMIN, KID, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';

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

test('catalog rows mix library cards with request cards', async ({ page }) => {
  await enableCatalogRows(['CatalogPopularMovies', 'CatalogUpcoming']);
  await login(page, ADMIN);

  const popular = page.getByRole('region', { name: 'Popular Movies' });
  await expect(popular.getByRole('button', { name: 'The Matrix, Request' })).toBeVisible();
  // 604 is on the server, so it's an ordinary Lumen card that opens the library details page.
  await expect(popular.getByRole('link', { name: /^Lumen Alpha/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Coming Soon' }).getByRole('button', { name: /Lumen Future/ })).toBeVisible();

  await popular.getByRole('button', { name: 'The Matrix, Request' }).click();
  await expect(page).toHaveURL(/#\/home\?title=movie-603$/);
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

test('users without a Seerr account get no catalog rows', async ({ page }) => {
  await enableCatalogRows(['CatalogTrending']);
  await login(page, KID);

  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Trending' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'My Requests' })).toHaveCount(0);
});
