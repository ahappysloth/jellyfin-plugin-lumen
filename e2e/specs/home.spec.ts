import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';
import { expectPresentButHidden } from '../support/stock';

test('Lumen replaces the home screen with a hero and rows', { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-hero')).toBeVisible();
  // toBeVisible() passes for off-screen elements; the hero must be on screen, not pushed below the stock layout.
  await expect(page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-button--primary')).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Recently Added in Movies' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recently Added in Shows' })).toBeVisible();
  await expectPresentButHidden(page.locator('#reactRoot .skinBody'));
});

test('a cold load with a remembered sign-in still shows the Lumen home', { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();

  await page.reload();

  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
});

test.afterEach(async () => {
  const { admin, items } = loadState();
  await api(`/UserItems/${items['Lumen Beta']}/UserData`, {
    method: 'POST',
    token: admin.token,
    query: { userId: admin.userId },
    body: { PlaybackPositionTicks: 0 },
  });
});

test('a partially watched movie appears in Continue Watching', async ({ page }) => {
  const { admin, items } = loadState();
  await api(`/UserItems/${items['Lumen Beta']}/UserData`, {
    method: 'POST',
    token: admin.token,
    query: { userId: admin.userId },
    body: { PlaybackPositionTicks: 50_000_000, LastPlayedDate: new Date().toISOString() },
  });

  await login(page, ADMIN);

  await expect(page.getByRole('region', { name: 'Continue Watching' }).getByRole('button', { name: /Lumen Beta/ })).toBeVisible();
});
