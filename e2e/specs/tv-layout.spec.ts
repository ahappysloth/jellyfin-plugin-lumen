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
  const card = page.locator('#lmn-root .lmn-card:focus');
  await expect(card).not.toHaveAttribute('data-item-id', first!);
  // The remote's Menu key and long-press open a card's menu on TV: no More button as a second stop per card.
  await expect(page.locator('#lmn-root .lmn-card__more').first()).toBeHidden();

  // OK opens the focused card's page.
  const id = await card.getAttribute('data-item-id');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/(details|list)\\?.*Id=${id}`, 'i'));
});

test('TV layout: D-pad Right moves from an episode row to its details link and back', async ({ page }) => {
  const { items } = loadState();
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const series = page.locator('#lmn-root .lmn-details--series');
  // Play renders once the episodes have loaded; focus moves on to it from the Back button that stood in.
  await expect(series.locator('.lmn-details__header .lmn-button--primary')).toBeFocused();
  const row = series.locator('.lmn-episode').first();
  await expect(row).toBeVisible();
  // Start from the first episode row once focus put there stays there (nothing else takes it back mid-test).
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
