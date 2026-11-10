import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';
import { expectPresentButHidden } from '../support/stock';

test('a genre page lists its movies and shows, with All / Movies / Shows', async ({ page }) => {
  const { admin } = loadState();
  // Science Fiction: Lumen Alpha (a movie) and Lumen Show (scripts/gen-test-media.sh).
  const genres = await api<{ Items: { Id: string; Name: string }[] }>('/Genres', {
    token: admin.token,
    query: { userId: admin.userId },
  });
  const genre = genres.Items.find((g) => g.Name === 'Science Fiction')!;
  await login(page, ADMIN);

  await page.goto(`/web/#/list?genreId=${genre.Id}`);

  await expect(page.getByRole('heading', { name: 'Science Fiction', level: 1 })).toBeVisible();
  await expectPresentButHidden(page.locator('#reactRoot .skinBody'));
  const grid = page.getByRole('list', { name: 'Science Fiction' });
  await expect(grid.getByRole('link', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(grid.getByRole('link', { name: 'Lumen Show' })).toBeVisible();

  const filter = page.getByRole('group', { name: 'Filter' });
  await filter.getByRole('button', { name: 'Shows' }).click();
  await expect(grid.getByRole('link', { name: 'Lumen Show' })).toBeVisible();
  await expect(grid.getByRole('link', { name: 'Lumen Alpha' })).toHaveCount(0);

  await filter.getByRole('button', { name: 'Movies' }).click();
  await expect(grid.getByRole('link', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(grid.getByRole('link', { name: 'Lumen Show' })).toHaveCount(0);
  await filter.getByRole('button', { name: 'All' }).click();
});

test('a person page, opened from the cast row, lists their titles in the library', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  await page.getByRole('region', { name: 'Cast' }).getByRole('button', { name: /Ada Vance/ }).click();

  await expect(page).toHaveURL(/#\/details\?id=/);
  await expect(page.getByRole('heading', { name: 'Ada Vance', level: 1 })).toBeVisible();
  const knownFor = page.getByRole('list', { name: 'Known for' });
  await expect(knownFor.getByRole('link', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(knownFor.getByRole('link', { name: 'Lumen Show' })).toBeVisible();
  await expect(page.locator('#itemDetailPage:not(.hide)')).toBeHidden();
});

test.describe('collections', () => {
  let collectionId: string | undefined;

  test.afterEach(async () => {
    if (collectionId) await api('/Items', { method: 'DELETE', token: loadState().admin.token, query: { ids: collectionId } });
    collectionId = undefined;
  });

  test('a collection page lists its titles oldest first, and the Collections library lists it', async ({ page }) => {
    const { admin, items } = loadState();
    collectionId = (
      await api<{ Id: string }>('/Collections', {
        method: 'POST',
        token: admin.token,
        query: { name: 'Lumen Trilogy', ids: [items['Lumen Gamma'], items['Lumen Alpha']].join(',') },
      })
    ).Id;
    await login(page, ADMIN);

    await page.goto(`/web/#/details?id=${collectionId}`);

    const details = page.locator('#lmn-root .lmn-details--collection');
    await expect(details.getByRole('heading', { name: 'Lumen Trilogy', level: 1 })).toBeVisible();
    const titles = page.getByRole('list', { name: 'In this collection' });
    await expect(titles.getByRole('link')).toHaveText([/Lumen Alpha/, /Lumen Gamma/]);
    await expect(details.getByRole('button', { name: 'Play' })).toBeVisible();

    // Jellyfin adds a Collections library once a collection exists; Lumen's nav links to it.
    const views = await api<{ Items: { Id: string; Name: string; CollectionType?: string }[] }>(
      `/Users/${admin.userId}/Views`,
      { token: admin.token },
    );
    const boxsets = views.Items.find((v) => v.CollectionType === 'boxsets');
    test.skip(!boxsets, 'this server shows no Collections library');
    await page.goto(`/web/#/list?parentId=${boxsets!.Id}&collectionType=boxsets`);
    await expect(page.getByRole('heading', { name: boxsets!.Name, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lumen Trilogy' })).toBeVisible();
  });
});
