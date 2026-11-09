import { expect, test } from '@playwright/test';
import { ADMIN, KID } from '../support/api';
import { login } from '../support/login';

test('search finds library titles as you type and keeps the query for Back', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Search' }).click();

  const box = page.getByRole('searchbox', { name: 'Search' });
  await expect(box).toBeFocused();
  await expect(page.locator('#reactRoot .skinBody').first()).toBeHidden();
  await box.fill('alpha');

  const movies = page.getByRole('list', { name: 'Movies' });
  await expect(movies.getByRole('button', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(page).toHaveURL(/#\/search\?query=alpha$/);

  await movies.getByRole('button', { name: 'Lumen Alpha' }).click();
  await expect(page).toHaveURL(/#\/details\?id=/);
  await page.goBack();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('alpha');
});

test('the settings menu links to the stock settings pages; admin links only for admins', async ({ page }) => {
  await login(page, KID);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings and profile' }).click();

  await expect(page.getByRole('heading', { name: 'kid', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Dashboard/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  await page.getByRole('link', { name: /Playback/ }).click();
  await expect(page).toHaveURL(/#\/mypreferencesplayback\?userId=/);
  await expect(page.locator('#lmn-root .lmn-profile')).toBeHidden();
});
