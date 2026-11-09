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
import { ADMIN_ROUTES, LIBRARY_ROUTES } from '../../client/src/compat/registry';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';
import { NOT_FOUND, openFresh } from '../support/stock-pages';

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
    // Every library type Lumen links to (the id only has to exist for the page to render).
    ...Object.keys(LIBRARY_ROUTES).map((CollectionType) => libraryHash({ Id: libraries.movies, CollectionType })),
    libraryHash({ Id: libraries.movies, CollectionType: 'boxsets', ServerId: serverId }),
    libraryHash({ Id: libraries.movies, ServerId: serverId }),
    ...Object.values(SETTINGS_HASHES).map((hash) => hash(admin.userId)),
    // The admin pages Lumen restyles (and links to from its settings menu).
    ...ADMIN_ROUTES.map((route) => (route === '/configurationpage' ? `#${route}?name=Lumen` : `#${route}`)),
  ];
  for (const hash of hashes) {
    await test.step(hash, async () => {
      await openFresh(page, hash);
      await expect(page.locator(NOT_FOUND), `${hash} is jellyfin-web's 404 page`).toHaveCount(0);
    });
  }
});
