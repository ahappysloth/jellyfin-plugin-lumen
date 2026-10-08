import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

test('Lumen replaces the home screen with a hero and rows', async ({ page }) => {
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-hero')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recently Added in Movies' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recently Added in Shows' })).toBeVisible();
  await expect(page.locator('#reactRoot .skinBody').first()).toBeHidden();
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
