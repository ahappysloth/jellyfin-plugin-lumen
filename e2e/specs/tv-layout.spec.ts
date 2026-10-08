import { expect, test } from '@playwright/test';
import { ADMIN } from '../support/api';
import { login } from '../support/login';

test('TV layout: focus starts on the hero and arrow keys move through rows', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-hero .lmn-button--primary')).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#lmn-root .lmn-card:focus')).toHaveCount(1);
  const first = await page.locator('#lmn-root .lmn-card:focus').getAttribute('data-item-id');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#lmn-root .lmn-card:focus')).not.toHaveAttribute('data-item-id', first!);
});
