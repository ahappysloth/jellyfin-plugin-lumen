import { expect, test } from '@playwright/test';
import { ADMIN } from '../support/api';
import { login } from '../support/login';

test('the Lumen dashboard page loads its settings', async ({ page }) => {
  await login(page, ADMIN);

  await page.goto('/web/#/configurationpage?name=Lumen');

  await expect(page.getByRole('group', { name: 'Home sections' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Move Continue Watching down/ })).toBeVisible();
});

test('the Dashboard wears Lumen’s look, and only on admin pages', async ({ page }) => {
  await login(page, ADMIN);
  const html = page.locator('html');
  await expect(page.locator('link[href*="lumen-dashboard.css"]')).toHaveCount(1);
  // The server's accent comes with the page, so the admin pages have it at first paint.
  expect(await page.locator('style').allTextContents()).toContain('html.lmn-skin-dashboard{--lmn-accent:#e30b17}');

  await page.goto('/web/#/dashboard');
  await expect(html).toHaveClass(/\blmn-skin-dashboard\b/);
  const restart = page.locator('.MuiButton-containedError').first();
  await expect(restart).toBeVisible();
  // Lumen's background on the drawer; destructive buttons outlined rather than filled.
  await expect(page.locator('.MuiDrawer-paper').first()).toHaveCSS('background-color', 'rgb(15, 15, 15)');
  await expect(restart).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // The Scan button carries the accent.
  await expect(page.locator('.MuiButton-containedPrimary').first()).toHaveCSS('background-color', 'rgb(227, 11, 23)');

  // jellyfin-web navigates with pushState; the look comes off on Lumen's own pages.
  await page.locator('.MuiDrawer-paper a[href="#/"]').first().click();
  await expect(html).not.toHaveClass(/lmn-skin-dashboard/);

  await page.goto('/web/#/metadata');
  await expect(html).toHaveClass(/\blmn-skin-dashboard\b/);
  await expect(page.locator('.editPageSidebar')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
});
