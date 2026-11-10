import { expect, test } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { login } from '../support/login';

test('TV layout: focus starts on the hero and arrow keys move through rows', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-button--primary')).toBeFocused();
  await expect(page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-button--primary')).toBeInViewport();

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#lmn-root .lmn-card:focus')).toHaveCount(1);
  const first = await page.locator('#lmn-root .lmn-card:focus').getAttribute('data-item-id');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#lmn-root .lmn-card:focus')).not.toHaveAttribute('data-item-id', first!);
});

test('TV layout: D-pad Right moves from an episode row to its details link and back', async ({ page }) => {
  const { items } = loadState();
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const series = page.locator('#lmn-root .lmn-details--series');
  const row = series.locator('.lmn-episode').first();
  await expect(row).toBeVisible();
  // The page moves focus to its own default once it has loaded; start from the first episode row only once that has
  // happened, i.e. focus put on the row stays there.
  await expect(async () => {
    await row.focus();
    await page.waitForTimeout(300);
    await expect(row).toBeFocused({ timeout: 100 });
  }).toPass({ timeout: 10_000 });

  // jellyfin-web's focus manager moves right only to an element whose right edge is past the row's.
  await page.keyboard.press('ArrowRight');
  await expect(series.locator('.lmn-episodes__details').first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(row).toBeFocused();
});
