import { expect, test } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { login } from '../support/login';

test("Play hands off to jellyfin-web's own player", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();

  await expect(page).toHaveURL(/#\/video/);
  await expect(page.locator('video').first()).toBeVisible();
});
