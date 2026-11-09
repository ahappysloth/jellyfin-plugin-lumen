import { expect, type Page, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

async function libraryId(type: 'movies' | 'tvshows'): Promise<string> {
  const { admin } = loadState();
  const views = await api<{ Items: { Id: string; CollectionType?: string }[] }>('/UserViews', {
    token: admin.token,
    query: { userId: admin.userId },
  });
  return views.Items.find((v) => v.CollectionType === type)!.Id;
}

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Library sections' });

test('Movies has Lumen tabs; Genres and Studios open their titles inside the library', async ({ page }) => {
  const movies = await libraryId('movies');
  await login(page, ADMIN);
  await page.goto(`/web/#/movies?topParentId=${movies}&collectionType=movies`);

  await expect(tabs(page).getByRole('link')).toHaveText(['Movies', 'Favorites', 'Collections', 'Genres', 'Studios']);

  await tabs(page).getByRole('link', { name: 'Genres' }).click();
  await expect(page).toHaveURL(/tab=4/);
  const action = page.locator('#lmn-root').getByRole('link', { name: /^Action/ });
  await expect(action).toBeVisible();
  await expect(action.getByText(/\d+ titles?/)).toBeVisible();
  await action.click();
  await expect(page.getByRole('heading', { name: 'Action', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lumen Alpha' })).toBeVisible();

  await page.goBack();
  await tabs(page).getByRole('link', { name: 'Studios' }).click();
  await page.locator('#lmn-root').getByRole('link', { name: /^Lumen Pictures/ }).click();
  await expect(page.getByRole('heading', { name: 'Lumen Pictures', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lumen Alpha' })).toBeVisible();
});

test.describe('library tabs with user data', () => {
  let collectionId: string | undefined;

  test.afterEach(async () => {
    const { admin, items } = loadState();
    await api(`/UserFavoriteItems/${items['Lumen Beta']}`, {
      method: 'DELETE',
      token: admin.token,
      query: { userId: admin.userId },
    });
    if (collectionId) await api('/Items', { method: 'DELETE', token: admin.token, query: { ids: collectionId } });
    collectionId = undefined;
  });

  test("Favorites and Collections list this library's favorites and collections", async ({ page }) => {
    const { admin, items } = loadState();
    const movies = await libraryId('movies');
    await api(`/UserFavoriteItems/${items['Lumen Beta']}`, {
      method: 'POST',
      token: admin.token,
      query: { userId: admin.userId },
    });
    collectionId = (
      await api<{ Id: string }>('/Collections', {
        method: 'POST',
        token: admin.token,
        query: { name: 'Lumen Tabs Trilogy', ids: [items['Lumen Alpha'], items['Lumen Gamma']].join(',') },
      })
    ).Id;
    await login(page, ADMIN);

    await page.goto(`/web/#/movies?topParentId=${movies}&collectionType=movies&tab=2`);
    const root = page.locator('#lmn-root');
    await expect(root.getByRole('button', { name: 'Lumen Beta' })).toBeVisible();
    await expect(root.getByRole('button', { name: 'Lumen Alpha' })).toHaveCount(0);

    await tabs(page).getByRole('link', { name: 'Collections' }).click();
    await expect(root.getByRole('button', { name: 'Lumen Tabs Trilogy' })).toBeVisible();
  });
});

test('Shows has an Episodes tab, newest first, opening the episode page', async ({ page }) => {
  const shows = await libraryId('tvshows');
  await login(page, ADMIN);
  await page.goto(`/web/#/tv?topParentId=${shows}&collectionType=tvshows&tab=5`);

  await expect(tabs(page).getByRole('link', { name: 'Episodes' })).toHaveAttribute('aria-current', 'page');
  const cards = page.locator('#lmn-root .lmn-browse-grid .lmn-card');
  await expect(cards).toHaveCount(6);
  await cards.first().click();
  await expect(page.locator('#lmn-root .lmn-details--episode')).toBeVisible();
});

test('tabs Lumen has not built stay stock', async ({ page }) => {
  const shows = await libraryId('tvshows');
  await login(page, ADMIN);
  await page.goto(`/web/#/tv?topParentId=${shows}&collectionType=tvshows&tab=2`);

  await expect(page.locator('#lmn-root')).toBeHidden();
});
