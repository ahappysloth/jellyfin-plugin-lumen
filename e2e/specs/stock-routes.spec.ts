import { expect, test } from '@playwright/test';
import {
  detailsHash,
  FAVORITES_HASH,
  genreHash,
  HOME_HASH,
  libraryHash,
  PREFERENCES_HASH,
  SEARCH_HASH,
  SETTINGS_HASHES,
} from '../../client/src/compat/jellyfin';
import { ADMIN_ROUTES, HEALTH_FIX_ROUTES, LIBRARY_ROUTES, MODERN_LIBRARY_ROUTES } from '../../client/src/compat/registry';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';
import { NOT_FOUND, openFresh } from '../support/stock-pages';

/** Every library type Lumen has a link for, plus one it hasn't (no CollectionType: a plain folder). */
const LIBRARY_TYPES = [
  ...Object.keys(LIBRARY_ROUTES),
  ...Object.keys(MODERN_LIBRARY_ROUTES),
  'livetv',
  'boxsets',
  undefined,
];

/**
 * Contract: every jellyfin-web route Lumen links to still exists. If jellyfin-web renames one, Lumen's own takeover of
 * it just stops (parseRoute returns 'other'), but its links would land on jellyfin-web's "Page not found".
 */
test('every stock route Lumen links to opens a real page, not jellyfin-web’s 404', async ({ page }) => {
  test.setTimeout(180_000);
  const { admin, items, libraries } = loadState();
  const genres = await api<{ Items: { Id: string }[] }>('/Genres', { token: admin.token, query: { userId: admin.userId } });
  const views = await api<{ Items: { Id: string; ServerId: string }[] }>(`/Users/${admin.userId}/Views`, { token: admin.token });
  const serverId = views.Items[0]!.ServerId;

  await login(page, ADMIN);
  // The 404 marker itself must still mean what this test thinks it means.
  await openFresh(page, '#/lumen-contract-no-such-page');
  await expect(page.locator(NOT_FOUND)).toBeAttached();

  const hashes = [
    HOME_HASH,
    FAVORITES_HASH,
    SEARCH_HASH,
    PREFERENCES_HASH,
    detailsHash(items['Lumen Alpha']!, serverId),
    genreHash(genres.Items[0]!.Id, serverId),
    // Every library type Lumen links to (the id only has to exist for the page to render), as built in this layout.
    ...LIBRARY_TYPES.map((CollectionType) =>
      libraryHash({ Id: libraries.movies, CollectionType, ServerId: serverId }, true),
    ),
    ...Object.values(SETTINGS_HASHES).map((hash) => hash(admin.userId)),
    // The admin pages Lumen restyles (and links to from its settings menu).
    ...ADMIN_ROUTES.map((route) => (route === '/configurationpage' ? `#${route}?name=Lumen` : `#${route}`)),
    // The Dashboard pages the Health tab links to for a fix.
    ...Object.values(HEALTH_FIX_ROUTES).map((route) => `#${route}`),
  ];
  for (const hash of hashes) {
    await test.step(hash, async () => {
      await openFresh(page, hash);
      await expect(page.locator(NOT_FOUND), `${hash} is jellyfin-web's 404 page`).toHaveCount(0);
    });
  }
});

/**
 * The TV layout runs jellyfin-web's Legacy app, which has fewer library pages (no Books, Music Videos or Playlists
 * page): Lumen's library links there must be the ones stock builds in that layout.
 */
test('in the TV layout, every library link Lumen builds opens a real page', async ({ page }) => {
  test.setTimeout(120_000);
  const { admin, libraries } = loadState();
  const views = await api<{ Items: { ServerId: string }[] }>(`/Users/${admin.userId}/Views`, { token: admin.token });
  const serverId = views.Items[0]!.ServerId;
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await openFresh(page, '#/lumen-contract-no-such-page');
  await expect(page.locator(NOT_FOUND)).toBeAttached();
  await expect(page.locator('html')).toHaveClass(/layout-tv/);

  for (const CollectionType of LIBRARY_TYPES) {
    const hash = libraryHash({ Id: libraries.movies, CollectionType, ServerId: serverId }, false);
    await test.step(hash, async () => {
      await openFresh(page, hash);
      await expect(page.locator(NOT_FOUND), `${hash} is jellyfin-web's 404 page`).toHaveCount(0);
    });
  }
});

/**
 * What Lumen itself builds on a TV: its nav links a Books library to the list page (the Legacy app has no Books page),
 * and the link opens a real page. The fixture has no Books library, so the server's list of libraries gets one more,
 * first: the test show's folder, presented as a Books library.
 */
test("in the TV layout, Lumen's nav links a Books library to a page that exists", async ({ page }) => {
  const { items } = loadState();
  // A real folder that isn't already in the nav (a library's id would repeat its key there).
  const folder = items['Lumen Show']!;
  await page.route(/\/UserViews(\?|$)/, async (route) => {
    const response = await route.fetch();
    const views = (await response.json()) as { Items: { ServerId: string }[] };
    const books = { ...views.Items[0], Id: folder, Name: 'Lumen Books', CollectionType: 'books' };
    // First, as the nav shows only the first few libraries.
    await route.fulfill({ response, json: { ...views, Items: [books, ...views.Items] } });
  });
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/layout-tv/);

  const link = page.locator('#lmn-root .lmn-nav__pill').getByRole('link', { name: 'Lumen Books' });
  await expect(link).toHaveAttribute('href', new RegExp(`^#/list\\?parentId=${folder}&serverId=`));
  await openFresh(page, (await link.getAttribute('href'))!);
  await expect(page.locator(NOT_FOUND)).toHaveCount(0);
});
